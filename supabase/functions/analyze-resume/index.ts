// Supabase Edge Function: analyze-resume
// Reads a resume from Storage, matches it against the role's knowledge_base
// entry, sends both to Claude, and returns structured skill-gap feedback.

import { createClient } from "npm:@supabase/supabase-js@2"
import { parseFeedback, runWithFallback, type Attempt } from "./llm.ts"
import { finalizeFeedback, parseKnowledgeBase } from "./kb.ts"

// Which model answers: set LLM_PROVIDER to "gemini" or "claude" (default claude).
const LLM_PROVIDER = (Deno.env.get("LLM_PROVIDER") ?? "claude").toLowerCase()
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? ""
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? ""
// Comma-separated list, tried in order: best model first, a lighter or less busy one after.
// (GEMINI_MODEL with a single name still works.)
const GEMINI_MODELS = (Deno.env.get("GEMINI_MODELS") ?? Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash")
  .split(",").map((m) => m.trim()).filter(Boolean)
// Optional second provider, used only if the first one keeps failing: "claude", "gemini" or "none" (default).
const LLM_FALLBACK = (Deno.env.get("LLM_FALLBACK") ?? "none").toLowerCase()
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const DAILY_LIMIT = Number(Deno.env.get("DAILY_LIMIT") ?? "5") // scans per user per 24h, protects paid credit. Raise it for testing.
// Bump when analysis prompt or output semantics change.
const ANALYSIS_VERSION = "1"

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function buildAttempts(): Attempt[] {
  const gemini = (): Attempt[] =>
    GEMINI_API_KEY ? GEMINI_MODELS.map((model) => ({ provider: "gemini" as const, model, apiKey: GEMINI_API_KEY, tries: 2 })) : []
  const claude = (): Attempt[] =>
    ANTHROPIC_API_KEY ? [{ provider: "claude" as const, model: CLAUDE_MODEL, apiKey: ANTHROPIC_API_KEY, tries: 2 }] : []
  const order = [LLM_PROVIDER, ...(LLM_FALLBACK !== "none" && LLM_FALLBACK !== LLM_PROVIDER ? [LLM_FALLBACK] : [])]
  return order.flatMap((p) => (p === "gemini" ? gemini() : p === "claude" ? claude() : []))
}

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
    const resumeFingerprint = await sha256Hex(bytes)
    const knowledgeBaseFingerprint = await sha256Hex(new TextEncoder().encode(kb.content))
    const normalizedLevel = level === "switcher" ? "switcher" : "fresher"
    const analysisKey = await sha256Hex(new TextEncoder().encode(JSON.stringify({
      resumeFingerprint,
      roleKey,
      level: normalizedLevel,
      knowledgeBaseFingerprint,
      analysisVersion: ANALYSIS_VERSION,
    })))

    // Reuse an exact-file analysis for this user and these analysis inputs.
    const { data: matchingFeedback, error: lookupError } = await supabase
      .from("feedback")
      .select("result")
      .eq("user_id", authedUser.id)
      .eq("analysis_key", analysisKey)
      .maybeSingle()
    if (lookupError) {
      console.error("Failed to look up reusable feedback:", lookupError)
      return json({ ok: false, reason: "feedback_lookup_error" }, 500)
    }
    if (matchingFeedback) return json({ ok: true, result: matchingFeedback.result, reused: true })

    // Reused analyses do not consume the per-user daily scan limit.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authedUser.id)
      .gte("created_at", since)
    if (countError) {
      console.error("Failed to check the daily scan limit:", countError)
      return json({ ok: false, reason: "rate_limit_check_error" }, 500)
    }
    if ((count ?? 0) >= DAILY_LIMIT) return json({ ok: false, reason: "rate_limited" })

    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    // 3. Build the prompt and call Claude
    const today = new Date().toISOString().slice(0, 10)
    const kbItems = parseKnowledgeBase(kb.content)
    const hasMustHaves = kbItems.some((i) => i.tier === "MH")

    const systemPrompt = `You are Fixio's resume analyst. You evaluate a fresher's resume against a knowledge base of what the target role asks for. The knowledge base is built from real job postings. Items marked [PA#] come from practitioner input and are still pending review.

Today's date: ${today}
Target role: ${kb.role_label}
Candidate level: ${level === "switcher" ? "career switcher" : "fresher"}

Knowledge base for this role:
---
${kb.content}
---

Instructions:
- Knowledge base items carry IDs: [MH#] must-have, [SP#] strongly preferred, [NH#] nice-to-have, [PA#] practitioner-added (not from job postings, pending review).
- Assess EVERY [MH#] item and list it under "mustHaves" with a status: "present" (clearly shown in the resume), "partial" (only hinted at, or weak) or "missing". Give evidence as a short exact quote from the resume, or null when missing. Never mark an item "present" without a quote. Look for synonyms and related wording before marking an item missing (a project that triages alerts shows alert triage even if the word "runbook" never appears).
- Identify genuine strengths (clearly present and relevant) as short phrases of at most 12 words, and genuine gaps. Base gaps mainly on [MH#] and [SP#] items. Raise [NH#] or [PA#] items only when the resume shows no sign of them, and at most 2 such issues in total. Never present an [NH#] or [PA#] item as a major problem.
- For every genuine gap and each weak resume passage, create an issue with a concise solution. Use the exact section heading as printed in the resume. If the issue concerns missing content, set excerpt to null so the section heading can be highlighted. If the issue concerns weak content that is present, excerpt must be an exact, contiguous quote copied from the resume PDF. Set kbItem to the ID of the knowledge base item the issue comes from (for example "MH6"), or null when the issue is about wording or clarity rather than a knowledge base item.
- Where the resume is already strong in an area, say so under strengths and do not create an issue for it. Do not invent gaps to fill the output. Fewer real issues are better than many weak ones.
- Dates: today is ${today}. Any date on or before today is valid, even a recent one. Raise a date issue only if a date is after today or an end date is before its start date.
- Formatting: raise at most 1 formatting issue, and only for a real problem that would hurt shortlisting (for example unreadable sections or missing contact details).
- Also flag up to 2 resume bullet points that read as vague or generic (lacking tools, scale or outcome). Never accuse the candidate of lying. Note what an interviewer would ask and what detail would make the bullet convincing.
- Give 2-4 concrete suggestions (certs, projects, learning paths) drawn from the knowledge base to close the real gaps.
- Respond with ONLY valid JSON, no prose before or after, in this exact shape:
{
  "strengths": ["short phrase", "..."],
  "mustHaves": [{"id": "MH1", "status": "present | partial | missing", "evidence": "short exact quote from the resume, or null"}],
  "gaps": ["short phrase with a brief why-it-matters", "..."],
  "issues": [
    {
      "section": "exact resume section heading",
      "excerpt": "exact contiguous resume text, or null when the skill/detail is missing",
      "issue": "what is weak or missing and why it matters",
      "solution": "a concrete, role-relevant way to improve it",
      "kbItem": "ID of the knowledge base item, or null"
    }
  ],
  "suggestions": ["specific actionable suggestion", "..."],
  "vagueBullets": [{"original": "...", "suggestion": "..."}]
}`

    const userText = "Analyze this resume per your instructions and return only the JSON."

    const attempts = buildAttempts()
    if (!attempts.length) {
      console.error(`No usable AI provider: LLM_PROVIDER=${LLM_PROVIDER}, LLM_FALLBACK=${LLM_FALLBACK}. Check the GEMINI_API_KEY / ANTHROPIC_API_KEY secrets.`)
      return json({ ok: false, reason: "llm_error", detail: "no provider configured" })
    }

    // Retries, model fallback and timeouts happen here, silently. The user just waits a bit longer.
    const llm = await runWithFallback(attempts, { systemPrompt, userText, pdfBase64: base64 }, {
      validate: (text) => {
        const p = parseFeedback(text)
        return p !== null && (!hasMustHaves || p.mustHaves.length > 0)
      },
    })
    if (!llm.ok) {
      console.error("All model attempts failed:", llm.detail)
      return json({ ok: false, reason: llm.reason, detail: llm.detail })
    }

    const parsed = parseFeedback(llm.text)
    if (!parsed) return json({ ok: false, reason: "parse_error" })
    const final = finalizeFeedback(parsed, kbItems)

    // 4. Persist the result so the user can revisit it later.
    const { error: saveError } = await supabase.from("feedback").insert({
      user_id: authedUser.id,
      role,
      level,
      resume_path: resumePath,
      analysis_key: analysisKey,
      result: { ...final, meta: { provider: llm.provider, model: llm.model, tried: llm.tried } },
    })
    if (saveError) {
      if (saveError.code === "23505") {
        const { data: existingFeedback, error: lookupError } = await supabase
          .from("feedback")
          .select("result")
          .eq("user_id", authedUser.id)
          .eq("analysis_key", analysisKey)
          .maybeSingle()
        if (!lookupError && existingFeedback) {
          return json({ ok: true, result: existingFeedback.result, reused: true })
        }
        if (lookupError) console.error("Failed to load concurrently saved feedback:", lookupError)
      }
      console.error("Failed to save feedback:", saveError)
      return json({ ok: false, reason: "feedback_save_error" }, 500)
    }

    return json({ ok: true, result: final })
  } catch (e) {
    console.error(e)
    return json({ ok: false, reason: "unexpected_error" }, 500)
  }
})
