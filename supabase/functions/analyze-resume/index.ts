// Supabase Edge Function: analyze-resume
// Reads a resume from Storage, matches it against the role's knowledge_base
// entry, sends both to Claude, and returns structured skill-gap feedback.

import { createClient } from "npm:@supabase/supabase-js@2"
import { callClaude, callGemini, parseFeedback } from "./llm.ts"

// Which model answers: set LLM_PROVIDER to "gemini" or "claude" (default claude).
const LLM_PROVIDER = (Deno.env.get("LLM_PROVIDER") ?? "claude").toLowerCase()
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? ""
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash" // names change often, set GEMINI_MODEL to override
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const DAILY_LIMIT = Number(Deno.env.get("DAILY_LIMIT") ?? "5") // scans per user per 24h, protects paid credit. Raise it for testing.

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() })

  try {
    const { role, level, resumePath } = await req.json()
    if (!role || !resumePath) return json({ ok: false, reason: "bad_request" }, 400)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 0. Require a logged-in user. The public anon key alone must not trigger paid calls.
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? ""
    const { data: userData } = await supabase.auth.getUser(token)
    const authedUser = userData?.user
    if (!authedUser) return json({ ok: false, reason: "unauthorized" }, 401)

    // Users may only analyze files inside their own storage folder.
    if (!resumePath.startsWith(`${authedUser.id}/`)) return json({ ok: false, reason: "forbidden" }, 403)

    // Per-user daily cap.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authedUser.id)
      .gte("created_at", since)
    if ((count ?? 0) >= DAILY_LIMIT) return json({ ok: false, reason: "rate_limited" })

    // 1. Look up the knowledge base entry for this role
    const roleKey = slugify(role)
    const { data: kb, error: kbError } = await supabase
      .from("knowledge_base")
      .select("content, role_label")
      .eq("role_key", roleKey)
      .single()

    if (kbError || !kb) return json({ ok: false, reason: "no_knowledge_base" })

    // 2. Download the resume file
    const { data: fileBlob, error: fileError } = await supabase.storage
      .from("resumes")
      .download(resumePath)

    if (fileError || !fileBlob) return json({ ok: false, reason: "file_not_found" })

    const isPdf = resumePath.toLowerCase().endsWith(".pdf")
    if (!isPdf) {
      // DOCX support comes later (needs text extraction via mammoth) — PDF only for now.
      return json({ ok: false, reason: "unsupported_file_type" })
    }

    const arrayBuffer = await fileBlob.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    // 3. Build the prompt and call Claude
    const systemPrompt = `You are Fixio's resume analyst. You evaluate a fresher's resume against a curated knowledge base of what the target role actually requires, built from real job descriptions and reviewed for accuracy.

Target role: ${kb.role_label}
Candidate level: ${level === "switcher" ? "career switcher" : "fresher"}

Knowledge base for this role:
---
${kb.content}
---

Instructions:
- Compare the resume against the knowledge base above. Identify genuine strengths (skills/experience clearly present and relevant), genuine gaps (things the knowledge base says matter that are missing or weak), and 2-4 concrete, actionable suggestions (specific certs, projects, or learning paths drawn from the knowledge base) to close those gaps.
- For every genuine gap and each weak resume passage, create an issue with a concise solution. Use the exact section heading as printed in the resume. If the issue concerns missing content, set excerpt to null so the section heading can be highlighted. If the issue concerns weak content that is present, excerpt must be an exact, contiguous quote copied from the resume PDF.
- Also flag up to 2 resume bullet points that read as vague or generic (lacking specifics like tools used, scale, or outcome). Never accuse the candidate of lying — just note the bullet could be more specific.
- Be honest and specific. Do not pad the strengths list with things not actually supported by the resume text.
- Respond with ONLY valid JSON, no prose before or after, in this exact shape:
{
  "strengths": ["short phrase", "..."],
  "gaps": ["short phrase with a brief why-it-matters", "..."],
  "issues": [
    {
      "section": "exact resume section heading",
      "excerpt": "exact contiguous resume text, or null when the skill/detail is missing",
      "issue": "what is weak or missing and why it matters",
      "solution": "a concrete, role-relevant way to improve it"
    }
  ],
  "suggestions": ["specific actionable suggestion", "..."],
  "vagueBullets": [{"original": "...", "suggestion": "..."}]
}`

    const userText = "Analyze this resume per your instructions and return only the JSON."
    const useGemini = LLM_PROVIDER === "gemini"
    const apiKey = useGemini ? GEMINI_API_KEY : ANTHROPIC_API_KEY
    const model = useGemini ? GEMINI_MODEL : CLAUDE_MODEL

    if (!apiKey) {
      console.error(`Missing API key secret for provider "${LLM_PROVIDER}" (${useGemini ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"})`)
      return json({ ok: false, reason: "llm_error" })
    }

    const llm = await (useGemini ? callGemini : callClaude)({
      apiKey, model, systemPrompt, userText, pdfBase64: base64,
    })
    if (!llm.ok) return json({ ok: false, reason: llm.reason })

    const parsed = parseFeedback(llm.text)
    if (!parsed) {
      console.error("Could not use model output:", llm.text.slice(0, 500))
      return json({ ok: false, reason: "parse_error" })
    }

    // 4. Save to feedback table (best-effort — don't fail the request if this fails)
    await supabase.from("feedback").insert({
      user_id: authedUser.id,
      role,
      level,
      resume_path: resumePath,
      result: { ...parsed, meta: { provider: LLM_PROVIDER, model } },
    })

    return json({ ok: true, result: parsed })
  } catch (e) {
    console.error(e)
    return json({ ok: false, reason: "unexpected_error" }, 500)
  }
})
