import { expect, test } from 'claude-code/testing'

import { graphOf, isAhead } from '../lib/forest'
import type { Graph, GraphRow } from '../lib/forest'
import { localizer } from '../lib/lang'
import { layoutPane } from '../lib/layout'
import type { Block, PaneInput, PaneLayout } from '../lib/layout'
import { cellSpans, entryFirst, entrySecond, gapCells, geometry, laneCol, lanePlan, rowCells } from '../lib/overview'
import type { Cell, CellOptions, Geo, Lanes } from '../lib/overview'
import { EMPTY_TM } from '../lib/state'
import { lineText, lineWidth } from '../lib/spans'
import type { DtLang, DtStatus, DtTreeInfo } from '../types'
import { NOW, manyTrees, noon, notesTm, projectOf, treesOf } from './notes'
import { checkOverview, input, overviewInput, textOf, ui } from './panes'

const other = (lang: DtLang): DtLang => (lang === 'en' ? 'zh' : 'en')

// ---------------------------------------------------------------- the lanes

test('lanes: as far apart as the room allows, and the titles start a gap after the last lane', () => {
  // one lane has nothing to space
  expect(lanePlan(1, 100)).toEqual({ count: 1, step: 3, titleCol: 5 })
  expect(lanePlan(0, 80)).toEqual({ count: 0, step: 3, titleCol: 5 })
  // three lanes: 3 columns apart while the title keeps its room and the name and date theirs, then 2, then 1
  expect(lanePlan(3, 100)).toEqual({ count: 3, step: 3, titleCol: 11 })
  expect(lanePlan(3, 36)).toEqual({ count: 3, step: 3, titleCol: 11 })
  expect(lanePlan(3, 35)).toEqual({ count: 3, step: 2, titleCol: 9 })
  expect(lanePlan(3, 34)).toEqual({ count: 3, step: 2, titleCol: 9 })
  expect(lanePlan(3, 33)).toEqual({ count: 3, step: 1, titleCol: 7 })
  expect(lanePlan(3, 32)).toEqual({ count: 3, step: 1, titleCol: 7 })
  // not even a column between the lanes: the first ones only, and at least one
  expect(lanePlan(3, 31)).toEqual({ count: 2, step: 1, titleCol: 6 })
  expect(lanePlan(3, 30)).toEqual({ count: 1, step: 1, titleCol: 5 })
  expect(lanePlan(3, 16)).toEqual({ count: 1, step: 1, titleCol: 5 })
})

test('lanes: whatever the width and the number of lanes, a title keeps its room, a lane is left out only when one more would not fit, and room is given up in one order', () => {
  const MARGINS = 1 /* the edge */ + 8 /* the date and the name's blanks */
  for (let count = 0; count <= 20; count++) {
    let narrower: Lanes | null = null
    for (let width = 16; width <= 200; width++) {
      const lanes = lanePlan(count, width)
      const label = `${count} lanes in ${width} columns`
      expect(lanes.count, label).toBeLessThanOrEqual(count)
      expect(lanes.count >= 1 || count === 0, label).toBe(true)
      expect([1, 2, 3], label).toContain(lanes.step)
      expect(lanes.titleCol, label).toBe(2 + lanes.step * Math.max(0, lanes.count - 1) + 3)
      if (lanes.count > 1) expect(width - MARGINS - lanes.titleCol, label).toBeGreaterThanOrEqual(16)
      if (lanes.count < count) expect(2 + lanes.count + 3 + 16 + MARGINS, label).toBeGreaterThan(width)
      // a wider pane never draws fewer lanes, nor puts them closer
      if (narrower !== null) {
        expect(lanes.count, label).toBeGreaterThanOrEqual(narrower.count)
        expect(lanes.step, label).toBeGreaterThanOrEqual(narrower.step)
      }
      narrower = lanes
    }
  }
  // and more lanes never get more room each
  for (let width = 16; width <= 200; width += 3) {
    let fewer: Lanes | null = null
    for (let count = 1; count <= 20; count++) {
      const lanes = lanePlan(count, width)
      if (fewer !== null) {
        expect(lanes.count, `${count} lanes in ${width} columns`).toBeGreaterThanOrEqual(fewer.count)
        if (count > 2) expect(lanes.step, `${count} lanes in ${width} columns`).toBeLessThanOrEqual(fewer.step)
      }
      fewer = lanes
    }
  }
})

// ---------------------------------------------------------------- the geometry of the graph

const sample = (): Graph => graphOf(treesOf('en'))
const where = (g: Geo) => g.rows.map(r => `${r.tree}:${r.step.id}`)

test('geometry: each lane has the rows of its own steps and runs from where it leaves the lane it came from to its last step', () => {
  const g = geometry(sample(), lanePlan(3, 100))
  expect(where(g)).toEqual(['main:n0', 'main:n1', 'cloud-first:c1', 'main:n2', 'cloud-first:c2', 'crdt-engine:x1', 'main:n3', 'main:n16', 'main:n8', 'crdt-engine:x4'])
  // lanes: the first tree, then crdt-engine (opened later in main), then cloud-first
  expect(g.own).toEqual([[0, 1, 3, 6, 7, 8], [5, 9], [2, 4]])
  // crdt-engine leaves main at its Sync step (row 3) and cloud-first at its Storage step (row 1)
  expect(g.top).toEqual([0, 3, 1])
  expect(g.bottom).toEqual([8, 9, 4])
  expect([0, 1, 2].map(lane => laneCol(g.lanes, lane))).toEqual([2, 5, 8])
})

test('geometry: lanes the pane has no room for are left out, with their rows', () => {
  const lanes = lanePlan(3, 31)
  expect(lanes.count).toBe(2)
  const g = geometry(sample(), lanes)
  expect(where(g)).toEqual(['main:n0', 'main:n1', 'main:n2', 'crdt-engine:x1', 'main:n3', 'main:n16', 'main:n8', 'crdt-engine:x4'])
  expect(g.own).toEqual([[0, 1, 2, 4, 5, 6], [3, 7]])
  expect(g.top).toEqual([0, 2])
  expect(g.bottom).toEqual([6, 7])
})

// ---------------------------------------------------------------- the cells of a row

const colour = (lane: number) => `L${lane}`
const options = (ascii = false): CellOptions => ({ ascii, colour })
const glyphs = (cells: readonly Cell[]) => cells.map(c => c.ch).join('')
/** The cells that draw something, as the glyph and the number of its lane's colour. */
const painted = (cells: readonly Cell[]) =>
  cells
    .filter(c => c.ch !== ' ')
    .map(c => `${c.ch}${(c.color ?? '?').slice(1)}`)
    .join(' ')

test('graph cells: the dot of the step, the lanes that run past it, and the line to a lane opened from it', () => {
  const g = geometry(sample(), lanePlan(3, 100))
  const rows = g.rows.map((_, at) => glyphs(rowCells(g, at, options())))
  expect(rows).toEqual([
    '  ●        ', // Notes app
    '  ●━━━━━┓  ', // Storage: cloud-first leaves from here
    '  ┃     ●  ', // cloud-first: Sync
    '  ●━━┓  ┃  ', // Sync: crdt-engine leaves from here, over nothing
    '  ┃  ┃  ◉  ', // cloud-first: the head of its lane
    '  ┃  ◉     ', // crdt-engine: its first step
    '  ●  ╏     ', // Conflicts, and the lane of crdt-engine leading on to a step still ahead
    '  ◉  ╏     ', // Offline queue: the head of main
    '  ○  ╏     ', // Beta: planned, so hollow
    '     ○     ', // crdt-engine: its plan
  ])
  // ASCII has no glyph that needs more than a column, or any heavy line
  const ascii = g.rows.map((_, at) => glyphs(rowCells(g, at, options(true))))
  expect(ascii).toEqual([
    '  *        ',
    '  *-----+  ',
    '  |     *  ',
    '  *--+  |  ',
    '  |  |  @  ',
    '  |  @     ',
    '  *  :     ',
    '  @  :     ',
    '  o  :     ',
    '     o     ',
  ])
  // every row has the columns up to the titles, no more
  for (let at = 0; at < g.rows.length; at++) expect(rowCells(g, at, options()).length).toBe(g.lanes.titleCol)
})

test('graph cells: every glyph wears the colour of its lane, and a line across wears the colour of the lane it leads to', () => {
  const g = geometry(sample(), lanePlan(3, 100))
  const at = (row: number) => rowCells(g, row, options())
  expect(painted(at(0))).toBe('●0')
  expect(painted(at(1))).toBe('●0 ━2 ━2 ━2 ━2 ━2 ┓2')
  expect(painted(at(2))).toBe('┃0 ●2')
  expect(painted(at(3))).toBe('●0 ━1 ━1 ┓1 ┃2')
  expect(painted(at(4))).toBe('┃0 ┃1 ◉2')
  expect(painted(at(6))).toBe('●0 ╏1')
  expect(painted(at(9))).toBe('○1')
  // the head is bold, a step still ahead is hollow and dim, a lane that leads on to one is dashed and dim, a done one is plain
  expect(at(7)[2]).toEqual({ ch: '◉', color: 'L0', bold: true })
  expect(at(8)[2]).toEqual({ ch: '○', color: 'L0', dim: true })
  expect(at(6)[5]).toEqual({ ch: '╏', color: 'L1', dim: true })
  expect(at(2)[2]).toEqual({ ch: '┃', color: 'L0' })
  expect(at(0)[2]).toEqual({ ch: '●', color: 'L0' })
})

// A graph made by hand: lanes by name, and the rows as [tree, lane, step id, { forks, status, head }].
type Spec = [tree: string, lane: number, id: string, extra?: { forks?: number[]; status?: DtStatus; head?: boolean }]

function graphFrom(lanes: string[], specs: Spec[]): Graph {
  const rows = specs.map(([tree, lane, id, extra = {}], at): GraphRow => {
    const status = extra.status ?? 'adopted'
    return {
      tree,
      lane,
      step: { id, title: id, status, at: noon(10, 1 + at), by: `${at}`, head: extra.head === true },
      first: false,
      last: false,
      ahead: isAhead(status),
      forks: extra.forks ?? [],
    }
  })
  return { lanes, rows }
}

test('graph cells: two lanes opened from one step share its line: the nearer turns down in a tee, the farther in a corner', () => {
  const g = geometry(graphFrom(['main', 'a', 'b'], [['main', 0, 'm1', { forks: [1, 2] }], ['a', 1, 'a1'], ['b', 2, 'b1']]), lanePlan(3, 100))
  const row = rowCells(g, 0, options())
  expect(glyphs(row)).toBe('  ●━━┳━━┓  ')
  expect(painted(row)).toBe('●0 ━1 ━1 ┳1 ━2 ━2 ┓2')
  expect(glyphs(rowCells(g, 0, options(true)))).toBe('  *--+--+  ')
})

test('graph cells: a line across a lane that runs on crosses it', () => {
  const g = geometry(graphFrom(['main', 'b', 'c'], [['b', 1, 'b1'], ['main', 0, 'm1', { forks: [2] }], ['b', 1, 'b2'], ['c', 2, 'c1']]), lanePlan(3, 100))
  const row = rowCells(g, 1, options())
  expect(glyphs(row)).toBe('  ●━━╋━━┓  ')
  expect(painted(row)).toBe('●0 ━2 ━2 ╋2 ━2 ━2 ┓2')
  expect(glyphs(rowCells(g, 1, options(true)))).toBe('  *--+--+  ')
  // the new lane runs from the step it was opened at down to its first step
  expect(glyphs(rowCells(g, 2, options()))).toBe('     ●  ┃  ')
  expect(glyphs(rowCells(g, 0, options()))).toBe('     ●     ')
})

test('graph cells: the line to a lane whose first step is still ahead is dashed', () => {
  const g = geometry(graphFrom(['main', 'a'], [['main', 0, 'm1', { forks: [1] }], ['main', 0, 'm2'], ['a', 1, 'a1', { status: 'planned' }]]), lanePlan(2, 100))
  expect(glyphs(rowCells(g, 1, options()))).toBe('  ●  ╏  ')
  expect(rowCells(g, 1, options())[5]).toEqual({ ch: '╏', color: 'L1', dim: true })
  expect(glyphs(gapCells(g, 0, options()))).toBe('  ┃  ╏  ')
})

test('graph cells: a lane opened from a step by a tree the pane has no room for draws no line', () => {
  const g = geometry(sample(), lanePlan(3, 31))
  expect(glyphs(rowCells(g, 1, options()))).toBe('  ●   ') // Storage opened cloud-first, which is not drawn
  expect(glyphs(rowCells(g, 2, options()))).toBe('  ●┓  ') // Sync opened crdt-engine, which is: the next column
})

test('graph cells: between two rows, every lane that carries on has its line, dashed where it leads to a step still ahead', () => {
  const g = geometry(sample(), lanePlan(3, 100))
  expect(g.rows.slice(0, -1).map((_, at) => glyphs(gapCells(g, at, options())))).toEqual([
    '  ┃        ',
    '  ┃     ┃  ',
    '  ┃     ┃  ',
    '  ┃  ┃  ┃  ',
    '  ┃  ┃     ',
    '  ┃  ╏     ',
    '  ┃  ╏     ',
    '  ╏  ╏     ',
    '     ╏     ',
  ])
  expect(glyphs(gapCells(g, 3, options(true)))).toBe('  |  |  |  ')
  expect(glyphs(gapCells(g, 7, options(true)))).toBe('  :  :     ')
  expect(painted(gapCells(g, 3, options()))).toBe('┃0 ┃1 ┃2')
})

test('graph cells as spans: neighbours that look alike are one span, and the blanks at the end can be left off', () => {
  const g = geometry(sample(), lanePlan(3, 100))
  expect(cellSpans(rowCells(g, 1, options()))).toEqual([{ text: '  ' }, { text: '●', color: 'L0' }, { text: '━━━━━┓', color: 'L2' }, { text: '  ' }])
  // the colour is not the only thing that tells spans apart
  expect(cellSpans(rowCells(g, 6, options()))).toEqual([{ text: '  ' }, { text: '●', color: 'L0' }, { text: '  ' }, { text: '╏', color: 'L1', dim: true }, { text: '     ' }])
  expect(cellSpans(rowCells(g, 7, options()))).toContainEqual({ text: '◉', color: 'L0', bold: true })
  expect(cellSpans(rowCells(g, 0, options()), true)).toEqual([{ text: '  ' }, { text: '●', color: 'L0' }])
  expect(cellSpans(gapCells(g, 8, options()), true)).toEqual([{ text: '     ' }, { text: '╏', color: 'L1', dim: true }])
  expect(lineText(cellSpans(rowCells(g, 3, options())))).toBe('  ●━━┓  ┃  ')
})

// ---------------------------------------------------------------- the entries of the list

type Entry = Parameters<typeof entryFirst>[1]
const entry = (over: Partial<Entry> = {}): Entry => ({ width: 60, ascii: false, lang: 'en', nowMs: NOW, colour: 'merged', nameW: 11, decW: 12, recording: null, ...over })
/** The text of the first line of an entry, the clock masked (it is the machine's own time zone). */
const first = (info: DtTreeInfo, over: Partial<Entry> = {}) => lineText(entryFirst(info, entry(over))).replace(/\d\d:\d\d/, 'HH:MM')

test('entry: the tree, how big it is, and on the right whether it is recorded into, or who touched it last and when', () => {
  const [main, crdt, cloud] = treesOf('en') as [DtTreeInfo, DtTreeInfo, DtTreeInfo]
  expect(first(main, { recording: 'recording' })).toBe('● main         17 decisions  6 steps      ● recording  HH:MM')
  expect(first(main, { recording: 'paused' })).toBe('● main         17 decisions  6 steps         ● paused  HH:MM')
  expect(first(crdt)).toBe('● crdt-engine   9 decisions  5 steps            model  HH:MM')
  // a day other than today: the day
  expect(first(cloud)).toBe('● cloud-first   6 decisions  4 steps             user  09-22')
  // the first line is as wide as the entry, or it has nothing on the right
  expect(lineWidth(entryFirst(main, entry({ recording: 'recording' })))).toBe(60)
  // the dot is the colour of the tree's lane, the mark of the tree recorded into is green (amber while paused)
  const line = entryFirst(main, entry({ recording: 'recording' }))
  expect(line[0]).toEqual({ text: '●', color: 'merged' })
  expect(line.find(s => s.text === 'recording')).toEqual({ text: 'recording', color: 'success' })
  expect(entryFirst(main, entry({ recording: 'paused' })).find(s => s.text === 'paused')).toEqual({ text: 'paused', color: 'warning' })
  // a tree nobody has written to has no one to name
  expect(first({ ...cloud, lastActor: null }, { width: 60 })).toBe('● cloud-first   6 decisions  4 steps                   09-22')
})

test('entry: in a narrower pane the right side gives way first, then the count of steps, then the count of decisions', () => {
  const [main, crdt] = treesOf('en') as [DtTreeInfo, DtTreeInfo]
  const widths = [60, 44, 38, 34, 30, 26, 22, 18, 14, 8]
  expect(widths.map(width => first(main, { recording: 'recording', width }))).toEqual([
    '● main         17 decisions  6 steps      ● recording  HH:MM',
    '● main         17 decisions  6 steps       ●',
    '● main         17 decisions   ●  HH:MM',
    '● main         17 decisions      ●',
    '● main         17 decisions  ●',
    '● main            ●  HH:MM',
    '● main               ●',
    '● main           ●',
    '● main    …  ●',
    '● ma…  ●',
  ])
  expect(widths.map(width => first(crdt, { width }))).toEqual([
    '● crdt-engine   9 decisions  5 steps            model  HH:MM',
    '● crdt-engine   9 decisions  5 steps   HH:MM',
    '● crdt-engine   9 decisions  5 steps',
    '● crdt-engine   9 decisions  HH:MM',
    '● crdt-engine   9 decisions',
    '● crdt-engine        HH:MM',
    '● crdt-engine    HH:MM',
    '● crdt-engine',
    '● crdt-engine',
    '● crdt-…',
  ])
  // never wider than the entry
  for (const info of treesOf('en')) {
    for (const recording of [null, 'recording', 'paused'] as const) {
      for (let width = 1; width <= 80; width++) expect(lineWidth(entryFirst(info, entry({ width, recording }))), `${info.name} ${String(recording)} ${width}`).toBeLessThanOrEqual(width)
    }
  }
})

test('entry: in Chinese the counts are Chinese and the words of the tool stay English', () => {
  const [main, crdt] = treesOf('zh') as [DtTreeInfo, DtTreeInfo]
  expect(first(main, { lang: 'zh', recording: 'recording', decW: 9 })).toBe('● main         17 个决定  6 steps            ● 记录中  HH:MM')
  expect(first(main, { lang: 'zh', recording: 'paused', decW: 9 })).toBe('● main         17 个决定  6 steps            ● 已暂停  HH:MM')
  expect(first(crdt, { lang: 'zh', decW: 9 })).toBe('● crdt-engine   9 个决定  5 steps               model  HH:MM')
  for (let width = 1; width <= 80; width++) expect(lineWidth(entryFirst(main, entry({ width, lang: 'zh', recording: 'recording', decW: 9 }))), `${width}`).toBeLessThanOrEqual(width)
})

const second = (info: DtTreeInfo, over: { width?: number; lang?: DtLang; ascii?: boolean; tm?: Parameters<typeof localizer>[0] } = {}) => {
  const lang = over.lang ?? 'en'
  const line = entrySecond(info, { width: over.width ?? 70, lang, ascii: over.ascii ?? false, laneOf: () => 'merged', loc: localizer(over.tm ?? EMPTY_TM, lang) })
  return line === null ? null : lineText(line)
}

test('entry: the second line says where a tree was opened from and what it is for; the first tree only says what it is for', () => {
  const [main, crdt, cloud] = treesOf('en') as [DtTreeInfo, DtTreeInfo, DtTreeInfo]
  // (the first tree has no title of its own: it says what its oldest step says)
  expect(second(main)).toBe('  Notes app: offline-first rewrite for the spring release')
  expect(second(crdt)).toBe('  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge')
  expect(second(cloud)).toBe('  ↳ main #3 (09-14)   Server-first sync, offline later')
  expect(second(crdt, { ascii: true })).toBe('  > main #5 (09-21)   CRDT text engine instead of paragraph merge')
  // cut to the room it has
  expect(second(crdt, { width: 40 })).toBe('  ↳ main #5 (09-21)   CRDT text engine …')
  expect(second(main, { width: 12 })).toBe('  Notes app…')
  expect(second(main, { width: 3 })).toBe('  …')
  // nothing to say: no line
  expect(second({ ...main, title: null })).toBeNull()
  // a tree opened from nothing says so, and still says what it is for
  expect(second({ ...crdt, fork: { tree: 'main', at: null, count: 0 } }, { width: 70 })).toBe('  ↳ started empty   CRDT text engine instead of paragraph merge')
  for (const info of treesOf('en')) for (let width = 3; width <= 90; width++) expect(lineWidth(entrySecond(info, { width, lang: 'en', ascii: false, laneOf: () => 'merged', loc: localizer(EMPTY_TM, 'en') }) ?? []), `${info.name} ${width}`).toBeLessThanOrEqual(width)
})

test('entry: a title that has not been rendered yet is shown as written, with the mark of its language, until the rendition comes', () => {
  const [main, crdt] = treesOf('zh') as [DtTreeInfo, DtTreeInfo]
  expect(second(main)).toBe('  笔记 app：为春季版本做离线优先的重写 中')
  expect(second(crdt)).toBe('  ↳ main #5 (09-21)   用 CRDT 文本引擎代替按段落合并 中')
  // with the rendition, it reads in the language of the pane, with no mark
  expect(second(main, { tm: notesTm('zh') })).toBe('  Notes app: offline-first rewrite for the spring release')
  expect(second(crdt, { tm: notesTm('zh') })).toBe('  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge')
  // and the other way round
  const [mainEn, crdtEn] = treesOf('en') as [DtTreeInfo, DtTreeInfo]
  expect(second(mainEn, { lang: 'zh' })).toBe('  Notes app: offline-first rewrite for the spring release EN')
  expect(second(crdtEn, { lang: 'zh' })).toBe('  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge EN')
})

// ---------------------------------------------------------------- the whole overview

const WIDTHS = [16, 20, 24, 30, 36, 44, 52, 60, 72, 80, 100, 132]
const ROWS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 34, 40, 60]

const NEW_TREE = { name: 'try-it', at: '', title: '', error: null }

/** Every state the overview can be in, as a function of the language it is drawn in. */
const STATES: Record<string, (lang: DtLang) => Partial<PaneInput>> = {
  sample: lang => ({ lang, trees: treesOf(lang) }),
  recorded: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees' }) }),
  last: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees', pick: 'cloud-first' }) }),
  viewing: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees', tree: 'cloud-first', pick: null }) }),
  stray: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees', pick: 'no-such-tree' }) }),
  single: lang => ({ lang, trees: treesOf(lang).slice(0, 1), ui: ui({ view: 'trees' }) }),
  none: lang => ({ lang, trees: [] }),
  paused: lang => ({ lang, trees: treesOf(lang), project: projectOf({ mode: 'paused' }) }),
  foreign: lang => ({ lang, trees: treesOf(other(lang)), translating: 9 }),
  translated: lang => ({ lang, trees: treesOf(other(lang)), tm: notesTm(other(lang)) }),
  forming: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees', pick: 'cloud-first', newTree: NEW_TREE }) }),
  failing: lang => ({ lang, trees: treesOf(lang), ui: ui({ view: 'trees', newTree: { name: 'try it', at: '#99', title: 'x', error: 'There is no version #99 in main (it has 17).' } }) }),
  many: lang => ({ lang, trees: manyTrees(12, lang), ui: ui({ view: 'trees', pick: 'try-07' }) }),
  manyForming: lang => ({ lang, trees: manyTrees(12, lang), ui: ui({ view: 'trees', pick: 'try-07', newTree: NEW_TREE }) }),
  crowd: lang => ({ lang, trees: manyTrees(45, lang), ui: ui({ view: 'trees', pick: 'try-33' }) }),
  mobile: lang => ({ lang, trees: treesOf(lang), canEdit: false }),
  pinned: lang => ({ lang, trees: treesOf(lang), pin: true }),
}

// One test for each state, so that a failure names the state and none of them is slow.
for (const [name, state] of Object.entries(STATES)) {
  test(`overview sizes: ${name} is never wider than its width or taller than its rows, in either language and in ASCII`, { timeoutMs: 60000 }, () => {
    for (const lang of ['en', 'zh'] as DtLang[]) {
      for (const ascii of [false, true]) {
        for (const width of WIDTHS) {
          if (ascii && width % 8 !== 4 && width !== 16 && width !== 100) continue
          for (const rows of ROWS) {
            const i = overviewInput({ ...state(lang), width, rows, ascii })
            checkOverview(layoutPane(i), i, `${name}/${lang}${ascii ? '/ascii' : ''}/${width}x${rows}`)
          }
        }
      }
    }
  })
}

test('overview sizes: a docked pane has its keys on its last rows once it has the rows for them', { timeoutMs: 60000 }, () => {
  for (const [name, state] of Object.entries(STATES)) {
    for (const lang of ['en', 'zh'] as DtLang[]) {
      for (const width of [30, 60, 100]) {
        for (const rows of [4, 6, 8, 10, 12, 16, 24, 40, 60]) {
          const i = overviewInput({ ...state(lang), width, rows, pin: true })
          checkOverview(layoutPane(i), i, `${name}/${lang}/${width}x${rows}/docked`)
        }
      }
    }
  }
})

// ---------------------------------------------------------------- whole screens

/** What the pane draws for the input, a line to a string, the clock masked (it is the time of the machine the test runs on). */
const shown = (over: Partial<PaneInput>) => textOf(layoutPane(overviewInput(over))).map(l => l.replace(/\d\d:\d\d/g, 'HH:MM'))

test('screen: with room to spare the pane has the strip, every tree in one graph, the trees in a frame and the keys', () => {
  expect(shown({ width: 100, rows: 40 })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                                             EN  中',
    '  3 trees                                                       ● recording in main   updated HH:MM',
    '',
    '  ●        Notes app: offline-first rewrite for the spring release                     main  09-02',
    '  ┃',
    '  ●━━━━━┓  Storage: SQLite with a write-ahead log, no more JSON files                  main  09-14',
    '  ┃     ┃',
    '  ┃     ●  Sync: the server owns the data, phones keep a cache                  cloud-first  09-16',
    '  ┃     ┃',
    '  ●━━┓  ┃  Sync: clients send operations, the server decides their order               main  09-21',
    '  ┃  ┃  ┃',
    '  ┃  ┃  ◉  Offline editing comes later; a read-only cache until then            cloud-first  09-22',
    '  ┃  ┃',
    '▌ ┃  ◉     CRDT text engine: merge by character, no conflict screen             crdt-engine  09-28',
    '  ┃  ╏',
    '  ●  ╏     Conflicts: merge by paragraph, last edit wins for titles                    main  10-01',
    '  ┃  ╏',
    '  ◉  ╏     Offline queue: at most 5,000 operations per note                            main  10-06',
    '  ╏  ╏',
    '  ○  ╏     Beta to 500 testers once the soak test passes                               main  10-06',
    '     ╏',
    '▌    ○     Keep it only if cold start stays under 2 s                           crdt-engine  10-07',
    '',
    '  ╭─ Trees ─────────────────────────────────────────────────────────────────────────────── 2 / 3 ─╮',
    '  │                                                                                               │',
    '  │ ● main         17 decisions  6 steps                                       ● recording  HH:MM │',
    '  │   Notes app: offline-first rewrite for the spring release                                     │',
    '  │                                                                                               │',
    '  │▌● crdt-engine   9 decisions  5 steps                                             model  HH:MM │',
    '  │▌  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge                             │',
    '  │                                                                                               │',
    '  │ ● cloud-first   6 decisions  4 steps                                              user  09-22 │',
    '  │   ↳ main #3 (09-14)   Server-first sync, offline later                                        │',
    '  ╰───────────────────────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back                                   l: 中',
  ])
})

test('screen: in Chinese the counts and the ordinary words are Chinese, and the names of things stay English', () => {
  expect(shown({ width: 72, rows: 30, lang: 'zh' })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                 EN  中',
    '  3 个 tree                                ● 正记录到 main   HH:MM 更新',
    '',
    '  ●        笔记 app：为春季版本做离线优先的重写            main  09-02',
    '  ●━━━━━┓  存储：SQLite 加预写日志，不再用 JSON …          main  09-14',
    '  ┃     ●  同步：数据归服务器，手机只留缓存         cloud-first  09-16',
    '  ●━━┓  ┃  同步：客户端发操作，由服务器决定顺序            main  09-21',
    '  ┃  ┃  ◉  离线编辑以后再做；在那之前缓存只读       cloud-first  09-22',
    '▌ ┃  ◉     CRDT 文本引擎：按字符合并，不再有冲突…   crdt-engine  09-28',
    '  ●  ╏     冲突：按段落合并，标题以最后一次编辑为…         main  10-01',
    '  ◉  ╏     离线队列：每条笔记最多 5,000 个操作             main  10-06',
    '  ○  ╏     浸泡测试通过后，向 500 名测试者开放 be…         main  10-06',
    '▌    ○     冷启动不超过 2 秒才保留                  crdt-engine  10-07',
    '',
    '  ╭─ Trees ─────────────────────────────────────────────────── 2 / 3 ─╮',
    '  │                                                                   │',
    '  │ ● main         17 个决定  6 steps                 ● 记录中  HH:MM │',
    '  │   笔记 app：为春季版本做离线优先的重写                            │',
    '  │                                                                   │',
    '  │▌● crdt-engine   9 个决定  5 steps                    model  HH:MM │',
    '  │▌  ↳ main #5 (09-21)   用 CRDT 文本引擎代替按段落合并              │',
    '  │                                                                   │',
    '  │ ● cloud-first   6 个决定  4 steps                     user  09-22 │',
    '  │   ↳ main #3 (09-14)   服务器优先的同步，离线以后再做              │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: 打开  r: 记到这里  n: 新 tree  t: 返回           l: EN',
  ])
})

test('screen: with fewer rows the graph is cut to the picked tree, counting what it leaves out, and the list loses its blank lines', () => {
  expect(shown({ width: 60, rows: 16 })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first     EN  中',
    '  3 trees               ● recording in main   updated HH:MM',
    '  ▲ 4 more above',
    '  ┃  ┃  ◉  Offline editing comes late…  cloud-first  09-22',
    '▌ ┃  ◉     CRDT text engine: merge by…  crdt-engine  09-28',
    '  ●  ╏     Conflicts: merge by paragr…         main  10-01',
    '  ◉  ╏     Offline queue: at most 5,0…         main  10-06',
    '  ○  ╏     Beta to 500 testers once t…         main  10-06',
    '▌    ○     Keep it only if cold start…  crdt-engine  10-07',
    '  ╭─ Trees ─────────────────────────────────────── 2 / 3 ─╮',
    '  │ ● main         17 decisions  6 steps         ●  HH:MM │',
    '  │▌● crdt-engine   9 decisions  5 steps     model  HH:MM │',
    '  │ ● cloud-first   6 decisions  4 steps      user  09-22 │',
    '  ╰───────────────────────────────────────────────────────╯',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree    l: 中',
    '  t: back',
  ])
})

test('screen: in a narrow pane the tabs shorten, the dates stay, the list is bare, and the keys take two lines', () => {
  expect(shown({ width: 44, rows: 12 })).toEqual([
    '  notes-app   …   crdt-engine   …    EN  中',
    '  3 trees               ● recording in main',
    '  ▲ 6 more above',
    '  ●  ╏     Conflicts: merge by par…  10-01',
    '  ◉  ╏     Offline queue: at most …  10-06',
    '  ○  ╏     Beta to 500 testers onc…  10-06',
    '▌    ○     Keep it only if cold st…  10-07',
    '  ● main         17 decisions  6 steps    ●',
    '▌ ● crdt-engine   9 decisions  5 steps',
    '  ● cloud-first   6 decisions  4 steps',
    '  k: ↑  j: ↓  ⏎: open                 l: 中',
    '  r: record here  n: new tree  t: back',
  ])
})

test('screen: in 30 columns and 8 rows there is no graph, and the frame stays with a line for each tree', () => {
  expect(shown({ width: 30, rows: 8 })).toEqual([
    '  notes-app   crdt-e…  EN  中',
    '  3 trees         ● recording',
    '  ╭─ Trees ───────── 2 / 3 ─╮',
    '  │ ● main         ●  HH:MM │',
    '  │▌● crdt-engine     HH:MM │',
    '  │ ● cloud-first     09-22 │',
    '  ╰─────────────────────────╯',
    '  k: ↑  j: ↓  ⏎: open',
  ])
})

test('screen: in 24 columns and 6 rows the frame goes too', () => {
  expect(shown({ width: 24, rows: 6 })).toEqual([
    '  notes-app      EN  中',
    '  3 trees   ● recording',
    '  ● main              ●',
    '▌ ● crdt-engine   HH:MM',
    '  ● cloud-first   09-22',
    '  k: ↑  j: ↓  ⏎: open',
  ])
})

test('screen: in 16 columns and 3 rows the pane keeps its four lines, the least it needs to be used', () => {
  expect(shown({ width: 16, rows: 3 })).toEqual([
    '  note…  EN  中',
    '  3 trees     ●',
    '▌ ● crdt-engine',
    '  k: ↑  j: ↓',
  ])
})

test('screen: one tree has one lane, and every step of it is the picked one', () => {
  expect(shown({ width: 80, rows: 24, trees: treesOf('en').slice(0, 1), ui: ui({ view: 'trees' }) })).toEqual([
    '  notes-app                                                              EN  中',
    '  1 tree                                    ● recording in main   updated HH:MM',
    '',
    '▌ ●  Notes app: offline-first rewrite for the spring release       main  09-02',
    '  ┃',
    '▌ ●  Storage: SQLite with a write-ahead log, no more JSON files    main  09-14',
    '  ┃',
    '▌ ●  Sync: clients send operations, the server decides their ord…  main  09-21',
    '  ┃',
    '▌ ●  Conflicts: merge by paragraph, last edit wins for titles      main  10-01',
    '  ┃',
    '▌ ◉  Offline queue: at most 5,000 operations per note              main  10-06',
    '  ╏',
    '▌ ○  Beta to 500 testers once the soak test passes                 main  10-06',
    '',
    '  ╭─ Trees ─────────────────────────────────────────────────────────── 1 / 1 ─╮',
    '  │                                                                           │',
    '  │▌● main  17 decisions  6 steps                          ● recording  HH:MM │',
    '  │▌  Notes app: offline-first rewrite for the spring release                 │',
    '  ╰───────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back               l: 中',
  ])
})

test('screen: while recording is paused the tree recorded into says so, in the strip and in the list', () => {
  expect(shown({ width: 80, rows: 24, project: projectOf({ mode: 'paused' }), ui: ui({ view: 'trees' }) })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                         EN  中',
    '  3 trees                                              ● paused   updated HH:MM',
    '',
    '  ▲ 3 more above',
    '▌ ●━━┓  ┃  Sync: clients send operations, the server deci…         main  09-21',
    '  ┃  ┃  ◉  Offline editing comes later; a read-only cache…  cloud-first  09-22',
    '  ┃  ◉     CRDT text engine: merge by character, no confl…  crdt-engine  09-28',
    '▌ ●  ╏     Conflicts: merge by paragraph, last edit wins …         main  10-01',
    '▌ ◉  ╏     Offline queue: at most 5,000 operations per no…         main  10-06',
    '▌ ○  ╏     Beta to 500 testers once the soak test passes           main  10-06',
    '  ▼ 1 more below',
    '',
    '  ╭─ Trees ─────────────────────────────────────────────────────────── 1 / 3 ─╮',
    '  │▌● main         17 decisions  6 steps                      ● paused  HH:MM │',
    '  │▌  Notes app: offline-first rewrite for the spring release                 │',
    '  │                                                                           │',
    '  │ ● crdt-engine   9 decisions  5 steps                         model  HH:MM │',
    '  │   ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge         │',
    '  │                                                                           │',
    '  │ ● cloud-first   6 decisions  4 steps                          user  09-22 │',
    '  │   ↳ main #3 (09-14)   Server-first sync, offline later                    │',
    '  ╰───────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back               l: 中',
  ])
})

test('screen: with the form for a new tree open the list gives its place to the form, and the keys are those of the form', () => {
  expect(shown({ width: 80, rows: 30, ui: ui({ view: 'trees', newTree: { name: '', at: '', title: '', error: null } }) })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                         EN  中',
    '  3 trees                                   ● recording in main   updated HH:MM',
    '',
    '▌ ●        Notes app: offline-first rewrite for the sprin…         main  09-02',
    '▌ ●━━━━━┓  Storage: SQLite with a write-ahead log, no mor…         main  09-14',
    '  ┃     ●  Sync: the server owns the data, phones keep a …  cloud-first  09-16',
    '▌ ●━━┓  ┃  Sync: clients send operations, the server deci…         main  09-21',
    '  ┃  ┃  ◉  Offline editing comes later; a read-only cache…  cloud-first  09-22',
    '  ┃  ◉     CRDT text engine: merge by character, no confl…  crdt-engine  09-28',
    '▌ ●  ╏     Conflicts: merge by paragraph, last edit wins …         main  10-01',
    '▌ ◉  ╏     Offline queue: at most 5,000 operations per no…         main  10-06',
    '▌ ○  ╏     Beta to 500 testers once the soak test passes           main  10-06',
    '     ○     Keep it only if cold start stays under 2 s       crdt-engine  10-07',
    '',
    '  ─────────────────────────────────────────────────────────────────────────────',
    '  New tree   Opens from main',
    '',
    '  ⏎: create                                                               l: 中',
  ])
})

test('screen: in ASCII every glyph is one column, and the arrows are spelled out', () => {
  expect(shown({ width: 60, rows: 20, ascii: true, ui: ui({ view: 'trees' }) })).toEqual([
    '  notes-app   main *   crdt-engine   cloud-first     EN  中',
    '  3 trees               * recording in main   updated HH:MM',
    '',
    '  ^ 3 more above',
    '> *--+  |  Sync: clients send operati…         main  09-21',
    '  |  |  @  Offline editing comes late…  cloud-first  09-22',
    '  |  @     CRDT text engine: merge by…  crdt-engine  09-28',
    '> *  :     Conflicts: merge by paragr…         main  10-01',
    '> @  :     Offline queue: at most 5,0…         main  10-06',
    '> o  :     Beta to 500 testers once t…         main  10-06',
    '  v 1 more below',
    '',
    '  +- Trees --------------------------------------- 1 / 3 -+',
    '  |>* main         17 decisions  6 steps         *  HH:MM |',
    '  | * crdt-engine   9 decisions  5 steps     model  HH:MM |',
    '  | * cloud-first   6 decisions  4 steps      user  09-22 |',
    '  +-------------------------------------------------------+',
    '',
    '  k: up  j: down  Enter: open  r: record here         l: 中',
    '  n: new tree  t: back',
  ])
})

test('screen: trees written in Chinese, in an English pane: each text is shown as written with the mark of its language, and the strip counts the renditions on the way', () => {
  expect(shown({ width: 90, rows: 30, trees: treesOf('zh'), translating: 9 })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                 ◌ translating 9   EN  中',
    '  3 trees                                             ● recording in main   updated HH:MM',
    '',
    '  ●        笔记 app：为春季版本做离线优先的重写 中                           main  09-02',
    '  ●━━━━━┓  存储：SQLite 加预写日志，不再用 JSON 文件 中                      main  09-14',
    '  ┃     ●  同步：数据归服务器，手机只留缓存 中                        cloud-first  09-16',
    '  ●━━┓  ┃  同步：客户端发操作，由服务器决定顺序 中                           main  09-21',
    '  ┃  ┃  ◉  离线编辑以后再做；在那之前缓存只读 中                      cloud-first  09-22',
    '▌ ┃  ◉     CRDT 文本引擎：按字符合并，不再有冲突界面 中               crdt-engine  09-28',
    '  ●  ╏     冲突：按段落合并，标题以最后一次编辑为准 中                       main  10-01',
    '  ◉  ╏     离线队列：每条笔记最多 5,000 个操作 中                            main  10-06',
    '  ○  ╏     浸泡测试通过后，向 500 名测试者开放 beta 中                       main  10-06',
    '▌    ○     冷启动不超过 2 秒才保留 中                                 crdt-engine  10-07',
    '',
    '  ╭─ Trees ───────────────────────────────────────────────────────────────────── 2 / 3 ─╮',
    '  │                                                                                     │',
    '  │ ● main         17 decisions  6 steps                             ● recording  HH:MM │',
    '  │   笔记 app：为春季版本做离线优先的重写 中                                           │',
    '  │                                                                                     │',
    '  │▌● crdt-engine   9 decisions  5 steps                                   model  HH:MM │',
    '  │▌  ↳ main #5 (09-21)   用 CRDT 文本引擎代替按段落合并 中                             │',
    '  │                                                                                     │',
    '  │ ● cloud-first   6 decisions  4 steps                                    user  09-22 │',
    '  │   ↳ main #3 (09-14)   服务器优先的同步，离线以后再做 中                             │',
    '  ╰─────────────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back                         l: 中',
  ])
})

test('screen: a text that has its rendition reads in the language of the pane, one that has none keeps its mark', () => {
  expect(shown({ width: 90, rows: 30, trees: treesOf('zh'), tm: notesTm('zh') })).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                                   EN  中',
    '  3 trees                                             ● recording in main   updated HH:MM',
    '',
    '  ●        Notes app: offline-first rewrite for the spring release           main  09-02',
    '  ●━━━━━┓  Storage: SQLite with a write-ahead log, no more JSON fil…         main  09-14',
    '  ┃     ●  Sync: the server owns the data, phones keep a cache        cloud-first  09-16',
    '  ●━━┓  ┃  Sync: clients send operations, the server decides their …         main  09-21',
    '  ┃  ┃  ◉  Offline editing comes later; a read-only cache until then  cloud-first  09-22',
    '▌ ┃  ◉     CRDT 文本引擎：按字符合并，不再有冲突界面 中               crdt-engine  09-28',
    '  ●  ╏     Conflicts: merge by paragraph, last edit wins for titles          main  10-01',
    '  ◉  ╏     Offline queue: at most 5,000 operations per note                  main  10-06',
    '  ○  ╏     Beta to 500 testers once the soak test passes                     main  10-06',
    '▌    ○     冷启动不超过 2 秒才保留 中                                 crdt-engine  10-07',
    '',
    '  ╭─ Trees ───────────────────────────────────────────────────────────────────── 2 / 3 ─╮',
    '  │                                                                                     │',
    '  │ ● main         17 decisions  6 steps                             ● recording  HH:MM │',
    '  │   Notes app: offline-first rewrite for the spring release                           │',
    '  │                                                                                     │',
    '  │▌● crdt-engine   9 decisions  5 steps                                   model  HH:MM │',
    '  │▌  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge                   │',
    '  │                                                                                     │',
    '  │ ● cloud-first   6 decisions  4 steps                                    user  09-22 │',
    '  │   ↳ main #3 (09-14)   Server-first sync, offline later                              │',
    '  ╰─────────────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back                         l: 中',
  ])
})

test('screen: with many trees the graph and the list are windows that keep the picked tree in sight', () => {
  expect(shown({ width: 80, rows: 24, trees: manyTrees(12), ui: ui({ view: 'trees', pick: 'try-07' }) })).toEqual([
    '  notes-app   …   try-07   try-08   try-09   long-experi…   try-11       EN  中',
    '  12 trees                                  ● recording in main   updated HH:MM',
    '',
    '              ┃  ┃  ○     ┃        Variant 5, step 3: batch the writes   10-18',
    '              ◉  ┃        ┃        Variant 6, step 1: shorter timeouts   10-19',
    '▌                ┃        ◉        Variant 7, step 1: a smaller cache    10-22',
    '▌                ┃        ○        Variant 7, step 2: a smaller cache    10-23',
    '',
    '  ╭─ Trees ────────────────────────────────────────────────────────── 8 / 12 ─╮',
    '  │ ● main                  17 decisions  6 steps          ● recording  HH:MM │',
    '  │ ● try-01                10 decisions  6 steps                 user  HH:MM │',
    '  │ ● try-02                12 decisions  7 steps                model  HH:MM │',
    '  │ ● try-03                 6 decisions  4 steps                 user  10-12 │',
    '  │ ● try-04                10 decisions  6 steps                model  10-12 │',
    '  │ ● long-experiment-nam…  12 decisions  7 steps                 user  10-12 │',
    '  │ ● try-06                 8 decisions  5 steps                model  10-11 │',
    '  │▌● try-07                10 decisions  6 steps                 user  10-11 │',
    '  │ ● try-08                12 decisions  7 steps                model  10-11 │',
    '  │ ● try-09                 8 decisions  5 steps                 user  10-11 │',
    '  │ ● long-experiment-nam…  10 decisions  6 steps                model  10-10 │',
    '  │ ● try-11                12 decisions  7 steps                 user  10-10 │',
    '  ╰───────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back               l: 中',
  ])
})

test('screen: with many trees, in Chinese, with the last one picked', () => {
  expect(shown({ width: 60, rows: 20, lang: 'zh', trees: manyTrees(12, 'zh'), ui: ui({ view: 'trees', pick: 'try-11' }) })).toEqual([
    '  notes-app   …   try-09   long-experi…   try-11     EN  中',
    '  12 个 tree                   ● 正记录到 main   HH:MM 更新',
    '',
    '  ╭─ Trees ───────────────────────────────────── 12 / 12 ─╮',
    '  │ ● main                  17 个决定  6 steps   ●  HH:MM │',
    '  │ ● try-01                10 个决定  6 steps      HH:MM │',
    '  │ ● try-02                12 个决定  7 steps      HH:MM │',
    '  │ ● try-03                 6 个决定  4 steps      10-12 │',
    '  │ ● try-04                10 个决定  6 steps      10-12 │',
    '  │ ● long-experiment-nam…  12 个决定  7 steps      10-12 │',
    '  │ ● try-06                 8 个决定  5 steps      10-11 │',
    '  │ ● try-07                10 个决定  6 steps      10-11 │',
    '  │ ● try-08                12 个决定  7 steps      10-11 │',
    '  │ ● try-09                 8 个决定  5 steps      10-11 │',
    '  │ ● long-experiment-nam…  10 个决定  6 steps      10-10 │',
    '  │▌● try-11                12 个决定  7 steps      10-10 │',
    '  ╰───────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: 打开  r: 记到这里  n: 新 tree        l: EN',
    '  t: 返回',
  ])
})

// ---------------------------------------------------------------- what the lines of the overview stand for

type TreeBlock = Extract<Block, { kind: 'tree' }>
const treeBlocks = (layout: PaneLayout): TreeBlock[] => layout.blocks.flatMap(b => (b.kind === 'tree' ? [b] : []))
/** `tree:step:part` (`-` for a line of the list), a star after the ones that are selected. */
const tag = (b: TreeBlock) => `${b.tree}:${b.step ?? '-'}:${b.part}${b.selected ? '*' : ''}`

test('screen: each step of the graph and each line of each entry of the list is a control that names its tree', () => {
  const layout = layoutPane(overviewInput({ width: 100, rows: 40 }))
  expect(treeBlocks(layout).map(tag)).toEqual([
    'main:n0:0',
    'main:n1:0',
    'cloud-first:c1:0',
    'main:n2:0',
    'cloud-first:c2:0',
    'crdt-engine:x1:0*',
    'main:n3:0',
    'main:n16:0',
    'main:n8:0',
    'crdt-engine:x4:0*',
    'main:-:0',
    'main:-:1',
    'crdt-engine:-:0*',
    'crdt-engine:-:1*',
    'cloud-first:-:0',
    'cloud-first:-:1',
  ])
  expect(layout.picked).toBe('crdt-engine')
  expect(layout.listed).toEqual(['main', 'crdt-engine', 'cloud-first'])
  // no step of a tree is selected, and none is drawn as a row of the tree view
  expect(layout.selected).toBeNull()
  expect(layout.drawn).toEqual([])
  // the tree view has none of these
  expect(treeBlocks(layoutPane(input()))).toEqual([])
})

test('screen: the picked tree wears the mark and the background of the selection, the others wear neither', () => {
  const layout = layoutPane(overviewInput({ width: 100, rows: 40 }))
  for (const b of treeBlocks(layout)) {
    const marks = b.line.filter(s => s.text === '▌')
    const lit = b.line.filter(s => s.bg === 'subtle')
    if (!b.selected) {
      expect(marks, tag(b)).toEqual([])
      expect(lit, tag(b)).toEqual([])
      continue
    }
    expect(marks, tag(b)).toEqual([{ text: '▌', color: 'suggestion', bg: 'subtle' }])
    if (b.step !== null) {
      // a step of the graph: the whole line, from the mark to the end
      expect(lit.length, tag(b)).toBe(b.line.length)
      expect(lineWidth(b.line), tag(b)).toBe(100)
    } else {
      // a line of the list: what is between the sides of the frame, which keep their own look
      expect(lineText(lit), tag(b)).toMatch(b.part === 0 ? /^▌● crdt-engine +9 decisions +5 steps +model +\d\d:\d\d $/ : /^▌ +↳ main #5 \(09-21\) +CRDT text engine instead of paragraph merge +$/)
      expect(lineText(b.line.slice(0, 2)), tag(b)).toBe('  │')
      expect(lineText(b.line.slice(-1)), tag(b)).toBe('│')
    }
  }
})

test('screen: the dot of a tree in the graph and in the list wears the colour of its lane, and the name at the end of a step the colour of its tree', () => {
  const layout = layoutPane(overviewInput({ width: 100, rows: 40 }))
  const colourOfLane = (tree: string) => {
    const dot = treeBlocks(layout).find(b => b.tree === tree && b.step === null && b.part === 0)!.line.find(s => s.text === '●')!
    return dot.color
  }
  const lanes = ['main', 'crdt-engine', 'cloud-first'].map(colourOfLane)
  expect(new Set(lanes).size).toBe(3)
  for (const b of treeBlocks(layout).filter(x => x.step !== null)) {
    const name = b.line.find(s => s.text.trim() === b.tree)
    expect(name, tag(b)).toBeDefined()
    expect(name!.color, tag(b)).toBe(colourOfLane(b.tree))
    expect(name!.dim, tag(b)).toBe(true)
  }
})

test('screen: the marks go to the picked tree; with none picked, to the tree being viewed; with that one gone, to the tree recorded into', () => {
  const marked = (over: Partial<PaneInput>) => {
    const layout = layoutPane(overviewInput(over))
    return { picked: layout.picked, marked: [...new Set(treeBlocks(layout).filter(b => b.selected).map(b => b.tree))] }
  }
  const view = (over: object) => ui({ view: 'trees', ...over })
  expect(marked({ ui: view({ pick: 'cloud-first' }) })).toEqual({ picked: 'cloud-first', marked: ['cloud-first'] })
  expect(marked({ ui: view({ pick: null, tree: 'cloud-first' }) })).toEqual({ picked: 'cloud-first', marked: ['cloud-first'] })
  expect(marked({ ui: view({ pick: null, tree: null }) })).toEqual({ picked: 'main', marked: ['main'] })
  expect(marked({ ui: view({ pick: 'gone', tree: null }) })).toEqual({ picked: 'main', marked: ['main'] })
  expect(marked({ ui: view({ pick: null, tree: 'gone' }) })).toEqual({ picked: 'main', marked: ['main'] })
  // the tree recorded into is not among them either: the first there is
  expect(marked({ trees: treesOf('en').slice(1), ui: view({ pick: 'gone' }) })).toEqual({ picked: 'crdt-engine', marked: ['crdt-engine'] })
  // and with no tree at all, nothing is picked
  expect(marked({ trees: [], ui: view({ pick: 'gone' }) })).toEqual({ picked: null, marked: [] })
})

test('screen: where nothing can be typed there is no key for a new tree, and with recording off there is no overview', () => {
  const text = (over: Partial<PaneInput>) => textOf(layoutPane(overviewInput({ width: 100, rows: 40, ...over }))).join('\n')
  expect(text({})).toContain('n: new tree')
  expect(text({ canEdit: false })).not.toContain('new tree')
  expect(text({ canEdit: false })).toContain('r: record here')
  const off = layoutPane(overviewInput({ project: projectOf({ mode: 'off', config: null }) }))
  expect(off.picked).toBeNull()
  expect(treeBlocks(off)).toEqual([])
  expect(textOf(off).join('\n')).not.toContain('Trees')
})
