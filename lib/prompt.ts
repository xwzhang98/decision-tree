// The system-prompt section (spec 7.3): one line when the project is not being
// recorded, one line when paused, and a short briefing when it is on.
//
// The text is for the model, so it is English whatever language the pane is in.
// It changes whenever a decision is recorded, and a change in a session-scoped
// section costs the prompt cache from that point on; the runtime therefore asks
// for a fresh copy once per turn, not once per request.

import type { DtMode } from '../types'
import type { TreeIndex } from './tree'
import { recentNodes, trunkNodes } from './tree'
import { oneLine, truncate } from './width'

export const SECTION_ID = 'decision-tree:record'
/** The limit on the "on" section, in characters (spec 7.3: about 1,500). */
export const MAX_SECTION = 1500
export const RECENT_IN_PROMPT = 10

export const OFF_LINE =
  "If the user asks to start recording this project's decisions (for example 'start recording decisions from now' or '从现在开始记录决定'), call decision_log_start."

export const PAUSED_LINE =
  "This project's decision record is paused (the user can resume it with /decide resume). Do not record decisions."

// Short on purpose: the section is rebuilt every turn and every character is paid for again; the
// tool descriptions carry the full rules, and the room here goes to the tree.
const RULES = [
  'Decision record ON: decision_record / decision_update / decision_note / decision_tree (their descriptions have the full rules).',
  'Record what the user decides, gate results (decidedBy "gate"), plans they accept (planned) and open proposals (proposed); never mark an unagreed idea adopted; no progress or logs.',
  'Evidence: numbers and intervals; evidence.run is the run name, evidence.source the report path. A replaced decision: update it with supersededBy. One matter, one node.',
  'Choose the parent from the list below, or call decision_tree. Technical terms in English, other text in the language the user writes in; never translate recorded text.',
].join('\n')

/** How much each part of the tree may take, from the roomiest to the tightest. */
const LEVELS: readonly { recentTitle: number; mainCount: number; mainTitle: number }[] = [
  { recentTitle: 36, mainCount: 8, mainTitle: 30 },
  { recentTitle: 30, mainCount: 6, mainTitle: 24 },
  { recentTitle: 24, mainCount: 5, mainTitle: 18 },
  { recentTitle: 18, mainCount: 4, mainTitle: 14 },
  { recentTitle: 14, mainCount: 3, mainTitle: 12 },
  { recentTitle: 10, mainCount: 2, mainTitle: 10 },
  { recentTitle: 8, mainCount: 1, mainTitle: 8 },
]

/** Which tree the project is recording into, when it is not the main one (`from`: where it began, in words). */
export type TreeNote = { name: string; from: string }

function treeLine(tree: TreeNote | null): string[] {
  return tree === null ? [] : [`Current tree: ${tree.name}${tree.from === '' ? '' : ` (${tree.from})`}. What you record goes into it, and the list below is its.`]
}

/** The section's text for the current state; `idx` is the replayed tree when the project is on. */
export function sectionText(mode: DtMode, idx: TreeIndex | null, tree: TreeNote | null = null): string {
  if (mode === 'off') return OFF_LINE
  if (mode === 'paused') return PAUSED_LINE

  if (idx === null || idx.nodes.length === 0) {
    return [RULES, ...treeLine(tree), 'Nothing is recorded yet: the first decision has parent null.'].join('\n')
  }

  const trunk = trunkNodes(idx)
  const recent = recentNodes(idx, RECENT_IN_PROMPT)

  const build = (level: (typeof LEVELS)[number], recentCount: number): string => {
    const m = trunk.slice(-level.mainCount).map(n => `${n.id} "${truncate(oneLine(n.title), level.mainTitle)}"`)
    const r = recent.slice(0, recentCount).map(n => `${n.id} · ${n.status} · ${truncate(oneLine(n.title), level.recentTitle)}`)
    const parts = [RULES, ...treeLine(tree)]
    if (m.length > 0) parts.push(`Mainline: ${m.join(' > ')}`)
    if (r.length > 0) parts.push(`Recent (id · status · title):\n${r.join('\n')}`)
    return parts.join('\n')
  }

  // all ten recent nodes at the roomiest level that fits; failing that, the newest ones at the tightest
  for (const level of LEVELS) {
    const text = build(level, recent.length)
    if (text.length <= MAX_SECTION) return text
  }
  const tightest = LEVELS[LEVELS.length - 1]!
  for (let count = recent.length - 1; count >= 0; count--) {
    const text = build(tightest, count)
    if (text.length <= MAX_SECTION) return text
  }
  return build(tightest, 0).slice(0, MAX_SECTION)
}
