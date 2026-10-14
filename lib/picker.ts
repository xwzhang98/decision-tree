// The picker of colour schemes (`c` in the pane): a line for each scheme, with a swatch of its seven colours, and under
// the list a small sample of the pane to see them on. While the picker is open the whole pane is drawn in the scheme
// that is highlighted (view.tsx), so moving the highlight is trying a scheme on; ⏎ keeps it, going back leaves
// things as they were.
//
//   notes-app                                                                 EN  中
//   Colors   16 schemes                    It stays as you choose it, in every project.
//
//   ▌ Terminal           ● ● ● ● ● ● ●   your terminal's own 16 colors                in use
//     Theme              ● ● ● ● ● ● ●   follows Claude Code's own theme
//     One Dark           ● ● ● ● ● ● ●   Atom, for dark terminals
//
//   ╭─ Preview ─────────────────────────────────────────────────────── One Dark ─╮
//   │  ●  Notes app: offline-first rewrite                                09-02   │
//   │  ●  Storage: SQLite with a write-ahead log                          09-14   │
//   │  ┠─ ✗ Keep JSON files and add a lock file                                   │
//   ╰─────────────────────────────────────────────────────────────────────────────╯
//   k: ↑  j: ↓  ⏎: use  r: default  c: back                                  l: 中
//
// The sample is a made-up tree drawn by the same code as the real rail, so a scheme is seen on the real thing.
// Everything here is pure: `layoutColors` returns blocks, like `layoutPane`.

import type { DtLang, DtModel, DtNode, DtStatus, DtUi } from '../types'
import type { Part } from './bar'
import { textPart } from './bar'
import { fmtDate } from './events'
import { pickerItems, packBar } from './foot'
import { frameBand, frameBottom, frameInner, frameRow, frameTop } from './frame'
import { COLORS, MARKS, pick } from './glyphs'
import { headerBar } from './head'
import { t } from './i18n'
import type { Block, PaneInput, PaneLayout } from './layout'
import { DEFAULT_SCHEME, SCHEMES, effectiveScheme, findScheme, schemeOf, swatchOf } from './palettes'
import type { Scheme } from './palettes'
import { baseName } from './project'
import { indentPlan, railLine } from './rail'
import { AIRY_MIN_ROWS, footerLines } from './room'
import { EDGE, GUTTER, QUIET, S, innerWidth, lead } from './style'
import type { Line } from './spans'
import { barLine, fitSpans, lineWidth, truncateSpans } from './spans'
import { EMPTY_UI } from './state'
import { buildIndex, visibleRows, windowRows } from './tree'
import { padEnd, plain, strWidth, truncate } from './width'

/** The widest name of a scheme: the column the names are set in. */
const NAME_COLS = Math.max(...SCHEMES.map(s => strWidth(s.name)))
/** The columns between the parts of a line. */
const GAP = 2
/** The swatch: seven dots with a blank between each, or without. */
const SWATCH_SPACED = 13
const SWATCH_TIGHT = 7
/** The fewest columns a note keeps; narrower than that it is left out. */
const NOTE_MIN = 14
/** Rows of the list worth drawing beside the sample; a pane shorter than that shows the list alone. */
const LIST_MIN = 6
/** The least rows of a list that is windowed, from which it marks what is above and below. */
const MARKS_MIN = 5

// ---------------------------------------------------------------- the sample

type SampleNode = { id: string; parent: string | null; trunk: boolean; status: DtStatus; date: string; recent: boolean; title: [en: string, zh: string] }

const SAMPLE: readonly SampleNode[] = [
  { id: 's0', parent: null, trunk: true, status: 'adopted', date: '09-02', recent: false, title: ['Notes app: offline-first rewrite', '笔记 app：离线优先的重写'] },
  { id: 's1', parent: 's0', trunk: true, status: 'adopted', date: '09-14', recent: false, title: ['Storage: SQLite with a write-ahead log', '存储：SQLite 加预写日志'] },
  { id: 's2', parent: 's1', trunk: false, status: 'rejected', date: '09-14', recent: false, title: ['Keep JSON files and add a lock file', '继续用 JSON 文件，加一个锁文件'] },
  { id: 's3', parent: 's1', trunk: true, status: 'adopted', date: '09-21', recent: true, title: ['Sync: clients send operations every 5 s', '同步：客户端每 5 秒发送一次操作'] },
  { id: 's4', parent: 's3', trunk: false, status: 'in-progress', date: '10-05', recent: false, title: ['Replay 200 recorded sessions', '回放 200 次录下的会话'] },
  { id: 's5', parent: 's3', trunk: true, status: 'planned', date: '10-06', recent: false, title: ['Beta to 500 testers once the "soak test" passes', '“浸泡测试”通过后，向 500 名测试者开放 beta'] },
  { id: 's6', parent: 's5', trunk: false, status: 'proposed', date: '10-06', recent: false, title: ['Staged rollout: 5% first', '分阶段发布：先 5%'] },
]

/** The sample's selected row: the newest step that is adopted. */
const SAMPLE_SELECTED = 's3'

function sampleModel(lang: DtLang, nowMs: number): Pick<DtModel, 'nodes'> {
  const nodes = SAMPLE.map((s): DtNode => {
    const at = `2026-${s.date}T12:00:00Z`
    const updated = s.recent ? new Date(nowMs - 3600_000).toISOString() : at
    return {
      id: s.id,
      title: lang === 'zh' ? s.title[1] : s.title[0],
      parent: s.parent,
      status: s.status,
      kind: 'decision',
      ...(s.trunk ? { trunk: true } : {}),
      decidedAt: at,
      createdAt: at,
      createdBy: 'model',
      updatedAt: updated,
      notes: [],
      addedBy: `${s.id}.json`,
    }
  })
  return { nodes }
}

/** The lines of the sample, each as it reads inside the frame; the selected one is flagged. */
function sampleLines(o: { lang: DtLang; ascii: boolean; width: number; nowMs: number }): { line: Line; selected: boolean }[] {
  const idx = buildIndex(sampleModel(o.lang, o.nowMs))
  const rows = visibleRows(idx, { ui: { ...EMPTY_UI, filter: 'all' }, nowMs: o.nowMs })
  const plan = indentPlan(rows, o.width)
  return rows.map(row => ({
    selected: row.node.id === SAMPLE_SELECTED,
    // (the width of the line plus the blank the pane keeps at its edge: the rail draws one column less than it is given)
    line: railLine(row, { width: o.width + EDGE, selected: false, ascii: o.ascii, lang: o.lang, nowMs: o.nowMs, title: plain(row.node.title), mark: null, step: plan.step }),
  }))
}

/** Rows the sample takes with its frame. */
export const SAMPLE_ROWS = SAMPLE.length + 2

// ---------------------------------------------------------------- one scheme

/** The seven dots of a scheme, each in a colour of its own that the scheme in use does not repaint. */
function swatchOf7(s: Scheme, o: { surface: string; ascii: boolean; spaced: boolean }): Line {
  const dot = pick(MARKS.dot, o.ascii)
  const out: Line = []
  swatchOf(effectiveScheme(s, o.surface)).forEach((colour, k) => {
    if (k > 0 && o.spaced) out.push(S(' '))
    out.push(S(dot, { color: colour, fixed: true }))
  })
  return out
}

/** What a scheme's line says as words, for whatever reads the button out. */
function wordsOf(s: Scheme, lang: DtLang, tag: string): string {
  return [s.name, s.note[lang], tag].filter(x => x !== '').join(', ')
}

/** What a line of the list holds: how wide the swatch is and whether a note follows it. */
type Mode = { swatch: number; spaced: boolean; note: boolean }

/** From the fullest to the barest; a narrow pane gives up the note first, then the blanks between the dots, then the swatch. */
const MODES: readonly Mode[] = [
  { swatch: SWATCH_SPACED, spaced: true, note: true },
  { swatch: SWATCH_SPACED, spaced: true, note: false },
  { swatch: SWATCH_TIGHT, spaced: false, note: false },
  { swatch: 0, spaced: false, note: false },
]

/** The columns taken besides the note: the name, the swatch and the tag (the longest there is, so that every line is set the same way). */
function fixedWidth(m: Mode, tagW: number): number {
  return NAME_COLS + (m.swatch > 0 ? GAP + m.swatch : 0) + (tagW > 0 ? GAP + tagW : 0)
}

/** The fullest mode that fits `room` columns, or null when not even the name and the tag do. */
function modeFor(room: number, tagW: number): Mode | null {
  for (const m of MODES) {
    const fixed = fixedWidth(m, tagW)
    if (fixed > room) continue
    if (m.note && room - fixed - GAP < NOTE_MIN) continue
    return m
  }
  return null
}

/** The line of a scheme without its mark: the name, the swatch, what the scheme is like, and flush right whether it is in use. */
function entryLine(s: Scheme, o: { room: number; mode: Mode | null; tagW: number; lang: DtLang; ascii: boolean; surface: string; tag: string; tagColour: string }): Line {
  const tag: Line = o.tag === '' ? [] : [S(o.tag, o.tagColour === 'inactive' ? QUIET : { color: o.tagColour })]
  const m = o.mode
  if (m === null) {
    // too narrow for anything but the name (cut) and the tag
    return fitSpans([S(truncate(s.name, Math.max(1, o.room - (o.tag === '' ? 0 : GAP + strWidth(o.tag)))))], tag, o.room, GAP)
  }
  const left: Line = [S(padEnd(s.name, NAME_COLS))]
  if (m.swatch > 0) left.push(S(' '.repeat(GAP)), ...swatchOf7(s, { surface: o.surface, ascii: o.ascii, spaced: m.spaced }))
  if (m.note) left.push(S(' '.repeat(GAP)), ...truncateSpans([S(s.note[o.lang], QUIET)], o.room - fixedWidth(m, o.tagW) - GAP))
  return fitSpans(left, tag, o.room, GAP)
}

/** `▲ 3 more above`; in a pane too narrow for the words, `▲ 3` (the number is what must not be cut). */
function pageMark(lang: DtLang, ascii: boolean, up: boolean, n: number, room: number): Line {
  const arrow = ascii ? (up ? '^' : 'v') : up ? '▲' : '▼'
  const full = t(lang, up ? 'pane.above' : 'pane.below', { n }).replace(up ? '▲' : '▼', arrow)
  return truncateSpans([S(strWidth(full) <= room ? full : `${arrow} ${n}`, QUIET)], room)
}

// ---------------------------------------------------------------- the picker

/** Works out every block of the picker, top to bottom, in `width` columns and `rows` rows. */
export function layoutColors(i: PaneInput): PaneLayout {
  const width = Math.max(16, Math.floor(i.width))
  const rows = Math.max(3, Math.floor(i.rows))
  const inner = innerWidth(width)
  const { lang, ascii, project } = i
  const surface = i.surface ?? 'terminal'
  const inUse = schemeOf(i.scheme ?? DEFAULT_SCHEME)
  const ui: DtUi = i.ui
  const highlighted = (ui.pick !== null ? findScheme(ui.pick) : undefined) ?? inUse
  const at = Math.max(0, SCHEMES.findIndex(s => s.id === highlighted.id))
  const total = SCHEMES.length

  const blocks: Block[] = []
  const text = (l: Line) => blocks.push({ kind: 'text', line: lead(l) })
  const blank = () => blocks.push({ kind: 'text', line: [] })
  const bar = (parts: readonly Part[]) => blocks.push({ kind: 'bar', parts: [textPart([S(' '.repeat(GUTTER))]), ...parts] })

  const titleText = project.config?.title ?? (project.root !== '' ? baseName(project.root) : '')
  bar(headerBar({ width: inner, lang, ascii, title: titleText, trees: [], viewed: '', recording: null, translating: i.translating }))
  const heading: Line = [S(t(lang, 'colors.title'), { bold: true }), S('   '), S(t(lang, 'colors.count', { n: total }), QUIET)]
  const hint: Line = [S(t(lang, 'colors.hint'), QUIET)]
  text(lineWidth(heading) + lineWidth(hint) + GAP <= inner ? fitSpans(heading, hint, inner, GAP) : truncateSpans(heading, inner))

  // ---- what the rows are shared out between
  const keys = pickerItems({ lang, ascii })
  const footer = packBar(keys.items, keys.right, inner, footerLines(rows))
  const airy = rows >= AIRY_MIN_ROWS
  const free = rows - (2 + (airy ? 1 : 0) + (airy ? 1 : 0) + footer.length)
  // the sample goes under the list when the list keeps a useful length beside it
  const withSample = free - (SAMPLE_ROWS + 1) >= Math.min(total, LIST_MIN)
  const listRows = Math.max(1, Math.min(total, withSample ? free - (SAMPLE_ROWS + 1) : free))

  if (airy) blank()

  // ---- the list, windowed around the highlight, with a word for what is above and below
  const marks = listRows >= MARKS_MIN && listRows < total
  let count = listRows
  let win = windowRows(total, at, null, count)
  for (let pass = 0; marks && pass < 3; pass++) {
    const usable = listRows - (win.above > 0 ? 1 : 0) - (win.below > 0 ? 1 : 0)
    if (usable === count) break
    count = Math.max(1, usable)
    win = windowRows(total, at, null, count)
  }
  if (marks && win.above > 0) blocks.push({ kind: 'page', dir: 'up', step: count, line: lead(pageMark(lang, ascii, true, win.above, inner)) })
  const listed: string[] = []
  const room = width - EDGE - GUTTER
  // (the same mode for every line: the longest tag is the one that has to fit)
  const tagW = Math.max(strWidth(t(lang, 'colors.inUse')), strWidth(t(lang, 'colors.default')))
  const mode = modeFor(room, tagW)
  for (const s of SCHEMES.slice(win.start, win.end)) {
    const selected = s.id === highlighted.id
    const tag = s.id === inUse.id ? t(lang, 'colors.inUse') : s.id === DEFAULT_SCHEME ? t(lang, 'colors.default') : ''
    const content = entryLine(s, { room, mode, tagW, lang, ascii, surface, tag, tagColour: s.id === inUse.id ? 'success' : 'inactive' })
    const row: Line = [S(selected ? pick(MARKS.bar, ascii) : ' ', selected ? { color: COLORS.mark } : {}), S(' '.repeat(Math.max(0, GUTTER - 1))), ...content]
    const line = selected ? barLine(truncateSpans(row, width - EDGE), COLORS.selected, width) : truncateSpans(row, width - EDGE)
    blocks.push({ kind: 'scheme', id: s.id, selected, line, label: wordsOf(s, lang, tag) })
    listed.push(s.id)
  }
  if (marks && win.below > 0) blocks.push({ kind: 'page', dir: 'down', step: count, line: lead(pageMark(lang, ascii, false, win.below, inner)) })

  // ---- the sample, in a frame that names the scheme it is drawn in
  if (withSample) {
    blank()
    const frameW = inner
    const bodyW = frameInner(frameW)
    text(frameTop(frameW, { title: [S(t(lang, 'colors.sample'), { bold: true })], right: [S(highlighted.name, { bold: true })], ascii }))
    for (const sample of sampleLines({ lang, ascii, width: bodyW, nowMs: i.nowMs })) {
      blocks.push({
        kind: 'text',
        line: lead(sample.selected ? frameBand(sample.line, frameW, ascii, { bg: COLORS.selected, bar: pick(MARKS.bar, ascii), barColor: COLORS.mark }) : frameRow(sample.line, frameW, ascii)),
      })
    }
    text(frameBottom(frameW, ascii))
  }

  // ---- the keys, on the last rows when the pane is all the person's to use
  if (i.pin === true) for (let k = rows - blocks.length - footer.length; k > 0; k--) blank()
  else if (airy) blank()
  for (const l of footer) bar(l)

  return { blocks, selected: null, drawn: [], height: blocks.length, picked: highlighted.id, listed }
}
