// The "now" block: what the project's status command reports, in a frame of its own: the lanes (what
// is running and how far it is), what is next, warnings, and how fresh it is.
//
//   ╭─ Now ─────────────────────────────────────────────── stale 3 min ─╮
//   │ ALPHA  sync-bench s0  ████████░░  1700/2000  ~18:40  warming up   │
//   │ BRAVO  merge-eval s1  █░░░░░░░░░   210/2000  ~07:25               │
//   │ Next   restore-test s1 (~05:05)                                   │
//   │ ! CHARLIE is idle                                                 │
//   ╰───────────────────────────────────────────────────────────────────╯
//
// A command that waits for the person's OK is spelled out whole, never cut, with the button to allow it
// under it (layout.ts puts the button in).

import type { DtLane, DtLang, DtNow } from '../types'
import { t } from './i18n'
import { QUIET, S, paren } from './style'
import type { Line } from './spans'
import { indent, lineWidth, truncateSpans } from './spans'
import { describeArgv, isStale, minutesSince, progressBar, stepText } from './status'
import { padEnd, padStart, strWidth, truncate, wrap } from './width'

export type NowInput = {
  now: DtNow
  intervalSec: number
  nowMs: number
  /** Columns of content inside the frame. */
  width: number
  ascii: boolean
  lang: DtLang
}

/** What the block says: the words of the frame's top border and the lines inside it. `argv` is the command the lines show; `needsApproval` is true only when all of it is shown and the button may be offered. */
export type NowBlock = { title: Line; right: Line; lines: Line[]; needsApproval: boolean; argv: readonly string[] }

/** The most lines a command waiting for approval may take; a longer one is not offered for approval. */
export const MAX_COMMAND_LINES = 6

function laneColor(state: DtLane['state']): { color?: string; dim?: boolean } {
  switch (state) {
    case 'running':
      return { color: 'suggestion' }
    case 'done':
      return { color: 'success' }
    case 'failed':
      return { color: 'error' }
    default:
      return { dim: true }
  }
}

function laneStateLabel(state: DtLane['state'], lang: DtLang): string {
  switch (state) {
    case 'queued':
      return t(lang, 'now.queued')
    case 'done':
      return t(lang, 'now.done')
    case 'failed':
      return t(lang, 'now.failed')
    case 'idle':
      return t(lang, 'now.idle')
    default:
      return ''
  }
}

function wrapped(text: string, width: number, ind: number, style: { color?: string; dim?: boolean } = {}): Line[] {
  return wrap(text, Math.max(1, width - ind)).map(l => (ind > 0 ? [indent(ind), S(l, style)] : [S(l, style)]))
}

export type Cols = { name: number; run: number; step: number }

/** One lane: `ALPHA  sync-bench s0   ████████░░  1700/2000   ~18:40   note`; trailing cells go first when narrow. */
export function laneLine(lane: DtLane, cols: Cols, o: { width: number; ascii: boolean; lang: DtLang; stale: boolean }): Line {
  const tone = laneColor(lane.state)
  const dim = o.stale || tone.dim === true
  const hasBar = lane.total !== null && lane.total > 0
  const stateText = laneStateLabel(lane.state, o.lang)
  const barText = hasBar ? progressBar(lane.step, lane.total, o.ascii) : padEnd(stateText, 10)
  const step = hasBar ? padStart(stepText(lane.step, lane.total), cols.step) : ''
  let tail = ''
  if (lane.state === 'running' && lane.eta !== '') tail = t(o.lang, 'now.eta', { eta: lane.eta })
  else if (lane.state !== 'running' && hasBar && stateText !== '') tail = stateText
  const note = lane.note

  let runW = cols.run
  const build = (withNote: boolean, withTail: boolean, withStep: boolean, withBar: boolean): Line => {
    const name = truncate(lane.name, cols.name)
    const line: Line = [S(name + ' '.repeat(Math.max(0, cols.name - strWidth(name))), { bold: true, dim: o.stale })]
    line.push(S('  '))
    const run = truncate(lane.run, runW)
    line.push(S(run + ' '.repeat(Math.max(0, runW - strWidth(run))), { dim: o.stale }))
    if (withBar) {
      line.push(S('  '), S(barText, { ...(dim ? {} : { color: tone.color }), dim }))
      if (withStep && step !== '') line.push(S('  '), S(step, { dim }))
      if (withTail && tail !== '') line.push(S('  '), S(tail, QUIET))
    }
    if (withNote && note !== '') line.push(S('  '), S(note, QUIET))
    return line
  }

  const attempts: [boolean, boolean, boolean, boolean][] = [
    [true, true, true, true],
    [false, true, true, true],
    [false, false, true, true],
    [false, false, false, true],
  ]
  for (const [a, b, c, d] of attempts) {
    const line = build(a, b, c, d)
    if (lineWidth(line) <= o.width) return line
  }
  // still too wide: the run name gives way
  const bare = build(false, false, false, true)
  const over = lineWidth(bare) - o.width
  runW = Math.max(4, cols.run - over)
  const line = build(false, false, false, true)
  if (lineWidth(line) <= o.width) return line
  return truncateSpans(build(false, false, false, false), o.width)
}

export function lanesCols(lanes: readonly DtLane[]): Cols {
  let name = 0
  let run = 0
  let step = 0
  for (const l of lanes) {
    name = Math.max(name, strWidth(l.name))
    run = Math.max(run, strWidth(l.run))
    if (l.total !== null && l.total > 0) step = Math.max(step, strWidth(stepText(l.step, l.total)))
  }
  return { name: Math.min(name, 10), run: Math.min(run, 18), step }
}

/** The block for the status the project reports; no lines at all when there is no status command. */
export function nowBlock(i: NowInput): NowBlock {
  const { now, lang, width } = i
  const title: Line = [S(t(lang, 'pane.now'), { bold: true })]
  if (now.approval === 'none') return { title, right: [], lines: [], needsApproval: false, argv: [] }

  if (now.approval === 'pending') {
    const lines: Line[] = []
    // the person allows what they read, so all of it is shown: spelled out, never cut
    const command = wrapped(describeArgv(now.argv), width, 2, { color: 'warning' })
    if (command.length > MAX_COMMAND_LINES) {
      lines.push(...wrapped(t(lang, 'now.tooLong'), width, 0, { color: 'warning' }))
      return { title, right: [], lines, needsApproval: false, argv: now.argv }
    }
    lines.push(...wrapped(t(lang, 'now.askRun'), width, 0))
    lines.push(...command)
    lines.push(...wrapped(t(lang, 'now.askNote', { sec: i.intervalSec }), width, 0, QUIET))
    return { title, right: [], lines, needsApproval: true, argv: now.argv }
  }

  const data = now.data
  const stale = isStale(i.nowMs, now.fetchedAt, i.intervalSec, now.error)
  let staleText = ''
  if (stale && now.fetchedAt !== null) {
    const min = minutesSince(i.nowMs, now.fetchedAt)
    staleText = min >= 1 ? t(lang, 'now.stale', { n: min }) : t(lang, 'now.staleSec')
  }
  const right: Line = staleText === '' ? [] : [S(staleText, { color: 'warning' })]
  const lines: Line[] = []

  if (data === null) {
    if (now.error !== null) lines.push(...wrapped(t(lang, 'now.error', { error: now.error }), width, 0, { color: 'error' }).slice(0, 2))
    else lines.push([S(t(lang, 'now.loading'), QUIET)])
    return { title, right, lines, needsApproval: false, argv: now.argv }
  }

  const cols = lanesCols(data.lanes)
  for (const lane of data.lanes) lines.push(laneLine(lane, cols, { width, ascii: i.ascii, lang, stale }))

  // the first of what is next after its label, the second under the first
  const label = t(lang, 'now.next')
  data.next.slice(0, 2).forEach((item, k) => {
    const eta = item.eta !== '' ? paren(lang, t(lang, 'now.eta', { eta: item.eta })) : ''
    const lead = k === 0 ? S(label, QUIET) : S(' '.repeat(strWidth(label)))
    lines.push(truncateSpans([lead, S('  '), S(item.text), S(eta, QUIET)], width))
  })
  for (const w of data.warnings.slice(0, 2)) lines.push(truncateSpans([S('! ' + w, { color: 'warning' })], width))
  if (now.error !== null) lines.push(...wrapped(t(lang, 'now.error', { error: now.error }), width, 0, { color: 'error' }).slice(0, 2))
  return { title, right, lines, needsApproval: false, argv: now.argv }
}

/** The title and the lines of the block when it was asked for but there is no room to show a command waiting for approval. */
export function resizeNotice(lang: DtLang, width: number): Line {
  return truncateSpans([S(t(lang, 'now.resize'), { color: 'warning' })], width)
}
