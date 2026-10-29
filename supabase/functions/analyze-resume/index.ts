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
const ANALYSIS_VERSION = "3"

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
- Review the WHOLE resume, section by section. Do not stop after the first problems you find and do not skip a section.
- Split the resume into items and give EVERY item a verdict under "items", so that all the content of the resume is covered. One item for each: skill or group of skills on one line of a skills section, bullet point under an experience entry or project (one item per bullet), certification or course, line of education detail, and sentence or line of a summary or profile. Do not make items for the candidate's name, contact details, section headings, dates, or employer and institution names.
- Verdicts: "relevant" = clearly shows something this role asks for in the knowledge base. "weak" = related to the role but thin, basic, vague or only partly showing what the role asks for. "irrelevant" = shows nothing this role asks for.
- Judge the resume as a whole. Skills that are not SOC-specific but are normal in security teams today (for example AI or prompt engineering, research skills, analytical reasoning, communication) are fine and count as "relevant" when the rest of the resume is on topic. Flag a non-security skill (for example product management) as "weak" only because it takes space from relevant skills, and say so gently. If most of the resume is off-topic, say that plainly instead.
- Security skills that SOC teams use less (for example offensive testing tools) are "relevant" when the resume also shows related work such as vulnerability assessment.
- A project or experience that is not SOC work is "weak", not "irrelevant", when it still shows items the knowledge base asks for. State plainly that it is not SOC-related, say which items it does support in kbItems, and name which bullets to reword toward SOC work (alert handling, log analysis, triage, documentation).
- Certifications: a certification the knowledge base names as common for this role is "relevant", and one in progress is fine to list. A course badge or a certification the postings do not name is "weak": say gently that it carries less weight than a certification, and point to the next step on the knowledge base's certification ladder or fix ideas. Only suggest certifications that appear in the knowledge base. Never suggest adding, renaming or splitting sections: the resume is one page.
- Every item has: section (the exact heading as printed in the resume), kind (skill, experience, project, certification, education or other), excerpt (an exact quote copied from ONE single line of the resume, at most 15 words, never joined across lines; null only if there is nothing to quote), verdict, kbItems (IDs of the knowledge base items the item supports, [] if none), and for "weak" and "irrelevant" items also issue (what is weak and why it matters, one or two sentences) and solution (one or two sentences). For "relevant" items, issue and solution are null.
- Tone of every issue and solution: polite and encouraging, written to the candidate ("consider", "you could"). Never say "remove", "replace" or "list this under" without saying exactly which words are meant and what to put instead. Name the exact skill, bullet, project or certification the fix is about. For an item in a skills list, never tell the candidate to "explain how it was used": a skills list only holds keywords. Suggest showing it in a bullet instead.
- Assess EVERY [MH#] item and list it under "mustHaves" with a status: "present" (clearly shown in the resume), "partial" (only hinted at, or weak) or "missing". Give evidence as a short exact quote from the resume, or null when missing. Never mark an item "present" without a quote. Look for synonyms and related wording before marking an item missing (a project that triages alerts shows alert triage even if the word "runbook" never appears). Tool names in the knowledge base are examples of a concept, never required. For "partial" and "missing" items also give section (the resume section where the fix belongs) and solution (one concrete sentence). Never raise an issue about a must-have you marked "present".
- Under "issues" put only problems that no single item shows: content the resume lacks entirely (excerpt null, section = the heading where it belongs), date problems, and formatting problems. Give each a kind: "missing" (content that should be there), "error" (a date after today or an end date before its start date, missing contact details, unreadable sections) or "weak". Set kbItem to the knowledge base item ID it comes from, or null. Do not repeat a problem already covered by an item. Base missing content mainly on [MH#] and [SP#] items. Never present an [NH#] or [PA#] item as a major problem.
- Where the resume is already strong in an area, mark the items "relevant" and say so under strengths, as plain short phrases of at most 12 words with no praise words such as "gold-standard". Do not invent gaps. Every weak or irrelevant verdict must be real and specific to the resume.
- Dates: today is ${today}. Any date on or before today is valid, even a recent one. Raise a date issue only if a date is after today or an end date is before its start date.
- Also flag resume bullet points that read as vague or generic (lacking tools, scale or outcome), up to 5. Never accuse the candidate of lying. Note what an interviewer would ask and what detail would make the bullet convincing.
- Give 4-6 suggestions under "suggestions", ordered by impact for THIS resume, each naming the exact item it is about and drawn from the knowledge base. Order: finishing certifications that are in progress first; then fixes for missing must-haves; then linking off-target projects or experience to SOC work; then writing stronger SOC-focused bullets; then further learning. Do not repeat what an issue already says word for word.
- Keep every sentence short. Respond with ONLY valid JSON, no prose before or after, in this exact shape:
{
  "strengths": ["short phrase", "..."],
  "items": [
    {
      "section": "exact resume section heading",
      "kind": "skill | experience | project | certification | education | other",
      "excerpt": "exact contiguous resume text",
      "verdict": "relevant | weak | irrelevant",
      "kbItems": ["MH1", "SP2"],
      "issue": "what is weak and why it matters, or null when relevant",
      "solution": "a concrete, role-relevant way to improve it, or null when relevant"
    }
  ],
  "mustHaves": [{"id": "MH1", "status": "present | partial | missing", "evidence": "short exact quote from the resume, or null", "section": "where the fix belongs, or null when present", "solution": "one concrete sentence, or null when present"}],
  "gaps": ["short phrase with a brief why-it-matters", "..."],
  "issues": [
    {
      "section": "exact resume section heading",
      "excerpt": "exact contiguous resume text, or null when the skill/detail is missing",
      "kind": "missing | error | weak",
      "issue": "what is missing or wrong and why it matters",
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
      // The answer is longer now (it lists every resume item), so each call gets more time. The
      // total stays under the 150 second limit on the Supabase free plan.
      timeoutMs: 55_000,
      softDeadlineMs: 80_000,
      validate: (text) => {
        const p = parseFeedback(text)
        return p !== null && p.items.length > 0 && (!hasMustHaves || p.mustHaves.length > 0)
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
