// Run: deno test kb_test.ts
import { buildMustHaveSummary, finalizeFeedback, parseKnowledgeBase, priorityFor } from "./kb.ts"
import type { Feedback } from "./llm.ts"

const assert = (cond: unknown, msg: string) => { if (!cond) throw new Error("FAILED: " + msg) }

const KB = `# Title
## MUST-HAVE
- [MH1] SIEM familiarity and alert monitoring (seen in 9 of 9 postings)
- [MH2] Alert triage and incident response basics: classify, escalate (seen in 8 of 9 postings)
- [MH3] Core security concepts (attack types, malware) (seen in 8 of 9 postings)
- [SP1] Security tools: EDR/XDR, firewalls (required in 4 of 9 postings, an advantage in 2 more)
- [NH3] Hands-on practice (seen in 2 of 9 postings)
  Note for reviewers on NH3: not an item line.
- [PA1] Windows event log basics (practitioner-added, pending review)
- [MH1] duplicate id is ignored (seen in 1 of 9 postings)
Not a list line (seen in 3 of 9 postings)
- plain bullet without id (seen in 3 of 9 postings)`

Deno.test("parses ids, tiers, labels and basis", () => {
  const kb = parseKnowledgeBase(KB)
  assert(kb.map((i) => i.id).join() === "MH1,MH2,MH3,SP1,NH3,PA1", "ids in order, duplicate and non-items skipped")
  assert(kb[2].label === "Core security concepts (attack types, malware)" && kb[2].basis === "seen in 8 of 9 postings", "label keeps its own brackets")
  assert(kb[3].basis === "required in 4 of 9 postings, an advantage in 2 more", "basis taken from the text")
  assert(kb[5].tier === "PA" && kb[5].basis === "practitioner-added, pending review", "practitioner-added kept apart")
})

Deno.test("priority by tier", () => {
  assert(priorityFor("MH") === "high" && priorityFor("SP") === "medium" && priorityFor("NH") === "low" && priorityFor("PA") === "low", "tiers map")
})

Deno.test("must-have summary counts", () => {
  const kb = parseKnowledgeBase(KB)
  const s = buildMustHaveSummary(kb, [
    { id: "MH1", status: "present", evidence: "Splunk alerts" },
    { id: "MH2", status: "present", evidence: null },   // no quote: cannot be present
    { id: "MH3", status: "banana", evidence: "x" },     // invalid status: ignored
    { id: "SP1", status: "present", evidence: "EDR" },  // not a must-have: ignored
  ])!
  assert(s.total === 3 && s.shown === 1 && s.partial === 1, "1 of 3 shown, 1 partial")
  assert(s.items[1].status === "partial" && s.items[2].status === "unknown", "downgrade and unknown")
})

Deno.test("no must-haves in the knowledge base -> no summary", () => {
  assert(buildMustHaveSummary(parseKnowledgeBase("- [SP1] x (seen in 1 of 9 postings)"), []) === null, "null")
  assert(buildMustHaveSummary([], []) === null, "empty kb")
})

const base = (issues: Feedback["issues"], mustHaves: Feedback["mustHaves"] = []): Feedback =>
  ({ strengths: ["a"], gaps: ["g"], suggestions: ["s"], vagueBullets: [], issues, mustHaves })
const issue = (kbItem: string | null, section = "S") => ({ section, excerpt: null, issue: "i", solution: "s", kbItem })

Deno.test("issues get source label and priority, sorted high to low", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(base([issue("NH3", "a"), issue("MH2", "b"), issue(null, "c"), issue("PA1", "d"), issue("SP1", "e"), issue("ZZ9", "f")]), kb)
  const order = out.issues.map((i) => i.priority + ":" + i.section).join(" ")
  assert(order === "high:b medium:c medium:e medium:f low:a low:d", "sorted by priority, original order kept inside a tier: " + order)
  const mh2 = out.issues.find((i) => i.kbItem === "MH2")!
  assert(mh2.basis === "seen in 8 of 9 postings", "basis from the knowledge base text")
  const unknown = out.issues.find((i) => i.section === "f")!
  assert(unknown.kbItem === null && unknown.basis === "general practice, not from the job postings", "unknown id treated as general")
  assert(out.issues.find((i) => i.kbItem === "PA1")!.basis === "practitioner-added, pending review", "PA labelled")
  assert(!("mustHaves" in out), "raw mustHaves not passed on")
})

Deno.test("older knowledge base without ids: no false source label", () => {
  const out = finalizeFeedback(base([issue(null)]), parseKnowledgeBase("plain text knowledge base"))
  assert(out.issues[0].basis === null && out.issues[0].priority === "medium" && out.mustHaveSummary === null, "unlabelled")
})
