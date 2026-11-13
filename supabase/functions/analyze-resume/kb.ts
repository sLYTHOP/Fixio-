// Reads the knowledge base text (items like "- [MH1] label (seen in 9 of 9 postings)") and turns
// the model's answer into the final result: priority, source label and color on every issue, a
// color on every resume item, plus the "N of M must-haves shown" summary. Counts, labels and
// colors come from the knowledge base text and from code, never from the model, so the model
// cannot invent them. Every weak or irrelevant item and every missing must-have becomes an
// issue here, so coverage does not depend on the model choosing to raise it.

import type { Feedback, Item, IssueKind, RoleWork } from "./llm.ts"

export type Tier = "MH" | "SP" | "NH" | "PA"
export type KbItem = { id: string; tier: Tier; label: string; basis: string }
export type Priority = "high" | "medium" | "low"
export type MustHaveStatus = "present" | "partial" | "missing" | "unknown"
export type MustHaveSummary = {
  total: number
  shown: number   // clearly present, with a quote from the resume
  partial: number // hinted at or weak
  items: { id: string; label: string; status: MustHaveStatus; evidence: string | null }[]
}
// red: fix first (a missing must-have, a date or contact error). orange: weak, fix after the red ones.
export type IssueColor = "red" | "orange"
export type ItemColor = IssueColor | "green"
// minor: optional polish. Set only when the whole resume is strong, and sorted after the other issues of its color.
export type FinalIssue = Feedback["issues"][number] & { basis: string | null; priority: Priority; color: IssueColor; minor: boolean }
// issueIndex: position of this item's issue in the sorted issues list, so a mark on the resume can open that
// issue. null for relevant items. red is used for skills and certifications that have nothing to do with the field.
// grade: how much the item helps for this role, the same three levels in every section (the base for scoring).
export type Grade = "core" | "thin" | "irrelevant"
export type FinalItem = Item & { color: ItemColor; issueIndex: number | null; grade: Grade }
export type ColorCounts = { red: number; orange: number; green: number }
export type OverallLevel = "strong" | "moderate" | "low"
export type Overall = { level: OverallLevel; note: string }
export type FinalFeedback = Omit<Feedback, "issues" | "mustHaves" | "items" | "skillsMissing" | "skillIdeas" | "handsOnIdeas"> & {
  issues: FinalIssue[]
  items: FinalItem[]
  colorCounts: ColorCounts
  overall: Overall | null
  skillsMissing: { id: string; label: string }[]
  mustHaveSummary: MustHaveSummary | null
}

// "- [MH6] Networking fundamentals: TCP/IP, DNS (seen in 6 of 9 postings)"
const LINE = /^\s*[-*]\s*\[(MH|SP|NH|PA)(\d+)\]\s+(.+)\s\(([^()]+)\)\s*$/

export function parseKnowledgeBase(content: string): KbItem[] {
  const items: KbItem[] = []
  const seen = new Set<string>()
  for (const line of content.split("\n")) {
    const m = line.match(LINE)
    if (!m) continue
    const id = m[1] + m[2]
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, tier: m[1] as Tier, label: m[3].trim(), basis: m[4].trim() })
  }
  return items
}

export function priorityFor(tier: Tier): Priority {
  return tier === "MH" ? "high" : tier === "SP" ? "medium" : "low"
}

const STATUSES = new Set(["present", "partial", "missing"])

export function buildMustHaveSummary(kb: KbItem[], reported: Feedback["mustHaves"]): MustHaveSummary | null {
  const must = kb.filter((i) => i.tier === "MH")
  if (!must.length) return null

  const byId = new Map<string, { status: MustHaveStatus; evidence: string | null }>()
  for (const r of reported) {
    if (!STATUSES.has(r.status)) continue
    let status = r.status as MustHaveStatus
    // "Present" needs a quote from the resume. No quote means we cannot call it present.
    if (status === "present" && !r.evidence) status = "partial"
    byId.set(r.id.toUpperCase(), { status, evidence: r.evidence })
  }

  const items = must.map((m) => {
    const got = byId.get(m.id)
    return { id: m.id, label: m.label, status: got?.status ?? ("unknown" as MustHaveStatus), evidence: got?.evidence ?? null }
  })
  return {
    total: items.length,
    shown: items.filter((i) => i.status === "present").length,
    partial: items.filter((i) => i.status === "partial").length,
    items,
  }
}

const norm = (v: string | null) => (v ?? "").toLowerCase().replace(/\s+/g, " ").trim()
// ---- checking experience and project bullets ----
// Whether a bullet shows the role's work is decided here, not by the model's opinion. The subject words come from the
// knowledge base ("Subject words: alert, incident, ..."). A bullet is "clear" only when it names the subject, says what
// the candidate did (not "supported" or "contributed to"), and gives a tool or a result. The model supplies the tool,
// action and result as exact quotes, and a quote that is not in the bullet is ignored.
const WEAK_ACTION = /^(support|assist|contribut|help|work(ed|ing)? on|involv|participat|exposure|familiar|learn|responsible|tasked|part of|observ|shadow|attend|duties)/i

export function parseEvidenceTerms(content: string): string[] {
  const m = content.match(/^\s*Subject words:\s*(.+)$/im)
  return m ? m[1].split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : []
}

// Lines like "Skills to list for MH1: Splunk, Microsoft Sentinel, Wazuh*" give concrete names a candidate can list for each
// knowledge base item. A trailing star (practitioner-added name) is dropped here.
export function parseSkillCatalog(content: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*Skills to list for ([A-Z]{2}\d+):\s*(.+)$/i)
    if (m) out.set(m[1].toUpperCase(), m[2].split(",").map((x) => x.trim().replace(/\*+$/, "").trim()).filter(Boolean))
  }
  return out
}

const inText = (quote: string | null | undefined, text: string) => !!quote && norm(text).includes(norm(quote))

export function evidenceLevel(it: Item, terms: string[]): RoleWork | null {
  if (!terms.length || (it.kind !== "experience" && it.kind !== "project") || !it.excerpt) return it.roleWork
  const text = it.excerpt
  const subject = terms.some((t) => new RegExp("\\b" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(text))
  if (!subject) return "none"
  const ev = it.evidence
  const action = inText(ev?.action, text) && !WEAK_ACTION.test(norm(ev?.action ?? ""))
  const proof = inText(ev?.tool, text) || inText(ev?.result, text)
  return action && proof ? "clear" : "thin"
}

// ---- what a thin bullet lacks, and how the fix is worded ----
// Nothing here is specific to one role: the subject words come from the knowledge base, the rest is about how a bullet is written.
// A fix about a bullet must never claim the candidate did work the bullet does not show, so every fix is a condition
// ("If you did this work, ..."). The lead-in rotates so that neighbouring bullets do not all open the same way.
export type BulletGap = "action" | "tool" | "proof"
const LEADS = ["If you did this work, ", "Where this is true of your work, ", "If it matches what you did, "]
const GAP_NAME: Record<BulletGap, string> = { action: "what you did yourself", tool: "the tool you used", proof: "a number or an outcome" }
const GAP_FIX: Record<BulletGap, string> = {
  action: "start with what you personally did, such as Investigated or Built, not supported or helped",
  tool: "name the tool or platform you used",
  proof: "add a number or an outcome, such as volume, time saved or what you delivered",
}
const lcFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)
const CONDITIONAL = /\b(if you|if it|once you|when you|where you|where this|in case you)\b/i

// null when the model gave no quotes for the bullet (nothing to measure). A number anywhere in the bullet counts as scale.
export function bulletGaps(it: Item): BulletGap[] | null {
  if (!it.excerpt || !it.evidence) return null
  const text = it.excerpt
  const ev = it.evidence
  const gaps: BulletGap[] = []
  if (!(inText(ev.action, text) && !WEAK_ACTION.test(norm(ev.action ?? "")))) gaps.push("action")
  if (!inText(ev.tool, text)) gaps.push("tool")
  if (!(inText(ev.result, text) || /\d/.test(text))) gaps.push("proof")
  return gaps
}

// A fix the model wrote for a bullet gets a condition unless it already has one.
export function conditionalFix(solution: string, lead = LEADS[0]): string {
  const s = solution.trim()
  return !s || CONDITIONAL.test(s) ? s : lead + lcFirst(s)
}

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec".split("|")
// Is the entry still going on? Decided from the date range the model quoted: "Present" and similar words, or an end month that is
// this month or later. A range needs a start and an end. A single date is never treated as ongoing.
export function isOngoing(period: string | null | undefined, today: Date): boolean {
  if (!period) return false
  if (/\b(present|currently|current|ongoing|till date|to date|now)\b/i.test(period)) return true
  const parts = period.split(/\s*(?:[-\u2013\u2014]|\bto\b|\buntil\b)\s*/i)
  if (parts.length < 2) return false
  const m = parts[parts.length - 1].toLowerCase().match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?,?\\s+(\\d{4})\\b`))
  if (!m) return false
  return Number(m[2]) * 12 + MONTHS.indexOf(m[1]) >= today.getUTCFullYear() * 12 + today.getUTCMonth()
}

const shortLabel = (label: string) => label.split(":")[0].trim()
const listOf = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

// Skills and certifications that have nothing to do with the field take space for nothing: red.
// An unrelated job or project is normal for a fresher, so those stay orange.
const itemColor = (it: Item): ItemColor =>
  it.verdict === "relevant" ? "green" : it.verdict === "irrelevant" && (it.kind === "skill" || it.kind === "certification") ? "red" : "orange"

// The same three levels for every kind of item, computed from the labels the model gave and the final verdict.
// Skills: core and soft count as core; adjacent and off-role skills are thin. Certifications: role-level is core,
// foundational is thin. Experience and projects: only clear evidence is core. Anything unrelated to security
// and IT is irrelevant. When the model gave no label, the verdict decides.
export function gradeOf(original: Item, final: Item): Grade {
  const byVerdict = (): Grade => (final.verdict === "relevant" ? "core" : final.verdict === "weak" ? "thin" : "irrelevant")
  if (final.verdict === "irrelevant") return "irrelevant"
  if (original.kind === "skill" && original.fit) {
    return original.fit === "unrelated" ? "irrelevant" : original.fit === "core" || original.fit === "soft" ? "core" : "thin"
  }
  if (original.kind === "certification" && original.certLevel) {
    return original.certLevel === "unrelated" ? "irrelevant" : original.certLevel === "role" ? "core" : "thin"
  }
  if ((original.kind === "experience" || original.kind === "project") && original.roleWork) {
    return original.roleWork === "clear" && final.verdict === "relevant" ? "core" : "thin"
  }
  return byVerdict()
}

// Red for errors and for a must-have that is missing. Everything else is weak: orange.
export function issueColor(kind: IssueKind | null | undefined, excerpt: string | null, tier: Tier | null): IssueColor {
  if (kind === "error") return "red"
  const missing = kind === "missing" || (!kind && excerpt === null)
  return missing && tier === "MH" ? "red" : "orange"
}

// How strong the whole resume is for the role. Computed from the checked items and the
// must-haves, never asked of the model. The thresholds are starting values to tune on real results.
export function overallFor(items: Item[], summary: MustHaveSummary | null): Overall | null {
  if (!items.length) return null
  const share = items.filter((i) => i.verdict === "relevant").length / items.length
  const coverage = summary && summary.total ? summary.shown / summary.total : null
  const hasRoleWork = items.some((i) => i.roleWork === "clear")
  const anyRoleWorkInfo = items.some((i) => i.roleWork !== null)
  const counts = summary ? `${summary.shown} of ${summary.total} must-haves shown` : null
  if ((coverage !== null && coverage < 0.5) || share < 0.4) {
    return { level: "low", note: `Early stage${counts ? `: ${counts}` : ""}. Start with the red items, then the orange ones.` }
  }
  if ((coverage === null || coverage >= 0.85) && share >= 0.7 && (hasRoleWork || !anyRoleWorkInfo)) {
    return { level: "strong", note: `Strong fit${counts ? `: ${counts}` : ""}, and most of your resume is on target. Items marked minor are optional polish.` }
  }
  return { level: "moderate", note: `Partly there${counts ? `: ${counts}` : ""}. Fixing the red items first, then the orange ones, will help most.` }
}

export function finalizeFeedback(
  parsed: Feedback,
  kb: KbItem[],
  roleLabel = "this role",
  evidenceTerms: string[] = [],
  skillCatalog: Map<string, string[]> = new Map(),
  today: Date = new Date(),
): FinalFeedback {
  // The level of evidence for each experience and project bullet is worked out here (see evidenceLevel).
  parsed = { ...parsed, items: parsed.items.map((it) => ({ ...it, roleWork: evidenceLevel(it, evidenceTerms) })) }
  const byId = new Map(kb.map((i) => [i.id, i]))
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }
  const colorRank: Record<IssueColor, number> = { red: 0, orange: 1 }
  const summary = buildMustHaveSummary(kb, parsed.mustHaves)

  // Core skills a strong skills section would show but this one lacks (ids checked against the knowledge base).
  const missing: KbItem[] = []
  for (const id of parsed.skillsMissing) {
    const k = byId.get(id.toUpperCase())
    if (k && k.tier !== "PA" && !missing.includes(k)) missing.push(k)
    if (missing.length === 5) break
  }
  const missingNames = missing.map((k) => shortLabel(k.label))
  const isCore = (it: Item) => it.kbItems.some((id) => {
    const k = byId.get(id)
    return !!k && (k.tier === "MH" || k.tier === "SP")
  })

  // Ideas for what to list instead of a weak skill. Each flagged skill takes the next two from a shared
  // list, so neighbouring skills do not all get the same advice.
  // The names come from the knowledge base's "Skills to list" lines for the missing items, taken in turn from each
  // item so the advice is varied, minus anything already listed in the skills section. The model's own ideas follow.
  const listedTokens = parsed.items
    .filter((i) => i.kind === "skill")
    .flatMap((i) => (i.excerpt ?? "").split(/[,;/()|]+/))
    .map((t) => norm(t))
    .filter(Boolean)
  const unlisted = (name: string) => {
    const n = norm(name)
    return !listedTokens.some((t) => t === n || t.startsWith(n + " "))
  }
  const lists = missing.map((k) => (skillCatalog.get(k.id) ?? []).filter(unlisted))
  const candidates: string[] = []
  for (let r = 0; lists.some((l) => r < l.length); r++) for (const l of lists) if (r < l.length) candidates.push(l[r])
  candidates.push(...parsed.skillIdeas.filter(unlisted))
  const seenNames = new Set<string>()
  const merged = candidates.filter((n) => !seenNames.has(n.toLowerCase()) && !!seenNames.add(n.toLowerCase()))
  const pool = merged.length ? merged : missingNames
  let next = 0
  const ideasFor = (): string => {
    if (!pool.length) return ""
    const picked = [pool[next % pool.length]]
    if (pool.length > 1) picked.push(pool[(next + 1) % pool.length])
    next += 2
    return listOf(picked).replace(" and ", " or ")
  }
  const names3 = listOf(missingNames.slice(0, 3))
  const swapFix = () => {
    const ideas = ideasFor()
    return ideas ? `Try listing ${ideas} here instead, if you have used them.` : "Swap it for a skill the role asks for."
  }
  const clean = (it: Item): Item => ({ ...it, verdict: "relevant", issue: null, solution: null })

  // Skills. Soft skills and core skills are left alone and skills unrelated to security and IT are red.
  // For the rest, one flagged skill per core skill the section lacks: the ones with no use in the role
  // first, then the security skills the role does not rely on. The others are fine to keep.
  const swapOrder: Record<string, number> = { offrole: 0, adjacent: 1 }
  const flagged = new Set(
    parsed.items
      .map((it, order) => ({ it, order }))
      .filter((x) => x.it.kind === "skill" && (x.it.fit === "offrole" || x.it.fit === "adjacent"))
      .sort((a, b) => swapOrder[a.it.fit!] - swapOrder[b.it.fit!] || a.order - b.order)
      .slice(0, missingNames.length)
      .map((x) => x.it),
  )

  let leadNo = 0
  const ongoingSaid = new Set<string>()
  const handsOn = parsed.handsOnIdeas[0] ?? ""
  const items0: Item[] = parsed.items.map((it) => {
    const what = it.excerpt ?? "This skill"
    if (it.kind === "skill") {
      if (it.fit === "soft" || it.fit === "core") return clean(it)
      if (it.fit === "unrelated") {
        return { ...it, verdict: "irrelevant", issue: `${what} has nothing to do with security or IT work.`, solution: swapFix() }
      }
      if (it.fit === "offrole" || it.fit === "adjacent") {
        if (!flagged.has(it)) return clean(it)
        return {
          ...it,
          verdict: "weak",
          issue: it.fit === "offrole"
            ? `${what} is not something ${roleLabel} uses day to day, and your skills section does not yet show ${names3}.`
            : `${what} is a security skill, but not one ${roleLabel} relies on, and your skills section does not yet show ${names3}.`,
          solution: swapFix(),
        }
      }
      // No fit given by the model: a skill that supports no must-have or strongly preferred item is
      // weak while core skills are absent.
      if (!missingNames.length || isCore(it)) return it
      return {
        ...it,
        verdict: it.verdict === "relevant" ? "weak" : it.verdict,
        issue: it.verdict === "relevant" ? `This is not a core skill for ${roleLabel}, and your skills section does not yet show ${names3}.` : it.issue,
        solution: swapFix(),
      }
    }
    // Experience and projects: only clear evidence of the role's work can be green.
    if ((it.kind === "experience" || it.kind === "project") && it.roleWork && it.roleWork !== "clear") {
      const thin = it.roleWork === "thin"
      const own = it.verdict !== "relevant"
      const gaps = thin ? bulletGaps(it) : null
      const lead = LEADS[leadNo++ % LEADS.length]
      // An entry that is still going on: ask for the role's tasks instead of telling the candidate to add work not done yet.
      // Said once per entry; the other bullets of the same entry get their own fix.
      const ongoing = it.verdict !== "irrelevant" && isOngoing(it.period, today) && !ongoingSaid.has(it.period!)
      if (ongoing) ongoingSaid.add(it.period!)
      const fix = ongoing
        ? `You are still in this role, so ask for tasks that ${roleLabel} does day to day${handsOn ? `, such as ${lcFirst(handsOn)}` : ""}, and add a bullet once you have done them.`
        : thin && gaps?.length
          ? `${lead}${listOf(gaps.map((g) => GAP_FIX[g]))}.`
          : (own && it.solution && conditionalFix(it.solution, lead)) || (thin
            ? "If you did this work, name the tool you used, what you did and what came out of it."
            : "Add a bullet about related hands-on work, if you have done any.")
      return {
        ...it,
        verdict: it.verdict === "irrelevant" ? "irrelevant" : "weak",
        issue: (own && it.issue) || (thin
          ? gaps?.length
            ? `This touches on work ${roleLabel} does day to day, but it does not show ${listOf(gaps.map((g) => GAP_NAME[g]))}.`
            : `This touches on work ${roleLabel} does day to day, but does not give enough evidence.`
          : `This does not show work ${roleLabel} does day to day.`),
        solution: fix,
      }
    }
    return it
  })

  const make = (
    base: { section: string; excerpt: string | null; issue: string; solution: string; kbItem: string | null; kind?: IssueKind | null },
    color?: IssueColor,
  ): FinalIssue => {
    const item = base.kbItem ? byId.get(base.kbItem) : undefined
    return {
      ...base,
      kbItem: item ? item.id : null,
      // No matching item: the issue is about wording or clarity. Without any knowledge base
      // items at all (an older knowledge base), do not label the source.
      basis: item ? item.basis : kb.length ? "general practice, not from the job postings" : null,
      priority: item ? priorityFor(item.tier) : "medium",
      color: color ?? issueColor(base.kind, base.excerpt, item ? item.tier : null),
      minor: false,
    }
  }

  const overall = overallFor(items0, summary)

  // 1. Every weak or irrelevant item becomes an issue.
  const issueOf = new Map<Item, FinalIssue>()
  const fromItems: FinalIssue[] = items0
    .filter((it) => it.verdict !== "relevant")
    .map((it) => {
      const color = itemColor(it) as IssueColor
      const issue: FinalIssue = {
      // A weak or irrelevant item is not a gap, so it carries no "seen in N postings" label.
      ...make({
        section: it.section,
        excerpt: it.excerpt,
        issue: it.issue ?? "",
        solution: it.solution ?? "",
        kbItem: it.kbItems.find((id) => byId.has(id)) ?? null,
        kind: "weak",
      }, color),
      basis: null,
      priority: "medium" as Priority,
      minor: overall?.level === "strong" && color === "orange",
      }
      issueOf.set(it, issue)
      return issue
    })

  // 2. The model's own issues cover what no single item can show: missing content, date errors,
  // formatting. An issue about text already covered by an item is dropped as a duplicate.
  const covered = new Set(fromItems.map((i) => norm(i.excerpt)).filter(Boolean))
  // An issue about a must-have the model itself marked present is a contradiction: dropped.
  const presentMust = new Set((summary?.items ?? []).filter((m) => m.status === "present").map((m) => m.id))
  const fromModel: FinalIssue[] = parsed.issues
    .filter((it) => !(it.excerpt && covered.has(norm(it.excerpt))))
    .filter((it) => !(it.kbItem && presentMust.has(it.kbItem.toUpperCase())))
    .map((it) => make(it))

  const all: FinalIssue[] = [...fromItems, ...fromModel]

  // 3. A must-have the model marked missing is red, and a partial one is orange, even if the
  // model never raised an issue about it. "Unknown" (the model skipped it) raises nothing.
  for (const m of summary?.items ?? []) {
    if (m.status !== "missing" && m.status !== "partial") continue
    const reported = parsed.mustHaves.find((r) => r.id.toUpperCase() === m.id)
    const linked = all.filter((i) => i.kbItem === m.id)
    if (m.status === "missing") {
      // An issue the model already raised for it is made red; if there is none, add one.
      let upgraded = false
      for (const i of linked) if (i.excerpt === null) { i.color = "red"; upgraded = true }
      if (!upgraded) {
        const short = shortLabel(m.label)
        all.push(make({
          section: reported?.section ?? "Overall",
          excerpt: null,
          issue: `Nothing in the resume shows this must-have: ${short}.`,
          solution: reported?.solution ?? `Add a project, lab write-up or experience line that shows ${short.toLowerCase()}.`,
          kbItem: m.id,
          kind: "missing",
        }, "red"))
      }
    } else if (!linked.some((i) => i.excerpt === null)) {
      // A partial must-have always gets its own issue, even when other issues point at the same item.
      const short = shortLabel(m.label)
      all.push(make({
        section: reported?.section ?? "Overall",
        excerpt: m.evidence,
        issue: `This only hints at a must-have and does not clearly show it: ${short}.`,
        solution: reported?.solution ?? `Add the tool, what you did and the result, so it clearly shows ${short.toLowerCase()}.`,
        kbItem: m.id,
        kind: "weak",
      }, "orange"))
    }
  }

  // 4. Section checks. Skills: the core skills the section lacks. Experience and projects: at least one
  // entry should show the role's day-to-day work with enough evidence. Skipped when the model gave no
  // answer for any entry of that kind.
  const skillItems = items0.filter((i) => i.kind === "skill")
  if (skillItems.length && missingNames.length) {
    all.push({
      ...make({
        section: skillItems[0].section,
        excerpt: null,
        issue: `Your skills section does not yet show ${names3}.`,
        solution: "Add the ones you have used, and let the least relevant skills make way if you are short of room.",
        kbItem: null,
        kind: "weak",
      }, "orange"),
      basis: null,
    })
  }
  const idea = parsed.handsOnIdeas[0]
  for (const [kind, noun] of [["experience", "experience entries"], ["project", "projects"]] as const) {
    const group = items0.filter((i) => i.kind === kind)
    if (!group.length || !group.some((i) => i.roleWork !== null) || group.some((i) => i.roleWork === "clear")) continue
    const anyThin = group.some((i) => i.roleWork === "thin")
    const how = kind === "experience"
      ? `Add a bullet that names the tool, what you did and the result. If you have no such work yet, a documented lab can show it${idea ? `. For example: ${idea}.` : "."}`
      : `Add one project that shows this work${idea ? `. For example: ${idea}.` : "."}`
    all.push({
      ...make({
        section: group[0].section,
        excerpt: null,
        issue: anyThin
          ? `Your ${noun} touch on work ${roleLabel} does day to day, but none shows it with enough evidence.`
          : `None of your ${noun} show work that ${roleLabel} does day to day.`,
        solution: how,
        kbItem: null,
        kind: "weak",
      }, "orange"),
      basis: null,
    })
  }

  // 5. Certifications: at least one should be aimed at the role (or above the foundational level).
  // All foundational: orange, with the next steps from the knowledge base. None related to the
  // field at all: red. Skipped when the model gave no level for any certification.
  const certs = items0.filter((i) => i.kind === "certification")
  if (certs.length && certs.some((i) => i.certLevel !== null) && !certs.some((i) => i.certLevel === "role")) {
    const next = [...new Set(parsed.nextCerts.map((c) => c.trim()).filter(Boolean))].slice(0, 3)
    const foundational = certs.some((i) => i.certLevel === "foundational")
    all.push(foundational
      ? make({
        section: certs[0].section,
        excerpt: null,
        issue: "All of your certifications are at the foundational level.",
        solution: next.length
          ? `Add ${listOf(next)} next, as a step beyond the foundational level.`
          : `Add one certification aimed at the work of ${roleLabel}, as a step beyond the foundational level.`,
        kbItem: null,
        kind: "weak",
      }, "orange")
      : make({
        section: certs[0].section,
        excerpt: null,
        issue: `None of your certifications relate to the work of ${roleLabel}.`,
        solution: next.length
          ? `Start with ${listOf(next)}.`
          : "Start with an entry-level security certification.",
        kbItem: null,
        kind: "missing",
      }, "red"))
    const last = all[all.length - 1]
    last.basis = null
  }

  const issues = all
    .map((final, index) => ({ final, index }))
    .sort((a, b) =>
      colorRank[a.final.color] - colorRank[b.final.color] ||
      Number(a.final.minor) - Number(b.final.minor) ||
      rank[a.final.priority] - rank[b.final.priority] ||
      a.index - b.index)
    .map((x) => x.final)

  const position = new Map(issues.map((issue, index) => [issue, index]))
  const items: FinalItem[] = items0.map((it, n) => {
    const issue = issueOf.get(it)
    return {
      ...it,
      grade: gradeOf(parsed.items[n], it),
      kbItems: it.kbItems.filter((id) => byId.has(id)),
      color: itemColor(it),
      issueIndex: issue ? (position.get(issue) ?? null) : null,
    }
  })

  const colorCounts: ColorCounts = {
    red: issues.filter((i) => i.color === "red").length,
    orange: issues.filter((i) => i.color === "orange").length,
    green: items.filter((i) => i.color === "green").length,
  }

  // At most 6 suggestions, no repeats, and none that just repeats an issue's own fix.
  const seen = new Set(issues.map((i) => norm(i.solution)))
  const suggestions: string[] = []
  for (const text of parsed.suggestions) {
    const key = norm(text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    suggestions.push(text)
    if (suggestions.length === 6) break
  }

  const { mustHaves: _m, issues: _i, items: _it, suggestions: _s, skillsMissing: _sm, skillIdeas: _si, handsOnIdeas: _h, ...rest } = parsed
  return {
    ...rest,
    suggestions,
    issues,
    items,
    colorCounts,
    overall,
    skillsMissing: missing.map((k) => ({ id: k.id, label: shortLabel(k.label) })),
    mustHaveSummary: summary,
  }
}
