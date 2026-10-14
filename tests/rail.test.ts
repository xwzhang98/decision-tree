import { expect, test } from 'claude-code/testing'

import { EDGE } from '../lib/style'
import { indentPlan, isRecent, railLine, rowNote, spacerLine } from '../lib/rail'
import type { RailLineOptions } from '../lib/rail'
import { lineText, lineWidth } from '../lib/spans'
import { EMPTY_UI } from '../lib/state'
import { buildIndex, visibleRows } from '../lib/tree'
import type { Row } from '../lib/tree'
import type { DtLang, DtNode, DtUi } from '../types'
import { node } from './fixture'
import { NOW, iso, notesModel } from './notes'

const model = notesModel('en')
const IDX = buildIndex(model)
const rowsFor = (ui: Partial<DtUi> = {}, idx = IDX): Row[] => visibleRows(idx, { ui: { ...EMPTY_UI, ...ui }, nowMs: NOW })
const rowOf = (id: string, ui: Partial<DtUi> = {}): Row => rowsFor(ui).find(r => r.node.id === id)!

function opts(row: Row, over: Partial<RailLineOptions> = {}): RailLineOptions {
  return { width: 80, selected: false, ascii: false, lang: 'en', nowMs: NOW, title: row.node.title, mark: null, step: 3, ...over }
}
const lineOf = (id: string, over: Partial<RailLineOptions> = {}, ui: Partial<DtUi> = {}) => {
  const row = rowOf(id, ui)
  return railLine(row, opts(row, over))
}
const textOf = (id: string, over: Partial<RailLineOptions> = {}, ui: Partial<DtUi> = {}) => lineText(lineOf(id, over, ui))

test('rail: a step is a dot, a title and the day it was decided; a branch hangs from the spine', () => {
  // the room between a title and the day is blanks; what matters is where each part starts and ends
  expect(textOf('n0')).toMatch(/^ {2}● {2}Notes app: offline-first rewrite for the spring release {2,}09-02 {2}$/)
  expect(textOf('n1')).toMatch(/^ {2}● {2}Storage: SQLite with a write-ahead log, no more JSON files {2,}09-14 {2}$/)
  // a branch: the fork, a dash, the glyph of its status and its title; no day
  expect(textOf('n14').trimEnd()).toBe('  ┠─ ✗ Keep JSON files and add a lock file')
  expect(textOf('n12').trimEnd()).toBe('  ┠─ ‖ Desktop client: after the spring release')
  expect(textOf('n11').trimEnd()).toBe('  ┠─ ⊘ Compress operations before sending')
  expect(textOf('n5').trimEnd()).toBe('  ┠─ = Merge window of 5 s instead of 10 s')
  // a branch of a branch hangs under the spine's continuation, one elbow in
  expect(textOf('n15').trimEnd()).toBe('  ┃  ╰─ ◌ Title conflicts: show both versions and let the person pick')
  // the last step's branches close the spine
  expect(textOf('n9').trimEnd()).toBe('  ┠─ ○ Soak test: three older phones, one week offline')
  expect(textOf('n10').trimEnd()).toBe('  ┖─ ◌ Staged rollout: 5% first, then a quarter, then everyone')
  // every line is one column short of the edge
  for (const id of ['n0', 'n12', 'n3', 'n15', 'n10']) expect(lineWidth(lineOf(id))).toBe(80 - EDGE)
})

test('rail: the newest step adopted is the head, a step still ahead is hollow, and the way to it is dashed', () => {
  expect(textOf('n16')).toMatch(/^ {2}◉ {2}Offline queue: at most 5,000 operations per note {2,}10-06 {2}$/)
  expect(textOf('n8')).toMatch(/^ {2}○ {2}Beta to 500 testers once the soak test passes {2,}10-06 {2}$/)
  const head = rowOf('n16')
  expect(head.rail).toMatchObject({ step: true, head: true, ahead: true })
  expect(lineOf('n16').find(s => s.text === '◉')).toEqual({ text: '◉', color: 'merged', bold: true })
  // the hollow one is quiet
  expect(lineOf('n8').find(s => s.text === '○')).toEqual({ text: '○', color: 'merged', dim: true })
  // the line of spine between two steps: solid once the way is done, dashed on the way to a step ahead
  expect(spacerLine(false, { ascii: false })).toEqual([{ text: '  ' }, { text: '┃', color: 'merged' }])
  expect(spacerLine(true, { ascii: false })).toEqual([{ text: '  ' }, { text: '╏', color: 'merged', dim: true }])
  expect(lineText(spacerLine(false, { ascii: true }))).toBe('  |')
  expect(lineText(spacerLine(true, { ascii: true }))).toBe('  :')
  // a branch of the step ahead keeps the spine beside it dashed too; one of a done step keeps it solid
  const deeper = lineOf('n15').find(s => s.text === '┃')
  expect(deeper).toEqual({ text: '┃', color: 'merged' })
})

test('rail: the glyph of a status keeps its colour, a step\'s title is bold when it is adopted, a finished matter is dim', () => {
  const step = lineOf('n3')
  expect(step.find(s => s.text === '●')!.color).toBe('merged')
  // the title is coloured by what it holds (a topic before a colon), and all of it is bold
  expect(step.filter(s => s.text.startsWith('Conflicts') || s.text.includes('merge by paragraph')).every(s => s.bold === true)).toBe(true)
  const rejected = lineOf('n14')
  expect(rejected.find(s => s.text === '✗')!.color).toBe('error')
  expect(rejected.filter(s => s.text.includes('Keep JSON')).every(s => s.dim === true)).toBe(true)
  const adopted = lineOf('n13')
  expect(adopted.find(s => s.text === '✓')!.color).toBe('success')
  expect(adopted.some(s => s.dim === true && s.text.includes('Release bar'))).toBe(false)
  const planned = lineOf('n9')
  expect(planned.find(s => s.text === '○')!.color).toBe('suggestion')
  const proposed = lineOf('n10')
  expect(proposed.find(s => s.text === '◌')).toMatchObject({ color: 'suggestion', dim: true })
})

test('rail: a node changed in the last day ends in a bullet', () => {
  // n13 changed 3 hours ago, n3 six hours ago, n12 five days ago
  expect(textOf('n13').endsWith('•')).toBe(true)
  expect(textOf('n3').endsWith('•')).toBe(true)
  expect(textOf('n12').endsWith('•')).toBe(false)
  expect(lineOf('n13').at(-1)).toEqual({ text: '•', color: 'suggestion' })
  const at = (hours: number): DtNode => ({ ...model.nodes[0]!, updatedAt: iso(NOW - hours * 3600 * 1000) })
  expect(isRecent(at(0), NOW)).toBe(true)
  expect(isRecent(at(23), NOW)).toBe(true)
  expect(isRecent(at(25), NOW)).toBe(false)
  expect(isRecent(at(-23), NOW)).toBe(true) // a clock a little ahead of ours
  expect(isRecent(at(-30), NOW)).toBe(false)
  expect(isRecent({ ...at(1), updatedAt: 'not a time' }, NOW)).toBe(false)
  expect(textOf('n13', { ascii: true }).endsWith('*')).toBe(true)
})

test('rail: the selected row is a bar from edge to edge: a mark, a background, and the title in bold', () => {
  const bar = lineOf('n12', { selected: true })
  expect(lineWidth(bar)).toBe(80)
  expect(bar[0]).toEqual({ text: '▌', color: 'suggestion', bg: 'subtle' })
  expect(bar.every(s => s.bg === 'subtle')).toBe(true)
  expect(lineText(bar).trimEnd()).toBe('▌ ┠─ ‖ Desktop client: after the spring release')
  // a finished matter is not dim once it is selected
  const rejected = lineOf('n14', { selected: true })
  expect(rejected.filter(s => s.text.includes('Keep JSON')).some(s => s.dim === true)).toBe(false)
  // a step keeps its dot, its title and its day on the bar
  expect(lineText(lineOf('n3', { selected: true })).startsWith('▌ ●  Conflicts: merge by paragraph')).toBe(true)
  // ASCII: a plain mark
  expect(textOf('n12', { selected: true, ascii: true }).trimEnd()).toBe('> |- " Desktop client: after the spring release')
})

test('rail: a title still waiting for its rendition is grey, with the mark of the language it is in', () => {
  const row = rowOf('n12')
  const line = railLine(row, opts(row, { title: '桌面客户端：春季版本之后再做', mark: '中' }))
  expect(lineText(line).trimEnd()).toBe('  ┠─ ‖ 桌面客户端：春季版本之后再做 中')
  expect(line.find(s => s.text === '桌面客户端：春季版本之后再做')).toEqual({ text: '桌面客户端：春季版本之后再做', color: 'inactive' })
  expect(line.find(s => s.text === '中')).toMatchObject({ color: 'inactive', dim: true })
  // a step too
  const step = rowOf('n0')
  expect(lineText(railLine(step, opts(step, { title: '笔记 app', mark: '中' }))).startsWith('  ●  笔记 app 中')).toBe(true)
})

test('rail: ASCII mode draws plain characters only', () => {
  const rows = rowsFor({ filter: 'all' })
  for (const row of rows) {
    const text = lineText(railLine(row, opts(row, { ascii: true })))
    expect(/^[\x20-\x7e]+$/.test(text), JSON.stringify(text)).toBe(true)
  }
  expect(textOf('n0', { ascii: true }).startsWith('  *  Notes app')).toBe(true)
  expect(textOf('n16', { ascii: true }).startsWith('  @  Offline queue')).toBe(true)
  expect(textOf('n8', { ascii: true }).startsWith('  o  Beta to 500')).toBe(true)
  expect(textOf('n14', { ascii: true }).trimEnd()).toBe('  |- x Keep JSON files and add a lock file')
  expect(textOf('n15', { ascii: true }).trimEnd()).toBe('  |  `- ? Title conflicts: show both versions and let the person pick')
  expect(textOf('n10', { ascii: true }).trimEnd()).toBe('  `- ? Staged rollout: 5% first, then a quarter, then everyone')
})

test('rail: indentation is three columns a level, fewer when the tree is too deep for that, and the title keeps its room', () => {
  const chain = Array.from({ length: 30 }, (_, k) => node(`c${k}`, k === 0 ? null : `c${k - 1}`, { title: `step ${k}`, trunk: k === 0 }))
  const rows = visibleRows(buildIndex({ nodes: chain }), { ui: { ...EMPTY_UI, filter: 'all' }, nowMs: NOW })
  expect(rows.map(r => r.depth)).toEqual(Array.from({ length: 30 }, (_, k) => k))
  // a shallow tree is three columns a level in any pane
  expect(indentPlan(rows.slice(0, 3), 40)).toEqual({ step: 3 })
  expect(indentPlan([], 40)).toEqual({ step: 3 })
  expect(indentPlan(rows.slice(0, 12), 80)).toEqual({ step: 3 })
  // deeper: two columns, then one, then none
  expect(indentPlan(rows.slice(0, 20), 80).step).toBe(2)
  expect(indentPlan(rows, 80).step).toBe(1)
  expect(indentPlan(rows, 40).step).toBe(0)
  // the deepest row of a narrow pane still shows its title, and every row fits
  for (const width of [30, 40, 60, 80, 120]) {
    const plan = indentPlan(rows, width)
    const last = rows[29]!
    const text = lineText(railLine(last, opts(last, { width, step: plan.step })))
    expect(text, `${width}`).toContain('step 29')
    for (const r of rows) expect(lineWidth(railLine(r, opts(r, { width, step: plan.step }))) <= width - EDGE).toBe(true)
  }
})

test('rail: the end of a row says how many rows are folded in it, and that it was retracted', () => {
  const folded = rowOf('n3', { collapsed: ['n3'] })
  expect(folded.hiddenKids).toBe(4)
  expect(rowNote(folded, 'en')).toBe('+4')
  expect(rowNote(folded, 'zh')).toBe('+4')
  expect(textOf('n3', {}, { collapsed: ['n3'] })).toMatch(/Conflicts: merge by paragraph, last edit wins for titles {2,}\+4 {2}10-01 •$/)
  // a node with nothing folded has no note
  expect(rowNote(rowOf('n12'), 'en')).toBe('')
  // a retracted node (shown under "all") says so, in the language of the pane
  const retracted = { ...model, nodes: model.nodes.map(n => (n.id === 'n12' ? { ...n, retracted: { ts: iso(NOW), actor: 'user' as const } } : n)) }
  const rows = rowsFor({ filter: 'all' }, buildIndex(retracted))
  const row = rows.find(r => r.node.id === 'n12')!
  expect(rowNote(row, 'en')).toBe('retracted')
  expect(rowNote(row, 'zh')).toBe('retracted')
  expect(lineText(railLine(row, opts(row))).trimEnd().endsWith('retracted')).toBe(true)
  // both, when a retracted node also holds folded rows
  expect(rowNote({ ...row, hiddenKids: 2 }, 'en')).toBe('+2 retracted')
})

test('rail: at every width, selected or not, in either language, a line stays inside the pane', () => {
  for (const lang of ['en', 'zh'] as DtLang[]) {
    const m = notesModel(lang)
    const idx = buildIndex(m)
    for (let width = 12; width <= 110; width += 3) {
      const rows = visibleRows(idx, { ui: { ...EMPTY_UI, filter: 'all' }, nowMs: NOW })
      const plan = indentPlan(rows, width)
      for (const row of rows) {
        for (const selected of [true, false]) {
          const line = railLine(row, { width, selected, ascii: false, lang, nowMs: NOW, title: row.node.title, mark: null, step: plan.step })
          expect(lineWidth(line), `${lang} ${width} ${row.node.id}`).toBeLessThanOrEqual(selected ? width : width - EDGE)
          if (selected) expect(lineWidth(line)).toBe(width)
        }
      }
    }
  }
})
