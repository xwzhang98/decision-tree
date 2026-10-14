import { expect, test } from 'claude-code/testing'

import { partText, partsWidth } from '../lib/bar'
import type { Part } from '../lib/bar'
import { laneColour } from '../lib/glyphs'
import { headerBar, languageToggle, originLine, overviewStateLine, stateLine } from '../lib/head'
import type { HeaderInput, OverviewStateInput, StateInput } from '../lib/head'
import { lineText, lineWidth } from '../lib/spans'
import type { DtFork, DtLang } from '../types'
import { CRDT_FORK, NOW, iso } from './notes'

/** What a row of parts says, the way the pane draws it. */
const textOf = (parts: readonly Part[]) => parts.map(partText).join('')
const buttons = (parts: readonly Part[]) => parts.filter((p): p is Extract<Part, { kind: 'button' }> => p.kind === 'button')

const head = (over: Partial<HeaderInput> = {}): HeaderInput => ({
  width: 100,
  lang: 'en',
  ascii: false,
  title: 'notes-app',
  trees: ['main', 'crdt-engine', 'cloud-first'],
  viewed: 'main',
  recording: 'main',
  translating: 0,
  ...over,
})

test('strip: the project, a tab for each tree and the language switch flush right', () => {
  const parts = headBar()
  expect(partsWidth(parts)).toBe(100)
  expect(textOf(parts)).toMatch(/^notes-app {3}main ● {3}crdt-engine {3}cloud-first +EN {2}中$/)
  // the project's name is bold; a tab is a button keyed by its tree; the viewed tab is bold and underlined, the rest quiet
  expect(parts[0]).toMatchObject({ kind: 'text', spans: [{ text: 'notes-app', bold: true }] })
  const tabs = buttons(parts).filter(b => b.key.startsWith('~tab-'))
  expect(tabs.map(b => b.key)).toEqual(['~tab-main', '~tab-crdt-engine', '~tab-cloud-first'])
  expect(tabs.map(b => b.action)).toEqual([
    { do: 'tab', tree: 'main' },
    { do: 'tab', tree: 'crdt-engine' },
    { do: 'tab', tree: 'cloud-first' },
  ])
  expect(tabs[0]!.spans[0]).toEqual({ text: 'main', color: 'text', bold: true, underline: true })
  expect(tabs[1]!.spans[0]).toEqual({ text: 'crdt-engine', color: 'inactive', dim: true })
  // the tree that is recorded into wears a dot, whichever tab is viewed
  expect(tabs[0]!.spans.map(s => s.text)).toEqual(['main', ' ', '●'])
  expect(tabs[0]!.spans[2]).toEqual({ text: '●', color: 'success' })
  const other = buttons(headerBar(head({ viewed: 'crdt-engine', recording: 'main' }))).filter(b => b.key.startsWith('~tab-'))
  expect(other[0]!.spans.map(s => s.text)).toEqual(['main', ' ', '●'])
  expect(other[1]!.spans[0]).toEqual({ text: 'crdt-engine', color: 'text', bold: true, underline: true })
  // nothing is recorded: no dot
  expect(textOf(headerBar(head({ recording: null })))).not.toContain('●')
})

function headBar(over: Partial<HeaderInput> = {}): Part[] {
  return headerBar(head(over))
}

test('strip: the language switch names both languages, bolds and underlines the one in use, and each is a button', () => {
  const en = languageToggle('en')
  expect(textOf(en)).toBe('EN  中')
  expect(buttons(en).map(b => [b.key, b.action])).toEqual([
    ['~lang-en', { do: 'lang', lang: 'en' }],
    ['~lang-zh', { do: 'lang', lang: 'zh' }],
  ])
  expect(buttons(en)[0]!.spans[0]).toEqual({ text: 'EN', color: 'text', bold: true, underline: true })
  expect(buttons(en)[1]!.spans[0]).toEqual({ text: '中', color: 'inactive', dim: true })
  const zh = languageToggle('zh')
  expect(buttons(zh)[0]!.spans[0]).toEqual({ text: 'EN', color: 'inactive', dim: true })
  expect(buttons(zh)[1]!.spans[0]).toEqual({ text: '中', color: 'text', bold: true, underline: true })
  // the switch has no hotkey of its own: the l key is in the footer
  expect(buttons(en).every(b => b.hotkey === null)).toBe(true)
})

test('strip: fewer than two trees draw no tabs, and a project that is off draws only its name and the switch', () => {
  expect(textOf(headBar({ width: 60, trees: ['main'] }))).toMatch(/^notes-app +EN {2}中$/)
  expect(textOf(headBar({ width: 60, trees: [], recording: null }))).toMatch(/^notes-app +EN {2}中$/)
  expect(textOf(headBar({ width: 30, title: '', trees: [], recording: null }))).toMatch(/^ +EN {2}中$/)
})

test('strip: the count of texts waiting for a rendition sits beside the switch, and goes before the tabs do', () => {
  const busy = headBar({ translating: 14 })
  expect(textOf(busy)).toMatch(/cloud-first +◌ translating 14 {3}EN {2}中$/)
  expect(textOf(headBar({ translating: 14, lang: 'zh' }))).toMatch(/◌ 翻译中 14 {3}EN {2}中$/)
  expect(textOf(headBar({ translating: 14, ascii: true }))).toContain('? translating 14')
  // narrower: the tabs it would crowd give way first, down to the viewed one with the rest as an ellipsis
  expect(textOf(headBar({ width: 60, translating: 14 }))).toMatch(/^notes-app {3}main ● {3}… +◌ translating 14 {3}EN {2}中$/)
  // narrower still: the count goes rather than leave the viewed tab a stump
  expect(textOf(headBar({ width: 44, translating: 14 }))).toBe('notes-app   main ●   crdt-engine   …  EN  中')
})

test('strip: tabs give up their length, then their neighbours of the viewed tab, and the line is always as wide as asked', () => {
  // the names are cut shorter before a tab goes
  expect(textOf(headBar({ width: 50 }))).toBe('notes-app   main ●   crdt-en…   cloud-f…    EN  中')
  // then the viewed tab keeps its place and the others become an ellipsis
  expect(textOf(headBar({ width: 40 }))).toBe('notes-app   main ●   …            EN  中')
  expect(textOf(headBar({ width: 30 }))).toBe('notes-app   main ●   …  EN  中')
  const many = { trees: ['main', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'], viewed: 't4', title: '' }
  // (a window around the viewed tab, with an ellipsis for what is out of it on either side)
  expect(textOf(headBar({ ...many, width: 32 }))).toMatch(/^…\s+t4\s+t5\s+t6\s+…\s+EN {2}中$/)
  // a long name is cut under half the strip, and the viewed tab still has its room
  const long = headBar({ width: 60, title: 'a-rather-long-project-name-for-a-notes-app', trees: ['main', 'a-very-long-tree-name-indeed', 'third'], viewed: 'a-very-long-tree-name-indeed' })
  expect(textOf(long)).toMatch(/^a-rather-long-project-name… {3}… {3}a-very-long…/)
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const translating of [0, 14]) {
      for (let width = 14; width <= 130; width++) {
        const parts = headBar({ width, lang, translating })
        expect(partsWidth(parts), `${lang} ${width} ${translating}`).toBe(width)
        // the switch is never dropped
        expect(buttons(parts).filter(b => b.key.startsWith('~lang-'))).toHaveLength(2)
        // the viewed tab is there from the width that has room for the name and a stump
        if (width >= 44) expect(buttons(parts).some(b => b.key === '~tab-main')).toBe(true)
      }
    }
  }
})

const state = (over: Partial<StateInput> = {}): StateInput => ({
  width: 100,
  lang: 'en',
  ascii: false,
  mode: 'recording',
  count: 17,
  steps: 6,
  lastEventAt: iso(NOW),
  readOnly: false,
  recording: 'main',
  ...over,
})
const stateText = (over: Partial<StateInput> = {}) => lineText(stateLine(state(over)))

test('state: what there is on the left, whether it is being recorded on the right', () => {
  const line = stateLine(state())
  expect(lineWidth(line)).toBe(100)
  expect(lineText(line)).toMatch(/^17 decisions {3}mainline 6 steps +● recording {3}updated \d\d:\d\d$/)
  expect(line.find(s => s.text === '●')).toEqual({ text: '●', color: 'success' })
  expect(line.find(s => s.text === 'recording')).toEqual({ text: 'recording', color: 'success' })
  // the counts are quiet
  expect(line[0]).toMatchObject({ text: '17 decisions', color: 'inactive', dim: true })
  expect(stateText({ lang: 'zh' })).toMatch(/^17 个决定 {3}mainline 6 steps +● 记录中 {3}\d\d:\d\d 更新$/)
  expect(stateText({ count: 1, steps: 1, lastEventAt: null })).toMatch(/^1 decision {3}mainline 1 step +● recording$/)
  expect(stateText({ ascii: true })).toContain('* recording')
  // paused: the dot and the word in the warning colour
  const paused = stateLine(state({ mode: 'paused' }))
  expect(lineText(paused)).toMatch(/● paused {3}updated/)
  expect(paused.find(s => s.text === '●')!.color).toBe('warning')
  expect(paused.find(s => s.text === 'paused')!.color).toBe('warning')
})

test('state: the tree being looked at is not the one recorded into: read only, and where the recording goes', () => {
  expect(stateText({ readOnly: true })).toMatch(/^17 decisions {3}mainline 6 steps +○ read only {3}recording in main {3}updated \d\d:\d\d$/)
  expect(stateText({ readOnly: true, lang: 'zh' })).toMatch(/○ 只读 {3}正记录到 main {3}\d\d:\d\d 更新$/)
  expect(stateText({ readOnly: true, mode: 'paused' })).toMatch(/○ read only {3}● paused {3}updated/)
  expect(stateText({ readOnly: true, ascii: true })).toContain('o read only')
  const ring = stateLine(state({ readOnly: true })).find(s => s.text === '○')
  expect(ring).toEqual({ text: '○', color: 'inactive' })
})

test('state: the right gives up the clock first, then the tree it records into, then its word; then the left gives up the steps', () => {
  expect(stateText({ width: 60 })).toMatch(/^17 decisions {3}mainline 6 steps {2}● recording {3}updated \d\d:\d\d$/)
  expect(stateText({ width: 50 })).toBe('17 decisions   mainline 6 steps        ● recording')
  expect(stateText({ width: 40 })).toBe('17 decisions   mainline 6 steps        ●')
  expect(stateText({ width: 30 })).toBe('17 decisions       ● recording')
  expect(stateText({ width: 70, readOnly: true })).toMatch(/○ read only {3}recording in main$/)
  expect(stateText({ width: 60, readOnly: true })).toMatch(/○ read only$/)
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const readOnly of [false, true]) {
      for (let width = 8; width <= 120; width++) expect(lineWidth(stateLine(state({ width, lang, readOnly }))), `${lang} ${readOnly} ${width}`).toBeLessThanOrEqual(width)
    }
  }
})

const laneOf = (tree: string) => laneColour(['main', 'crdt-engine'].indexOf(tree))

test('origin: where a tree began: the tree it was opened from, the version and its day, and what the tree is for', () => {
  const fork = CRDT_FORK('en')
  const line = originLine(fork, { width: 80, lang: 'en', ascii: false, laneOf })
  expect(lineText(line)).toBe('↳ main #5 (09-21)   CRDT text engine instead of paragraph merge')
  // the tree in its lane's colour, the version in the accent, the day quiet, the title in the colours of code but quiet
  expect(line.find(s => s.text === 'main')).toEqual({ text: 'main', color: 'merged' })
  expect(line.find(s => s.text === '#5')).toEqual({ text: '#5', color: 'warning' })
  expect(line.find(s => s.text === '(09-21)')).toEqual({ text: '(09-21)', color: 'inactive', dim: true })
  expect(line.find(s => s.text === ' text engine instead of paragraph merge')).toMatchObject({ dim: true })
  expect(lineText(originLine(fork, { width: 80, lang: 'en', ascii: true, laneOf })).startsWith('> main #5')).toBe(true)
  // a tree can begin in another one, and need not have a title
  expect(lineText(originLine({ ...fork, tree: 'crdt-engine', count: 5, title: undefined }, { width: 80, lang: 'en', ascii: false, laneOf }))).toBe('↳ crdt-engine #5 (09-21)')
  // one that began empty says so, in the language of the pane
  const empty: DtFork = { tree: 'main', at: null, count: 0, ts: fork.ts, actor: 'user' }
  expect(lineText(originLine(empty, { width: 80, lang: 'en', ascii: false, laneOf }))).toBe('↳ started empty')
  expect(lineText(originLine({ ...empty, title: 'Scratch' }, { width: 80, lang: 'zh', ascii: false, laneOf }))).toBe('↳ 从空白开始   Scratch')
  // cut to the pane, from the end
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 1; width <= 70; width++) expect(lineWidth(originLine(fork, { width, lang, ascii: false, laneOf }))).toBeLessThanOrEqual(width)
  }
  expect(lineText(originLine(fork, { width: 30, lang: 'en', ascii: false, laneOf }))).toBe('↳ main #5 (09-21)   CRDT text…')
})

test('origin: a title that is still in the language it was written in is shown as written, quiet, with the mark of that language', () => {
  const fork = CRDT_FORK('zh')
  const line = originLine(fork, { width: 80, lang: 'en', ascii: false, laneOf, mark: '中' })
  expect(lineText(line)).toBe('↳ main #5 (09-21)   用 CRDT 文本引擎代替按段落合并 中')
  // quiet: no colours of code, one dim span for the title and one for the mark
  expect(line.slice(-3)).toEqual([
    { text: '用 CRDT 文本引擎代替按段落合并', color: 'inactive', dim: true },
    { text: ' ' },
    { text: '中', color: 'inactive', dim: true },
  ])
  // with no mark, the title is drawn the way a title is (highlighted)
  const plain = originLine(fork, { width: 80, lang: 'en', ascii: false, laneOf })
  expect(lineText(plain)).toBe('↳ main #5 (09-21)   用 CRDT 文本引擎代替按段落合并')
  expect(lineText(originLine(fork, { width: 80, lang: 'en', ascii: false, laneOf, mark: null }))).toBe(lineText(plain))
  expect(plain.length).toBeGreaterThan(line.length - 3 + 1)
  // a tree opened from nothing keeps the mark on its title too, and a tree with no title has no mark to show
  const empty: DtFork = { tree: 'main', at: null, count: 0, ts: fork.ts, actor: 'user' }
  expect(lineText(originLine({ ...empty, title: 'Scratch' }, { width: 80, lang: 'zh', ascii: false, laneOf, mark: 'EN' }))).toBe('↳ 从空白开始   Scratch EN')
  expect(lineText(originLine({ ...fork, title: undefined }, { width: 80, lang: 'en', ascii: false, laneOf, mark: '中' }))).toBe('↳ main #5 (09-21)')
  // cut from the end, mark and all
  for (let width = 1; width <= 70; width++) expect(lineWidth(originLine(fork, { width, lang: 'en', ascii: false, laneOf, mark: '中' })), `${width}`).toBeLessThanOrEqual(width)
})

// ---------------------------------------------------------------- the state line of the overview

const overviewState = (over: Partial<OverviewStateInput> = {}): OverviewStateInput => ({
  width: 100,
  lang: 'en',
  ascii: false,
  mode: 'recording',
  trees: 3,
  lastEventAt: iso(NOW),
  recording: 'main',
  ...over,
})
const overviewText = (over: Partial<OverviewStateInput> = {}) => lineText(overviewStateLine(overviewState(over)))

test('overview state: how many trees there are on the left, whether and where it is being recorded on the right', () => {
  const line = overviewStateLine(overviewState())
  expect(lineWidth(line)).toBe(100)
  expect(lineText(line)).toMatch(/^3 trees +● recording in main {3}updated \d\d:\d\d$/)
  expect(line.find(s => s.text === '●')).toEqual({ text: '●', color: 'success' })
  expect(line.find(s => s.text === 'recording in main')).toEqual({ text: 'recording in main', color: 'success' })
  // the count is quiet
  expect(line[0]).toMatchObject({ text: '3 trees', color: 'inactive', dim: true })
  expect(overviewText({ trees: 1 })).toMatch(/^1 tree +● recording in main/)
  expect(overviewText({ lang: 'zh' })).toMatch(/^3 个 tree +● 正记录到 main {3}\d\d:\d\d 更新$/)
  expect(overviewText({ lang: 'zh', trees: 1 })).toMatch(/^1 个 tree +●/)
  expect(overviewText({ ascii: true })).toMatch(/^3 trees +\* recording in main/)
  // the tree it records into is named as it is written
  expect(overviewText({ recording: 'crdt-engine' })).toMatch(/● recording in crdt-engine {3}updated/)
  // nothing recorded yet: no clock to show
  expect(overviewText({ lastEventAt: null })).toMatch(/^3 trees +● recording in main$/)
})

test('overview state: while paused the dot and the word are in the warning colour, and no tree is named', () => {
  const line = overviewStateLine(overviewState({ mode: 'paused' }))
  expect(lineText(line)).toMatch(/^3 trees +● paused {3}updated \d\d:\d\d$/)
  expect(line.find(s => s.text === '●')!.color).toBe('warning')
  expect(line.find(s => s.text === 'paused')!.color).toBe('warning')
  expect(overviewText({ mode: 'paused', lang: 'zh' })).toMatch(/^3 个 tree +● 已暂停 {3}\d\d:\d\d 更新$/)
  expect(overviewText({ mode: 'paused', width: 30 })).toMatch(/^3 trees {15}● paused$/)
})

test('overview state: the right gives up the clock first, then the tree it records into, then its word; the line is never wider than asked', () => {
  const at = (width: number) => lineText(overviewStateLine(overviewState({ width })))
  expect(at(44)).toMatch(/^3 trees {2}● recording in main {3}updated \d\d:\d\d$/)
  expect(at(43)).toMatch(/^3 trees +● recording in main$/)
  expect(at(28)).toBe('3 trees  ● recording in main')
  expect(at(27)).toMatch(/^3 trees +● recording$/)
  expect(at(20)).toBe('3 trees  ● recording')
  expect(at(19)).toMatch(/^3 trees +●$/)
  expect(at(10)).toBe('3 trees  ●')
  for (const width of [44, 43, 28, 27, 20, 19, 10]) expect(lineWidth(overviewStateLine(overviewState({ width }))), `${width}`).toBe(width)
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const mode of ['recording', 'paused'] as const) {
      for (const lastEventAt of [iso(NOW), null]) {
        for (let width = 4; width <= 120; width++) expect(lineWidth(overviewStateLine(overviewState({ width, lang, mode, lastEventAt }))), `${lang} ${mode} ${width}`).toBeLessThanOrEqual(width)
      }
    }
  }
})
