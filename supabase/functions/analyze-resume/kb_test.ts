// Run: deno test kb_test.ts
import { buildMustHaveSummary, finalizeFeedback, issueColor, parseKnowledgeBase, priorityFor } from "./kb.ts"
import type { Feedback, Item } from "./llm.ts"

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
  ({ strengths: ["a"], gaps: ["g"], suggestions: ["s"], vagueBullets: [], issues, mustHaves, items: [] })
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

// ---------- verdicts, colors and issues built in code ----------

const item = (over: Partial<Item>): Item =>
  ({ section: "SKILLS", kind: "skill", excerpt: "x", verdict: "relevant", kbItems: [], issue: null, solution: null, ...over })
const withItems = (items: Item[], mustHaves: Feedback["mustHaves"] = [], issues: Feedback["issues"] = []): Feedback =>
  ({ ...base(issues, mustHaves), items })

Deno.test("issueColor: errors and missing content are red, weak content is orange", () => {
  assert(issueColor("error", "x", null) === "red", "error is red")
  assert(issueColor("missing", null, "MH") === "red", "missing must-have is red")
  assert(issueColor("missing", null, "SP") === "red", "missing preferred item is red")
  assert(issueColor("missing", null, null) === "red", "missing without a knowledge base item is red")
  assert(issueColor(null, null, "MH") === "red", "no kind and no excerpt counts as missing")
  assert(issueColor("weak", "quote", "MH") === "orange" && issueColor(null, "quote", "MH") === "orange", "weak content is orange")
})

Deno.test("every weak or irrelevant item becomes an orange issue, relevant items turn green", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([
    item({ excerpt: "Splunk alerts", verdict: "relevant", kbItems: ["MH1", "ZZ9"] }),
    item({ excerpt: "AI", verdict: "irrelevant", issue: "buzzword", solution: "name a tool" }),
    item({ section: "EXPERIENCE", kind: "experience", excerpt: "VAPT intern", verdict: "weak", kbItems: ["ZZ9", "SP1"], issue: "not SOC", solution: "add log work" }),
  ]), kb)
  assert(out.issues.length === 2 && out.issues.every((i) => i.color === "orange"), "two orange issues")
  const vapt = out.issues.find((i) => i.excerpt === "VAPT intern")!
  assert(vapt.kbItem === "SP1" && vapt.priority === "medium" && vapt.basis === "required in 4 of 9 postings, an advantage in 2 more", "first known knowledge base item is used")
  assert(out.issues.find((i) => i.excerpt === "AI")!.basis === "general practice, not from the job postings", "no item: general practice")
  assert(out.items.map((i) => i.color).join() === "green,orange,orange", "item colors")
  assert(out.items[0].kbItems.join() === "MH1", "unknown ids dropped from items")
  assert(out.colorCounts.red === 0 && out.colorCounts.orange === 2 && out.colorCounts.green === 1, "counts")
})

Deno.test("a missing must-have gets a red issue even if the model raised none", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([], [
    { id: "MH1", status: "present", evidence: "Splunk" },
    { id: "MH2", status: "missing", evidence: null, section: "PROJECTS", solution: "Write up a triage case." },
    { id: "MH3", status: "missing", evidence: null },
  ]), kb)
  const mh2 = out.issues.find((i) => i.kbItem === "MH2")!
  assert(mh2.color === "red" && mh2.section === "PROJECTS" && mh2.solution === "Write up a triage case." && mh2.excerpt === null, "model's section and fix used")
  const mh3 = out.issues.find((i) => i.kbItem === "MH3")!
  assert(mh3.color === "red" && mh3.section === "Overall" && mh3.solution.length > 0, "fallback section and fix")
  assert(!out.issues.some((i) => i.kbItem === "MH1"), "present must-have raises nothing")
})

Deno.test("partial must-have is orange, an unknown one raises nothing", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([], [{ id: "MH1", status: "partial", evidence: "alerts" }]), kb)
  assert(out.issues.length === 1, "only MH1 partial raises an issue")
  const mh1 = out.issues.find((i) => i.kbItem === "MH1")!
  assert(mh1.color === "orange" && mh1.excerpt === "alerts", "partial is orange and quotes the evidence")
  assert(!out.issues.some((i) => i.kbItem === "MH2" || i.kbItem === "MH3"), "skipped must-haves are not guessed")
})

Deno.test("an issue the model raised for a missing must-have is made red, not duplicated", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([], [{ id: "MH2", status: "missing", evidence: null }],
    [{ section: "SKILLS", excerpt: null, issue: "no triage", solution: "add it", kbItem: "MH2", kind: "weak" }]), kb)
  const forMh2 = out.issues.filter((i) => i.kbItem === "MH2")
  assert(forMh2.length === 1 && forMh2[0].color === "red" && forMh2[0].solution === "add it", "one red issue, model's text kept")
})

Deno.test("model issues: error is red, same excerpt as an item is not repeated, red sorts first", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems(
    [item({ excerpt: "  Built   a lab ", verdict: "weak", issue: "thin", solution: "add detail" })],
    [],
    [
      { section: "EXPERIENCE", excerpt: "built a lab", issue: "same thing", solution: "dup", kbItem: null, kind: "weak" },
      { section: "EXPERIENCE", excerpt: "Jan 2031 - Feb 2030", issue: "bad date", solution: "fix it", kbItem: null, kind: "error" },
    ]), kb)
  assert(out.issues.length === 2, "duplicate dropped: " + out.issues.map((i) => i.issue).join("|"))
  assert(out.issues[0].issue === "bad date" && out.issues[0].color === "red" && out.issues[1].color === "orange", "red first")
  assert(out.colorCounts.red === 1 && out.colorCounts.orange === 1, "counts")
})

Deno.test("no knowledge base ids at all: items still become issues without a source label", () => {
  const out = finalizeFeedback(withItems([item({ verdict: "weak", issue: "i", solution: "s" })]), parseKnowledgeBase("plain text"))
  assert(out.issues[0].basis === null && out.issues[0].color === "orange" && out.mustHaveSummary === null, "unlabelled")
})
