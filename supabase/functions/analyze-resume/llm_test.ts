// Run: deno test llm_test.ts   (no network, all provider calls are faked)
import { buildGeminiBody, callClaude, callGemini, parseFeedback, runWithFallback, type Attempt, type RunResult } from "./llm.ts"

const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error("FAILED: " + msg) }
function mustFail(r: RunResult) { if (r.ok) throw new Error("FAILED: expected a failure"); return r }

const GOOD = JSON.stringify({
  strengths: ["a"], gaps: ["b"], suggestions: ["c"],
  issues: [{ section: "SKILLS", excerpt: null, issue: "x", solution: "y" }],
})
const gemOk = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 })
const gemEmpty = () => new Response(JSON.stringify({ candidates: [{ finishReason: "MAX_TOKENS" }] }), { status: 200 })
const claudeOk = (text: string) => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 })
const err = (status: number, message: string) => new Response(JSON.stringify({ error: { message } }), { status })

type Step = Response | Error | "hang"
// Script per key: a gemini model name, or "claude". The last step repeats once the list runs out.
function mockFetch(script: Record<string, Step[]>) {
  const calls: string[] = []
  const counters: Record<string, number> = {}
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const key = u.includes("anthropic.com") ? "claude" : decodeURIComponent(u.split("/models/")[1].split(":")[0])
    const steps = script[key]
    if (!steps) throw new Error("no script for " + key)
    const i = (counters[key] = (counters[key] ?? -1) + 1)
    calls.push(key)
    const step = steps[Math.min(i, steps.length - 1)]
    if (step instanceof Error) throw step
    if (step === "hang") {
      return await new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))
    }
    return step.clone()
  }) as typeof fetch
  return { fn, calls }
}

const plan = { systemPrompt: "S", userText: "U", pdfBase64: "QUJD" }
const g = (model: string, tries = 2): Attempt => ({ provider: "gemini", model, apiKey: "k", tries })
const c = (tries = 2): Attempt => ({ provider: "claude", model: "claude-x", apiKey: "k", tries })
function deps(extra: Record<string, unknown> = {}) {
  const sleeps: number[] = []
  return { sleeps, d: { sleep: (ms: number) => { sleeps.push(ms); return Promise.resolve() }, backoffMs: 100, ...extra } }
}

Deno.test("busy (503) then success on retry", async () => {
  const m = mockFetch({ A: [err(503, "high demand"), gemOk(GOOD)] })
  const { sleeps, d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A")], plan, d)
  assert(r.ok && r.model === "A", "should succeed")
  assert(m.calls.join() === "A,A" && sleeps.length === 1, "one retry with one pause")
  assert(r.tried[0].includes("503"), "attempt log keeps the 503")
})

Deno.test("model A stays busy -> model B answers", async () => {
  const m = mockFetch({ A: [err(503, "busy")], B: [gemOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A"), g("B")], plan, d)
  assert(r.ok && r.model === "B", "B answers")
  assert(m.calls.join() === "A,A,B", "A tried twice, then B")
})

Deno.test("wrong model name (404) is not retried", async () => {
  const m = mockFetch({ A: [err(404, "model not found")], B: [gemOk(GOOD)] })
  const { sleeps, d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A"), g("B")], plan, d)
  assert(r.ok && m.calls.join() === "A,B" && sleeps.length === 0, "skip straight to B, no pause")
})

Deno.test("Gemini down -> Claude fallback", async () => {
  const m = mockFetch({ A: [err(503, "busy")], claude: [claudeOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A"), c()], plan, d)
  assert(r.ok && r.provider === "claude", "Claude answers")
})

Deno.test("everything fails -> clear detail, no crash", async () => {
  const m = mockFetch({ A: [err(503, "busy")], claude: [err(402, "credit balance is too low")] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A"), c()], plan, d)
  const f = mustFail(r)
  assert(f.reason === "llm_error", "fails cleanly")
  assert(f.tried.length === 3, "A twice, Claude once (402 is permanent)")
  assert(f.detail.includes("gemini/A") && f.detail.includes("402"), "detail names provider and status")
})

Deno.test("empty answer (thinking ate the tokens) is retried", async () => {
  const m = mockFetch({ A: [gemEmpty(), gemOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A")], plan, d)
  assert(r.ok && m.calls.length === 2, "second try works")
})

Deno.test("unusable JSON is retried, validate decides", async () => {
  const m = mockFetch({ A: [gemOk("sorry, here is some prose"), gemOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn, validate: (t: string) => parseFeedback(t) !== null })
  const r = await runWithFallback([g("A")], plan, d)
  assert(r.ok && r.text === GOOD, "uses the good answer")
  assert(r.tried[0].includes("unusable"), "bad answer logged")
})

Deno.test("only unusable answers -> parse_error", async () => {
  const m = mockFetch({ A: [gemOk("nope")] })
  const { d } = deps({ fetchFn: m.fn, validate: (t: string) => parseFeedback(t) !== null })
  const r = await runWithFallback([g("A")], plan, d)
  assert(!r.ok && r.reason === "parse_error", "reports parse_error")
})

Deno.test("network error is retried", async () => {
  const m = mockFetch({ A: [new TypeError("fetch failed"), gemOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([g("A")], plan, d)
  assert(r.ok && r.tried[0].includes("network error"), "recovers")
})

Deno.test("hung call is aborted by the timeout", async () => {
  const m = mockFetch({ A: ["hang", gemOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn, timeoutMs: 30 })
  const r = await runWithFallback([g("A")], plan, d)
  assert(r.ok && r.tried[0].includes("timeout"), "aborted then recovered")
})

Deno.test("time budget stops new attempts", async () => {
  const m = mockFetch({ A: [err(503, "busy")] })
  let t = 0
  const { d } = deps({ fetchFn: m.fn, now: () => (t += 40_000) })
  const r = await runWithFallback([g("A", 3)], plan, d)
  const f = mustFail(r)
  assert(m.calls.length === 1, "stops after the first call")
  assert(f.detail.includes("time budget"), "says why")
})

Deno.test("Claude 529 overloaded is retried", async () => {
  const m = mockFetch({ claude: [err(529, "overloaded"), claudeOk(GOOD)] })
  const { d } = deps({ fetchFn: m.fn })
  const r = await runWithFallback([c()], plan, d)
  assert(r.ok && m.calls.length === 2, "retried")
})

Deno.test("no providers configured", async () => {
  const r = await runWithFallback([], plan, deps().d)
  assert(!r.ok, "fails cleanly")
})

Deno.test("request shapes unchanged", async () => {
  let seen: any
  const spy = (async (url: string | URL | Request, init?: RequestInit) => { seen = { url: String(url), headers: init!.headers, body: JSON.parse(init!.body as string) }; return gemOk(GOOD) }) as typeof fetch
  await callGemini({ apiKey: "KEY", model: "m1", ...plan }, spy)
  assert(seen.url.endsWith("/models/m1:generateContent") && !seen.url.includes("KEY"), "key not in url")
  assert((seen.headers as any)["x-goog-api-key"] === "KEY", "key in header")
  assert(seen.body.contents[0].parts[0].inlineData.mimeType === "application/pdf", "pdf attached")
  assert(buildGeminiBody({ ...plan }).generationConfig.responseMimeType === "application/json", "json mode")
  await callClaude({ apiKey: "KEY", model: "cm", ...plan }, (async (_u: unknown, init?: RequestInit) => { seen = JSON.parse(init!.body as string); return claudeOk(GOOD) }) as typeof fetch)
  assert(seen.model === "cm" && seen.max_tokens === 4500 && seen.messages[0].content[0].type === "document", "claude body")
})

Deno.test("parseFeedback (including the issues rules)", () => {
  assert(parseFeedback(GOOD)?.issues.length === 1, "valid with issues")
  const withKb = parseFeedback(JSON.stringify({ strengths: ["a"], gaps: ["g"], issues: [{ section: "S", excerpt: null, issue: "i", solution: "s", kbItem: " mh6 " }], mustHaves: [{ id: "mh1", status: "Present", evidence: " quote " }, { id: 5 }, null] }))
  assert(withKb?.issues[0].kbItem === "MH6", "kbItem cleaned and upper-cased")
  assert(withKb?.mustHaves.length === 1 && withKb.mustHaves[0].id === "MH1" && withKb.mustHaves[0].status === "present" && withKb.mustHaves[0].evidence === "quote", "mustHaves cleaned, junk dropped")
  assert(parseFeedback(GOOD)?.issues[0].kbItem === null && parseFeedback(GOOD)?.mustHaves.length === 0, "new fields default safely")
  assert(parseFeedback("```json\n" + GOOD + "\n```") !== null, "fenced json")
  assert(parseFeedback('{"strengths":["a"]}')?.gaps.length === 0, "missing fields default to []")
  assert(parseFeedback('{"strengths":["a"],"gaps":["g"]}') === null, "gaps without issues is rejected")
  assert(parseFeedback("sorry I cannot") === null, "garbage")
  assert(parseFeedback('{"strengths":[],"gaps":[],"suggestions":[],"issues":[]}') === null, "empty")
})
