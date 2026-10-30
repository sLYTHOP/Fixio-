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
  ({ strengths: ["a"], gaps: ["g"], suggestions: ["s"], vagueBullets: [], issues, mustHaves, items: [], skillsMissing: [] })
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
  ({ section: "SKILLS", kind: "skill", excerpt: "x", verdict: "relevant", kbItems: [], roleWork: null, issue: null, solution: null, ...over })
const withItems = (items: Item[], mustHaves: Feedback["mustHaves"] = [], issues: Feedback["issues"] = []): Feedback =>
  ({ ...base(issues, mustHaves), items })

Deno.test("issueColor: error and missing must-have are red, the rest orange", () => {
  assert(issueColor("error", "x", null) === "red", "error is red")
  assert(issueColor("missing", null, "MH") === "red", "missing must-have is red")
  assert(issueColor(null, null, "MH") === "red", "no kind and no excerpt counts as missing")
  assert(issueColor("missing", null, "SP") === "orange" && issueColor("missing", null, "NH") === "orange", "missing lower tier is orange")
  assert(issueColor("missing", null, null) === "orange", "missing with no knowledge base item is orange")
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
  assert(vapt.kbItem === "SP1", "first known knowledge base item is used")
  assert(vapt.basis === null && vapt.priority === "medium", "an item issue carries no posting label")
  assert(out.issues.find((i) => i.excerpt === "AI")!.kbItem === null, "no item: no knowledge base id")
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

Deno.test("an issue about a must-have the model marked present is dropped", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([], [{ id: "MH2", status: "present", evidence: "triage" }],
    [
      { section: "SKILLS", excerpt: null, issue: "no ticketing tool", solution: "add one", kbItem: "MH2", kind: "missing" },
      { section: "SKILLS", excerpt: null, issue: "no scripting", solution: "add one", kbItem: "SP1", kind: "missing" },
    ]), kb)
  assert(out.issues.length === 1 && out.issues[0].kbItem === "SP1", "only the unrelated issue stays")
})

Deno.test("suggestions: capped at 6, no repeats, none that repeats an issue fix", () => {
  const kb = parseKnowledgeBase(KB)
  const parsed = withItems([item({ verdict: "weak", issue: "i", solution: "Add a triage write-up." })])
  parsed.suggestions = ["Finish Security+.", " finish security+. ", "add a TRIAGE write-up.", "b", "c", "d", "e", "f", "g"]
  const out = finalizeFeedback(parsed, kb)
  assert(out.suggestions.join("|") === "Finish Security+.|b|c|d|e|f", "got " + out.suggestions.join("|"))
})

// ---------- skills crowding, role work and the overall level ----------

Deno.test("core skills missing: a non-core skill turns weak and the fix names the missing ones", () => {
  const kb = parseKnowledgeBase(KB)
  const parsed = withItems([
    item({ excerpt: "SIEM", kbItems: ["MH1"] }),
    item({ excerpt: "Prompt Engineering", kbItems: [] }),
    item({ excerpt: "Burp Suite", kbItems: ["NH3"], verdict: "relevant" }),
    item({ section: "EXPERIENCE", kind: "experience", excerpt: "intern", kbItems: [] }),
  ])
  parsed.skillsMissing = ["sp1", "NH3", "PA1", "ZZ9", "SP1"]
  const out = finalizeFeedback(parsed, kb, "SOC Analyst")
  assert(out.skillsMissing.map((m) => m.id).join() === "SP1,NH3", "valid ids only, no PA, no repeats: " + out.skillsMissing.map((m) => m.id).join())
  assert(out.items.map((i) => i.color).join() === "green,orange,orange,green", "colors: " + out.items.map((i) => i.color).join())
  const pe = out.issues.find((i) => i.excerpt === "Prompt Engineering")!
  assert(pe.color === "orange" && pe.issue.includes("SOC Analyst") && pe.solution === "Consider making room for Security tools and Hands-on practice in place of it.", "text: " + pe.solution)
  assert(out.issues.find((i) => i.excerpt === "SIEM") === undefined, "core skill untouched")
})

Deno.test("no core skills missing: non-core skills are left as the model judged them", () => {
  const out = finalizeFeedback(withItems([item({ excerpt: "Prompt Engineering", kbItems: [] })]), parseKnowledgeBase(KB))
  assert(out.items[0].color === "green" && out.issues.length === 0, "unchanged")
})

Deno.test("no project shows the role's work: one orange issue on the section, naming what is still needed", () => {
  const kb = parseKnowledgeBase(KB)
  const out = finalizeFeedback(withItems([
    item({ section: "PROJECTS", kind: "project", excerpt: "a", roleWork: false }),
    item({ section: "PROJECTS", kind: "project", excerpt: "b", roleWork: false }),
    item({ section: "EXPERIENCE", kind: "experience", excerpt: "c", roleWork: true }),
  ], [
    { id: "MH1", status: "present", evidence: "x" },
    { id: "MH2", status: "partial", evidence: "y" },
    { id: "MH3", status: "missing", evidence: null },
  ]), kb, "SOC Analyst")
  const sec = out.issues.filter((i) => i.excerpt === null && i.section === "PROJECTS")
  assert(sec.length === 1 && sec[0].color === "orange" && sec[0].basis === null, "one section issue")
  assert(sec[0].issue === "None of your projects show work that SOC Analyst does day to day.", sec[0].issue)
  assert(sec[0].solution.includes("alert triage") && sec[0].solution.includes("core security concepts"), "names still-needed must-haves: " + sec[0].solution)
  assert(!out.issues.some((i) => i.section === "EXPERIENCE" && i.excerpt === null && i.issue.startsWith("None of")), "experience has role work")
})

Deno.test("role-work check is skipped when the model gave no answer", () => {
  const out = finalizeFeedback(withItems([item({ section: "PROJECTS", kind: "project", excerpt: "a", roleWork: null })]), parseKnowledgeBase(KB))
  assert(out.issues.length === 0, "nothing raised")
})

Deno.test("overall level: strong marks item issues minor and sorts them last, low does not", () => {
  const kb = parseKnowledgeBase(KB)
  const must: Feedback["mustHaves"] = [
    { id: "MH1", status: "present", evidence: "a" }, { id: "MH2", status: "present", evidence: "b" }, { id: "MH3", status: "present", evidence: "c" },
  ]
  const good = Array.from({ length: 8 }, (_, n) => item({ excerpt: "g" + n, kbItems: ["MH1"] }))
  const strong = finalizeFeedback(withItems([
    ...good,
    item({ section: "EXPERIENCE", kind: "experience", excerpt: "intern", roleWork: true }),
    item({ section: "PROJECTS", kind: "project", excerpt: "off", verdict: "weak", issue: "off topic", solution: "reword", roleWork: false }),
  ], must, [{ section: "S", excerpt: "x", issue: "model issue", solution: "fix", kbItem: null, kind: "weak" }]), kb)
  assert(strong.overall!.level === "strong" && strong.overall!.note.startsWith("Strong fit: 3 of 3 must-haves shown"), "strong: " + strong.overall!.note)
  const off = strong.issues.find((i) => i.excerpt === "off")!
  assert(off.minor === true, "item issue is minor")
  assert(strong.issues.length === 3 && strong.issues[2].excerpt === "off" && !strong.issues[0].minor && !strong.issues[1].minor, "minor sorts after the other orange issues")

  const low = finalizeFeedback(withItems([
    item({ excerpt: "a", verdict: "weak", issue: "i", solution: "s" }),
    item({ excerpt: "b", verdict: "irrelevant", issue: "i", solution: "s" }),
  ], [{ id: "MH1", status: "missing", evidence: null }, { id: "MH2", status: "missing", evidence: null }, { id: "MH3", status: "missing", evidence: null }]), kb)
  assert(low.overall!.level === "low" && low.issues.every((i) => !i.minor), "low: no minor flags")
  assert(finalizeFeedback(base([], []), kb).overall === null, "no items, no overall")
  const mid = finalizeFeedback(withItems([item({ excerpt: "a" }), item({ excerpt: "b", verdict: "weak", issue: "i", solution: "s" })],
    [{ id: "MH1", status: "present", evidence: "a" }, { id: "MH2", status: "partial", evidence: "b" }, { id: "MH3", status: "present", evidence: "c" }]), kb)
  assert(mid.overall!.level === "moderate", "moderate: " + mid.overall!.level)
})
