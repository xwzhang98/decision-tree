// The details of the selected node: what the frame under the rail holds.
//
//   ╭─ Details ──────────────────────────── ✓ adopted  model  10-01 ─╮
//   │ Conflicts: merge by paragraph, the title is the last edit       │
//   │                                                                 │
//   │ Paragraphs are the smallest unit a person thinks in ...         │
//   │                                                                 │
//   │ Rationale  A paragraph is what a user means by "what I changed" │
//   │ Evidence   Merge by paragraph (200 sessions)   3 left   replay_a│
//   │ Sources    docs/adr/0004-sync.md                                │
//   │ Notes      10-04 user  Keep it for now                          │
//   ╰─────────────────────────────────────────────────────────────────╯
//
// This module makes the lines inside the frame and the words of its top border; frame.ts draws the frame.
// A text that has no rendition in the pane's language yet is shown as it was written, in grey.

import type { DtEvidence, DtLang, DtNode, DtStatus } from '../types'
import { fmtDate } from './events'
import { glyphOf, toneOf } from './glyphs'
import { ACTOR_COLOUR, richSpans, runSpans, wrapRuns } from './highlight'
import { statusLabel, t } from './i18n'
import type { Localizer } from './lang'
import { markOf } from './lang'
import { QUIET, S, nonEmpty } from './style'
import type { Line, Span } from './spans'
import { indent, lineWidth, truncateSpans } from './spans'
import type { TreeIndex } from './tree'
import { supersededNodes } from './tree'
import { padEnd, plain, strWidth, truncate, wrap } from './width'

/** The most lines a title takes in the details. */
const TITLE_LINES = 3
/** A run name cut to fewer columns than this says nothing, so it is left out instead. */
const MIN_RUN = 6
/** The least room the text of a labelled part keeps beside its label; narrower than that, the label goes above. */
const MIN_BODY = 26
/** The least room the text of a note keeps beside its date and actor; narrower than that, they go above it. */
const MIN_NOTE = 16

type Style = Omit<Span, 'text'>

// ---------------------------------------------------------------- the words of the top border

/** `✓ adopted` as a chip: adopted and rejected sit on a tinted ground, the others on the quiet band. */
export function statusChip(status: DtStatus, o: { lang: DtLang; ascii: boolean }): Span {
  const tone = toneOf(status)
  const text = ` ${glyphOf(status, o.ascii)} ${statusLabel(o.lang, status)} `
  if (status === 'adopted') return S(text, { color: tone.color, bg: 'diffAddedDimmed' })
  if (status === 'rejected') return S(text, { color: tone.color, bg: 'diffRemovedDimmed' })
  return S(text, { color: tone.color, bg: 'subtle', ...(tone.dim ? { dim: true } : {}) })
}

/** The right of the border: the status chip, who decided it and when. */
export function detailBadge(n: DtNode, o: { lang: DtLang; ascii: boolean }): Line {
  const actor = n.decidedBy ?? n.createdBy
  const date = fmtDate(n.decidedAt ?? n.createdAt)
  const line: Line = [statusChip(n.status, o)]
  if (nonEmpty(actor)) line.push(S(' '), S(actor, { color: ACTOR_COLOUR[actor] }))
  if (date !== '') line.push(S('  ' + date, QUIET))
  return line
}

/** The left of the border. */
export function detailTitle(lang: DtLang): Line {
  return [S(t(lang, 'detail.title'), { bold: true })]
}

// ---------------------------------------------------------------- text, coloured

/** `text` wrapped to `width`: coloured like code, or plain grey when it is still in the language it was written in. */
function textLines(text: string, width: number, o: { grey: boolean; topic?: boolean; style?: Style }): Line[] {
  const style = o.style ?? {}
  if (o.grey) return wrap(text, Math.max(1, width)).map(l => [S(l, { ...style, color: 'inactive' })])
  return wrapRuns(text, Math.max(1, width), o.topic === true).map(runs => runSpans(runs, style))
}

/** Lines each set in by `ind` columns. */
function setIn(lines: readonly Line[], ind: number): Line[] {
  return lines.map(l => [indent(ind), ...l])
}

function wrapped(text: string, width: number, ind: number, style: Style = {}): Line[] {
  return wrap(text, Math.max(1, width - ind)).map(l => (ind > 0 ? [indent(ind), S(l, style)] : [S(l, style)]))
}

/** The path of a source: the folders quiet, the name of the file in a colour of its own. */
export function pathSpans(path: string, max: number): Line {
  const at = path.lastIndexOf('/') + 1
  let dir = path.slice(0, at)
  const file = path.slice(at)
  if (strWidth(path) > max) {
    // the start of the folders goes first: the end of a path is what tells it apart
    const room = max - strWidth(file) - 1
    dir = room > 0 ? '…' + dir.slice(Math.max(0, dir.length - room)) : ''
  }
  const out: Line = []
  if (dir !== '') out.push(S(dir, QUIET))
  out.push(S(truncate(file, Math.max(1, max - strWidth(dir))), { color: 'ide' }))
  return out
}

// ---------------------------------------------------------------- evidence

/**
 * An evidence line `label  value ci  run`, cut to `width`. With `labelW` the label is padded to that many columns,
 * so that the values of several lines line up, as long as the value still fits beside it. What does not fit
 * goes in this order: the run (cut when at least `MIN_RUN` columns of it can show, else dropped), then the
 * end of the label.
 */
export function evidenceLine(ev: DtEvidence, width: number, ind: number, labelW = 0, grey = false, greyText = grey): Line {
  const room = Math.max(1, width - ind)
  const gap = 2
  const w = strWidth
  let label = plain(ev.label)
  const value = plain(ev.value ?? '')
  const ci = plain(ev.ci ?? '')
  let run = plain(ev.run ?? '')
  // a result with neither value nor interval may still carry a note
  const note = value === '' && ci === '' ? plain(ev.note ?? '') : ''
  const mid = [value, ci, note].filter(nonEmpty).join(' ')
  const midW = mid !== '' ? gap + w(mid) : 0

  if (label !== '' && mid !== '' && labelW > w(label) && labelW + midW <= room) label = padEnd(label, labelW)

  if (run !== '') {
    const left = room - w(label) - midW - gap
    if (w(run) > left) run = left >= MIN_RUN ? truncate(run, left) : ''
  }
  const runW = run !== '' ? gap + w(run) : 0
  if (w(label) + midW + runW > room) {
    const left = room - midW - runW
    label = left >= 2 ? truncate(label, left) : ''
  }

  const line: Line = [indent(ind)]
  let any = false
  const push = (spans: Line) => {
    if (any) line.push(S(' '.repeat(gap)))
    line.push(...spans)
    any = true
  }
  const words = (text: string, quiet: boolean): Line => (quiet ? [S(text, { color: 'inactive' })] : richSpans(text))
  if (label !== '') push(words(label, grey))
  if (mid !== '') {
    const spans: Line = []
    const text = [value, note].filter(nonEmpty).join(' ')
    if (text !== '') spans.push(...words(text, greyText))
    if (ci !== '') spans.push(S(text !== '' ? ` ${ci}` : ci, QUIET))
    push(spans)
  }
  if (run !== '') push([S(run, { color: 'planMode', dim: true })])
  return truncateSpans(line, width)
}

// ---------------------------------------------------------------- the content

export type DetailInput = {
  node: DtNode
  idx: TreeIndex
  /** Columns of content inside the frame. */
  width: number
  lang: DtLang
  ascii: boolean
  loc: Localizer
  /** A blank line between the parts: set when the pane has room for them. */
  roomy?: boolean
}

/**
 * The detail of one node, every line at most `width` columns. Title, summary, then the labelled parts:
 * rationale, evidence, sources, tags and notes, each label in a column beside its text (above it when the
 * pane is too narrow for that).
 */
export function detailContent(a: DetailInput): Line[] {
  const { node: n, width, lang, loc } = a
  const out: Line[] = []
  const gap = () => {
    if (a.roomy === true && out.length > 0 && out[out.length - 1]!.length > 0) out.push([])
  }
  const grey = (text: string) => loc.waiting(text)

  // the title: coloured by its parts, bold, at most three lines, and its language marked when it is waiting for a rendition
  const empty = plain(n.title) === ''
  const titleText = empty ? t(lang, 'r.untitled') : plain(n.title)
  const waitingTitle = !empty && grey(n.title)
  const titleStyle: Style = {}
  if (!waitingTitle && !empty) titleStyle.bold = true
  if (empty) titleStyle.dim = true
  const title = textLines(titleText, width, { grey: waitingTitle || empty, topic: true, style: titleStyle })
  const shown = title.slice(0, TITLE_LINES)
  if (title.length > TITLE_LINES) shown[TITLE_LINES - 1] = truncateSpans([...shown[TITLE_LINES - 1]!, S('…')], width)
  if (waitingTitle) {
    const last = shown.length - 1
    shown[last] = truncateSpans([...shown[last]!, S(' '), S(markOf(n.title), QUIET)], width)
  }
  out.push(...shown)

  const evidence = n.evidence ?? []
  const sources = n.sources ?? []
  const tags = n.tags ?? []
  const older = supersededNodes(a.idx, n.id)
  const hasParts = nonEmpty(n.rationale) || evidence.length > 0 || sources.length > 0 || tags.length > 0 || n.notes.length > 0

  if (n.retracted !== undefined) {
    gap()
    const by = t(lang, 'pane.retractedBy', { actor: n.retracted.actor })
    const reason = nonEmpty(n.retracted.reason) ? `: ${plain(n.retracted.reason)}` : ''
    out.push(...wrapped(by + reason, width, 0, { color: 'error' }))
  }
  if (nonEmpty(n.summary)) {
    gap()
    out.push(...textLines(n.summary, width, { grey: grey(n.summary) }))
  }
  if (hasParts) gap()

  // the labels share a column, unless that leaves too little room for the text
  const labels = [
    nonEmpty(n.rationale) ? t(lang, 'detail.rationale') : '',
    evidence.length > 0 ? t(lang, 'detail.evidence') : '',
    sources.length > 0 ? t(lang, 'detail.sources') : '',
    tags.length > 0 ? t(lang, 'detail.tags') : '',
    n.notes.length > 0 ? t(lang, 'detail.notes') : '',
  ]
  const labelW = labels.reduce((m, l) => Math.max(m, strWidth(l)), 0) + 2
  const listed = width - labelW >= MIN_BODY
  const bodyAt = listed ? labelW : 2
  const bodyW = Math.max(1, width - bodyAt)

  /** A labelled part: the label in the column beside the first line, or alone above the lines when stacked. */
  const part = (label: string, lines: Line[]) => {
    if (lines.length === 0) return
    if (listed) {
      // every line starts with the indent of the text column; the first one gives it up for the label
      out.push([S(padEnd(label, labelW), QUIET), ...lines[0]!.slice(1)])
      out.push(...lines.slice(1))
    } else {
      out.push([S(label, QUIET)], ...lines)
    }
  }

  if (nonEmpty(n.rationale)) part(t(lang, 'detail.rationale'), setIn(textLines(n.rationale, bodyW, { grey: grey(n.rationale) }), bodyAt))

  if (evidence.length > 0) {
    const wide = evidence.reduce((m, ev) => Math.max(m, strWidth(plain(ev.label))), 0)
    const pad = Math.min(wide, Math.floor(bodyW * 0.5))
    part(t(lang, 'detail.evidence'), evidence.map(ev => evidenceLine(ev, width, bodyAt, pad, grey(ev.label), grey(ev.value ?? '') || grey(ev.note ?? ''))))
  }

  if (sources.length > 0) part(t(lang, 'detail.sources'), sources.map(src => [indent(bodyAt), ...pathSpans(plain(src), bodyW)]))

  if (nonEmpty(n.supersededBy)) out.push(...wrapped(t(lang, 'detail.supersededBy', { id: n.supersededBy }), width, 0, QUIET))
  if (older.length > 0) out.push(...wrapped(t(lang, 'detail.supersedes', { ids: older.map(o => o.id).join(', ') }), width, 0, QUIET))

  if (tags.length > 0) part(t(lang, 'detail.tags'), wrap(tags.join(', '), bodyW).map(l => [indent(bodyAt), S(l)]))

  if (n.notes.length > 0) {
    const lines: Line[] = []
    for (const note of n.notes) {
      const date = fmtDate(note.ts)
      const head = [date, note.actor].filter(nonEmpty).join(' ')
      const mark: Line = [...(date === '' ? [] : [S(date, QUIET), S(' ')]), S(note.actor, { color: ACTOR_COLOUR[note.actor] })]
      const beside = bodyW - strWidth(head) - 2
      if (plain(note.text) === '') {
        lines.push([indent(bodyAt), ...mark])
      } else if (beside >= MIN_NOTE) {
        // the text beside the date and the actor, its other lines hanging under its first
        const text = textLines(plain(note.text), beside, { grey: grey(note.text) })
        text.forEach((l, i) => {
          lines.push(i === 0 ? [indent(bodyAt), ...mark, S('  '), ...l] : [indent(bodyAt + strWidth(head) + 2), ...l])
        })
      } else {
        // too narrow for that: the date and the actor on a line of their own, the text under them
        lines.push([indent(bodyAt), ...mark])
        lines.push(...setIn(textLines(plain(note.text), bodyW, { grey: grey(note.text) }), bodyAt))
      }
    }
    part(t(lang, 'detail.notes'), lines)
  }
  // nothing wider than the room, even where there is hardly any (a label wider than the pane, say)
  return out.map(l => (lineWidth(l) > width ? truncateSpans(l, width) : l))
}

/** At most `max` lines; the last one says that more were cut. */
export function capLines(lines: readonly Line[], max: number): Line[] {
  if (max <= 0) return []
  if (lines.length <= max) return [...lines]
  return [...lines.slice(0, max - 1), [S('…', QUIET)]]
}
