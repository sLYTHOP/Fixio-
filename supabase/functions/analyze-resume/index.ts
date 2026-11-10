// Supabase Edge Function: analyze-resume
// Reads a resume from Storage, matches it against the role's knowledge_base
// entry, sends both to Claude, and returns structured skill-gap feedback.

import { createClient } from "npm:@supabase/supabase-js@2"
import { parseFeedback, planAttempts, runWithFallback } from "./llm.ts"
import { finalizeFeedback, parseEvidenceTerms, parseKnowledgeBase, parseSkillCatalog } from "./kb.ts"

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
// Comma-separated list, tried in order (a second model is the backup if the first is busy). Set the
// CLAUDE_MODELS secret to change it without touching code. CLAUDE_MODEL with a single name also works.
const CLAUDE_MODELS = (Deno.env.get("CLAUDE_MODELS") ?? Deno.env.get("CLAUDE_MODEL") ?? "claude-haiku-4-5-20251001")
  .split(",").map((m) => m.trim()).filter(Boolean)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
// New scans allowed per user in SCAN_WINDOW_DAYS days (DAILY_LIMIT still works as the old name), and new scans
// allowed across all users per 24 hours. Both protect paid credit. Raise them for testing, then set them back.
const SCAN_LIMIT = Number(Deno.env.get("SCAN_LIMIT") ?? Deno.env.get("DAILY_LIMIT") ?? "3")
const SCAN_WINDOW_DAYS = Number(Deno.env.get("SCAN_WINDOW_DAYS") ?? "30")
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get("GLOBAL_DAILY_LIMIT") ?? "30")
// Bump when analysis prompt or output semantics change.
const ANALYSIS_VERSION = "8"

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function buildAttempts() {
  return planAttempts({
    provider: LLM_PROVIDER,
    fallback: LLM_FALLBACK,
    geminiKey: GEMINI_API_KEY,
    geminiModels: GEMINI_MODELS,
    anthropicKey: ANTHROPIC_API_KEY,
    claudeModels: CLAUDE_MODELS,
  })
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
    const since = new Date(Date.now() - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { count, error: countError } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authedUser.id)
      .gte("created_at", since)
    if (countError) {
      console.error("Failed to check the scan limit:", countError)
      return json({ ok: false, reason: "rate_limit_check_error" }, 500)
    }
    if ((count ?? 0) >= SCAN_LIMIT) return json({ ok: false, reason: "rate_limited" })

    // Across all users, per 24 hours: a safety stop for the paid credit.
    const daySince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: dayCount, error: dayError } = await supabase
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .gte("created_at", daySince)
    if (dayError) {
      console.error("Failed to check the overall scan limit:", dayError)
      return json({ ok: false, reason: "rate_limit_check_error" }, 500)
    }
    if ((dayCount ?? 0) >= GLOBAL_DAILY_LIMIT) return json({ ok: false, reason: "busy_today" })

    let binary = ""
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)

    // 3. Build the prompt and call Claude
    const today = new Date().toISOString().slice(0, 10)
    const kbItems = parseKnowledgeBase(kb.content)
    const mustIds = kbItems.filter((i) => i.tier === "MH").map((i) => i.id)

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
- Split the resume into items and give EVERY item a verdict under "items", so that all the content of the resume is covered. One item for each: individual skill listed in a skills section (split every list on its commas, so each tool, technique or concept gets its own item, and never put skills of different fit in one item; the excerpt is just that skill's own words), bullet point under an experience entry or project (one item per bullet), certification or course, line of education detail, and sentence or line of a summary or profile. Do not make items for the candidate's name, contact details, section headings, dates, employer and institution names, or extracurricular, volunteering and hobby sections.
- Verdicts, which decide the colors. For SKILLS set "fit": "core" = names a concept, tool or skill that one of the knowledge base items describes; "adjacent" = a security skill the role does not rely on day to day (for example offensive testing tools such as Kali Linux, Burp Suite or Nmap, privacy or compliance frameworks); "offrole" = an IT, software or professional skill with no use in this role (for example web design, databases, a code editor, spreadsheets, product management); "unrelated" = nothing to do with security or IT work (for example presentation software, an unrelated course); "soft" = a soft skill such as communication, teamwork or analytical thinking. For CERTIFICATIONS set certLevel. For EXPERIENCE entries and PROJECTS set roleWork. The "verdict" you give every item must agree with that: "relevant", "weak" (related but not what the role asks for, or without enough evidence) or "irrelevant" (nothing to do with security or IT). Map an item to a knowledge base item (kbItems) only if it matches that item's own wording: a related but different activity (for example hands-on offensive testing compared with supporting vulnerability management) is not a match.
- Soft skills are never a problem: fit "soft", verdict "relevant". Skills that are normal in security teams today (for example AI or prompt engineering, research skills) are "adjacent", not "unrelated".
- kbItems for a skill lists only the knowledge base items it directly supports. A tool or skill that the knowledge base does not name and that the role does not use day to day (for example offensive testing tools, or non-security skills) gets [] for kbItems.
- "skillsMissing": the IDs of up to 5 knowledge base items of the kind a skills section lists (tools, platforms, techniques, concepts) that a strong skills section for this role would show but the candidate's skills section does not. Most important first. [] if the skills section already covers them. Never include [PA#] items.
- "skillIdeas": up to 8 short names (one to four words each, such as a tool, platform or technique) taken from the knowledge base items your skillsMissing refer to, that a candidate could list in a skills section instead of a weak skill. Most useful first. Plain names only, no sentences.
- "handsOnIdeas": up to 3 hands-on project or lab ideas taken from the knowledge base (for example from its fix ideas), each one short sentence that names the tool and what to produce. Used to tell the candidate what to build when no experience or project shows the role's work.
- "roleWork" is for experience entries and project bullets only (null for everything else). "clear" = shows work the role does day to day (as described by the must-have items) AND gives enough evidence: the tool or platform used, what was done, and the outcome or scale. "thin" = mentions that kind of work but without enough evidence: a keyword such as "log monitoring" or "incident response" on its own is "thin", not "clear". "none" = security-related or not, but not the role's day-to-day work (for example vulnerability testing, writing security documentation, building a model). Be strict: when in doubt, choose the lower level.
- "evidence" is for experience entries and project bullets only (null for everything else): three exact quotes copied from that bullet, or null for each. tool = the words naming a specific tool, platform or technique actually used. action = the words saying what the candidate personally did; "supported", "assisted", "contributed to", "helped", "worked on" and "learned" are not actions. result = the words giving a number, an outcome or a deliverable. Do not decide whether the bullet is the role's work: the code decides that from your quotes. Only quote words that really are in the bullet.
- A project or experience that is not SOC work is "weak", not "irrelevant", when it still shows items the knowledge base asks for. State plainly that it is not SOC-related, say which items it does support in kbItems, and name which bullets to reword toward SOC work (alert handling, log analysis, triage, documentation).
- Certifications: a certification the knowledge base names as common for this role is "relevant", and one in progress is fine to list. A course badge or a certification the postings do not name is "weak": say gently that it carries less weight than a certification, and point to the next step on the knowledge base's certification ladder or fix ideas. A certification unrelated to security and IT is "irrelevant". For every certification item also set certLevel: "role" = aimed at the work of this role or above the foundational level on the knowledge base's ladder, "foundational" = an entry-level security or IT certification, "unrelated" = not about security or IT. Under "nextCerts" list up to 3 certification names from the knowledge base that are the next step beyond what the candidate already holds ([] if the candidate already holds role-level ones). Only suggest certifications that appear in the knowledge base. Never suggest adding, renaming or splitting sections: the resume is one page.
- Every item has: section (the exact heading as printed in the resume), kind (skill, experience, project, certification, education or other), excerpt (an exact quote copied from the resume; for skills, certifications and education ONE single line of at most 15 words, never joined across lines; for experience and project items the WHOLE bullet point exactly as written, even when it wraps over two lines; null only if there is nothing to quote), verdict, kbItems (IDs of the knowledge base items the item supports, [] if none), and for "weak" and "irrelevant" items also issue (what is weak and why it matters, one or two sentences) and solution (one or two sentences). For "relevant" items, issue and solution are null. Also fit (skills only), roleWork and evidence (experience and projects only) and certLevel (certifications only); null for the others.
- Tone: polite and encouraging, written to the candidate. "issue" says only WHY the item is flagged, in one sentence, with no advice. "solution" says what to do, in one or two sentences. Start every solution with a different word and never start more than two with the same word; use verbs such as Add, Name, Swap, Show, Try, Mention, Reword, Pair. Say exactly which words are meant and what to put instead, and name the exact skill, bullet, project or certification. For an item in a skills list never tell the candidate to "explain how it was used": suggest showing it in a bullet instead. For an experience or project bullet that is not the role's work, the "issue" first says in a few words what does carry over to the role (for example log analysis or SQL as a base for SIEM queries), if anything, then what is missing.
- Assess EVERY [MH#] item and list it under "mustHaves" with a status: "present" (clearly shown in the resume), "partial" (only hinted at, or weak) or "missing". Give evidence as a short exact quote from the resume, or null when missing. Never mark an item "present" without a quote. Look for synonyms and related wording before marking an item missing (a project that triages alerts shows alert triage even if the word "runbook" never appears). Tool names in the knowledge base are examples of a concept, never required. A keyword alone is not evidence: "present" needs what was done, with which tool, and the outcome or scale; a bullet that only says "log monitoring" or "incident response" is "partial". For "partial" and "missing" items also give section (the resume section where the fix belongs) and solution (one concrete sentence). When an item combines a tool or platform with an activity, naming or using the platform is needed for "present"; the activity alone is "partial". Never raise an issue about a must-have you marked "present". Never leave out an [MH#] item: every one must appear under "mustHaves".
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
      "fit": "core | adjacent | offrole | unrelated | soft, for skills only, else null",
      "roleWork": "clear | thin | none, for experience and projects only, else null",
      "evidence": {"tool": "exact words from the bullet or null", "action": "exact words from the bullet or null", "result": "exact words from the bullet or null"},
      "certLevel": "role | foundational | unrelated, for certifications only, else null",
      "issue": "what is weak and why it matters, or null when relevant",
      "solution": "a concrete, role-relevant way to improve it, or null when relevant"
    }
  ],
  "skillsMissing": ["SP3", "NH13"],
  "skillIdeas": ["Linux", "Python scripting"],
  "handsOnIdeas": ["Triage sample alerts in a free SIEM and write each case up as a ticket-style note"],
  "nextCerts": ["certification name from the knowledge base"],
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
        // Every must-have has to be assessed, otherwise the answer is retried.
        return p !== null && p.items.length > 0 && mustIds.every((id) => p.mustHaves.some((m) => m.id === id))
      },
    })
    if (!llm.ok) {
      console.error("All model attempts failed:", llm.detail)
      return json({ ok: false, reason: llm.reason, detail: llm.detail })
    }

    const parsed = parseFeedback(llm.text)
    if (!parsed) return json({ ok: false, reason: "parse_error" })
    const final = finalizeFeedback(parsed, kbItems, kb.role_label, parseEvidenceTerms(kb.content), parseSkillCatalog(kb.content))

    // 4. Persist the result so the user can revisit it later.
    const { error: saveError } = await supabase.from("feedback").insert({
      user_id: authedUser.id,
      role,
      level,
      resume_path: resumePath,
      analysis_key: analysisKey,
      result: { ...final, meta: { provider: llm.provider, model: llm.model, tried: llm.tried, usage: llm.usage ?? null } },
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
