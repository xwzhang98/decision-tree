// The rail: the mainline of the tree drawn as the spine of a graph, a dot for each step, with what was
// tried at that step hanging off it.
//
//   ●  Storage: SQLite with a write-ahead log                  09-14
//   ┠─ ✗ Keep JSON files and add a lock file
//   ┃
//   ◉  Sync: clients send operations, the server decides   •   09-21
//   ┠─ ✗ CRDT text engine: too heavy for older phones
//   ┃  ╰─ ◌ A fallback for notes over 50 KB
//   ╏
//   ○  Beta to 500 testers once the soak test passes           10-06
//
// One line of it is `railLine`; `Row` (tree.ts) says what the line is. The spine is solid once the way
// to a step is done and dashed while it leads to a step still ahead; the newest step adopted is the head.

import type { DtLang, DtNode } from '../types'
import { fmtDate, parseTime } from './events'
import { COLORS, MARKS, RAIL, glyphOf, isQuiet, pick, toneOf } from './glyphs'
import { richSpans } from './highlight'
import { t } from './i18n'
import { EDGE, QUIET, S } from './style'
import type { Line, Span } from './spans'
import { barLine, fitSpans, lineWidth } from './spans'
import type { Row } from './tree'
import { strWidth } from './width'

/** The column of the spine, and where a title starts on a step and on a branch. */
export const SPINE_COL = 2
const STEP_TITLE_COL = 5
const BRANCH_GLYPH_COL = 5
/** The least room a title keeps however deep the branches go. */
const MIN_TITLE = 22
/** What the right-hand side of a step can take: `+12  10-06 •`. */
const RIGHT_ROOM = 8

const DAY_MS = 24 * 3600 * 1000

/** Where a branch of the given depth (2 and up) puts its elbow, a glyph and its title; `step` columns a level. */
function placeOf(depth: number, step: number): { elbow: number; glyph: number; title: number } {
  const elbow = BRANCH_GLYPH_COL + step * (depth - 2)
  return { elbow, glyph: elbow + 3, title: elbow + 5 }
}

/** How far each level of deep branches moves in (3 columns, fewer when the tree is too deep for the pane to leave titles their room). */
export function indentPlan(rows: readonly Row[], width: number): { step: number } {
  const deepest = rows.reduce((m, r) => Math.max(m, r.depth), 0)
  if (deepest < 3) return { step: 3 }
  for (const step of [3, 2, 1]) {
    if (placeOf(deepest, step).title + MIN_TITLE + RIGHT_ROOM <= width - EDGE) return { step }
  }
  return { step: 0 }
}

export type RailLineOptions = {
  /** The whole pane's width: the selection's bar goes from edge to edge. */
  width: number
  selected: boolean
  ascii: boolean
  lang: DtLang
  nowMs: number
  /** The title as it reads in the pane's language. */
  title: string
  /** The language mark, when the title is shown in the language it was written in because its rendition is not there yet. */
  mark: string | null
  step: number
}

/** The part of a note at the end of a row, quiet: how many rows a collapsed node folds, and that a node was retracted. */
export function rowNote(row: Row, lang: DtLang): string {
  const parts: string[] = []
  if (row.hiddenKids > 0) parts.push(`+${row.hiddenKids}`)
  if (row.node.retracted !== undefined) parts.push(t(lang, 'pane.retracted'))
  return parts.join(' ')
}

/** Whether the node changed in the last day: the bullet at the end of its row. */
export function isRecent(n: DtNode, nowMs: number): boolean {
  const at = parseTime(n.updatedAt)
  return at !== null && nowMs - at <= DAY_MS && nowMs - at > -DAY_MS
}

/** The title of a row: coloured like code, or plain grey with the language mark after it when it is not rendered yet. */
export function titleSpans(text: string, o: { mark: string | null; bold: boolean; dim: boolean }): Line {
  if (o.mark !== null) return [S(text, { color: 'inactive' }), S(' '), S(o.mark, QUIET)]
  return richSpans(text, { ...(o.bold ? { bold: true } : {}), ...(o.dim ? { dim: true } : {}) }, true)
}

/** One line of the rail, `o.width` columns across the whole pane; the selected row is a bar from edge to edge. */
export function railLine(row: Row, o: RailLineOptions): Line {
  const n = row.node
  const tone = toneOf(n.status)
  const quiet = isQuiet(n.status) || n.retracted !== undefined
  const left: Line = []
  let col = 0
  /** Spans placed at a column (blanks fill the way there). */
  const putSpans = (spans: readonly Span[], at?: number) => {
    if (at !== undefined && at > col) {
      left.push(S(' '.repeat(at - col)))
      col = at
    }
    left.push(...spans)
    col += lineWidth(spans)
  }
  const put = (text: string, style: Omit<Span, 'text'> = {}, at?: number) => putSpans([S(text, style)], at)
  const glyph = (at: number) => put(glyphOf(n.status, o.ascii), { color: tone.color, ...(tone.dim && !o.selected ? { dim: true } : {}) }, at)

  put(o.selected ? pick(MARKS.bar, o.ascii) : ' ', o.selected ? { color: COLORS.mark } : {})
  const spine = { color: COLORS.mainline }
  if (row.rail.step) {
    const hollow = n.status === 'planned' || n.status === 'proposed'
    const dot = row.rail.head ? RAIL.head : hollow ? RAIL.ahead : RAIL.step
    put(pick(dot, o.ascii), { ...spine, ...(hollow ? { dim: true } : {}), ...(row.rail.head ? { bold: true } : {}) }, SPINE_COL)
    putSpans(titleSpans(o.title, { mark: o.mark, bold: n.status === 'adopted', dim: quiet }), STEP_TITLE_COL)
  } else if (row.depth === 1) {
    put(pick(row.rail.lastBranch && row.rail.end ? RAIL.forkEnd : RAIL.fork, o.ascii), spine, SPINE_COL)
    put(pick(RAIL.dash, o.ascii), QUIET)
    glyph(BRANCH_GLYPH_COL)
    put(' ')
    putSpans(titleSpans(o.title, { mark: o.mark, bold: false, dim: quiet && !o.selected }))
  } else {
    const at = placeOf(row.depth, o.step)
    if (!row.rail.end || row.rail.more) put(pick(RAIL.solid, o.ascii), { ...spine, ...(row.rail.ahead ? { dim: true } : {}) }, SPINE_COL)
    put(pick(RAIL.elbow, o.ascii), QUIET, at.elbow)
    put(pick(RAIL.dash, o.ascii), QUIET)
    glyph(at.glyph)
    put(' ')
    putSpans(titleSpans(o.title, { mark: o.mark, bold: false, dim: quiet && !o.selected }))
  }

  const right: Line = []
  const note = rowNote(row, o.lang)
  if (note !== '') right.push(S(note + '  ', { dim: true }))
  if (row.rail.step) right.push(S(fmtDate(n.decidedAt ?? n.createdAt), QUIET), S(' '))
  right.push(isRecent(n, o.nowMs) ? S(pick(RAIL.recent, o.ascii), { color: 'suggestion' }) : S(' '))

  const line = fitSpans(left, right, o.width - EDGE, 2)
  return o.selected ? barLine(line, COLORS.selected, o.width) : line
}

/** The spine between two steps: solid once the way is done, dashed while it leads to a step still ahead. */
export function spacerLine(ahead: boolean, o: { ascii: boolean }): Line {
  return [S(' '.repeat(SPINE_COL)), S(pick(ahead ? RAIL.dashed : RAIL.solid, o.ascii), { color: COLORS.mainline, ...(ahead ? { dim: true } : {}) })]
}

