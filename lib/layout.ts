// The pane as text: every line it shows, worked out as data (spec 9.2-9.7).
//
// Nothing here draws. `layoutPane` takes the replayed tree, the session's view
// state and the room (columns, rows) and returns the blocks to draw, top to
// bottom; the view turns each into elements. Because it is pure, tests can check
// that no line is wider than the pane and that the rows add up.

import type { DtEvidence, DtFilter, DtFork, DtLane, DtLang, DtMode, DtModel, DtNode, DtNow, DtProject, DtUi } from '../types'
import { fmtClock, fmtDate } from './events'
import { MAINLINE_SEP, glyphOf, isQuiet, toneOf } from './glyphs'
import { statusLabel, t } from './i18n'
import { baseName } from './project'
import type { Line, Span } from './spans'
import { fitSpans, indent, lineWidth, ruleLine, sp, truncateSpans } from './spans'
import { describeArgv, isStale, minutesSince, progressBar, stepText } from './status'
import type { Row, TreeIndex } from './tree'
import { buildIndex, effectiveSelection, rowIndex, trunkNodes, supersededNodes, visibleRows, windowRows } from './tree'
import { forkText } from './versions'
import { padEnd, padStart, plain, strWidth, truncate, wrap } from './width'

// ---------------------------------------------------------------- small helpers

type Style = Omit<Span, 'text'>

/** A span that carries only the style fields that are set. */
function S(text: string, style: { color?: string; dim?: boolean; bold?: boolean; inverse?: boolean } = {}): Span {
  const out: Span = { text }
  if (style.color !== undefined) out.color = style.color
  if (style.dim === true) out.dim = true
  if (style.bold === true) out.bold = true
  if (style.inverse === true) out.inverse = true
  return out
}

function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === 'string' && s !== ''
}

function paren(lang: DtLang, s: string): string {
  return lang === 'zh' ? `（${s}）` : ` (${s})`
}

export function filterLabel(filter: DtFilter, lang: DtLang): string {
  switch (filter) {
    case 'all':
      return t(lang, 'filter.all')
    case 'pending':
      return t(lang, 'filter.pending')
    case 'clean':
      return t(lang, 'filter.clean')
    default:
      return ''
  }
}

// ---------------------------------------------------------------- header

export type HeaderInput = {
  width: number
  lang: DtLang
  title: string
  mode: DtMode
  count: number
  lastEventAt: string | null
  /** The tree in use when it is not the main one: shown right after the title, where narrow panes still show it. */
  tree?: string
}

/** `决策树 [sql-v3] · orders-api-rewrite        记录中 · 23 个决定 · 00:12 更新` */
export function headerLine(h: HeaderInput): Line {
  const left: Line = [S(t(h.lang, 'pane.title'), { bold: true })]
  if (h.tree !== undefined && h.tree !== 'main') left.push(S(` [${plain(h.tree)}]`, { color: 'suggestion' }))
  const name = plain(h.title)
  if (name !== '') left.push(S(' · ', { dim: true }), S(name))
  const right: Line = []
  if (h.mode !== 'off') {
    right.push(h.mode === 'paused' ? S(t(h.lang, 'pane.state.paused'), { color: 'warning' }) : S(t(h.lang, 'pane.state.recording'), { color: 'success' }))
    const count = h.count === 1 ? t(h.lang, 'pane.count.one') : t(h.lang, 'pane.count.many', { n: h.count })
    right.push(S(` · ${count}`, { dim: true }))
    const clock = fmtClock(h.lastEventAt)
    if (clock !== '') right.push(S(` · ${t(h.lang, 'pane.updated', { time: clock })}`, { dim: true }))
  }
  return fitSpans(left, right, h.width, 2)
}

/** `基于 main 的 #17（10-08 17:44）· SQL 第三版`: where the tree in use began, dim, under the header. */
export function originLine(fork: DtFork, o: { width: number; lang: DtLang }): Line {
  const from = plain(forkText(o.lang, fork))
  const line: Line = [S(from, { dim: true })]
  const title = fork.title === undefined ? '' : plain(fork.title)
  // a full-width parenthesis already leaves a gap
  if (title !== '') line.push(S(from.endsWith('）') ? '· ' : ' · ', { dim: true }), S(title))
  return truncateSpans(line, o.width)
}

// ---------------------------------------------------------------- mainline

// older steps are cut shorter than the newest, which is what the person is on
const MAINLINE_ITEM = 22
const MAINLINE_LAST = 44

/** `主线  design v2 › exp-2 › 连接池 › gateway ◐`: the newest items that fit, older ones as `…`. */
export function mainlineLine(trunk: readonly DtNode[], o: { width: number; ascii: boolean; lang: DtLang }): Line | null {
  if (trunk.length === 0) return null
  const head: Line = [S(t(o.lang, 'pane.mainline'), { dim: true }), S('  ')]
  const sepText = o.ascii ? MAINLINE_SEP.ascii : MAINLINE_SEP.unicode
  const sep = S(sepText, { dim: true })
  const items: Line[] = trunk.map((n, k) => {
    const tone = toneOf(n.status)
    const limit = k === trunk.length - 1 ? MAINLINE_LAST : MAINLINE_ITEM
    const parts: Line = [S(truncate(plain(n.title) || t(o.lang, 'r.untitled'), limit), { dim: isQuiet(n.status) })]
    if (n.status !== 'adopted') parts.push(S(' '), S(glyphOf(n.status, o.ascii), { color: tone.color, dim: tone.dim }))
    return parts
  })
  const headW = lineWidth(head)
  const sepW = strWidth(sepText)
  const ellipsis: Line = [S('…', { dim: true }), sep]
  const ellW = lineWidth(ellipsis)

  const kept: Line[] = []
  let used = headW
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    const cost = lineWidth(item) + (kept.length > 0 ? sepW : 0)
    const reserve = i > 0 ? ellW : 0
    if (kept.length > 0 && used + cost + reserve > o.width) break
    kept.unshift(item)
    used += cost
  }
  const line: Line = [...head]
  if (kept.length < items.length) line.push(...ellipsis)
  kept.forEach((item, i) => {
    if (i > 0) line.push(sep)
    line.push(...item)
  })
  return truncateSpans(line, o.width)
}

// ---------------------------------------------------------------- tree rows

function showsLabel(n: DtNode, depth: number): boolean {
  if (n.status === 'in-progress') return true
  return depth <= 1 && (n.status === 'planned' || n.status === 'proposed' || n.status === 'deferred')
}

/** The dim note at the end of a row: collapsed count, then label or date. */
export function rowNote(row: Row, lang: DtLang): string {
  const n = row.node
  const parts: string[] = []
  if (row.hiddenKids > 0) parts.push(`+${row.hiddenKids}`)
  if (n.retracted !== undefined) parts.push(t(lang, 'pane.retracted'))
  else if (showsLabel(n, row.depth)) parts.push(statusLabel(lang, n.status))
  else if (row.depth <= 1) {
    const d = fmtDate(n.decidedAt ?? n.createdAt)
    if (d !== '') parts.push(d)
  }
  return parts.join(' ')
}

export const GUTTER = 2

/** One row of the tree: gutter marker, guides, glyph, title, and the note flush right. */
export function treeRowLine(row: Row, o: { width: number; selected: boolean; ascii: boolean; lang: DtLang }): Line {
  const n = row.node
  const tone = toneOf(n.status)
  const quiet = isQuiet(n.status) || n.retracted !== undefined
  const left: Line = [o.selected ? S(o.ascii ? '> ' : '❯ ', { bold: true }) : indent(GUTTER)]
  if (row.prefix !== '') left.push(S(row.prefix, { dim: true }))
  left.push(S(glyphOf(n.status, o.ascii), { color: tone.color, dim: tone.dim }))
  left.push(S(' '))
  left.push(S(plain(n.title) || t(o.lang, 'r.untitled'), { bold: n.trunk === true || o.selected, dim: quiet }))
  const note = rowNote(row, o.lang)
  return fitSpans(left, note === '' ? [] : [S(note, { dim: true })], o.width, 2)
}

// ---------------------------------------------------------------- detail

/** An evidence line `label  value ci  run`, cut to `width`: the run goes first, then the label. */
export function evidenceLine(ev: DtEvidence, width: number, ind: number): Line {
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
  const total = (l: string, r: string) => w(l) + (mid !== '' ? gap + w(mid) : 0) + (r !== '' ? gap + w(r) : 0)

  if (total(label, run) > room && run !== '') {
    const left = room - w(label) - (mid !== '' ? gap + w(mid) : 0) - gap
    run = left >= 3 ? truncate(run, left) : ''
  }
  if (total(label, run) > room) {
    const left = room - (mid !== '' ? gap + w(mid) : 0) - (run !== '' ? gap + w(run) : 0)
    label = left >= 2 ? truncate(label, left) : ''
  }

  const line: Line = [indent(ind)]
  const push = (span: Span) => {
    if (line.length > 1) line.push(S(' '.repeat(gap)))
    line.push(span)
  }
  if (label !== '') push(S(label))
  if (value !== '' || ci !== '' || note !== '') {
    const text = [value, note].filter(nonEmpty).join(' ')
    const spans: Line = []
    if (text !== '') spans.push(S(text, { bold: value !== '' }))
    if (ci !== '') spans.push(S(text !== '' ? ` ${ci}` : ci, { dim: true }))
    if (line.length > 1) line.push(S(' '.repeat(gap)))
    line.push(...spans)
  }
  if (run !== '') push(S(run, { dim: true }))
  return truncateSpans(line, width)
}

export type DetailInput = {
  node: DtNode
  idx: TreeIndex
  width: number
  ascii: boolean
  lang: DtLang
  /** True when the node's children are drawn, false when they are collapsed, null for a leaf. */
  open: boolean | null
}

function wrapped(text: string, width: number, ind: number, style: { color?: string; dim?: boolean; bold?: boolean } = {}): Line[] {
  return wrap(text, Math.max(1, width - ind)).map(l => [indent(ind), S(l, style)])
}

/** The detail of one node (spec 9.4), every line at most `width` columns. */
export function detailLines(a: DetailInput): Line[] {
  const { node: n, width, lang, ascii } = a
  const out: Line[] = []
  const tone = toneOf(n.status)

  const marker = S(a.open === false ? (ascii ? '>' : '▸') : ascii ? 'v' : '▾', { dim: true })
  const meta = [n.decidedBy ?? n.createdBy, fmtDate(n.decidedAt ?? n.createdAt)].filter(nonEmpty)
  const right: Line = [S(`${glyphOf(n.status, ascii)} ${statusLabel(lang, n.status)}`, { color: tone.color })]
  if (meta.length > 0) right.push(S(` · ${meta.join(' · ')}`, { dim: true }))
  const title = plain(n.title) || t(lang, 'r.untitled')

  if (strWidth(title) + 2 + 2 + lineWidth(right) <= width) {
    out.push(fitSpans([marker, S(' '), S(title, { bold: true })], right, width, 2))
  } else {
    // a long title gets its own lines (three at most) and the status goes under it
    const lines = wrap(title, Math.max(1, width - 2))
    lines.slice(0, 3).forEach((l, i) => {
      const last = i === 2 && lines.length > 3
      out.push([i === 0 ? marker : indent(1), S(' '), S(last ? truncate(l + '…', Math.max(1, width - 2)) : l, { bold: true })])
    })
    out.push(truncateSpans([indent(2), ...right], width))
  }

  if (n.retracted !== undefined) {
    const by = t(lang, 'pane.retractedBy', { actor: n.retracted.actor })
    const reason = n.retracted.reason !== undefined && n.retracted.reason !== '' ? `: ${plain(n.retracted.reason)}` : ''
    out.push(...wrapped(by + reason, width, 2, { color: 'error' }))
  }

  if (nonEmpty(n.summary)) out.push(...wrapped(n.summary, width, 2))

  if (nonEmpty(n.rationale)) {
    out.push([indent(2), S(t(lang, 'detail.rationale'), { dim: true })])
    out.push(...wrapped(n.rationale, width, 4))
  }

  const evidence = n.evidence ?? []
  if (evidence.length > 0) {
    out.push([indent(2), S(t(lang, 'detail.evidence'), { dim: true })])
    for (const ev of evidence) out.push(evidenceLine(ev, width, 4))
  }

  const sources = n.sources ?? []
  if (sources.length > 0) {
    const label = t(lang, 'detail.sources')
    const lead = 2 + strWidth(label) + 2
    const body = wrap(sources.map(s => plain(s)).join('  '), Math.max(1, width - lead))
    body.forEach((l, i) => {
      out.push(i === 0 ? [indent(2), S(label, { dim: true }), S('  '), S(l)] : [indent(lead), S(l)])
    })
  }

  if (nonEmpty(n.supersededBy)) out.push(...wrapped(t(lang, 'detail.supersededBy', { id: n.supersededBy }), width, 2, { dim: true }))
  const older = supersededNodes(a.idx, n.id)
  if (older.length > 0) {
    out.push(...wrapped(t(lang, 'detail.supersedes', { ids: older.map(o => o.id).join(', ') }), width, 2, { dim: true }))
  }

  const tags = n.tags ?? []
  if (tags.length > 0) out.push(...wrapped(`${t(lang, 'detail.tags')}  ${tags.join(', ')}`, width, 2, { dim: true }))

  if (n.notes.length > 0) {
    out.push([indent(2), S(t(lang, 'detail.notes'), { dim: true })])
    for (const note of n.notes) {
      const when = fmtDate(note.ts)
      const head = [when, note.actor].filter(nonEmpty).join(' ')
      const lines = wrap(plain(note.text), Math.max(1, width - 4 - strWidth(head) - 2))
      lines.forEach((l, i) => {
        out.push(i === 0 ? [indent(4), S(head, { dim: true }), S('  '), S(l)] : [indent(4 + strWidth(head) + 2), S(l)])
      })
    }
  }
  return out
}

/** At most `max` lines; the last one says that more were cut. */
export function capLines(lines: readonly Line[], max: number): Line[] {
  if (max <= 0) return []
  if (lines.length <= max) return [...lines]
  return [...lines.slice(0, max - 1), [indent(2), S('…', { dim: true })]]
}

// ---------------------------------------------------------------- now

export type NowInput = {
  now: DtNow
  intervalSec: number
  nowMs: number
  width: number
  ascii: boolean
  lang: DtLang
}

/** `argv` is the command the lines show; `needsApproval` is true only when all of it is shown and the button may be offered. */
export type NowBlock = { lines: Line[]; needsApproval: boolean; argv: readonly string[] }

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

type Cols = { name: number; run: number; step: number }

/** One lane: `ZETA    gateway s0   ████████░░  3400/4000   约 23:50   note`; trailing cells go first when narrow. */
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
    const line: Line = [indent(2), S(name + ' '.repeat(Math.max(0, cols.name - strWidth(name))), { bold: true, dim: o.stale })]
    line.push(S('  '))
    const run = truncate(lane.run, runW)
    line.push(S(run + ' '.repeat(Math.max(0, runW - strWidth(run))), { dim: o.stale }))
    if (withBar) {
      line.push(S('  '), S(barText, { color: dim ? undefined : tone.color, dim }))
      if (withStep && step !== '') line.push(S('  '), S(step, { dim }))
      if (withTail && tail !== '') line.push(S('  '), S(tail, { dim: true }))
    }
    if (withNote && note !== '') line.push(S('  '), S(note, { dim: true }))
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

function lanesCols(lanes: readonly DtLane[]): Cols {
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

/** The "now" block: lanes, what is next, warnings, and how fresh it is (spec 10). */
export function nowBlock(i: NowInput): NowBlock {
  const { now, lang, width } = i
  if (now.approval === 'none') return { lines: [], needsApproval: false, argv: [] }
  const label = S(t(lang, 'pane.now'), { bold: true })

  if (now.approval === 'pending') {
    const lines: Line[] = [[label]]
    // the person allows what they read, so all of it is shown: spelled out, never cut
    const command = wrapped(describeArgv(now.argv), width, 4, { color: 'warning' })
    if (command.length > MAX_COMMAND_LINES) {
      lines.push(...wrapped(t(lang, 'now.tooLong'), width, 2, { color: 'warning' }))
      return { lines, needsApproval: false, argv: now.argv }
    }
    lines.push(...wrapped(t(lang, 'now.askRun'), width, 2))
    lines.push(...command)
    lines.push(...wrapped(t(lang, 'now.askNote', { sec: i.intervalSec }), width, 2, { dim: true }))
    return { lines, needsApproval: true, argv: now.argv }
  }

  const data = now.data
  const stale = isStale(i.nowMs, now.fetchedAt, i.intervalSec, now.error)
  let staleText = ''
  if (stale && now.fetchedAt !== null) {
    const min = minutesSince(i.nowMs, now.fetchedAt)
    staleText = min >= 1 ? t(lang, 'now.stale', { n: min }) : t(lang, 'now.staleSec')
  }
  const head = fitSpans([label], staleText === '' ? [] : [S(staleText, { color: 'warning' })], width, 2)
  const lines: Line[] = [head]

  if (data === null) {
    if (now.error !== null) lines.push(...wrapped(t(lang, 'now.error', { error: now.error }), width, 2, { color: 'error' }).slice(0, 2))
    else lines.push([indent(2), S(t(lang, 'now.loading'), { dim: true })])
    return { lines, needsApproval: false, argv: now.argv }
  }

  const cols = lanesCols(data.lanes)
  for (const lane of data.lanes) lines.push(laneLine(lane, cols, { width, ascii: i.ascii, lang, stale }))

  data.next.slice(0, 2).forEach((item, k) => {
    const lead = k === 0 ? t(lang, 'now.next') : ''
    const gap = k === 0 ? 2 : 0
    const eta = item.eta !== '' ? paren(lang, t(lang, 'now.eta', { eta: item.eta })) : ''
    const labelW = k === 0 ? strWidth(t(lang, 'now.next')) : 0
    const line: Line = [indent(2), S(lead, { dim: true }), S(' '.repeat(k === 0 ? gap : labelW + gap)), S(item.text), S(eta, { dim: true })]
    lines.push(truncateSpans(line, width))
  })
  for (const w of data.warnings.slice(0, 2)) lines.push(truncateSpans([indent(2), S('! ' + w, { color: 'warning' })], width))
  if (now.error !== null) lines.push(...wrapped(t(lang, 'now.error', { error: now.error }), width, 2, { color: 'error' }).slice(0, 2))
  return { lines, needsApproval: false, argv: now.argv }
}

// ---------------------------------------------------------------- footer

export type FooterAction = 'up' | 'down' | 'all' | 'pending' | 'clean' | 'now' | 'edit'

export type FooterItem =
  | { kind: 'text'; text: string }
  | { kind: 'key'; hotkey: string; label: string; action: FooterAction; active: boolean }
  | { kind: 'warn'; text: string; count: number }

const FOOTER_GAP = 2

export function itemWidth(item: FooterItem): number {
  switch (item.kind) {
    case 'text':
      return strWidth(item.text)
    case 'key':
      return strWidth(item.hotkey) + 2 + strWidth(item.label)
    case 'warn':
      return strWidth(item.text)
  }
}

export type FooterInput = {
  lang: DtLang
  canEdit: boolean
  filter: DtFilter
  hasNow: boolean
  showNow: boolean
}

/** The hints and keys of the footer, most useful first. */
export function footerItems(f: FooterInput): FooterItem[] {
  const items: FooterItem[] = [
    { kind: 'key', hotkey: 'k', label: '↑', action: 'up', active: false },
    { kind: 'key', hotkey: 'j', label: '↓', action: 'down', active: false },
    { kind: 'text', text: t(f.lang, 'key.expand') },
  ]
  if (f.canEdit) items.push({ kind: 'key', hotkey: 'e', label: t(f.lang, 'key.edit'), action: 'edit', active: false })
  items.push({ kind: 'key', hotkey: 'p', label: t(f.lang, 'key.pending'), action: 'pending', active: f.filter === 'pending' })
  items.push({ kind: 'key', hotkey: 'h', label: t(f.lang, 'key.clean'), action: 'clean', active: f.filter === 'clean' })
  items.push({ kind: 'key', hotkey: 'a', label: t(f.lang, 'key.all'), action: 'all', active: f.filter === 'all' })
  if (f.hasNow) items.push({ kind: 'key', hotkey: 's', label: t(f.lang, 'key.now'), action: 'now', active: f.showNow })
  return items
}

export type FooterLine = { items: FooterItem[]; pad: number; warn: FooterItem | null }

/**
 * Packs the items into at most `maxLines` lines of `width` columns. The warnings
 * count has first claim on the end of the first line (when the pane is wide
 * enough for it at all); items that do not fit are dropped from the end.
 */
export function packFooter(items: readonly FooterItem[], warn: FooterItem | null, width: number, maxLines: number): FooterLine[] {
  const warnW = warn === null ? 0 : itemWidth(warn)
  const reserve = warn !== null && width >= warnW + 24 ? warnW + FOOTER_GAP : 0
  const showWarn = reserve > 0
  const lines: FooterItem[][] = [[]]
  let used = 0
  let limit = width - reserve
  for (const item of items) {
    const w = itemWidth(item)
    const cur = lines[lines.length - 1]!
    const need = (cur.length > 0 ? FOOTER_GAP : 0) + w
    if (used + need <= limit) {
      cur.push(item)
      used += need
      continue
    }
    if (lines.length < maxLines && w <= width) {
      lines.push([item])
      used = w
      limit = width
    }
    // otherwise it fits nowhere and is left out
  }
  const widthOf = (l: readonly FooterItem[]) => l.reduce((sum, it, i) => sum + itemWidth(it) + (i > 0 ? FOOTER_GAP : 0), 0)
  const out: FooterLine[] = lines.map(l => ({ items: l, pad: 0, warn: null }))
  if (showWarn && warn !== null) {
    const first = out[0]!
    first.warn = warn
    first.pad = Math.max(1, width - widthOf(first.items) - warnW)
  }
  return out
}

// ---------------------------------------------------------------- the pane

export type PaneInput = {
  width: number
  /** Rows the pane may take. */
  rows: number
  lang: DtLang
  ascii: boolean
  nowMs: number
  project: DtProject
  model: DtModel
  ui: DtUi
  now: DtNow
  /** Refresh interval of the status command, or null when none is configured. */
  statusInterval: number | null
  /** False on a surface with no text field (mobile). */
  canEdit: boolean
}

export type Block =
  | { kind: 'text'; line: Line }
  | { kind: 'rule'; line: Line }
  | { kind: 'row'; id: string; line: Line; selected: boolean }
  | { kind: 'page'; dir: 'up' | 'down'; line: Line; step: number }
  | { kind: 'allow'; label: string; argv: readonly string[] }
  | { kind: 'edit'; id: string; title: Line }
  | { kind: 'footer'; line: FooterLine }

export type PaneLayout = {
  blocks: Block[]
  /** The node the pane treats as selected, or null. */
  selected: string | null
  /** Ids of the rows drawn, in order. */
  drawn: string[]
  /** Rows (blocks) used. */
  height: number
}

/** Rows the edit form takes: title, status, summary, buttons. */
export const EDIT_ROWS = 4
const MIN_TREE = 4
/** The line saying where a tree began is drawn from this many rows up; a smaller pane keeps the room for the tree. */
export const ORIGIN_MIN_ROWS = 16

function emptyText(project: DtProject, lang: DtLang): string {
  if (project.configError !== null) return t(lang, 'pane.empty.config', { error: project.configError })
  return t(lang, 'pane.empty')
}

/** Works out every block of the pane, top to bottom, in `width` columns and `rows` rows. */
export function layoutPane(i: PaneInput): PaneLayout {
  const width = Math.max(16, Math.floor(i.width))
  const rows = Math.max(3, Math.floor(i.rows))
  const { lang, ascii, project, model, ui } = i
  const blocks: Block[] = []

  const titleText = project.config?.title ?? (project.root !== '' ? baseName(project.root) : '')
  const header = headerLine({
    width,
    lang,
    title: titleText,
    mode: project.mode,
    count: model.nodes.filter(n => n.retracted === undefined).length,
    lastEventAt: model.lastEventAt,
    ...(project.tree !== 'main' ? { tree: project.tree } : {}),
  })
  blocks.push({ kind: 'text', line: header })

  // not recording here: say how to start
  if (project.mode === 'off') {
    blocks.push({ kind: 'rule', line: ruleLine(width, ascii) })
    const message = wrapped(emptyText(project, lang), width, 0, { dim: project.configError === null })
    for (const l of capLines(message, Math.max(1, rows - 2))) blocks.push({ kind: 'text', line: l })
    return { blocks, selected: null, drawn: [], height: blocks.length }
  }

  const idx = buildIndex(model)
  const allRows = visibleRows(idx, { ui, nowMs: i.nowMs, ascii })
  const sel = effectiveSelection(idx, allRows, ui.selected)
  const selIndex = rowIndex(allRows, sel)
  const selRow = selIndex >= 0 ? allRows[selIndex]! : null

  // pieces whose height is known before the tree gets what is left
  const mainline = mainlineLine(trunkNodes(idx), { width, ascii, lang })
  const hasNow = i.statusInterval !== null
  const footerAll = footerItems({
    lang,
    canEdit: i.canEdit,
    filter: ui.filter,
    hasNow,
    showNow: ui.showNow,
  })
  const warn: FooterItem | null = {
    kind: 'warn',
    text: t(lang, 'pane.warnings', { n: model.warningCount }),
    count: model.warningCount,
  }
  const footer = packFooter(footerAll, warn, width, rows >= 12 ? 2 : 1)

  const editing = ui.editing !== null && selRow !== null && ui.editing.id === selRow.node.id ? ui.editing : null
  const detailAll: Line[] =
    selRow === null || editing !== null
      ? []
      : detailLines({ node: selRow.node, idx, width, ascii, lang, open: selRow.childCount === 0 ? null : selRow.isExpanded })

  const nowAll: NowBlock =
    hasNow && ui.showNow ? nowBlock({ now: i.now, intervalSec: i.statusInterval ?? 30, nowMs: i.nowMs, width, ascii, lang }) : { lines: [], needsApproval: false, argv: [] }

  // where this tree began: when it is not the main one and the pane is not cramped
  const origin = project.tree !== 'main' && model.fork !== null && rows >= ORIGIN_MIN_ROWS ? originLine(model.fork, { width, lang }) : null

  // ---- the vertical budget
  const mainRows = mainline === null ? 0 : 2 // the rule above it and the line itself
  const base = 1 /* header */ + (origin === null ? 0 : 1) + mainRows + 1 /* rule above the tree */ + 1 /* rule above the footer */ + footer.length
  const nowCap = Math.max(3, Math.floor(rows * 0.35))
  // a command waiting for approval is never cut: the person reads all of it or is not asked
  let nowLines = nowAll.needsApproval ? nowAll.lines : capLines(nowAll.lines, nowCap)
  let allow = nowAll.needsApproval
  const nowCostOf = () => (nowLines.length > 0 ? 1 + nowLines.length + (allow ? 1 : 0) : 0)
  let nowCost = nowCostOf()

  const hasDetail = selRow !== null && (editing !== null || detailAll.length > 0)
  const detailCap = Math.max(3, Math.floor(rows * 0.45))
  let detailRows = editing !== null ? EDIT_ROWS : Math.min(detailAll.length, detailCap)
  const detailCost = () => (hasDetail && detailRows > 0 ? 1 + detailRows : 0)

  let treeRows = rows - base - nowCost - detailCost()
  // set when the command waiting for approval could not be shown whole: one line says so instead
  let resizeNotice = false
  if (allow) {
    // short of room: the detail gives way to the command waiting for approval; if even then it does
    // not fit whole, the button is not offered and the pane says why
    if (treeRows < MIN_TREE && hasDetail && editing === null) {
      detailRows = 0
      treeRows = rows - base - nowCost - detailCost()
    }
    if (treeRows < MIN_TREE) {
      allow = false
      resizeNotice = true
      nowLines = [truncateSpans([S(t(lang, 'pane.now'), { bold: true }), S('  '), S(t(lang, 'now.resize'), { color: 'warning' })], width)]
      nowCost = nowCostOf()
      treeRows = rows - base - nowCost - detailCost()
    }
  }
  // short of room: the "now" block goes first (the notice that a command is waiting for the person's OK
  // is the last thing to go: it stays while the tree keeps two rows), then the detail shrinks, then goes
  if (treeRows < (resizeNotice ? 2 : MIN_TREE) && nowCost > 0) {
    nowCost = 0
    nowLines = []
    allow = false
    treeRows = rows - base - detailCost()
  }
  if (treeRows < MIN_TREE && hasDetail && editing === null && detailRows > 2) {
    detailRows = Math.max(2, detailRows - (MIN_TREE - treeRows))
    treeRows = rows - base - nowCost - detailCost()
  }
  if (treeRows < MIN_TREE && hasDetail && editing === null && detailRows > 0) {
    detailRows = 0
    treeRows = rows - base - nowCost - detailCost()
  }
  if (treeRows < 1) treeRows = 1

  // ---- blocks above the tree
  if (origin !== null) blocks.push({ kind: 'text', line: origin })
  if (nowCost > 0) {
    blocks.push({ kind: 'rule', line: ruleLine(width, ascii) })
    for (const l of nowLines) blocks.push({ kind: 'text', line: l })
    if (allow) blocks.push({ kind: 'allow', label: t(lang, 'now.allow'), argv: nowAll.argv })
  }
  if (mainline !== null) {
    blocks.push({ kind: 'rule', line: ruleLine(width, ascii) })
    blocks.push({ kind: 'text', line: mainline })
  }
  blocks.push({ kind: 'rule', line: ruleLine(width, ascii, filterLabel(ui.filter, lang)) })

  // ---- the tree window
  const drawn: string[] = []
  if (allRows.length === 0) {
    const text = model.nodes.length === 0 ? t(lang, 'pane.noNodes') : t(lang, 'pane.noMatch')
    for (const l of wrapped(text, width, 2, { dim: true }).slice(0, Math.max(1, treeRows))) blocks.push({ kind: 'text', line: l })
  } else {
    const marks = treeRows >= 5 // page rows only when they leave a useful window
    let count = treeRows
    let win = windowRows(allRows.length, selIndex, null, count)
    for (let pass = 0; marks && pass < 3; pass++) {
      const usable = treeRows - (win.above > 0 ? 1 : 0) - (win.below > 0 ? 1 : 0)
      if (usable === count) break
      count = Math.max(1, usable)
      win = windowRows(allRows.length, selIndex, null, count)
    }
    const mark = (up: boolean) => (ascii ? (up ? '^' : 'v') : up ? '▲' : '▼')
    if (marks && win.above > 0) {
      const text = t(lang, 'pane.above', { n: win.above }).replace('▲', mark(true))
      blocks.push({ kind: 'page', dir: 'up', step: count, line: [indent(GUTTER), S(text, { dim: true })] })
    }
    for (let k = win.start; k < win.end; k++) {
      const row = allRows[k]!
      const selected = k === selIndex
      drawn.push(row.node.id)
      blocks.push({ kind: 'row', id: row.node.id, selected, line: treeRowLine(row, { width, selected, ascii, lang }) })
    }
    if (marks && win.below > 0) {
      const text = t(lang, 'pane.below', { n: win.below }).replace('▼', mark(false))
      blocks.push({ kind: 'page', dir: 'down', step: count, line: [indent(GUTTER), S(text, { dim: true })] })
    }
  }

  // ---- the detail (or the edit form)
  if (hasDetail && detailRows > 0 && selRow !== null) {
    blocks.push({ kind: 'rule', line: ruleLine(width, ascii) })
    if (editing !== null) {
      const title = truncateSpans([S(t(lang, 'edit.title', { id: selRow.node.id }), { bold: true })], width)
      blocks.push({ kind: 'edit', id: selRow.node.id, title })
    } else {
      for (const l of capLines(detailAll, detailRows)) blocks.push({ kind: 'text', line: l })
    }
  }

  // ---- the footer
  blocks.push({ kind: 'rule', line: ruleLine(width, ascii) })
  for (const line of footer) blocks.push({ kind: 'footer', line })

  return { blocks, selected: sel, drawn, height: blocks.reduce((sum, b) => sum + (b.kind === 'edit' ? EDIT_ROWS : 1), 0) }
}

/** Everything in a layout that is plain text, for tests: a block's text, or null for controls. */
export function blockWidth(b: Block): number {
  switch (b.kind) {
    case 'text':
    case 'rule':
    case 'row':
    case 'page':
      return lineWidth(b.line)
    case 'allow':
      return strWidth(b.label) + 4
    case 'edit':
      return lineWidth(b.title)
    case 'footer': {
      const l = b.line
      let w = 0
      l.items.forEach((it, k) => {
        w += itemWidth(it) + (k > 0 ? FOOTER_GAP : 0)
      })
      if (l.warn !== null) w += l.pad + itemWidth(l.warn)
      return w
    }
  }
}
