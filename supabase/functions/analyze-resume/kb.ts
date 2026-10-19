// Reads the knowledge base text (items like "- [MH1] label (seen in 9 of 9 postings)") and turns
// the model's answer into the final result: priority and source label on every issue, plus the
// "N of M must-haves shown" summary. Counts and labels come from the knowledge base text, never
// from the model, so the model cannot invent them.

import type { Feedback } from "./llm.ts"

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
export type FinalIssue = Feedback["issues"][number] & { basis: string | null; priority: Priority }
export type FinalFeedback = Omit<Feedback, "issues" | "mustHaves"> & {
  issues: FinalIssue[]
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

export function finalizeFeedback(parsed: Feedback, kb: KbItem[]): FinalFeedback {
  const byId = new Map(kb.map((i) => [i.id, i]))
  const rank: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

  const issues: FinalIssue[] = parsed.issues
    .map((it, index) => {
      const item = it.kbItem ? byId.get(it.kbItem) : undefined
      const final: FinalIssue = {
        ...it,
        kbItem: item ? item.id : null,
        // No matching item: the issue is about wording or clarity. Without any knowledge base
        // items at all (an older knowledge base), do not label the source.
        basis: item ? item.basis : kb.length ? "general practice, not from the job postings" : null,
        priority: item ? priorityFor(item.tier) : "medium",
      }
      return { final, index }
    })
    .sort((a, b) => rank[a.final.priority] - rank[b.final.priority] || a.index - b.index)
    .map((x) => x.final)

  const { mustHaves, issues: _drop, ...rest } = parsed
  return { ...rest, issues, mustHaveSummary: buildMustHaveSummary(kb, mustHaves) }
}
