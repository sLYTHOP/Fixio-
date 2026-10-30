// Model calls for analyze-resume. Two providers, same prompt, same output shape.

export type CallOpts = {
  apiKey: string
  model: string
  systemPrompt: string
  userText: string
  pdfBase64: string
  timeoutMs?: number
}
export type LlmFail = { ok: false; reason: string; status?: number; transient: boolean; detail: string }
export type Usage = { inputTokens: number | null; outputTokens: number | null }
export type LlmResult = { ok: true; text: string; usage?: Usage } | LlmFail
type FetchFn = typeof fetch

export type ItemVerdict = "relevant" | "weak" | "irrelevant"
export type IssueKind = "missing" | "weak" | "error"
// One thing on the resume (a skill, a job, a project, a certification...) with a verdict on it.
export type Item = {
  section: string
  kind: string // skill | experience | project | certification | education | other
  excerpt: string | null
  verdict: ItemVerdict
  kbItems: string[]
  roleWork: boolean | null // experience and projects only: shows work the role does day to day
  issue: string | null
  solution: string | null
}

export type Feedback = {
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  issues: { section: string; excerpt: string | null; issue: string; solution: string; kbItem: string | null; kind?: IssueKind | null }[]
  items: Item[]
  skillsMissing: string[] // knowledge base item ids a strong skills section would show but this one lacks
  mustHaves: { id: string; status: string; evidence: string | null; section?: string | null; solution?: string | null }[]
  vagueBullets: { original: string; suggestion: string }[]
}

// ---------- Request plumbing ----------

// Temporary problems worth retrying: busy (503, 529), rate limited (429), server hiccups.
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 529])
const DEFAULT_TIMEOUT_MS = 40_000

type Raw = { ok: boolean; status: number; text: string }

// POSTs JSON with a hard timeout. Never throws: a network error or timeout comes back as a
// transient failure, so the caller can retry or move on to another model.
async function postJson(
  fetchFn: FetchFn,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<{ raw: Raw } | { fail: LlmFail }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal })
    return { raw: { ok: res.ok, status: res.status, text: await res.text() } }
  } catch (e) {
    const detail = ctrl.signal.aborted ? `timeout after ${timeoutMs}ms` : `network error: ${(e as Error).message}`
    return { fail: { ok: false, reason: "llm_error", transient: true, detail } }
  } finally {
    clearTimeout(timer)
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

// Short, safe-to-log description of a provider error body.
function shortMsg(body: string): string {
  try {
    const m = JSON.parse(body)?.error?.message
    if (typeof m === "string") return m.slice(0, 160)
  } catch { /* not JSON */ }
  return body.slice(0, 160)
}

// ---------- Claude ----------

export async function callClaude(o: CallOpts, fetchFn: FetchFn = fetch): Promise<LlmResult> {
  const out = await postJson(
    fetchFn,
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": o.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    {
      model: o.model,
      max_tokens: 8000, // the answer lists every resume item, so it is longer than before
      temperature: 0.2,
      system: o.systemPrompt,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: o.pdfBase64 } },
          { type: "text", text: o.userText },
        ],
      }],
    },
    o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if ("fail" in out) {
    console.error(`Claude (${o.model}) request failed:`, out.fail.detail)
    return out.fail
  }
  const { raw } = out
  if (!raw.ok) {
    console.error(`Claude API error (model ${o.model}):`, raw.status, raw.text.slice(0, 500))
    return { ok: false, reason: "llm_error", status: raw.status, transient: TRANSIENT_STATUS.has(raw.status), detail: `${raw.status} ${shortMsg(raw.text)}` }
  }
  let data: any
  try { data = JSON.parse(raw.text) } catch { return { ok: false, reason: "llm_error", transient: true, detail: "provider sent invalid JSON" } }
  const block = data.content?.find((b: { type: string }) => b.type === "text")
  if (!block?.text) {
    console.error("Claude returned no text")
    return { ok: false, reason: "llm_empty", transient: true, detail: "empty answer" }
  }
  const usage: Usage = { inputTokens: num(data.usage?.input_tokens), outputTokens: num(data.usage?.output_tokens) }
  return { ok: true, text: block.text, usage }
}

// ---------- Gemini ----------

export function buildGeminiBody(o: Pick<CallOpts, "systemPrompt" | "userText" | "pdfBase64">) {
  return {
    systemInstruction: { parts: [{ text: o.systemPrompt }] },
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "application/pdf", data: o.pdfBase64 } },
        { text: o.userText },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json", // asks Gemini for raw JSON, fewer parse errors
      maxOutputTokens: 12000,               // headroom in case the model spends tokens thinking
      temperature: 0.1,                    // low, so the same resume gets more consistent answers
    },
  }
}

export function extractGeminiText(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null
  const text = parts.map((p: any) => p?.text ?? "").join("")
  return text.trim() ? text : null
}

export async function callGemini(o: CallOpts, fetchFn: FetchFn = fetch): Promise<LlmResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:generateContent`
  const out = await postJson(
    fetchFn,
    url,
    { "x-goog-api-key": o.apiKey, "content-type": "application/json" },
    buildGeminiBody(o),
    o.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )
  if ("fail" in out) {
    console.error(`Gemini (${o.model}) request failed:`, out.fail.detail)
    return out.fail
  }
  const { raw } = out
  if (!raw.ok) {
    // Typical causes: busy (503), free-tier quota (429), wrong model name (404), bad key (400/403).
    console.error(`Gemini API error (model ${o.model}):`, raw.status, raw.text.slice(0, 500))
    return { ok: false, reason: "llm_error", status: raw.status, transient: TRANSIENT_STATUS.has(raw.status), detail: `${raw.status} ${shortMsg(raw.text)}` }
  }
  let data: any
  try { data = JSON.parse(raw.text) } catch { return { ok: false, reason: "llm_error", transient: true, detail: "provider sent invalid JSON" } }
  const text = extractGeminiText(data)
  if (!text) {
    const why = JSON.stringify({ finishReason: data?.candidates?.[0]?.finishReason, promptFeedback: data?.promptFeedback })
    console.error("Gemini returned no text:", why)
    return { ok: false, reason: "llm_empty", transient: true, detail: `empty answer ${why}` }
  }
  const u = data?.usageMetadata
  const answered = num(u?.candidatesTokenCount)
  const thinking = num(u?.thoughtsTokenCount)
  const usage: Usage = { inputTokens: num(u?.promptTokenCount), outputTokens: answered === null && thinking === null ? null : (answered ?? 0) + (thinking ?? 0) }
  return { ok: true, text, usage }
}

// ---------- Retry + fallback ----------

export type Attempt = { provider: "gemini" | "claude"; model: string; apiKey: string; tries: number }
export type Plan = { systemPrompt: string; userText: string; pdfBase64: string }
export type Deps = {
  fetchFn?: FetchFn
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  timeoutMs?: number        // per call
  softDeadlineMs?: number   // stop starting new calls after this much total time
  backoffMs?: number
  validate?: (text: string) => boolean // is the answer usable? if not, treat it as a failed try
}
export type RunResult =
  | { ok: true; text: string; provider: string; model: string; tried: string[]; usage?: Usage }
  | { ok: false; reason: string; detail: string; tried: string[] }

// Tries each option in order. A temporary failure (busy, rate limit, timeout, empty or unusable
// answer) is retried with a growing pause, then the next option is used. A permanent failure
// (wrong model name, bad key) skips straight to the next option. Total time stays under the
// Edge Function limit.
export async function runWithFallback(attempts: Attempt[], plan: Plan, deps: Deps = {}): Promise<RunResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const softDeadline = deps.softDeadlineMs ?? 70_000
  const backoff = deps.backoffMs ?? 1500
  const started = now()
  const tried: string[] = []
  let lastReason = "llm_error"

  for (const a of attempts) {
    const label = `${a.provider}/${a.model}`
    for (let i = 0; i < a.tries; i++) {
      if (now() - started > softDeadline) {
        tried.push("stopped: time budget used")
        return { ok: false, reason: lastReason, detail: tried.join(" | "), tried }
      }
      const call = a.provider === "gemini" ? callGemini : callClaude
      const r = await call({ apiKey: a.apiKey, model: a.model, ...plan, timeoutMs: deps.timeoutMs }, fetchFn)

      if (r.ok) {
        if (deps.validate && !deps.validate(r.text)) {
          tried.push(`${label}: unusable answer`)
          lastReason = "parse_error"
        } else {
          tried.push(`${label}: ok`)
          return { ok: true, text: r.text, provider: a.provider, model: a.model, tried, usage: r.usage }
        }
      } else {
        tried.push(`${label}: ${r.detail}`)
        lastReason = r.reason
        if (!r.transient) break // repeating a wrong model name or bad key cannot help
      }
      if (i < a.tries - 1) await sleep(backoff * 2 ** i + Math.floor(Math.random() * 400))
    }
  }
  return { ok: false, reason: lastReason, detail: tried.join(" | "), tried }
}

// ---------- Output handling (provider independent) ----------

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim()) : []

const VERDICTS = new Set(["relevant", "weak", "irrelevant"])
const ISSUE_KINDS = new Set(["missing", "weak", "error"])
const ITEM_KINDS = new Set(["skill", "experience", "project", "certification", "education", "other"])
const cleanStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

// Used when the model marks an item weak or irrelevant but forgets to say why. The item still
// becomes an issue, so coverage never depends on the model writing the explanation.
const DEFAULT_ITEM_ISSUE = "This part of the resume does not clearly show what the role asks for."
const DEFAULT_ITEM_SOLUTION = "Reword it or replace it with a concrete, role-relevant detail: the tool used, what you did and what came out of it."

// Parses model text into the exact shape the frontend expects. A model that
// leaves out a field must never crash the results page.
export function parseFeedback(text: string): Feedback | null {
  let raw: any
  try {
    raw = JSON.parse(text.replace(/```json|```/g, "").trim())
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null

  const vague = Array.isArray(raw.vagueBullets) ? raw.vagueBullets : []
  const issues = Array.isArray(raw.issues) ? raw.issues : []
  const items = Array.isArray(raw.items) ? raw.items : []
  const out: Feedback = {
    strengths: strList(raw.strengths),
    gaps: strList(raw.gaps),
    suggestions: strList(raw.suggestions),
    issues: issues
      .filter((item: any) =>
        item &&
        typeof item.section === "string" &&
        typeof item.issue === "string" &&
        typeof item.solution === "string" &&
        (item.excerpt === null || typeof item.excerpt === "string")
      )
      .map((item: any) => {
        const kind = typeof item.kind === "string" ? item.kind.trim().toLowerCase() : ""
        return {
          section: item.section.trim(),
          excerpt: typeof item.excerpt === "string" ? item.excerpt.trim() : null,
          issue: item.issue.trim(),
          solution: item.solution.trim(),
          kbItem: typeof item.kbItem === "string" && item.kbItem.trim() ? item.kbItem.trim().toUpperCase() : null,
          kind: ISSUE_KINDS.has(kind) ? (kind as IssueKind) : null,
        }
      })
      .filter((item: { section: string; issue: string; solution: string }) => item.section && item.issue && item.solution),
    items: items
      .filter((it: any) => it && typeof it.section === "string" && it.section.trim() && typeof it.verdict === "string" && VERDICTS.has(it.verdict.trim().toLowerCase()))
      .map((it: any): Item => {
        const verdict = it.verdict.trim().toLowerCase() as ItemVerdict
        const kind = typeof it.kind === "string" ? it.kind.trim().toLowerCase() : ""
        const ok = verdict !== "relevant"
        return {
          section: it.section.trim(),
          kind: ITEM_KINDS.has(kind) ? kind : "other",
          excerpt: cleanStr(it.excerpt),
          verdict,
          kbItems: strList(it.kbItems).map((x) => x.toUpperCase()),
          roleWork: typeof it.roleWork === "boolean" ? it.roleWork : null,
          issue: ok ? (cleanStr(it.issue) ?? DEFAULT_ITEM_ISSUE) : null,
          solution: ok ? (cleanStr(it.solution) ?? DEFAULT_ITEM_SOLUTION) : null,
        }
      }),
    skillsMissing: strList(raw.skillsMissing).map((x) => x.toUpperCase()),
    mustHaves: (Array.isArray(raw.mustHaves) ? raw.mustHaves : [])
      .filter((m: any) => m && typeof m.id === "string" && typeof m.status === "string")
      .map((m: any) => ({
        id: m.id.trim().toUpperCase(),
        status: m.status.trim().toLowerCase(),
        evidence: typeof m.evidence === "string" && m.evidence.trim() ? m.evidence.trim() : null,
        section: cleanStr(m.section),
        solution: cleanStr(m.solution),
      })),
    vagueBullets: vague
      .filter((b: any) => b && typeof b.original === "string" && typeof b.suggestion === "string")
      .slice(0, 5)
      .map((b: any) => ({ original: b.original, suggestion: b.suggestion })),
  }
  const hasWeakItem = out.items.some((it) => it.verdict !== "relevant")
  if ((out.gaps.length || out.vagueBullets.length) && !out.issues.length && !hasWeakItem) return null
  // An answer with nothing in any list is a failed answer, not feedback.
  if (!out.strengths.length && !out.gaps.length && !out.suggestions.length && !out.issues.length && !out.items.length) return null
  return out
}
