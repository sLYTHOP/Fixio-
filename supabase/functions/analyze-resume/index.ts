// Supabase Edge Function: analyze-resume
// Reads a resume from Storage, matches it against the role's knowledge_base
// entry, sends both to Claude, and returns structured skill-gap feedback.

import { createClient } from "npm:@supabase/supabase-js@2"

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

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
- Separately, flag up to 2 resume bullet points that read as vague or generic (lacking specifics like tools used, scale, or outcome) and briefly note what detail would make them more convincing. Never accuse the candidate of lying — just note the bullet could be more specific.
- Be honest and specific. Do not pad the strengths list with things not actually supported by the resume text.
- Respond with ONLY valid JSON, no prose before or after, in this exact shape:
{
  "strengths": ["short phrase", "..."],
  "gaps": ["short phrase with a brief why-it-matters", "..."],
  "suggestions": ["specific actionable suggestion", "..."],
  "vagueBullets": [{"original": "...", "suggestion": "..."}]
}`

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
              { type: "text", text: "Analyze this resume per your instructions and return only the JSON." },
            ],
          },
        ],
      }),
    })

    if (!anthropicRes.ok) {
      console.error("Anthropic API error:", await anthropicRes.text())
      return json({ ok: false, reason: "llm_error" })
    }

    const anthropicJson = await anthropicRes.json()
    const textBlock = anthropicJson.content?.find((b: any) => b.type === "text")

    let parsed
    try {
      const cleaned = (textBlock?.text || "").replace(/```json|```/g, "").trim()
      parsed = JSON.parse(cleaned)
    } catch {
      console.error("Failed to parse Claude response:", textBlock?.text)
      return json({ ok: false, reason: "parse_error" })
    }

    // 4. Save to feedback table (best-effort — don't fail the request if this fails)
    const authHeader = req.headers.get("Authorization")?.replace("Bearer ", "") ?? ""
    const { data: userData } = await supabase.auth.getUser(authHeader)

    await supabase.from("feedback").insert({
      user_id: userData?.user?.id ?? null,
      role,
      level,
      resume_path: resumePath,
      result: parsed,
    })

    return json({ ok: true, result: parsed })
  } catch (e) {
    console.error(e)
    return json({ ok: false, reason: "unexpected_error" }, 500)
  }
})
