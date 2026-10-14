// The overview of the project's trees: one graph with a lane for each tree, and under it the list of the trees.
//
//   notes-app   main ●   crdt-engine   cloud-first                              EN 中
//   3 trees                                           ● recording in main   updated 15:28
//
//   ●           Notes app: offline-first rewrite for the spring release     main  09-02
//   ●━━━━━━━━┓  Storage: SQLite with a write-ahead log, no more JSON files  main  09-14
//   ┃       ●   Sync: the server owns the data, phones keep a cache   cloud-first  09-16
//
//   ╭─ Trees ─────────────────────────────────────────────────────────── 2 / 3 ─╮
//   │ ● main          17 decisions  6 steps                   ● recording  15:28 │
//   │   Notes app: offline-first rewrite for the spring release                  │
//   ╰────────────────────────────────────────────────────────────────────────────╯
//   k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back                  l: 中
//
// The graph draws what each tree recorded itself (forest.ts), a step on a row, the oldest on top: its dot in the
// lane of its tree, the lane joined to the lane it was opened from at the step it was opened at. The rows of the
// tree picked in the list sit on a band. Everything here is pure: `layoutOverview` returns blocks, like `layoutPane`.

import type { DtLang, DtMode, DtTreeInfo } from '../types'
import type { Part } from './bar'
import { textPart } from './bar'
import { fmtDate, fmtWhen } from './events'
import { overviewItems, packBar } from './foot'
import { MAX_TREES, graphOf } from './forest'
import type { Graph, GraphRow } from './forest'
import { frameBand, frameBottom, frameInner, frameRow, frameTop } from './frame'
import { COLORS, GRAPH, MARKS, RAIL, isQuiet, laneColour, pick } from './glyphs'
import { headerBar, originLine, overviewStateLine } from './head'
import { richSpans } from './highlight'
import { decisionsText, stepsText, t } from './i18n'
import { localizer, markOf } from './lang'
import type { Localizer } from './lang'
import type { Block, PaneInput, PaneLayout } from './layout'
import { baseName } from './project'
import { SPINE_COL, titleSpans } from './rail'
import { AIRY_MIN_ROWS, NEWTREE_ROWS, SPACER_MIN_ROWS, footerLines } from './room'
import { EDGE, GUTTER, QUIET, S, innerWidth, lead } from './style'
import type { Line } from './spans'
import { barLine, fitSpans, lineText, lineWidth, ruleLine, truncateSpans } from './spans'
import { padEnd, padStart, plain, strWidth, truncate } from './width'

/** Columns between the last lane and the title of a step. */
const LANE_GAP = 3
/** The columns a title keeps at the least, however many lanes there are. */
const MIN_TITLE = 16
/** What the right end of a row takes besides the tree's name: two blanks, a date, a blank. */
const DATE_ROOM = 8
/** The widest the name of a tree is drawn (in the graph and in the list). */
const NAME_CAP = 20

/** What a line says, as words: single blanks, no blanks at either end. */
const words = (line: Line): string => lineText(line).replace(/\s+/g, ' ').trim()

/** The rows of the graph worth keeping before the list takes all it asks for. */
const GRAPH_MIN = 4

// ---------------------------------------------------------------- the lanes

export type Lanes = {
  /** How many lanes are drawn: the first ones, when there is no room for all. */
  count: number
  /** Columns from one lane to the next. */
  step: number
  /** The column the titles start at. */
  titleCol: number
}

/** Where the lanes sit in a pane `width` columns wide: as far apart as the room allows (3, 2 or 1 columns), and as many as fit. */
export function lanePlan(count: number, width: number): Lanes {
  const room = width - EDGE - SPINE_COL - LANE_GAP - MIN_TITLE - DATE_ROOM
  const spread = (n: number, step: number): Lanes => ({ count: n, step, titleCol: SPINE_COL + step * Math.max(0, n - 1) + LANE_GAP })
  // (a single lane has no space between lanes to spare)
  if (count <= 1) return spread(count, 3)
  for (const step of [3, 2, 1]) if (step * (count - 1) <= room) return spread(count, step)
  return spread(Math.max(1, Math.min(count, room + 1)), 1)
}

/** The graph with its lanes laid out: which rows are drawn, and the stretch of rows each lane runs over. */
export type Geo = {
  /** The rows of the lanes that are drawn, oldest first. */
  rows: GraphRow[]
  lanes: Lanes
  /** Per lane: the row its line starts at (where it leaves the lane it was opened from), and the last of its own rows. */
  top: number[]
  bottom: number[]
  /** Per lane: the rows of its own steps. */
  own: number[][]
}

export function geometry(graph: Graph, lanes: Lanes): Geo {
  const rows = graph.rows.filter(r => r.lane < lanes.count)
  const own: number[][] = Array.from({ length: lanes.count }, () => [])
  rows.forEach((r, at) => own[r.lane]!.push(at))
  const top = own.map((mine, lane) => {
    const joined = rows.findIndex(r => r.forks.includes(lane))
    const first = mine[0] ?? 0
    return joined >= 0 ? Math.min(joined, first) : first
  })
  const bottom = own.map(mine => (mine.length > 0 ? mine[mine.length - 1]! : -1))
  return { rows, lanes, top, bottom, own }
}

/** The column of a lane. */
export const laneCol = (lanes: Lanes, lane: number): number => SPINE_COL + lanes.step * lane

/** Whether the line of `lane` below `row` leads to a step that is still ahead: it is drawn dashed. */
function leadsAhead(g: Geo, lane: number, row: number): boolean {
  const next = g.own[lane]!.find(at => at > row)
  return next !== undefined && g.rows[next]!.ahead
}

/** One column of a row of the graph. */
export type Cell = { ch: string; color?: string; dim?: boolean; bold?: boolean }
const BLANK: Cell = { ch: ' ' }

export type CellOptions = {
  ascii: boolean
  /** The colour of a lane. */
  colour: (lane: number) => string
}

function line(g: Geo, lane: number, below: number, o: CellOptions): Cell {
  const dashed = leadsAhead(g, lane, below)
  return { ch: pick(dashed ? RAIL.dashed : RAIL.solid, o.ascii), color: o.colour(lane), ...(dashed ? { dim: true } : {}) }
}

/**
 * The columns of the lanes at a row of the graph, up to where the title starts: the dot of the row's own step, the
 * lanes that run on past it, and the lines that join the lanes of other trees to this one where they were opened.
 */
export function rowCells(g: Geo, at: number, o: CellOptions): Cell[] {
  const row = g.rows[at]!
  const col = (lane: number) => laneCol(g.lanes, lane)
  const cells: Cell[] = Array.from({ length: g.lanes.titleCol }, () => BLANK)
  for (let lane = 0; lane < g.lanes.count; lane++) {
    if (lane !== row.lane && g.top[lane]! < at && at < g.bottom[lane]!) cells[col(lane)] = line(g, lane, at, o)
  }
  // lanes opened from this step: a line to the right, turning down in the lane (the nearer ones branch off the farthest line)
  const targets = row.forks.filter(lane => lane < g.lanes.count).sort((a, b) => a - b)
  const far = targets[targets.length - 1]
  if (far !== undefined) {
    for (let c = col(row.lane) + 1; c < col(far); c++) {
      const to = targets.find(lane => col(lane) > c)!
      cells[c] = { ch: pick(cells[c] === BLANK ? GRAPH.across : GRAPH.cross, o.ascii), color: o.colour(to) }
    }
    for (const lane of targets) cells[col(lane)] = { ch: pick(lane === far ? GRAPH.corner : GRAPH.tee, o.ascii), color: o.colour(lane) }
  }
  const status = row.step.status
  const hollow = status === 'planned' || status === 'proposed'
  const dot = row.step.head ? RAIL.head : hollow ? RAIL.ahead : RAIL.step
  cells[col(row.lane)] = { ch: pick(dot, o.ascii), color: o.colour(row.lane), ...(hollow ? { dim: true } : {}), ...(row.step.head ? { bold: true } : {}) }
  return cells
}

/** The columns of the lanes in the line between row `at` and the next one: every lane that carries on. */
export function gapCells(g: Geo, at: number, o: CellOptions): Cell[] {
  const cells: Cell[] = Array.from({ length: g.lanes.titleCol }, () => BLANK)
  for (let lane = 0; lane < g.lanes.count; lane++) {
    if (g.top[lane]! <= at && at < g.bottom[lane]!) cells[laneCol(g.lanes, lane)] = line(g, lane, at, o)
  }
  return cells
}

/** Cells as spans: neighbours that look alike are one span. With `trim`, the blanks at the end are left off. */
export function cellSpans(cells: readonly Cell[], trim = false): Line {
  let end = cells.length
  if (trim) while (end > 0 && cells[end - 1] === BLANK) end -= 1
  const out: Line = []
  let key = ''
  for (const c of cells.slice(0, end)) {
    const k = `${c.color ?? ''}|${c.dim === true ? 1 : 0}|${c.bold === true ? 1 : 0}`
    const last = out[out.length - 1]
    if (last !== undefined && k === key) {
      last.text += c.ch
      continue
    }
    key = k
    out.push(S(c.ch, { ...(c.color !== undefined ? { color: c.color } : {}), ...(c.dim === true ? { dim: true } : {}), ...(c.bold === true ? { bold: true } : {}) }))
  }
  return out
}

// ---------------------------------------------------------------- the entries of the list

type Recording = 'recording' | 'paused' | null

type EntryOptions = {
  /** Columns the entry has. */
  width: number
  ascii: boolean
  lang: DtLang
  nowMs: number
  colour: string
  /** Columns of the name, and of the count of decisions (right-aligned): the same for every entry, so that they line up. */
  nameW: number
  decW: number
  recording: Recording
}

/** The first line of an entry: the tree's dot and name, how big it is, and on the right whether it is recorded into, or who touched it last and when. */
export function entryFirst(info: DtTreeInfo, o: EntryOptions): Line {
  const dot = pick(MARKS.dot, o.ascii)
  const head: Line = [S(dot, { color: o.colour }), S(' '), S(padEnd(truncate(plain(info.name), o.nameW), o.nameW), { bold: true })]
  const decisions = padStart(decisionsText(o.lang, info.nodes), o.decW)
  const sizes: Line[] = [
    [...head, S('  '), S(decisions), S('  '), S(stepsText(o.lang, info.steps), QUIET)],
    [...head, S('  '), S(decisions)],
    head,
  ]
  const when = fmtWhen(info.lastEventAt, o.nowMs)
  const clock: Line = when === '' ? [] : [S(when, QUIET)]
  const after = (marks: Line): Line => (clock.length === 0 ? marks : marks.length === 0 ? clock : [...marks, S('  '), ...clock])
  let ends: Line[]
  if (o.recording !== null) {
    const colour = o.recording === 'paused' ? 'warning' : 'success'
    const word = t(o.lang, o.recording === 'paused' ? 'pane.state.paused' : 'pane.state.recording')
    ends = [after([S(dot, { color: colour }), S(' '), S(word, { color: colour })]), after([S(dot, { color: colour })]), [S(dot, { color: colour })]]
  } else {
    const who: Line = info.lastActor === null ? [] : [S(info.lastActor, QUIET)]
    ends = [after(who), clock, []]
  }
  for (const size of sizes) {
    for (const end of ends) {
      if (lineWidth(size) + lineWidth(end) + 2 <= o.width) return fitSpans(size, end, o.width, 2)
    }
  }
  return fitSpans(sizes[sizes.length - 1]!, ends[ends.length - 1]!, o.width, 2)
}

/** The second line of an entry: where the tree was opened from and what it is for (the first tree has only what it is for). Null when there is nothing to say. */
export function entrySecond(info: DtTreeInfo, o: { width: number; lang: DtLang; ascii: boolean; laneOf: (tree: string) => string; loc: Localizer }): Line | null {
  const title = info.title === null ? '' : plain(o.loc.text(info.title))
  const room = Math.max(1, o.width - 2)
  if (info.fork !== null) {
    const { tree, at, count } = info.fork
    const mark = title !== '' && o.loc.waiting(title) ? markOf(title) : null
    return [S('  '), ...originLine({ tree, at, count, ...(title !== '' ? { title } : {}) }, { width: room, lang: o.lang, ascii: o.ascii, laneOf: o.laneOf, mark })]
  }
  if (title === '') return null
  const waiting = info.title !== null && o.loc.waiting(title)
  return [S('  '), ...truncateSpans(waiting ? [S(title, QUIET), S(' '), S(markOf(title), QUIET)] : richSpans(title, { color: 'inactive', dim: true }, true), room)]
}

// ---------------------------------------------------------------- the layout

type ListMode = 'roomy' | 'spaced' | 'tight' | 'compact' | 'bare'
const LIST_MODES: readonly ListMode[] = ['roomy', 'spaced', 'tight', 'compact', 'bare']

/** The rows a list of `k` entries takes in each mode: the frame, a blank row under its top, two lines to an entry, a blank row between entries. */
function listCost(mode: ListMode, k: number): number {
  switch (mode) {
    case 'roomy':
      return 3 * k + 2
    case 'spaced':
      return 3 * k + 1
    case 'tight':
      return 2 * k + 2
    case 'compact':
      return k + 2
    case 'bare':
      return k
  }
}

/** Where to start drawing `count` of `total` entries so that the span `lo`..`hi` is among them (the newest end of it when it does not fit). */
function windowStart(total: number, lo: number, hi: number, count: number): number {
  const most = Math.max(0, total - count)
  const span = hi - lo + 1
  const start = span <= count ? lo - Math.floor((count - span) / 2) : hi - count + 1
  return Math.min(Math.max(0, start), most)
}

/** Works out every block of the overview, top to bottom, in `width` columns and `rows` rows. */
export function layoutOverview(i: PaneInput): PaneLayout {
  const width = Math.max(16, Math.floor(i.width))
  const rows = Math.max(3, Math.floor(i.rows))
  const inner = innerWidth(width)
  const { lang, ascii, project, ui } = i
  const mode: Exclude<DtMode, 'off'> = project.mode === 'paused' ? 'paused' : 'recording'
  const trees = i.trees.slice(0, MAX_TREES)
  const names = trees.map(x => x.name)
  const colourOf = (tree: string) => laneColour(Math.max(0, names.indexOf(tree)))
  const loc = localizer(i.tm, lang)
  const forming = ui.newTree !== null

  // the tree the list has its pick on
  const wanted = ui.pick ?? ui.tree ?? project.tree
  const picked = names.includes(wanted) ? wanted : names.includes(project.tree) ? project.tree : (names[0] ?? null)
  const pickedAt = picked === null ? -1 : names.indexOf(picked)

  const blocks: Block[] = []
  const text = (l: Line) => blocks.push({ kind: 'text', line: lead(l) })
  const blank = () => blocks.push({ kind: 'text', line: [] })
  const bar = (parts: readonly Part[]) => blocks.push({ kind: 'bar', parts: [textPart([S(' '.repeat(GUTTER))]), ...parts] })

  const titleText = project.config?.title ?? (project.root !== '' ? baseName(project.root) : '')
  bar(headerBar({ width: inner, lang, ascii, title: titleText, trees: names, viewed: picked ?? project.tree, recording: project.tree, translating: i.translating }))
  const lastEventAt = trees.reduce<string | null>((latest, x) => (x.lastEventAt !== null && (latest === null || x.lastEventAt > latest) ? x.lastEventAt : latest), null)
  text(overviewStateLine({ width: inner, lang, ascii, mode, trees: trees.length, lastEventAt, recording: project.tree }))

  // ---- what the rows are shared out between
  const keys = overviewItems({ lang, ascii, canCreate: i.canEdit, forming })
  const footer = packBar(keys.items, keys.right, inner, footerLines(rows))
  const airy = rows >= AIRY_MIN_ROWS
  const roomy = rows >= AIRY_MIN_ROWS
  const free = rows - (2 + (airy ? 1 : 0) + (roomy ? 1 : 0) + footer.length)

  const graph = graphOf(trees)
  const lanes = lanePlan(graph.lanes.length, width)
  const geo = geometry(graph, lanes)
  const steps = geo.rows.length
  const want = Math.min(steps, Math.max(GRAPH_MIN, Math.floor(free * 0.45)))
  const gapFor = (graphRows: number) => (roomy && graphRows > 0 ? 1 : 0)

  // the list (or the form that takes its place): its mode, how many trees it shows, and so what is left for the graph
  const n = trees.length
  let listMode: ListMode = 'bare'
  let shown = Math.max(1, Math.min(n, free))
  let listRows: number
  if (forming) {
    listRows = 1 + NEWTREE_ROWS
  } else if (n === 0) {
    listRows = 1
  } else {
    let chosen: ListMode | null = null
    for (const m of LIST_MODES) {
      if (free - listCost(m, n) - (want > 0 && roomy ? 1 : 0) >= want) {
        chosen = m
        break
      }
    }
    // short of room: the richest list that still fits whole, and the graph gets what is left
    chosen ??= LIST_MODES.find(m => listCost(m, n) <= free) ?? null
    if (chosen !== null) {
      listMode = chosen
      shown = n
    } else if (free >= 3) {
      listMode = 'compact'
      shown = Math.min(n, free - 2)
    } else {
      listMode = 'bare'
      shown = Math.max(1, Math.min(n, free))
    }
    listRows = listCost(listMode, shown)
  }
  const spare = free - listRows
  const gap = gapFor(spare - 1) // a blank row between the graph and what is under it
  const graphRows = Math.max(0, Math.min(spare - gap, steps > 0 ? 2 * steps - 1 : 0))

  // ---- under the strip
  if (airy) blank()

  // ---- the graph
  if (graphRows > 0 && steps > 0) {
    const nameW = Math.min(NAME_CAP, geo.rows.reduce((m, r) => Math.max(m, strWidth(plain(r.tree))), 0))
    const cellOptions: CellOptions = { ascii, colour: lane => colourOf(graph.lanes[lane]!) }
    type Item = { kind: 'row'; at: number } | { kind: 'gap'; at: number }
    const spaced = rows >= SPACER_MIN_ROWS && 2 * steps - 1 <= graphRows
    const items: Item[] = []
    geo.rows.forEach((_, at) => {
      if (spaced && at > 0) items.push({ kind: 'gap', at: at - 1 })
      items.push({ kind: 'row', at })
    })
    const itemOf = (at: number) => items.findIndex(x => x.kind === 'row' && x.at === at)
    const lane = picked === null ? -1 : graph.lanes.indexOf(picked)
    const lo = lane >= 0 && lane < lanes.count ? itemOf(geo.top[lane]!) : items.length - 1
    const hi = lane >= 0 && lane < lanes.count ? itemOf(geo.bottom[lane]!) : items.length - 1
    const marks = graphRows >= 5
    let count = Math.min(graphRows, items.length)
    let start = windowStart(items.length, lo, hi, count)
    for (let pass = 0; marks && pass < 3; pass++) {
      const usable = graphRows - (start > 0 ? 1 : 0) - (start + count < items.length ? 1 : 0)
      if (usable >= items.length) {
        count = items.length
        start = 0
        break
      }
      if (usable === count) break
      count = Math.max(1, usable)
      start = windowStart(items.length, lo, hi, count)
    }
    const visible = items.slice(start, start + count)
    // a line of lane at either end of the window leads nowhere
    while (visible.length > 0 && visible[0]!.kind === 'gap') visible.shift()
    while (visible.length > 0 && visible[visible.length - 1]!.kind === 'gap') visible.pop()
    const rowsAbove = items.slice(0, start).filter(x => x.kind === 'row').length
    const rowsBelow = items.slice(start + count).filter(x => x.kind === 'row').length
    const mark = (up: boolean) => (ascii ? (up ? '^' : 'v') : up ? '▲' : '▼')
    if (marks && rowsAbove > 0) text(truncateSpans([S(t(lang, 'pane.above', { n: rowsAbove }).replace('▲', mark(true)), QUIET)], inner))
    for (const item of visible) {
      if (item.kind === 'gap') {
        blocks.push({ kind: 'text', line: cellSpans(gapCells(geo, item.at, cellOptions), true) })
        continue
      }
      const row = geo.rows[item.at]!
      const selected = row.tree === picked
      const cells = rowCells(geo, item.at, cellOptions)
      cells[0] = selected ? { ch: pick(MARKS.bar, ascii), color: COLORS.mark } : BLANK
      const written = row.step.title
      const shownTitle = plain(loc.text(written)) || t(lang, 'r.untitled')
      const waiting = plain(written) !== '' && loc.waiting(plain(loc.text(written)))
      const left: Line = [...cellSpans(cells), ...titleSpans(shownTitle, { mark: waiting ? markOf(written) : null, bold: row.step.status === 'adopted', dim: isQuiet(row.step.status) })]
      const name = truncate(plain(row.tree), nameW)
      const date = fmtDate(row.step.at)
      const ends: Line[] = [[S(' '.repeat(Math.max(0, nameW - strWidth(name))) + name, { color: colourOf(row.tree), dim: true }), S('  '), S(date, QUIET), S(' ')], [S(date, QUIET), S(' ')], []]
      const room = width - EDGE - lanes.titleCol - 2
      const end = ends.find(x => lineWidth(x) + MIN_TITLE <= room) ?? ends[ends.length - 1]!
      const full = fitSpans(left, end, width - EDGE, 2)
      blocks.push({ kind: 'tree', tree: row.tree, step: row.step.id, part: 0, selected, line: selected ? barLine(full, COLORS.selected, width) : full, label: [shownTitle, name, date].filter(x => x !== '').join(', ') })
    }
    if (marks && rowsBelow > 0) text(truncateSpans([S(t(lang, 'pane.below', { n: rowsBelow }).replace('▼', mark(false)), QUIET)], inner))
    if (gap > 0) blank()
  } else if (gap > 0 && steps > 0) {
    blank()
  }

  // ---- the form for a new tree, or the list of the trees
  const listed: string[] = []
  if (forming) {
    blocks.push({ kind: 'rule', line: lead(ruleLine(inner, ascii)) })
    const from = picked === null ? project.tree : picked
    blocks.push({ kind: 'newtree', title: lead(truncateSpans([S(t(lang, 'trees.new.title'), { bold: true }), S('   '), S(t(lang, 'trees.new.from', { tree: plain(from) }), QUIET)], inner)) })
  } else if (n === 0) {
    text(truncateSpans([S(t(lang, 'trees.empty'), QUIET)], inner))
  } else {
    const frameW = inner
    const bodyW = listMode === 'bare' ? inner : frameInner(frameW)
    const first = Math.min(Math.max(0, pickedAt - Math.floor(shown / 2)), Math.max(0, n - shown))
    const window = trees.slice(first, first + shown)
    const nameW = Math.min(NAME_CAP, window.reduce((m, x) => Math.max(m, strWidth(plain(x.name))), 0))
    const decW = window.reduce((m, x) => Math.max(m, strWidth(decisionsText(lang, x.nodes))), 0)
    const framed = listMode !== 'bare'
    const twoLines = listMode === 'roomy' || listMode === 'spaced' || listMode === 'tight'
    if (framed) {
      const counter = `${pickedAt + 1} / ${n}`
      blocks.push({ kind: 'text', line: lead(frameTop(frameW, { title: [S(t(lang, 'trees.title'), { bold: true })], right: [S(counter, QUIET)], ascii })) })
      if (listMode === 'roomy') text(frameRow([], frameW, ascii))
    }
    window.forEach((info, k) => {
      if (k > 0 && (listMode === 'roomy' || listMode === 'spaced')) text(frameRow([], frameW, ascii))
      const selected = info.name === picked
      const recording: Recording = info.name === project.tree ? mode : null
      const contents: Line[] = [entryFirst(info, { width: bodyW, ascii, lang, nowMs: i.nowMs, colour: colourOf(info.name), nameW, decW, recording })]
      if (twoLines) {
        const second = entrySecond(info, { width: bodyW, lang, ascii, laneOf: colourOf, loc })
        contents.push(second ?? [])
      }
      contents.forEach((content, part) => {
        let drawn: Line
        if (!framed) {
          const row: Line = [S(selected ? pick(MARKS.bar, ascii) : ' ', selected ? { color: COLORS.mark } : {}), S(' '.repeat(Math.max(0, GUTTER - 1))), ...content]
          drawn = selected ? barLine(truncateSpans(row, width - EDGE), COLORS.selected, width) : truncateSpans(row, width - EDGE)
        } else if (selected) {
          drawn = lead(frameBand(content, frameW, ascii, { bg: COLORS.selected, bar: pick(MARKS.bar, ascii), barColor: COLORS.mark }))
        } else {
          drawn = lead(frameRow(content, frameW, ascii))
        }
        blocks.push({ kind: 'tree', tree: info.name, step: null, part: part === 0 ? 0 : 1, selected, line: drawn, label: words(content) || words(contents[0]!) })
      })
      listed.push(info.name)
    })
    if (framed) blocks.push({ kind: 'text', line: lead(frameBottom(frameW, ascii)) })
  }

  // ---- the keys, on the last rows when the pane is all the person's to use
  const heightOf = (bs: readonly Block[]) => bs.reduce((sum, b) => sum + (b.kind === 'newtree' ? NEWTREE_ROWS : 1), 0)
  if (i.pin === true) for (let k = rows - heightOf(blocks) - footer.length; k > 0; k--) blank()
  else if (roomy) blank()
  for (const l of footer) bar(l)

  return { blocks, selected: null, drawn: [], height: heightOf(blocks), picked, listed }
}
