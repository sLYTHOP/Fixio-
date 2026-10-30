// Reads the knowledge base text (items like "- [MH1] label (seen in 9 of 9 postings)") and turns
// the model's answer into the final result: priority, source label and color on every issue, a
// color on every resume item, plus the "N of M must-haves shown" summary. Counts, labels and
// colors come from the knowledge base text and from code, never from the model, so the model
// cannot invent them. Every weak or irrelevant item and every missing must-have becomes an
// issue here, so coverage does not depend on the model choosing to raise it.

import type { Feedback, Item, IssueKind } from "./llm.ts"

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
export type FinalItem = Item & { color: ItemColor }
export type ColorCounts = { red: number; orange: number; green: number }
export type OverallLevel = "strong" | "moderate" | "low"
export type Overall = { level: OverallLevel; note: string }
export type FinalFeedback = Omit<Feedback, "issues" | "mustHaves" | "items" | "skillsMissing"> & {
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
const shortLabel = (label: string) => label.split(":")[0].trim()
const listOf = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`

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
  const hasRoleWork = items.some((i) => i.roleWork === true)
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

export function finalizeFeedback(parsed: Feedback, kb: KbItem[], roleLabel = "this role"): FinalFeedback {
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

  // While core skills are absent, a skill that supports no must-have or strongly preferred item
  // is weak: it takes space the missing skills could use. The fix names those skills.
  const items0: Item[] = parsed.items.map((it) => {
    if (it.kind !== "skill" || !missingNames.length || isCore(it)) return it
    const names = listOf(missingNames.slice(0, 3))
    return {
      ...it,
      verdict: it.verdict === "relevant" ? "weak" : it.verdict,
      issue: it.verdict === "relevant" ? `This is not a core skill for ${roleLabel}, and your skills section does not yet show ${names}.` : it.issue,
      solution: `Consider making room for ${names} in place of it.`,
    }
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
  const fromItems: FinalIssue[] = items0
    .filter((it) => it.verdict !== "relevant")
    .map((it) => ({
      // A weak or irrelevant item is not a gap, so it carries no "seen in N postings" label.
      ...make({
        section: it.section,
        excerpt: it.excerpt,
        issue: it.issue ?? "",
        solution: it.solution ?? "",
        kbItem: it.kbItems.find((id) => byId.has(id)) ?? null,
        kind: "weak",
      }, "orange"),
      basis: null,
      priority: "medium" as Priority,
      minor: overall?.level === "strong",
    }))

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
    } else if (!linked.length) {
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

  // 4. Experience and projects: at least one entry of each should show work the role does day
  // to day. Skipped when the model gave no answer for any entry of that kind.
  const stillNeeded = (summary?.items ?? []).filter((m) => m.status !== "present").map((m) => shortLabel(m.label))
  const examples = (stillNeeded.length ? stillNeeded : kb.filter((k) => k.tier === "MH").map((k) => shortLabel(k.label))).slice(0, 2)
  for (const [kind, noun] of [["experience", "experience entries"], ["project", "projects"]] as const) {
    const group = items0.filter((i) => i.kind === kind)
    if (!group.length || !group.some((i) => i.roleWork !== null) || group.some((i) => i.roleWork === true)) continue
    all.push({
      ...make({
        section: group[0].section,
        excerpt: null,
        issue: `None of your ${noun} show work that ${roleLabel} does day to day.`,
        solution: examples.length
          ? `Consider adding or rewording one entry so it shows ${listOf(examples).toLowerCase()}.`
          : "Consider adding or rewording one entry so it shows the day-to-day work of the role.",
        kbItem: null,
        kind: "weak",
      }, "orange"),
      basis: null,
    })
  }

  const issues = all
    .map((final, index) => ({ final, index }))
    .sort((a, b) =>
      colorRank[a.final.color] - colorRank[b.final.color] ||
      Number(a.final.minor) - Number(b.final.minor) ||
      rank[a.final.priority] - rank[b.final.priority] ||
      a.index - b.index)
    .map((x) => x.final)

  const items: FinalItem[] = items0.map((it) => ({
    ...it,
    kbItems: it.kbItems.filter((id) => byId.has(id)),
    color: it.verdict === "relevant" ? "green" : "orange",
  }))

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

  const { mustHaves: _m, issues: _i, items: _it, suggestions: _s, skillsMissing: _sm, ...rest } = parsed
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
