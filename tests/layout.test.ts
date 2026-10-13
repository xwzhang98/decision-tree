import { expect, test } from 'claude-code/testing'

import { eventFileName } from '../lib/events'
import { COLORS, MARKS } from '../lib/glyphs'
import {
  AIRIER_MIN_ROWS,
  AIRY_DETAIL_ROWS,
  AIRY_MIN_ROWS,
  EDGE,
  EDIT_ROWS,
  GUTTER,
  MAX_COMMAND_LINES,
  ORIGIN_MIN_ROWS,
  STEP,
  blockWidth,
  capLines,
  detailLines,
  evidenceLine,
  footerItems,
  headerLine,
  indentPlan,
  innerWidth,
  itemWidth,
  laneLine,
  layoutPane,
  mainlineLine,
  nowBlock,
  originLine,
  packFooter,
  rowNote,
  shortTitle,
  treeRowLine,
  type Block,
  type HeaderInput,
  type NowBlock,
  type NowInput,
  type PaneInput,
  type PaneLayout,
} from '../lib/layout'
import { barLine, fitSpans, lineText, lineWidth, ruleLine, sp, truncateSpans } from '../lib/spans'
import { describeArgv } from '../lib/status'
import { buildIndex, trunkNodes, visibleRows } from '../lib/tree'
import { drawable, isAltered, isHidden, strWidth } from '../lib/width'
import type { DtFork, DtLang, DtNode, DtUi } from '../types'
import { NOW, NOW_DATA, NOW_NONE, NOW_PENDING, UI0, bigTree, iso, modelOf, node, nowApproved, projectOf, sampleNodes } from './fixture'

const IDX = buildIndex(modelOf(sampleNodes()))
const rowsFor = (ui: Partial<DtUi> = {}) => visibleRows(IDX, { ui: { ...UI0, ...ui }, nowMs: NOW })
const rowOf = (id: string, ui: Partial<DtUi> = {}) => rowsFor(ui).find(r => r.node.id === id)!

function input(over: Partial<PaneInput> = {}): PaneInput {
  return {
    width: 68,
    rows: 40,
    lang: 'zh',
    ascii: false,
    nowMs: NOW,
    project: projectOf(),
    model: modelOf(sampleNodes()),
    ui: UI0,
    now: NOW_NONE,
    statusInterval: null,
    canEdit: true,
    ...over,
  }
}

const textOf = (layout: PaneLayout) =>
  layout.blocks.map(b => ('line' in b && !('items' in b.line) ? lineText(b.line) : b.kind === 'footer' ? `[footer ${b.line.items.length}]` : `[${b.kind}]`))

// Emoji sequences, spelled with escapes: their joiners and selectors are what the tests are about.
const HEART = '❤\ufe0f' // a heart and the emoji selector
const FAMILY = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}' // man, woman and girl joined by zero-width joiners
const THUMB = '\u{1F44D}\u{1F3FD}' // a thumb and a skin-tone modifier
const KEYCAP = '1\ufe0f\u20e3' // a 1, the emoji selector and the enclosing keycap
const CHINA = '\u{1F1E8}\u{1F1F3}' // the regional indicators C and N: a flag
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}' // a black flag and tag letters
const MELTING = '\u{1FAE0}' // melting face, added in Unicode 14
/** All of them in a row, and the same row as the pane draws it. */
const MESSY = `${HEART} ${FAMILY} ${CHINA} ${KEYCAP} ${THUMB} ${MELTING} ${ENGLAND}`
const TIDY = '❤ \u{1F468}\u{1F469}\u{1F467} CN 1 \u{1F44D} ? \u{1F3F4}'

/** A day at noon in the machine's own zone, so that its `MM-DD` reads the same wherever the tests run. */
const noon = (month: number, day: number) => iso(new Date(2026, month - 1, day, 12, 0, 0).getTime())

// ---------------------------------------------------------------- spans

test('spans: cutting keeps styles, ends in an ellipsis and never exceeds the width', () => {
  const line = [sp('ab', { bold: true }), sp('中文字', { dim: true }), sp('xyz')]
  expect(lineWidth(line)).toBe(11)
  for (let w = 0; w <= 14; w++) expect(lineWidth(truncateSpans(line, w)) <= w).toBe(true)
  expect(lineText(truncateSpans(line, 5))).toBe('ab中…')
  expect(truncateSpans(line, 5)[1]!.dim).toBe(true)
  expect(lineText(truncateSpans(line, 1))).toBe('…')
  expect(truncateSpans(line, 0)).toEqual([])
  expect(lineText(truncateSpans(line, 11))).toBe('ab中文字xyz')
})

test('spans: fit puts the right part flush right and cuts the left part first', () => {
  const a = fitSpans([sp('hello world')], [sp('10-09')], 20, 2)
  expect(lineText(a)).toBe('hello world    10-09')
  const b = fitSpans([sp('x'.repeat(30))], [sp('10-09')], 20, 2)
  expect(lineWidth(b)).toBe(20)
  expect(lineText(b).endsWith('10-09')).toBe(true)
  expect(lineText(b).includes('…')).toBe(true)
  // nothing on the right: not padded
  expect(lineText(fitSpans([sp('abc')], [], 20))).toBe('abc')
  // the right part alone wider than the line is cut instead
  expect(lineWidth(fitSpans([sp('a')], [sp('0123456789')], 6))).toBe(6)
})

test('spans: a rule is as wide as the pane, with the label near its right end', () => {
  expect(lineText(ruleLine(10, false))).toBe('──────────')
  expect(lineText(ruleLine(10, true))).toBe('----------')
  const labelled = ruleLine(24, false, 'only pending')
  expect(lineWidth(labelled)).toBe(24)
  expect(lineText(labelled).includes(' only pending ──')).toBe(true)
  // too narrow for the label: a plain rule
  expect(lineText(ruleLine(10, false, 'only pending'))).toBe('──────────')
  const zh = ruleLine(30, false, '只看待定')
  expect(lineWidth(zh)).toBe(30)
})

test('spans: a bar puts its background behind every span and pads the line out to the width', () => {
  const line = [sp('ab', { bold: true }), sp('中', { dim: true })]
  const bar = barLine(line, 'subtle', 10)
  expect(lineWidth(bar)).toBe(10)
  expect(lineText(bar)).toBe('ab中' + ' '.repeat(6))
  expect(bar.every(s => s.bg === 'subtle')).toBe(true)
  // the styles are kept; the line given is not changed
  expect(bar[0]!.bold).toBe(true)
  expect(bar[1]!.dim).toBe(true)
  expect(line.every(s => s.bg === undefined)).toBe(true)
  // a span with a background of its own keeps it
  expect(barLine([{ text: 'x', bg: 'error' }, sp('y')], 'subtle', 3).map(s => s.bg)).toEqual(['error', 'subtle', 'subtle'])
  // already as wide as the bar, or wider: nothing is added, nothing cut
  expect(lineText(barLine([sp('abcd')], 'subtle', 4))).toBe('abcd')
  expect(lineText(barLine([sp('abcdef')], 'subtle', 4))).toBe('abcdef')
})

// ---------------------------------------------------------------- header, mainline

test('header: the pane and the project on the left, the state, count and clock flush right', () => {
  const h = headerLine({ width: 68, lang: 'zh', title: 'orders-api-rewrite', mode: 'recording', count: 23, lastEventAt: '2026-10-10T00:12:00-04:00' })
  expect(lineWidth(h)).toBe(68)
  const text = lineText(h)
  expect(text.startsWith('决策树  orders-api-rewrite ')).toBe(true)
  expect(/● 记录中 {3}23 个决定 {3}\d\d:\d\d 更新$/.test(text)).toBe(true)
  // the project's name is the one thing in bold; the pane's own name and the details are quiet; the dot has the state's colour
  expect(h.filter(s => s.bold === true).map(s => s.text)).toEqual(['orders-api-rewrite'])
  expect(h.find(s => s.text === '决策树')!.dim).toBe(true)
  expect(h.find(s => s.text === '●')!.color).toBe('success')
  expect(h.find(s => s.text === ' 记录中')!.dim).toBe(true)

  // paused is said in the warning colour, the word too; a clock that is not known is left out
  const paused = headerLine({ width: 68, lang: 'en', title: 'orders-api-rewrite', mode: 'paused', count: 1, lastEventAt: null })
  expect(lineText(paused).startsWith('Decision tree  orders-api-rewrite ')).toBe(true)
  expect(lineText(paused).endsWith('● Paused   1 decision')).toBe(true)
  expect(paused.find(s => s.text === '●')!.color).toBe('warning')
  expect(paused.find(s => s.text === ' Paused')!.color).toBe('warning')
  // ASCII: the dot is an asterisk
  expect(lineText(headerLine({ width: 60, lang: 'en', ascii: true, title: 'x', mode: 'recording', count: 2, lastEventAt: null }))).toMatch(/^Decision tree {2}x +\* Recording {3}2 decisions$/)

  // not recording: the names only; and with no project name, the pane's own
  expect(lineText(headerLine({ width: 40, lang: 'zh', title: 'x', mode: 'off', count: 0, lastEventAt: null }))).toBe('决策树  x')
  expect(lineText(headerLine({ width: 40, lang: 'en', title: '', mode: 'off', count: 0, lastEventAt: null }))).toBe('Decision tree')
  expect(lineText(headerLine({ width: 40, lang: 'en', title: '', mode: 'recording', count: 2, lastEventAt: null }))).toMatch(/^Decision tree {2,}● Recording {3}2 decisions$/)
  for (let w = 8; w <= 70; w++) {
    expect(lineWidth(headerLine({ width: w, lang: 'zh', title: 'a-rather-long-project-name', mode: 'recording', count: 123, lastEventAt: '2026-10-10T00:12:00-04:00' })) <= w).toBe(true)
  }
})

const head = (over: Partial<HeaderInput> = {}): HeaderInput => ({
  width: 100,
  lang: 'en',
  title: 'orders-api-rewrite',
  mode: 'recording',
  count: 23,
  lastEventAt: '2026-10-10T00:12:00-04:00',
  tree: 'sql-v3',
  ...over,
})

test('header: a tree other than main is tagged after the name, and the name gives way before the tag and the state', () => {
  // room for everything: the tag follows the name; the state, the count and the clock are flush right
  const wide = headerLine(head())
  expect(lineWidth(wide)).toBe(100)
  expect(lineText(wide).startsWith('Decision tree  orders-api-rewrite  [sql-v3] ')).toBe(true)
  expect(/ {2}● Recording {3}23 decisions {3}updated \d\d:\d\d$/.test(lineText(wide))).toBe(true)
  const tag = wide.find(s => s.text === '[sql-v3]')!
  expect(tag.color).toBeDefined()
  expect(tag.dim).not.toBe(true)
  const zh = lineText(headerLine(head({ lang: 'zh' })))
  expect(zh.startsWith('决策树  orders-api-rewrite  [sql-v3] ')).toBe(true)
  expect(/● 记录中 {3}23 个决定 {3}\d\d:\d\d 更新$/.test(zh)).toBe(true)

  // the main tree is not named, nor is a header given no tree; what is stored is drawn like everything else
  for (const tree of ['main', undefined]) {
    const text = lineText(headerLine(head({ tree })))
    expect(text.startsWith('Decision tree  orders-api-rewrite ')).toBe(true)
    expect(text.includes('[')).toBe(false)
  }
  expect(lineText(headerLine(head({ tree: 'sql\u200b-v3' })))).toContain('  [sql-v3]  ')

  // narrower, the state gives up the clock, then the count, then its word, and the name stays whole ...
  const at = (width: number) => lineText(headerLine(head({ width })))
  expect(at(87)).toMatch(/23 decisions {3}updated \d\d:\d\d$/)
  expect(at(86)).toMatch(/\[sql-v3\] +● Recording {3}23 decisions$/)
  expect(at(71)).toMatch(/\[sql-v3\] +● Recording {3}23 decisions$/)
  expect(at(70)).toMatch(/\[sql-v3\] +● Recording$/)
  expect(at(56)).toMatch(/\[sql-v3\] +● Recording$/)
  expect(at(55)).toMatch(/\[sql-v3\] +●$/)
  expect(at(46)).toMatch(/orders-api-rewrite {2}\[sql-v3\] +●$/)
  // ... until the name is cut from its end, then left out, and the tag is still whole
  expect(at(45)).toContain('orders-api-rewri…  [sql-v3]  ●')
  expect(at(40)).toContain('orders-api-…  [sql-v3]  ●')
  expect(at(34)).toContain('order…  [sql-v3]')
  expect(at(33)).not.toContain('order')
  expect(at(33)).toMatch(/^Decision tree {2}\[sql-v3\] +●$/)

  // at every width: the line fits, the name never outlives the tag, and from 30 columns up the tag and the dot show
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 16; width <= 120; width++) {
      const h = headerLine(head({ width, lang }))
      const text = lineText(h)
      expect(lineWidth(h) <= width).toBe(true)
      if (text.includes('orders')) expect(text.includes('[sql-v3]')).toBe(true)
      if (width >= 30) expect(text.includes('[sql-v3]') && text.includes('●')).toBe(true)
    }
  }
})

const FORK_AT = Date.UTC(2026, 9, 8, 21, 44, 0)
const FORK: DtFork = { tree: 'main', at: eventFileName(FORK_AT, 'abcdef', 17), count: 17, ts: iso(FORK_AT), actor: 'user', title: 'SQL 第三版' }

/** `MM-DD HH:MM` of an instant in the machine's own zone, the way a tree says when it began. */
function localStamp(ms: number): string {
  const d = new Date(ms)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

test('origin: where a tree began, in words, dim, and cut to the pane', () => {
  const when = localStamp(FORK_AT)
  const en = originLine(FORK, { width: 80, lang: 'en' })
  expect(lineText(en)).toBe(`from main at #17 (${when}) · SQL 第三版`)
  const zh = originLine(FORK, { width: 80, lang: 'zh' })
  expect(lineText(zh)).toBe(`基于 main 的 #17（${when}）· SQL 第三版`)
  // dim: the words and the dot after them; the name the person gave the tree is not
  expect(en.map(s => s.dim === true)).toEqual([true, true, false])
  expect(zh.map(s => s.dim === true)).toEqual([true, true, false])

  // a tree can begin in another one, and need not have a name
  expect(lineText(originLine({ ...FORK, tree: 'sql-v3', count: 5, title: undefined }, { width: 80, lang: 'en' }))).toBe(`from sql-v3 at #5 (${when})`)
  // one that began empty says so
  const empty: DtFork = { tree: 'main', at: null, count: 0, ts: iso(FORK_AT), actor: 'user' }
  expect(lineText(originLine(empty, { width: 80, lang: 'en' }))).toBe('started empty')
  expect(lineText(originLine(empty, { width: 80, lang: 'zh' }))).toBe('从空白开始')
  expect(lineText(originLine({ ...empty, title: 'Scratch' }, { width: 80, lang: 'zh' }))).toBe('从空白开始 · Scratch')
  // the name is stored text, drawn like all of it
  expect(lineText(originLine({ ...FORK, title: `v3 ${HEART} ${CHINA}\u200b` }, { width: 80, lang: 'en' }))).toBe(`from main at #17 (${when}) · v3 \u2764 CN`)

  // cut to the pane: never wider; the words are cut at their end, or else the name is cut at its end
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 1; width <= 60; width++) expect(lineWidth(originLine(FORK, { width, lang })) <= width).toBe(true)
  }
  const cutWords = originLine(FORK, { width: 30, lang: 'en' })
  expect(lineText(cutWords).startsWith('from main at #17 (')).toBe(true)
  expect(lineText(cutWords).endsWith('…')).toBe(true)
  expect(cutWords.every(s => s.dim === true)).toBe(true)
  const cutName = originLine(FORK, { width: 40, lang: 'en' })
  expect(lineText(cutName)).toBe(`from main at #17 (${when}) · SQL 第…`)
  expect(cutName.find(s => s.text.includes('SQL'))!.dim).not.toBe(true)
})

test('mainline: the newest items that fit, older ones become an ellipsis, a glyph for what is not adopted', () => {
  const trunk = trunkNodes(IDX)
  expect(trunk.map(n => n.id)).toEqual(['design-v2', 'pooling-only-2', 'dbpool-adopted', 'v22-adopted', 'gateway'])
  const wide = lineText(mainlineLine(trunk, { width: 200, ascii: false, lang: 'zh' })!)
  expect(wide.startsWith('主线  design v2 定稿 › ')).toBe(true)
  expect(wide.endsWith('2 hops 简化为 gateway ◐')).toBe(true)
  expect(wide.includes('…')).toBe(false)

  const narrow = mainlineLine(trunk, { width: 68, ascii: false, lang: 'zh' })!
  expect(lineWidth(narrow) <= 68).toBe(true)
  expect(lineText(narrow).startsWith('主线  … › ')).toBe(true)
  expect(lineText(narrow).endsWith('gateway ◐')).toBe(true)

  const ascii = lineText(mainlineLine(trunk, { width: 200, ascii: true, lang: 'en' })!)
  expect(ascii.startsWith('Mainline  ')).toBe(true)
  expect(ascii.includes(' > ')).toBe(true)
  expect(ascii.endsWith('~')).toBe(true)

  expect(mainlineLine([], { width: 68, ascii: false, lang: 'zh' })).toBe(null)
  for (let w = 6; w < 60; w++) expect(lineWidth(mainlineLine(trunk, { width: w, ascii: false, lang: 'zh' })!) <= w).toBe(true)
})

test('mainline: the label is violet, older steps are quiet and the newest is in full strength', () => {
  const line = mainlineLine(trunkNodes(IDX), { width: 200, ascii: false, lang: 'zh' })!
  expect(line[0]).toEqual({ text: '主线', color: COLORS.mainline })
  const steps = line.filter(s => /design v2|连接只走池化|连接池采用|构建版本定为|2 hops/.test(s.text))
  expect(steps.map(s => s.dim === true)).toEqual([true, true, true, true, false])
  // a step that is not adopted carries its glyph in its own colour, after its title
  expect(line.find(s => s.text === '◐')!.color).toBe('suggestion')
  expect(line.filter(s => s.text === '✓')).toEqual([])
  // the separators are quiet too
  expect(line.filter(s => s.text === ' › ').every(s => s.dim === true)).toBe(true)
})

test('mainline: a title written as a sentence shows as its subject, and a long one is cut at a space', () => {
  expect(shortTitle('v22: why the pool is relative, and how it is set')).toBe('v22: why the pool is relative')
  expect(shortTitle('构建版本定为 v2.2：池的大小、线程、队列全部用比例')).toBe('构建版本定为 v2.2')
  expect(shortTitle('PgBouncer: adopted')).toBe('PgBouncer')
  expect(shortTitle('no break here')).toBe('no break here')
  // a front shorter than the least is not a subject: it keeps the sentence
  expect(shortTitle('v2: adopted')).toBe('v2: adopted')
  expect(shortTitle('ab: cd', 2)).toBe('ab')
  expect(shortTitle('(a) short title')).toBe('(a) short title')

  const one = (title: string, width: number) => lineText(mainlineLine([node('m', null, { title, trunk: true })], { width, ascii: false, lang: 'en' })!)
  // 24 columns for the newest of a 60-column pane: cut at the last space that keeps most of it, else in the word
  expect(one('Queue moves to SQS with 4 workers', 60)).toBe('Mainline  Queue moves to SQS…')
  expect(one('Queue moves to SQS: 4 workers and a dead-letter queue', 60)).toBe('Mainline  Queue moves to SQS')
  expect(one('Supercalifragilisticexpialidocious', 60)).toBe('Mainline  Supercalifragilisticexp…')
  // a cut never leaves a sign that joined the title to what was cut off
  expect(one('Run PgBouncer + SQS-backed queue', 40)).toBe('Mainline  Run PgBouncer…')
  expect(one('Use PgBouncer → SQS-backed queue', 40)).toBe('Mainline  Use PgBouncer…')
  expect(one('Plan: PgBouncer / SQS-backed queue', 40)).toBe('Mainline  Plan: PgBouncer…')
  // ... unless nothing else is left
  expect(one('+ '.repeat(19), 40)).toBe(`Mainline  ${'+ '.repeat(10)}+…`)
})

// ---------------------------------------------------------------- rows

test('rows: a glyph and a title indented by depth; the mainline has a spine, and nothing has a connector', () => {
  const rows = rowsFor()
  expect(rows.map(r => r.node.id)).toEqual([
    'design-v2',
    'pooling-only-2',
    'pool-32',
    'v21-abs-size',
    'dbpool-adopted',
    'v22-adopted',
    'deep-skip',
    'gateway',
    'proxies1',
  ])
  const line = (id: string, selected = false) => lineText(treeRowLine(rowOf(id), { width: 68, selected, ascii: false, lang: 'zh' }))

  // on the mainline: the spine in the first column, then the glyph, two columns in for each level
  expect(line('design-v2')).toBe('▎ ✓ design v2 定稿')
  expect(line('pooling-only-2')).toBe('▎   ✓ 连接只走池化（exp-2）')
  expect(line('dbpool-adopted')).toBe('▎     ✓ 连接池采用')
  expect(line('v22-adopted')).toBe('▎   ✓ 构建版本定为 v2.2')
  expect(line('gateway')).toBe('▎   ◐ 2 hops 简化为 gateway')
  // off it: nothing in the first column
  expect(line('pool-32')).toBe('      = pool 数维持 32')
  expect(line('deep-skip')).toBe('      ⊘ deep_skip 撤回')
  expect(line('proxies1')).toBe('      ○ 3 proxies 换成一个 distributed cache')
  // no connectors, dates or status words on a row
  for (const r of rows) expect(/[├└│]|\d\d-\d\d|进行中|计划|提议/.test(lineText(treeRowLine(r, { width: 68, selected: false, ascii: false, lang: 'zh' })))).toBe(false)
  // only the number of rows a folded one holds, flush right, one column short of the edge
  const folded = line('v21-abs-size')
  expect(folded.startsWith('      ✗ v2.1：池的大小用绝对值')).toBe(true)
  expect(folded.endsWith('  +2')).toBe(true)
  expect(strWidth(folded)).toBe(68 - EDGE)

  // the colours: the spine is the mainline's, the glyph the status's, a finished matter's title is quiet
  const spine = treeRowLine(rowOf('gateway'), { width: 68, selected: false, ascii: false, lang: 'zh' })
  expect(spine[0]).toEqual({ text: '▎', color: COLORS.mainline })
  expect(spine.find(s => s.text === '◐')!.color).toBe('suggestion')
  const rejected = treeRowLine(rowOf('v21-abs-size'), { width: 68, selected: false, ascii: false, lang: 'zh' })
  expect(rejected.find(s => s.text === '✗')!.color).toBe('error')
  expect(rejected.find(s => s.text.startsWith('v2.1'))!.dim).toBe(true)
  expect(spine.find(s => s.text.startsWith('2 hops'))!.dim).not.toBe(true)
  expect(spine.every(s => s.bg === undefined)).toBe(true)
})

test('rows: the selected row is a bar from edge to edge: a mark, a background and a bold title', () => {
  const sel = treeRowLine(rowOf('pool-32'), { width: 68, selected: true, ascii: false, lang: 'zh' })
  expect(lineWidth(sel)).toBe(68)
  expect(lineText(sel).trimEnd()).toBe('▌     = pool 数维持 32')
  expect(sel[0]).toEqual({ text: '▌', color: COLORS.mark, bg: COLORS.selected })
  expect(sel.every(s => s.bg === COLORS.selected)).toBe(true)
  expect(sel.find(s => s.text === 'pool 数维持 32')!.bold).toBe(true)
  // on the mainline the bar takes the place of the spine
  expect(lineText(treeRowLine(rowOf('gateway'), { width: 68, selected: true, ascii: false, lang: 'zh' })).startsWith('▌   ◐ 2 hops')).toBe(true)
  // a finished matter is not dim once it is selected, and the folded count stays at the edge, on the bar
  const rejected = treeRowLine(rowOf('v21-abs-size'), { width: 68, selected: true, ascii: false, lang: 'zh' })
  expect(rejected.find(s => s.text.startsWith('v2.1'))!.dim).not.toBe(true)
  expect(rejected.find(s => s.text === '✗')!.dim).not.toBe(true)
  expect(lineText(rejected).trimEnd().endsWith('  +2')).toBe(true)
  expect(lineWidth(rejected)).toBe(68)
  // ASCII: a plain mark
  expect(lineText(treeRowLine(rowOf('pool-32'), { width: 68, selected: true, ascii: true, lang: 'en' })).trimEnd()).toBe('>     = pool 数维持 32')
  expect(MARKS.bar.unicode).toBe('▌')
})

test('rows: ASCII mode draws plain characters', () => {
  const rows = visibleRows(IDX, { ui: UI0, nowMs: NOW })
  const lines = rows.map(r => lineText(treeRowLine(r, { width: 60, selected: false, ascii: true, lang: 'en' })))
  expect(lines.some(l => /[✓✗◐○⊘‖◌▎▌├└│]/.test(l))).toBe(false)
  expect(lines[0]).toBe('| + design v2 定稿')
  expect(lines.find(l => l.includes('2 hops'))).toBe('|   ~ 2 hops 简化为 gateway')
  expect(lines.find(l => l.includes('v2.1'))!.startsWith('      x v2.1')).toBe(true)
  expect(lines.find(l => l.includes('deep_skip'))).toBe('      / deep_skip 撤回')
})

test('rows: indentation is two columns a level, one when the tree is too deep for that, and the title keeps its room', () => {
  expect(STEP).toBe(2)
  const chain = Array.from({ length: 30 }, (_, k) => node(`c${k}`, k === 0 ? null : `c${k - 1}`, { title: `step ${k}`, trunk: true }))
  const rows = visibleRows(buildIndex(modelOf(chain)), { ui: { ...UI0, filter: 'all' }, nowMs: NOW })
  expect(rows.map(r => r.depth)).toEqual(Array.from({ length: 30 }, (_, k) => k))
  const plan = (width: number, from = rows) => indentPlan(from, width)
  // 30 levels need 58 columns at two a level
  expect(plan(100).step).toBe(2)
  expect(plan(40).step).toBe(1)
  expect(plan(100).cap).toBeGreaterThanOrEqual(58)
  // a shallow tree is two columns a level in any pane wide enough for the title
  expect(plan(40, rows.slice(0, 6)).step).toBe(2)
  expect(indentPlan([], 40)).toEqual({ step: 2, cap: plan(40).cap })
  // the deepest row of a narrow pane still shows its title, and every row fits
  for (const width of [30, 40, 50, 70]) {
    const p = indentPlan(rows, width)
    const last = lineText(treeRowLine(rows[29]!, { width, selected: false, ascii: false, lang: 'en', step: p.step, cap: p.cap }))
    expect(last).toContain('step 29')
    for (const r of rows) expect(lineWidth(treeRowLine(r, { width, selected: false, ascii: false, lang: 'en', step: p.step, cap: p.cap })) <= width).toBe(true)
  }
  // without a plan the row is indented two columns a level, as deep as it goes
  expect(lineText(treeRowLine(rows[3]!, { width: 80, selected: false, ascii: false, lang: 'en' }))).toBe('▎       ✓ step 3')
})

test('rows: the end of a row says how many rows are folded in it, and that it was retracted, and nothing else', () => {
  expect(rowNote(rowOf('v21-abs-size'), 'zh')).toBe('+2')
  // what a node is, is for its glyph and its detail to say: no status word, no date
  for (const id of ['gateway', 'proxies1', 'dbpool-adopted', 'v22-adopted', 'design-v2']) expect(rowNote(rowOf(id), 'zh')).toBe('')
  // retracted nodes (visible under "all") say so
  const nodes = sampleNodes().map(n => (n.id === 'pool-32' ? { ...n, retracted: { ts: iso(NOW), actor: 'user' as const, reason: 'oops' } } : n))
  const idx = buildIndex(modelOf(nodes))
  const rows = visibleRows(idx, { ui: { ...UI0, filter: 'all' }, nowMs: NOW })
  expect(rowNote(rows.find(r => r.node.id === 'pool-32')!, 'zh')).toBe('已撤销')
  expect(rowNote(rows.find(r => r.node.id === 'pool-32')!, 'en')).toBe('Retracted')
  // both, when a retracted node also holds folded rows
  const holder = rowOf('v21-abs-size')
  expect(rowNote({ ...holder, node: { ...holder.node, retracted: { ts: iso(NOW), actor: 'user' as const } } }, 'zh')).toBe('+2 已撤销')
})

test('rows: every width, selected or not, in either language, stays inside the pane', () => {
  for (const lang of ['zh', 'en'] as DtLang[]) {
    for (let width = 10; width <= 100; width += 3) {
      for (const row of rowsFor({ filter: 'all' })) {
        for (const selected of [true, false]) {
          const line = treeRowLine(row, { width, selected, ascii: false, lang })
          expect(lineWidth(line) <= width).toBe(true)
        }
      }
    }
  }
})

// ---------------------------------------------------------------- detail

test('detail: title, then the status line, the summary and the labelled parts in a column', () => {
  const n = IDX.byId.get('v22-adopted')!
  const spans = detailLines({ node: n, idx: IDX, width: 67, ascii: false, lang: 'zh', open: true })
  const lines = spans.map(lineText)
  expect(lines.length).toBe(6)
  expect(lines[0]).toBe('▾ 构建版本定为 v2.2')
  expect(lines[1]).toMatch(/^ {2}✓ 采用 {3}user {3}\d\d-\d\d$/)
  expect(lines.slice(2)).toEqual([
    '  池的大小、线程、队列全部用比例，加 GC 比例。',
    '  依据  v22 s0 预热后  P99 suite 内 −12.6% [−15.1, −10.4]  v22_s0',
    '        v22 s1 预热后  P99 suite 内 −13.5% [−15.7, −11.5]  v22_s1',
    '  来源  reports/design_v22_20261009/SPEC_V22.md',
  ])
  // the title is the one bold text; the status has its colour; who and when are quiet; so are the labels and the runs
  expect(spans.flat().filter(s => s.bold === true).map(s => s.text)).toEqual(['构建版本定为 v2.2'])
  expect(spans[1]![1]!.color).toBe('success')
  expect(spans[1]!.slice(2).every(s => s.dim === true)).toBe(true)
  expect(spans[3]!.find(s => s.text.startsWith('依据'))!.dim).toBe(true)
  expect(spans[3]!.find(s => s.text === 'v22_s0')!.dim).toBe(true)
  expect(spans[3]!.find(s => s.text.startsWith('P99'))!.dim).not.toBe(true)

  // the marker says whether the children are drawn: open, folded, or (a leaf) neither
  const marker = (open: boolean | null, ascii = false) => lineText(detailLines({ node: n, idx: IDX, width: 67, ascii, lang: 'en', open })[0]!).slice(0, 2)
  expect(marker(true)).toBe('▾ ')
  expect(marker(false)).toBe('▸ ')
  expect(marker(null)).toBe('▾ ')
  expect(marker(true, true)).toBe('v ')
  expect(marker(false, true)).toBe('> ')
})

test('detail: rationale wraps beside its label, supersession and notes show, a retracted node says so', () => {
  const base = IDX.byId.get('pool-32')!
  const n = {
    ...base,
    status: 'superseded' as const,
    supersededBy: 'v22-adopted',
    rationale: 'A long reason that has to wrap over more than one line of a narrow pane, with 中文 mixed in.',
    notes: [{ ts: '2026-10-09T12:00:00Z', actor: 'user' as const, text: 'checked again after the second seed finished' }],
    tags: ['capacity', 'v2'],
    retracted: { ts: iso(NOW), actor: 'user' as const, reason: 'duplicate' },
  }
  const idx = buildIndex(modelOf([...sampleNodes().filter(x => x.id !== 'pool-32'), n]))
  const lines = detailLines({ node: n, idx, width: 40, ascii: false, lang: 'en', open: null }).map(lineText)
  for (const l of lines) expect(strWidth(l) <= 40).toBe(true)
  expect(lines[0]).toBe('▾ pool 数维持 32')
  expect(lines[1]).toMatch(/^ {2}⊘ Superseded {3}model {3}\d\d-\d\d$/)
  // the text of each part starts in the same column, under the one before it
  expect(lines.slice(2, 9)).toEqual([
    '  Retracted by user: duplicate',
    '  Rationale  A long reason that has to',
    '             wrap over more than one',
    '             line of a narrow pane, with',
    '             中文 mixed in.',
    '  Superseded by v22-adopted',
    '  Tags       capacity, v2',
  ])
  expect(lines[9]).toMatch(/^ {2}Notes {6}\d\d-\d\d user {2}checked again$/)
  // the lines of a note hang under its text
  expect(lines.slice(10)).toEqual([`${' '.repeat(25)}after the`, `${' '.repeat(25)}second seed`, `${' '.repeat(25)}finished`])
  // the retraction is in the error colour
  expect(detailLines({ node: n, idx, width: 40, ascii: false, lang: 'en', open: null })[2]!.every(s => s.text === '' || s.text.trim() === '' || s.color === 'error')).toBe(true)
  // another node names this one as what replaced it
  const older = detailLines({ node: idx.byId.get('v22-adopted')!, idx, width: 67, ascii: false, lang: 'en', open: true }).map(lineText)
  expect(older).toContain('  Supersedes pool-32')
  expect(older).toContain('  Evidence  v22 s0 预热后  P99 suite 内 −12.6% [−15.1, −10.4]')
  expect(older).toContain('  Sources   reports/design_v22_20261009/SPEC_V22.md')
})

test('detail: a pane too narrow for the label column puts each label above its text', () => {
  const lines = detailLines({ node: IDX.byId.get('v22-adopted')!, idx: IDX, width: 30, ascii: false, lang: 'en', open: true }).map(lineText)
  for (const l of lines) expect(strWidth(l) <= 30).toBe(true)
  expect(lines).toContain('  Evidence')
  expect(lines).toContain('  Sources')
  // the text sits under its label, two columns further in, and still breaks where it must
  const at = lines.indexOf('  Sources')
  expect(lines[at + 1]!.startsWith('    reports/design_v22_')).toBe(true)
  expect(lines.slice(at + 1).every(l => l.startsWith('    '))).toBe(true)
})

test('detail: blank rows between the parts when the pane has the room, and none for a part that is not there', () => {
  const n = IDX.byId.get('v22-adopted')!
  const tight = detailLines({ node: n, idx: IDX, width: 67, ascii: false, lang: 'zh', open: true }).map(lineText)
  const roomy = detailLines({ node: n, idx: IDX, width: 67, ascii: false, lang: 'zh', open: true, roomy: true }).map(lineText)
  // after the status line, and after the summary
  expect(roomy).toEqual([tight[0]!, tight[1]!, '', tight[2]!, '', ...tight.slice(3)])
  // a node with nothing but a title and a status has no blank row to add, nor has one with a summary only
  const bare = node('bare', null, { title: 'Only a title', summary: undefined })
  expect(detailLines({ node: bare, idx: IDX, width: 67, ascii: false, lang: 'en', open: null, roomy: true }).map(lineText).filter(l => l === '')).toEqual([])
  const summed = node('summed', null, { title: 'Only a title', summary: 'and a summary' })
  expect(detailLines({ node: summed, idx: IDX, width: 67, ascii: false, lang: 'en', open: null, roomy: true }).map(lineText).filter(l => l === '')).toHaveLength(1)
})

test('detail: a long title takes its own lines and the status goes under it', () => {
  const base = IDX.byId.get('pool-32')!
  const n = { ...base, title: '一个非常非常长的标题'.repeat(6) }
  const lines = detailLines({ node: n, idx: IDX, width: 40, ascii: false, lang: 'zh', open: null }).map(lineText)
  expect(strWidth(lines[0]!) <= 40).toBe(true)
  expect(lines[0]!.startsWith('▾ 一个')).toBe(true)
  expect(lines.some(l => /^\s+= 无差别/.test(l))).toBe(true)
  const long = detailLines({ node: { ...base, title: 'x'.repeat(400) }, idx: IDX, width: 30, ascii: false, lang: 'en', open: null }).map(lineText)
  expect(long.length).toBeLessThan(8)
  for (const l of long) expect(strWidth(l) <= 30).toBe(true)
})

test('evidence lines give up the run first, then the label, and the value last', () => {
  const ev = { label: 'v22 s0 预热后', value: 'P99 suite 内 −12.6%', ci: '[−15.1, −10.4]', run: 'v22_s0_warm_run' }
  const at = (w: number) => lineText(evidenceLine(ev, w, 4))
  expect(at(80)).toBe('    v22 s0 预热后  P99 suite 内 −12.6% [−15.1, −10.4]  v22_s0_warm_run')
  const cutRun = at(62)
  expect(cutRun.includes('v22 s0 预热后  P99 suite 内 −12.6% [−15.1, −10.4]')).toBe(true)
  expect(cutRun.includes('…')).toBe(true)
  expect(strWidth(cutRun) <= 62).toBe(true)
  const noRun = at(56)
  expect(noRun.includes('v22_s0')).toBe(false)
  expect(noRun.includes('v22 s0 预热后')).toBe(true)
  const cutLabel = at(48)
  expect(cutLabel.includes('v22 s0 预热后')).toBe(false)
  expect(cutLabel.includes('P99 suite 内 −12.6% [−15.1, −10.4]')).toBe(true)
  for (let w = 6; w < 90; w++) expect(strWidth(at(w)) <= w).toBe(true)
  // only a note
  expect(lineText(evidenceLine({ label: 'smoke test', note: 'passed' }, 40, 4))).toBe('    smoke test  passed')
})

test('evidence lines: labels padded to one column line the values up, and a run shows only when enough of it can', () => {
  const a = { label: 'short', value: '1.5', run: 'run-a' }
  const b = { label: 'a longer label', value: '2.5 ms', ci: '[1, 3]' }
  expect(lineText(evidenceLine(a, 60, 4, 14))).toBe(`    ${'short'.padEnd(14)}  1.5  run-a`)
  expect(lineText(evidenceLine(b, 60, 4, 14))).toBe('    a longer label  2.5 ms [1, 3]')
  // no padding when the value would no longer fit beside the padded label: the line keeps its own label
  expect(lineText(evidenceLine(a, 14, 4, 14))).toBe('    short  1.5')
  // the padding goes before the run does: the value stays under the others', and the run is what gives way
  expect(lineText(evidenceLine(a, 4 + 14 + 2 + 3 + 2 + 2, 4, 14))).toBe(`    ${'short'.padEnd(14)}  1.5`)
  // a run cut to fewer than 6 columns says nothing, so it is left out; from 6 columns it is cut with an ellipsis
  const r = { label: 'x', value: 'v', run: 'bench_20261009_long' }
  expect(lineText(evidenceLine(r, 15, 4))).toBe('    x  v')
  expect(lineText(evidenceLine(r, 16, 4))).toBe('    x  v  bench…')
  expect(lineText(evidenceLine(r, 40, 4))).toBe('    x  v  bench_20261009_long')
  // a run that fits whole is shown however short it is
  expect(lineText(evidenceLine({ label: 'x', value: 'v', run: 's0' }, 12, 4))).toBe('    x  v  s0')
})

test('capLines marks what was cut', () => {
  const lines = ['a', 'b', 'c', 'd'].map(x => [sp(x)])
  expect(capLines(lines, 10).length).toBe(4)
  const cut = capLines(lines, 3).map(lineText)
  expect(cut).toEqual(['a', 'b', '  …'])
  expect(capLines(lines, 0)).toEqual([])
})

// ---------------------------------------------------------------- now

test('now: lanes in aligned columns with a bar, steps and eta; next and warnings under them', () => {
  const block = nowBlock({ now: nowApproved(), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  const lines = block.lines.map(lineText)
  expect(block.needsApproval).toBe(false)
  expect(lines[0]).toBe('现在')
  expect(lines[1]).toBe('  ZETA    gateway s0      ████████░░  3400/4000  约 23:50  预热中')
  expect(lines[2]).toBe('  BETA-0  ablate_wide s0  █░░░░░░░░░   420/4000  约 09:10')
  expect(lines[3]).toBe('  BETA-1  ablate_deep s0  ░░░░░░░░░░   120/4000  约 09:35')
  expect(lines[4]).toBe('  下一步  闸 → probe s1（约 06:15）')
  expect(lines[5]).toBe('  ! GAMMA 空闲')
  for (const l of lines) expect(strWidth(l) <= 68).toBe(true)

  const ascii = nowBlock({ now: nowApproved(), intervalSec: 30, nowMs: NOW, width: 80, ascii: true, lang: 'en' }).lines.map(lineText)
  expect(ascii[0]).toBe('Now')
  expect(ascii[1]!.includes('########..')).toBe(true)
  expect(ascii[1]!.includes('~23:50')).toBe(true)
  expect(ascii[4]!.startsWith('  Next  ')).toBe(true)
})

test('now: narrow panes drop the note, then the eta, then the steps, then shorten the run name', () => {
  const lane = NOW_DATA.lanes[0]!
  const cols = { name: 6, run: 14, step: 9 }
  const at = (w: number) => laneLine(lane, cols, { width: w, ascii: false, lang: 'zh', stale: false })
  expect(lineText(at(80)).includes('预热中')).toBe(true)
  expect(lineText(at(60)).includes('预热中')).toBe(false)
  expect(lineText(at(60)).includes('约 23:50')).toBe(true)
  expect(lineText(at(50)).includes('约 23:50')).toBe(false)
  expect(lineText(at(50)).includes('3400/4000')).toBe(true)
  expect(lineText(at(40)).includes('3400/4000')).toBe(false)
  expect(lineText(at(40)).includes('████████░░')).toBe(true)
  // below that the run name is shortened to keep the bar
  expect(lineText(at(30)).includes('████████░░')).toBe(true)
  expect(lineText(at(30)).includes('gateway s0')).toBe(false)
  for (let w = 8; w < 90; w++) expect(lineWidth(at(w)) <= w).toBe(true)
})

test('now: states other than running show their label; a failed lane is red', () => {
  const cols = { name: 6, run: 10, step: 0 }
  const queued = laneLine({ name: 'GAMMA', run: 'x s1', state: 'queued', step: null, total: null, eta: '', note: '' }, cols, { width: 60, ascii: false, lang: 'zh', stale: false })
  expect(lineText(queued).includes('排队')).toBe(true)
  const failed = laneLine({ name: 'GAMMA', run: 'x s1', state: 'failed', step: 10, total: 100, eta: '', note: 'nan loss' }, { ...cols, step: 7 }, { width: 60, ascii: false, lang: 'en', stale: false })
  expect(lineText(failed).includes('failed')).toBe(true)
  expect(failed.some(s => s.color === 'error')).toBe(true)
})

test('now: stale data says how old, and the error under it', () => {
  const stale = nowBlock({ now: nowApproved({ fetchedAt: NOW - 5 * 60_000 - 1000, error: 'timed out after 15000 ms' }), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  const lines = stale.lines.map(lineText)
  expect(lines[0]!.startsWith('现在')).toBe(true)
  expect(lines[0]!.endsWith('过期 5 分钟')).toBe(true)
  expect(strWidth(lines[0]!)).toBe(68)
  expect(lines.some(l => l.includes('状态命令失败：timed out after 15000 ms'))).toBe(true)
  // the lanes are still there, dim
  expect(lines.some(l => l.includes('ZETA'))).toBe(true)
  expect(stale.lines[1]!.every(s => s.dim === true || s.text.trim() === '')).toBe(true)

  const fresh = nowBlock({ now: nowApproved({ fetchedAt: NOW - 70_000 }), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  expect(lineText(fresh.lines[0]!).endsWith('过期 1 分钟')).toBe(true)
  const justNow = nowBlock({ now: nowApproved({ fetchedAt: NOW - 10_000, error: 'boom' }), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  expect(lineText(justNow.lines[0]!).endsWith('刚过期')).toBe(true)
})

test('now: first run waits for the person; failures before any data are one error line', () => {
  const ask = nowBlock({ now: NOW_PENDING, intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  expect(ask.needsApproval).toBe(true)
  const lines = ask.lines.map(lineText)
  expect(lines.some(l => l.includes('bash scripts/decision_status.sh'))).toBe(true)
  expect(lines.some(l => l.includes('每 30 秒'))).toBe(true)

  const none = nowBlock({ now: NOW_NONE, intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'zh' })
  expect(none.lines).toEqual([])

  const loading = nowBlock({ now: nowApproved({ data: null, fetchedAt: null }), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'en' })
  expect(loading.lines.map(lineText)).toEqual(['Now', '  Reading the status command…'])
  const failed = nowBlock({ now: nowApproved({ data: null, fetchedAt: null, error: 'bash: no such file' }), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'en' })
  expect(failed.lines.map(lineText)).toEqual(['Now', '  Status command failed: bash: no such file'])
})

// a status command waiting for the person's OK, as the "now" block spells it out
const pendingBlock = (argv: string[], over: Partial<NowInput> = {}): NowBlock =>
  nowBlock({ now: { ...NOW_PENDING, argv }, intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'en', ...over })

/** The lines that spell the command out: the ones indented four columns, as nothing else in the block is. */
const commandOf = (block: NowBlock): string[] => block.lines.map(lineText).filter(l => /^ {4}\S/.test(l))

/** A line of the command in the whole pane: the block's four columns, and the gutter before them. */
const COMMAND = new RegExp(`^ {${GUTTER + 4}}\\S`)

/** A word of 30 columns: two fit on a line of a 68-column pane, three do not. */
const word = (i: number): string => `w${String(i).padStart(2, '0')}`.padEnd(30, 'x')
const words = (n: number): string[] => Array.from({ length: n }, (_, i) => word(i + 1))

/** The pane's Allow button, if it has one. */
const allowOf = (layout: PaneLayout) => layout.blocks.find((b): b is Extract<Block, { kind: 'allow' }> => b.kind === 'allow')

test('now: the command waiting for approval is shown whole, quoted, with nothing hidden', () => {
  const simple = pendingBlock(['bash', 'scripts/decision_status.sh'])
  expect(simple.needsApproval).toBe(true)
  expect(simple.argv).toEqual(['bash', 'scripts/decision_status.sh'])
  expect(simple.lines.map(lineText)).toEqual([
    'Now',
    '  The status command wants to run in this project:',
    '    bash scripts/decision_status.sh',
    '  It runs on your machine, in the project folder, every 30 s while',
    '  this pane is open.',
  ])
  expect(simple.lines[2]!.some(s => s.color === 'warning')).toBe(true)

  // quoted as a shell would read it: a word that needs it, quotes inside a word, an empty word
  expect(commandOf(pendingBlock(['bash', '-c', 'echo "hi there"; cat /etc/passwd | head -3']))).toEqual([`    bash -c 'echo "hi there"; cat /etc/passwd | head -3'`])
  expect(commandOf(pendingBlock(['sh', '-c', "echo 'it'"]))).toEqual(["    sh -c 'echo '\\''it'\\'''"])
  expect(commandOf(pendingBlock(['bash', '', 'x']))).toEqual(["    bash '' x"])

  // what the pane would hide, or draw as something else, is spelled out: the person reads what would run
  const odd = ['bash', 'scripts/status\u200b.sh', 'a\u202eb', 'two\nlines', `heart${HEART}`, CHINA, MELTING, 'half\ud83d']
  const spelled = pendingBlock(odd, { width: 120 })
  expect(spelled.needsApproval).toBe(true)
  expect(commandOf(spelled).map(l => l.trim()).join(' ')).toBe(
    "bash 'scripts/status<U+200B>.sh' 'a<U+202E>b' 'two<U+000A>lines' 'heart❤<U+FE0F>' '<U+1F1E8><U+1F1F3>' '<U+1FAE0>' 'half<U+D83D>'",
  )
  for (const line of spelled.lines.map(lineText)) {
    for (const ch of line) expect(isHidden(ch.codePointAt(0)!) || isAltered(ch.codePointAt(0)!)).toBe(false)
  }
  // the button will carry the command itself, with its real characters
  expect(spelled.argv).toEqual(odd)

  // shown whole: a command of MAX_COMMAND_LINES lines is not cut
  const six = pendingBlock(words(12))
  expect(six.needsApproval).toBe(true)
  expect(commandOf(six)).toHaveLength(MAX_COMMAND_LINES)
  expect(commandOf(six)[0]).toBe(`    ${word(1)} ${word(2)}`)
  expect(commandOf(six)[5]).toBe(`    ${word(11)} ${word(12)}`)

  // at any width, what is offered for approval is the whole command, and every line fits
  const argv = ['python3', 'scripts/status.py', '--config', 'configs/sql v3.yaml', '--out', 'results/status.json']
  const whole = "python3 scripts/status.py --config 'configs/sql v3.yaml' --out results/status.json"
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 30; width <= 120; width++) {
      const block = pendingBlock(argv, { width, lang })
      expect(block.needsApproval).toBe(true)
      expect(commandOf(block).map(l => l.trim()).join(' ')).toBe(whole)
      for (const line of block.lines) expect(lineWidth(line) <= width).toBe(true)
    }
  }
})

test('now: a command too long to read in the pane is not offered for approval', () => {
  // twelve words fill the six lines allowed, a thirteenth is one line too many
  const fits = pendingBlock(words(12))
  const tooLong = pendingBlock(words(13))
  expect(fits.needsApproval).toBe(true)
  expect(commandOf(fits)).toHaveLength(MAX_COMMAND_LINES)
  expect(tooLong.needsApproval).toBe(false)
  // not a word of the command is drawn, not even the part that would fit; the block says why instead
  expect(tooLong.lines.map(lineText)).toEqual([
    'Now',
    '  The status command in config.json is too long to check here. Put',
    '  it in a script and point config.json at the script.',
  ])
  expect(tooLong.lines.slice(1).every(l => l.some(s => s.color === 'warning'))).toBe(true)
  const zh = pendingBlock(words(13), { lang: 'zh' })
  expect(zh.needsApproval).toBe(false)
  expect(zh.lines.map(lineText).join('')).toContain('状态命令太长')

  // it is lines that count, not characters: the same command fits a wider pane, and a short one a narrow pane
  expect(pendingBlock(words(13), { width: 140 }).needsApproval).toBe(true)
  const narrow = pendingBlock(['bash', 'scripts/decision_status.sh'], { width: 30 })
  expect(narrow.needsApproval).toBe(true)
  expect(commandOf(narrow)).toEqual(['    bash', '    scripts/decision_status.sh'])
  // and one that is too long for any pane
  expect(pendingBlock(words(60), { width: 140 }).needsApproval).toBe(false)
})

test('pane: the Allow button carries the command that was drawn above it', () => {
  // the person reads the command spelled out (`<U+200B>`); the button carries the command itself, word for word
  const argv = ['bash', '-c', 'scripts/status.sh --since "10 minutes ago"', 'tail\u200b']
  for (const lang of ['en', 'zh'] as DtLang[]) {
    const layout = layoutPane(input({ lang, now: { ...NOW_PENDING, argv }, statusInterval: 30 }))
    const at = layout.blocks.findIndex(b => b.kind === 'allow')
    expect(at).toBeGreaterThan(1)
    const allow = allowOf(layout)!
    expect(allow.argv).toEqual(argv)
    expect(allow.label).toBe(lang === 'zh' ? '允许运行' : 'Allow')
    const command = textOf(layout)
      .slice(0, at)
      .filter(l => COMMAND.test(l))
      .map(l => l.trim())
      .join(' ')
    expect(command).toBe(`bash -c 'scripts/status.sh --since "10 minutes ago"' 'tail<U+200B>'`)
    expect(command).toBe(describeArgv(allow.argv))
  }

  // another command in the config: the button follows what is drawn
  const other = ['bash', 'scripts/other.sh']
  const again = layoutPane(input({ now: { ...NOW_PENDING, argv: other }, statusInterval: 30 }))
  expect(allowOf(again)!.argv).toEqual(other)
  expect(textOf(again)).toContain('      bash scripts/other.sh')
  // no button for a command that is already allowed, or for one that is not drawn
  expect(allowOf(layoutPane(input({ now: nowApproved(), statusInterval: 30 })))).toBeUndefined()
  expect(allowOf(layoutPane(input({ now: NOW_PENDING, statusInterval: 30, ui: { ...UI0, showNow: false } })))).toBeUndefined()
})

test('pane: a command waiting for approval outranks the detail; with no room for all of it there is no button, and the pane says so', () => {
  const ui: DtUi = { ...UI0, selected: 'v22-adopted' }
  const detail = '▾ 构建版本定为 v2.2'
  const asked = (rows: number) => {
    const i = input({ rows, ui, now: NOW_PENDING, statusInterval: 30 })
    const layout = layoutPane(i)
    checkLayout(layout, i, `${rows} rows`)
    expect(layout.height).toBeLessThanOrEqual(rows)
    const t = textOf(layout)
    return { t, button: allowOf(layout) !== undefined, command: t.includes('      bash scripts/decision_status.sh'), detail: t.some(l => l.startsWith(detail)) }
  }
  // room for everything: the command, its button and the detail of the selected node
  expect(asked(40)).toMatchObject({ button: true, command: true, detail: true })
  // less room: the detail gives way, the command and its button stay
  expect(asked(19)).toMatchObject({ button: true, command: true, detail: false })
  // (with no command waiting, those rows do have room for the detail)
  expect(textOf(layoutPane(input({ rows: 19, ui }))).some(l => l.startsWith(detail))).toBe(true)
  // no room for the command whole: no button, no part of the command, and the pane says why
  const cramped = asked(12)
  expect(cramped).toMatchObject({ button: false, command: false, detail: false })
  // (one whole line under the label, not a sentence cut off where the room ran out)
  expect(cramped.t).toContain('  现在  有一条状态命令在等你确认；把 pane 拉大后才看得全。')
  const en = textOf(layoutPane(input({ rows: 12, width: 72, lang: 'en', ui, now: NOW_PENDING, statusInterval: 30 })))
  expect(en).toContain('  Now  A status command awaits your OK; enlarge the pane to read it.')
  expect(en.some(l => l.includes('bash scripts'))).toBe(false)
  // a narrow pane cuts that line with an ellipsis, it does not wrap it
  const narrow = textOf(layoutPane(input({ rows: 12, width: 30, lang: 'en', ui, now: NOW_PENDING, statusInterval: 30 })))
  expect(narrow.filter(l => l.startsWith('  Now  A status command'))).toHaveLength(1)
  expect(narrow.find(l => l.startsWith('  Now  A status command'))!.endsWith('…')).toBe(true)
  // the notice is the last thing to go: from 8 rows up the pane shows the whole command with its button, or the notice, never half of one ...
  for (let rows = 8; rows <= 40; rows++) {
    const c = asked(rows)
    const notice = c.t.some(l => l.startsWith('  现在  有一条状态命令在等你确认'))
    expect(notice, `${rows} rows`).toBe(!c.button)
    expect(c.command, `${rows} rows`).toBe(c.button)
  }
  // (a command of one line has its button from 15 rows)
  expect(asked(14).button).toBe(false)
  expect(asked(15).button).toBe(true)
  // ... and below 8 rows the pane draws only what fits, without a button
  for (let rows = 6; rows <= 7; rows++) expect(asked(rows)).toMatchObject({ button: false, command: false })
  // (a pane has 5 rows at the least: the header, the mainline, one row of the tree, and the footer under its rule; a smaller screen clips it)
  for (let rows = 3; rows <= 5; rows++) {
    const layout = layoutPane(input({ rows, ui, now: NOW_PENDING, statusInterval: 30 }))
    expect(layout.height, `${rows} rows`).toBe(5)
    expect(allowOf(layout), `${rows} rows`).toBeUndefined()
    expect(textOf(layout).some(l => l.includes('bash scripts')), `${rows} rows`).toBe(false)
  }

  // a longer command needs more room, and is left out rather than cut to fit
  const long = { ...NOW_PENDING, argv: words(12) }
  const roomy = layoutPane(input({ rows: 40, ui, now: long, statusInterval: 30 }))
  expect(allowOf(roomy)!.argv).toEqual(long.argv)
  expect(textOf(roomy).filter(l => new RegExp(`^ {${GUTTER + 4}}w\\d\\d`).test(l))).toHaveLength(MAX_COMMAND_LINES)
  const short = textOf(layoutPane(input({ rows: 17, ui, now: long, statusInterval: 30 })))
  expect(short.some(l => l.includes('w01'))).toBe(false)
  expect(short.some(l => l.includes('拉大'))).toBe(true)
  expect(allowOf(layoutPane(input({ rows: 17, ui, now: long, statusInterval: 30 })))).toBeUndefined()

  // whatever the size and the command: a button always has the whole command drawn above it
  for (const argv of [NOW_PENDING.argv, words(12), ['sh', '-c', `echo "a b"; echo ${'x'.repeat(50)}`]]) {
    const spelled = describeArgv(argv).replace(/\s+/g, '')
    for (const lang of ['zh', 'en'] as DtLang[]) {
      for (const width of [20, 68, 100]) {
        for (let rows = 3; rows <= 45; rows++) {
          const layout = layoutPane(input({ lang, width, rows, ui, now: { ...NOW_PENDING, argv }, statusInterval: 30 }))
          const at = layout.blocks.findIndex(b => b.kind === 'allow')
          if (at < 0) continue
          const drawn = textOf(layout)
            .slice(0, at)
            .filter(l => COMMAND.test(l))
            .join('')
            .replace(/\s+/g, '')
          if (drawn !== spelled) throw new Error(`${lang} ${width}x${rows}: a button with ${JSON.stringify(drawn)} above it, not ${JSON.stringify(spelled)}`)
        }
      }
    }
  }
})

// ---------------------------------------------------------------- footer

test('footer: keys in order of use, the warnings count flush right, low-priority keys dropped when narrow', () => {
  const items = footerItems({ lang: 'zh', canEdit: true, filter: 'default', hasNow: true, showNow: true })
  expect(items.map(i => (i.kind === 'key' ? i.hotkey : 'text'))).toEqual(['k', 'j', 'text', 'e', 'p', 'h', 'a', 's'])
  const warn = { kind: 'warn' as const, text: '警告 0', count: 0 }

  const one = packFooter(items, warn, 68, 1)
  expect(one.length).toBe(1)
  expect(one[0]!.items.map(i => (i.kind === 'key' ? i.hotkey : 'text'))).toEqual(['k', 'j', 'text', 'e', 'p', 'h'])
  expect(one[0]!.warn).toEqual(warn)
  const w1 = one[0]!.items.reduce((s, it, k) => s + itemWidth(it) + (k > 0 ? 2 : 0), 0) + one[0]!.pad + itemWidth(warn)
  expect(w1).toBe(68)

  const two = packFooter(items, warn, 68, 2)
  expect(two.length).toBe(2)
  expect(two[1]!.items.map(i => (i.kind === 'key' ? i.hotkey : 'text'))).toEqual(['a', 's'])

  // no text field (mobile): no edit key
  const mobile = footerItems({ lang: 'en', canEdit: false, filter: 'pending', hasNow: false, showNow: true })
  expect(mobile.some(i => i.kind === 'key' && i.hotkey === 'e')).toBe(false)
  expect(mobile.some(i => i.kind === 'key' && i.hotkey === 's')).toBe(false)
  expect(mobile.find(i => i.kind === 'key' && i.hotkey === 'p')).toEqual({ kind: 'key', hotkey: 'p', label: 'Pending', action: 'pending', active: true })

  for (let w = 10; w <= 100; w += 5) {
    for (const f of packFooter(items, warn, w, 2)) {
      const total = f.items.reduce((s, it, k) => s + itemWidth(it) + (k > 0 ? 2 : 0), 0) + (f.warn !== null ? f.pad + itemWidth(f.warn) : 0)
      expect(total <= w).toBe(true)
    }
  }
})

// ---------------------------------------------------------------- the whole pane

function checkLayout(layout: PaneLayout, i: PaneInput, label: string): void {
  const width = Math.max(16, i.width)
  for (const b of layout.blocks) {
    if (blockWidth(b) > width) throw new Error(`${label}: a ${b.kind} block is ${blockWidth(b)} wide in ${width}: ${JSON.stringify('line' in b && 'length' in b.line ? lineText(b.line as never) : b.kind)}`)
  }
  const first = layout.blocks[0]!
  if (first.kind !== 'text') throw new Error(`${label}: the header comes first`)
  if (i.project.mode !== 'off' && i.model.nodes.length > 0 && layout.drawn.length === 0) throw new Error(`${label}: no tree row drawn`)
  if (layout.selected !== null && i.project.mode !== 'off' && !layout.drawn.includes(layout.selected)) throw new Error(`${label}: the selection ${layout.selected} is not drawn`)
}

test('pane: the sketch at 68 columns: header, mainline, now, the tree, the detail and the footer', () => {
  const i = input({ rows: 40, now: nowApproved(), statusInterval: 30, ui: { ...UI0, selected: 'v22-adopted' } })
  const layout = layoutPane(i)
  const t = textOf(layout)
  checkLayout(layout, i, 'sketch')
  const rule = '  ' + '─'.repeat(68 - GUTTER - EDGE - 0)
  expect(innerWidth(68)).toBe(65)
  expect(rule).toHaveLength(67)
  // the header, then a blank row, then the mainline, with the rule between them and the rest only where something follows
  expect(t[0]!.startsWith('  决策树  orders-api-rewrite')).toBe(true)
  expect(t[1]).toBe('')
  expect(t[2]!.startsWith('  主线  ')).toBe(true)
  expect(t[3]).toBe(rule)
  expect(t[4]).toBe('  现在')
  expect(t.filter(x => x.startsWith('    ZETA') || x.startsWith('    BETA')).length).toBe(3)
  // the tree follows the now block after a blank row, with no rule of its own
  const firstRow = t.findIndex(x => x.startsWith('▎ ✓ design v2'))
  expect(firstRow).toBeGreaterThan(4)
  expect(t[firstRow - 1]).toBe('')
  expect(t.filter(x => x === rule)).toHaveLength(3)
  // nine tree rows, the selected one marked
  const rows = layout.blocks.filter((b): b is Extract<Block, { kind: 'row' }> => b.kind === 'row')
  expect(rows.map(r => r.id)).toEqual(['design-v2', 'pooling-only-2', 'pool-32', 'v21-abs-size', 'dbpool-adopted', 'v22-adopted', 'deep-skip', 'gateway', 'proxies1'])
  expect(rows.filter(r => r.selected).map(r => r.id)).toEqual(['v22-adopted'])
  expect(lineText(rows.find(r => r.selected)!.line).startsWith('▌   ✓ 构建版本定为 v2.2')).toBe(true)
  // the rows have the width of the pane less the free edge; the selected one is the bar, a column wider
  expect(rows.filter(r => !r.selected).every(r => lineWidth(r.line) <= 68 - EDGE)).toBe(true)
  expect(lineWidth(rows.find(r => r.selected)!.line)).toBe(68)
  // the detail follows under a rule, then the footer under another
  const detailAt = t.findIndex(x => x.startsWith('▾ 构建版本定为 v2.2'))
  expect(detailAt).toBeGreaterThan(firstRow)
  expect(t[detailAt - 1]).toBe(rule)
  expect(layout.blocks[layout.blocks.length - 1]!.kind).toBe('footer')
  expect(layout.blocks[layout.blocks.length - 2]!.kind === 'footer' || layout.blocks[layout.blocks.length - 2]!.kind === 'rule').toBe(true)
  expect(layout.height).toBeLessThanOrEqual(40)
})

test('pane: blank rows set the parts apart from 20 rows up, more of them from 28, and never cost the tree its rows', () => {
  expect(AIRY_MIN_ROWS).toBe(20)
  expect(AIRIER_MIN_ROWS).toBe(28)
  const blanksAbove = (rows: number, over: Partial<PaneInput> = {}) => {
    const layout = layoutPane(input({ rows, ...over }))
    const t = textOf(layout)
    const firstRow = layout.blocks.findIndex(b => b.kind === 'row')
    return { head: t.slice(0, firstRow), t, layout }
  }
  // cramped: header, mainline, the tree
  expect(blanksAbove(19).head.map(x => x === '')).toEqual([false, false])
  // from 20: a blank row between the mainline and the tree
  expect(blanksAbove(20).head.map(x => x === '')).toEqual([false, false, true])
  // from 28: another between the header and the mainline
  expect(blanksAbove(27).head.map(x => x === '')).toEqual([false, false, true])
  expect(blanksAbove(28).head.map(x => x === '')).toEqual([false, true, false, true])
  // a filter takes the blank row for its name, whatever the height
  for (const rows of [10, 19, 20, 40]) {
    const { head } = blanksAbove(rows, { ui: { ...UI0, filter: 'pending' } })
    expect(head[head.length - 1]).toBe('  只看待定')
  }
  // the blank rows are what the tree can spare: it never has fewer rows than it would without them, when it has them to show
  for (let rows = 8; rows <= 40; rows++) {
    const layout = layoutPane(input({ rows }))
    expect(layout.height).toBeLessThanOrEqual(rows)
  }
  expect(blanksAbove(40).layout.drawn.length).toBe(9)
})

test('pane: a docked pane keeps its footer on the last rows; one in the flow ends where its content does', () => {
  const docked = layoutPane(input({ rows: 40, pin: true }))
  const flow = layoutPane(input({ rows: 40 }))
  expect(docked.height).toBe(40)
  expect(flow.height).toBeLessThan(40)
  expect(docked.blocks.slice(-3).map(b => b.kind)).toEqual(['rule', 'footer', 'footer'])
  // the rows added are blank ones, between the detail and the footer's rule
  const pad = docked.blocks.length - flow.blocks.length
  expect(pad).toBe(40 - flow.height)
  const at = docked.blocks.length - 3
  expect(docked.blocks.slice(at - pad, at).every(b => b.kind === 'text' && b.line.length === 0)).toBe(true)
  // the same blocks otherwise
  expect(textOf(docked).filter(x => x !== '')).toEqual(textOf(flow).filter(x => x !== ''))
  // a pane that needs more rows than it was given is not padded
  expect(layoutPane(input({ rows: 8, pin: true })).height).toBe(8)
  // in every size the footer is the last block
  for (let rows = 3; rows <= 50; rows++) {
    const l = layoutPane(input({ rows, pin: true }))
    expect(l.blocks[l.blocks.length - 1]!.kind).toBe('footer')
    expect(l.height).toBe(Math.max(rows, 5))
  }
})

test('pane: the warnings count is in the footer only when there is something to count', () => {
  const warnOf = (layout: PaneLayout) => layout.blocks.flatMap(b => (b.kind === 'footer' && b.line.warn !== null ? [b.line.warn] : []))
  expect(warnOf(layoutPane(input()))).toEqual([])
  const warned = layoutPane(input({ model: { ...modelOf(sampleNodes()), warningCount: 2 } }))
  expect(warnOf(warned)).toEqual([{ kind: 'warn', text: '警告 2', count: 2 }])
  const en = layoutPane(input({ lang: 'en', model: { ...modelOf(sampleNodes()), warningCount: 1 } }))
  expect(warnOf(en)).toEqual([{ kind: 'warn', text: 'Warnings 1', count: 1 }])
  // flush right on the first footer line, with the keys before it
  const first = warned.blocks.find((b): b is Extract<Block, { kind: 'footer' }> => b.kind === 'footer')!
  expect(blockWidth(first)).toBe(GUTTER + innerWidth(68))
})

test('pane: a tree that began elsewhere says where under the header, when there is room', () => {
  const forked = (over: Partial<PaneInput> = {}): PaneInput =>
    input({ project: projectOf({ tree: 'sql-v3' }), model: { ...modelOf(sampleNodes()), fork: FORK }, ...over })
  const when = localStamp(FORK_AT)

  const layout = layoutPane(forked())
  checkLayout(layout, forked(), 'forked')
  const t = textOf(layout)
  expect(t[0]!.startsWith('  决策树  orders-api-rewrite  [sql-v3] ')).toBe(true)
  expect(t[1]).toBe(`  基于 main 的 #17（${when}）· SQL 第三版`)
  // under it, the blank row that follows the header when there is room, then the mainline
  expect(t[2]).toBe('')
  expect(t[3]!.startsWith('  主线')).toBe(true)
  const origin = layout.blocks[1] as Extract<Block, { kind: 'text' }>
  expect(origin.kind).toBe('text')
  expect(origin.line[1]!.dim).toBe(true)
  expect(textOf(layoutPane(forked({ lang: 'en' })))[1]).toBe(`  from main at #17 (${when}) · SQL 第三版`)

  // from ORIGIN_MIN_ROWS rows up; a smaller pane keeps its rows for the tree
  expect(ORIGIN_MIN_ROWS).toBe(16)
  for (let rows = 8; rows <= 40; rows++) {
    const i = forked({ rows })
    const l = layoutPane(i)
    checkLayout(l, i, `${rows} rows`)
    expect(l.height).toBeLessThanOrEqual(rows)
    expect(textOf(l).some(x => x.startsWith('  基于 main'))).toBe(rows >= ORIGIN_MIN_ROWS)
  }
  // the line takes a row from the tree, not from the room around it (the tree has one row fewer, or two when it
  // no longer fits whole and a row says how many are not drawn)
  for (const rows of [ORIGIN_MIN_ROWS, ORIGIN_MIN_ROWS + 1]) {
    const plainTree = layoutPane(forked({ rows, model: modelOf(sampleNodes()) }))
    const withOrigin = layoutPane(forked({ rows }))
    expect(plainTree.drawn.length - withOrigin.drawn.length).toBeGreaterThanOrEqual(1)
    expect(plainTree.drawn.length - withOrigin.drawn.length).toBeLessThanOrEqual(2)
    expect(withOrigin.height).toBe(plainTree.height)
  }

  // only for a tree other than main, and only when the tree knows where it began
  expect(textOf(layoutPane(input({ model: { ...modelOf(sampleNodes()), fork: FORK } }))).some(x => x.startsWith('  基于'))).toBe(false)
  expect(textOf(layoutPane(forked({ model: modelOf(sampleNodes()) }))).some(x => x.startsWith('  基于') || x.startsWith('  从空白'))).toBe(false)
  const empty: DtFork = { tree: 'main', at: null, count: 0, ts: iso(FORK_AT), actor: 'user' }
  expect(textOf(layoutPane(forked({ model: { ...modelOf(sampleNodes()), fork: empty } })))[1]).toBe('  从空白开始')
})

test('pane: without a status command there is no "now" block and no s key', () => {
  const layout = layoutPane(input({ now: NOW_NONE, statusInterval: null }))
  const t = textOf(layout)
  expect(t.some(x => x === '现在')).toBe(false)
  const keys = layout.blocks.flatMap(b => (b.kind === 'footer' ? b.line.items : [])).filter(i => i.kind === 'key')
  expect(keys.some(i => i.kind === 'key' && i.hotkey === 's')).toBe(false)
})

test('pane: the filter that is on is named in the row above the tree', () => {
  for (const [filter, label] of [
    ['all', '显示全部'],
    ['pending', '只看待定'],
    ['clean', '已隐藏否决'],
  ] as const) {
    const layout = layoutPane(input({ ui: { ...UI0, filter } }))
    const t = textOf(layout)
    expect(t.filter(x => x.includes(label))).toEqual([`  ${label}`])
    // in its own row, the last one before the tree, in the accent colour
    const at = t.indexOf(`  ${label}`)
    expect(layout.blocks[at + 1]!.kind).toBe('row')
    expect((layout.blocks[at] as Extract<Block, { kind: 'text' }>).line[1]).toEqual({ text: label, color: 'suggestion' })
  }
  // with the default filter there is no such row, and no label hanging off a rule
  expect(textOf(layoutPane(input())).some(x => /─ .+ ──$/.test(x) || x.includes('显示全部') || x.includes('只看待定'))).toBe(false)
  expect(textOf(layoutPane(input({ lang: 'en', ui: { ...UI0, filter: 'pending' } }))).filter(x => x.includes('pending only'))).toEqual(['  pending only'])
})

test('pane: nothing recorded yet, and nothing matching the filter, each say so', () => {
  const emptyIn = input({ model: { ...modelOf([]), isStarted: true } })
  const empty = layoutPane(emptyIn)
  expect(textOf(empty).some(x => x.includes('还没有记录任何决定'))).toBe(true)
  checkLayout(empty, emptyIn, 'empty')
  const none = layoutPane(input({ ui: { ...UI0, filter: 'pending' }, model: modelOf(sampleNodes().filter(n => n.status === 'adopted')) }))
  expect(textOf(none).some(x => x.includes('按 a 显示全部'))).toBe(true)
})

test('pane: a project that is not being recorded shows the invitation in the right language', () => {
  const squash = (s: string) => s.replace(/\s+/g, '')
  const off = layoutPane(input({ project: projectOf({ mode: 'off', config: null }), model: modelOf([]) }))
  const zh = squash(textOf(off).slice(2).join(''))
  expect(zh).toBe(squash("这个项目还没有开始记录决定。运行 /decide init 让 Claude 自己找出起点，/decide start 从空树开始，或在 prompt 里说'从现在开始记录决定'。"))
  const en = textOf(layoutPane(input({ lang: 'en', width: 200, project: projectOf({ mode: 'off', config: null }), model: modelOf([]) }))).join('\n')
  expect(squash(en)).toContain(
    squash("No decisions are being recorded in this project yet. Run /decide init to have Claude find the starting point, /decide start for an empty tree, or say 'start recording decisions from now' in a prompt."),
  )
  expect(off.drawn).toEqual([])
  expect(off.selected).toBe(null)
  const bad = layoutPane(input({ project: projectOf({ mode: 'off', config: null, configError: 'config.json: unexpected token' }), model: modelOf([]) }))
  expect(squash(textOf(bad).slice(2).join(''))).toBe(squash('读不了这个项目的决定记录：config.json: unexpected token'))
})

test('pane: paused says so in the header', () => {
  const t = textOf(layoutPane(input({ project: projectOf({ mode: 'paused' }) })))
  expect(t[0]!.includes('已暂停')).toBe(true)
})

test('pane: a long tree is windowed around the selection, with page rows above and below', () => {
  const nodes = bigTree(80)
  const model = modelOf(nodes)
  for (const selected of ['big-root', 'big-000', 'big-040', 'big-079']) {
    const i = input({ model, rows: 24, ui: { ...UI0, selected, filter: 'all' } })
    const layout = layoutPane(i)
    checkLayout(layout, i, selected)
    expect(layout.drawn.includes(selected)).toBe(true)
    expect(layout.height).toBeLessThanOrEqual(24)
    const treeBlocks = layout.blocks.filter(b => b.kind === 'row' || b.kind === 'page')
    expect(treeBlocks.length).toBeLessThan(24)
    const ups = layout.blocks.filter(b => b.kind === 'page' && b.dir === 'up').length
    const downs = layout.blocks.filter(b => b.kind === 'page' && b.dir === 'down').length
    // the first rows of the tree show whole; deeper selections have rows above them
    if (selected === 'big-root' || selected === 'big-000') expect(ups).toBe(0)
    else expect(ups).toBe(1)
    if (selected === 'big-079') expect(downs).toBe(0)
    else expect(downs).toBe(1)
  }
  const mid = layoutPane(input({ model, rows: 24, ui: { ...UI0, selected: 'big-040', filter: 'all' } }))
  const above = mid.blocks.find(b => b.kind === 'page' && b.dir === 'up') as Extract<Block, { kind: 'page' }>
  expect(/^ {2}▲ 上面还有 \d+ 行$/.test(lineText(above.line))).toBe(true)
})

test('pane: a selection that is not drawn falls back to the nearest drawn ancestor', () => {
  const layout = layoutPane(input({ ui: { ...UI0, selected: 'v21-run-a' } }))
  expect(layout.selected).toBe('v21-abs-size')
  const none = layoutPane(input({ ui: { ...UI0, selected: 'no-such-node' } }))
  expect(none.selected).toBe('design-v2')
})

test('pane: the edit form replaces the detail and keeps its four rows', () => {
  const ui: DtUi = { ...UI0, selected: 'v22-adopted', editing: { id: 'v22-adopted', status: 'adopted', summary: 'x' } }
  const layout = layoutPane(input({ ui, rows: 30 }))
  const at = layout.blocks.findIndex(b => b.kind === 'edit')
  expect(at).toBeGreaterThan(0)
  const edit = layout.blocks[at] as Extract<Block, { kind: 'edit' }>
  expect(edit.id).toBe('v22-adopted')
  expect(lineText(edit.title)).toBe('  编辑 v22-adopted')
  expect(textOf(layout).some(x => x.startsWith('▾ 构建版本定为'))).toBe(false)
  expect(layout.height).toBeLessThanOrEqual(30)
  // editing another node's form is not shown on this selection
  const other = layoutPane(input({ ui: { ...ui, selected: 'gateway' }, rows: 30 }))
  expect(other.blocks.some(b => b.kind === 'edit')).toBe(false)
  expect(EDIT_ROWS).toBe(4)
})

test('pane: approval asks first and carries the Allow button at the end of the now block', () => {
  const layout = layoutPane(input({ now: NOW_PENDING, statusInterval: 30 }))
  const kinds = layout.blocks.map(b => b.kind)
  const at = kinds.indexOf('allow')
  expect(at).toBeGreaterThan(1)
  expect((layout.blocks[at] as Extract<Block, { kind: 'allow' }>).label).toBe('允许运行')
  // the rule is above the block, and after the button the tree begins (after a blank row, when there is room)
  const t = textOf(layout)
  expect(t[at - 5]!.startsWith('  ─')).toBe(true)
  expect(t[at - 4]).toBe('  现在')
  expect(kinds.slice(at + 1, at + 3)).toEqual(['text', 'row'])
  expect(t[at + 1]).toBe('')
})

test('pane: whatever the width, height, language, filter and state, every line fits and the selection shows', () => {
  const states: { name: string; patch: Partial<PaneInput> }[] = [
    { name: 'plain', patch: {} },
    { name: 'selected-with-evidence', patch: { ui: { ...UI0, selected: 'v22-adopted' } } },
    { name: 'now', patch: { now: nowApproved(), statusInterval: 30 } },
    { name: 'now-stale', patch: { now: nowApproved({ fetchedAt: NOW - 600_000, error: 'boom' }), statusInterval: 30 } },
    { name: 'approval', patch: { now: NOW_PENDING, statusInterval: 30 } },
    { name: 'all', patch: { ui: { ...UI0, filter: 'all' } } },
    { name: 'pending', patch: { ui: { ...UI0, filter: 'pending', selected: 'gateway' } } },
    { name: 'clean', patch: { ui: { ...UI0, filter: 'clean' } } },
    { name: 'no-now', patch: { now: nowApproved(), statusInterval: 30, ui: { ...UI0, showNow: false } } },
    { name: 'editing', patch: { ui: { ...UI0, selected: 'gateway', editing: { id: 'gateway', status: 'in-progress', summary: '' } } } },
    { name: 'paused', patch: { project: projectOf({ mode: 'paused' }) } },
    { name: 'big', patch: { model: modelOf(bigTree(60)), ui: { ...UI0, selected: 'big-033', filter: 'all' } } },
    { name: 'off', patch: { project: projectOf({ mode: 'off', config: null }), model: modelOf([]) } },
  ]
  for (const st of states) {
    for (const lang of ['zh', 'en'] as DtLang[]) {
      for (const ascii of [false, true]) {
        for (const width of [20, 28, 36, 44, 56, 68, 80, 100, 140]) {
          for (const rows of [8, 10, 12, 16, 22, 30, 50]) {
            const i = input({ width, rows, lang, ascii, ...st.patch })
            const layout = layoutPane(i)
            const label = `${st.name}/${lang}/${ascii ? 'ascii' : 'uni'}/${width}x${rows}`
            checkLayout(layout, i, label)
            const roomy = st.name === 'editing' ? rows >= 14 : rows >= 8
            if (roomy && layout.height > rows) throw new Error(`${label}: ${layout.height} rows used in ${rows}\n${textOf(layout).join('\n')}`)
          }
        }
      }
    }
  }
})

test('pane: ASCII mode uses no glyph that a narrow-ambiguous terminal might draw wide', () => {
  const layout = layoutPane(input({ ascii: true, lang: 'en', now: nowApproved(), statusInterval: 30, ui: { ...UI0, selected: 'v22-adopted' } }))
  const text = textOf(layout).join('\n')
  expect(/[✓✗◐○⊘‖◌├└│█░─❯›▾▸▲▼▎▌●]/.test(text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef−]/g, ''))).toBe(false)
})

// ---------------------------------------------------------------- who decided, and titles with nothing to see

test('detail: the line under the title says who decided, else who recorded it', () => {
  const long = 'a title long enough to need its own lines in a narrow pane'
  const title = ['▾ a title long enough to need its own', '  lines in a narrow pane']
  // recorded by the model on the 8th, unless a case says otherwise; the 9th is the day of a decision
  const detail = (over: Partial<DtNode>, lang: DtLang = 'en', text = long, width = 40, ascii = false) =>
    detailLines({ node: node('who-1', null, { title: text, createdAt: noon(10, 8), ...over }), idx: IDX, width, ascii, lang, open: null }).map(lineText)
  const decided = { decidedBy: 'gate' as const, decidedAt: noon(10, 9) }

  // decided: whoever decided it and the day it was decided, however it was recorded
  expect(detail(decided)).toEqual([...title, '  ✓ Adopted   gate   10-09'])
  expect(detail({ decidedBy: 'user', decidedAt: noon(10, 9), createdBy: 'import' })).toEqual([...title, '  ✓ Adopted   user   10-09'])
  // not decided: whoever recorded it and the day it was recorded
  expect(detail({})).toEqual([...title, '  ✓ Adopted   model   10-08'])
  expect(detail({ createdBy: 'import' })).toEqual([...title, '  ✓ Adopted   import   10-08'])
  expect(detail({ status: 'in-progress', createdBy: 'user' })).toEqual([...title, '  ◐ In progress   user   10-08'])
  // a day that does not read is left out, and so is nothing else
  expect(detail({ decidedBy: 'gate', createdAt: 'unknown' }).at(-1)).toBe('  ✓ Adopted   gate')

  // the same in the other language, and in ASCII
  expect(detail(decided, 'zh', '一个非常非常长的标题'.repeat(2))).toEqual(['▾ 一个非常非常长的标题一个非常非常长的标', '  题', '  ✓ 采用   gate   10-09'])
  expect(detail(decided, 'en', long, 40, true)).toEqual(['v a title long enough to need its own', '  lines in a narrow pane', '  + Adopted   gate   10-09'])

  // it is always a line of its own, under the title, however short the title is
  expect(detail(decided, 'en', 'x'.repeat(12))).toEqual(['▾ xxxxxxxxxxxx', '  ✓ Adopted   gate   10-09'])
  expect(detail(decided, 'en', 'x'.repeat(13))).toEqual(['▾ xxxxxxxxxxxxx', '  ✓ Adopted   gate   10-09'])
})

test('pane: titles, summaries, evidence, notes and sources full of emoji sequences are drawn without joiners, selectors or flags, and still fit', () => {
  // what a pane must not hold: joiners, selectors, keycap marks, skin tones, regional indicators and tag characters
  const UNDRAWN = /[\p{Join_Control}\p{Variation_Selector}\p{Me}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0000}-\u{E0FFF}]/u
  expect(UNDRAWN.test(MESSY)).toBe(true)
  expect(drawable(MESSY)).toBe(TIDY)
  expect(UNDRAWN.test(TIDY)).toBe(false)

  const root = node('root', null, {
    title: `Title ${MESSY}`,
    trunk: true,
    decidedAt: noon(10, 9),
    decidedBy: 'user',
    summary: `Summary ${MESSY}`,
    rationale: `Because ${MESSY}`,
    evidence: [
      { label: `label ${MESSY}`, value: `value ${MESSY}`, ci: `[${HEART}, ${CHINA}]`, run: `run_${FAMILY}` },
      { label: `only a note ${HEART}`, note: `note ${MESSY}` },
    ],
    sources: [`docs/${MESSY}.md`, `${KEYCAP}.txt`],
    tags: [`tag${HEART}`, CHINA],
  })
  const kid = node('kid', 'root', {
    title: `Kid ${MESSY}`,
    decidedAt: noon(10, 10),
    notes: [{ ts: noon(10, 10), actor: 'user', text: `Note ${MESSY} ${MESSY}` }],
  })
  const model = modelOf([root, kid])
  const project = projectOf({ config: { ...projectOf().config!, title: `Project ${MESSY}` } })
  const draw = (lang: DtLang, width: number, selected: string): string[] => {
    const i = input({ lang, width, project, model, ui: { ...UI0, selected } })
    const layout = layoutPane(i)
    checkLayout(layout, i, `${lang}/${width}/${selected}`)
    return textOf(layout)
  }

  // at every width, in both languages, with either node selected: nothing undrawn, and every line inside the pane
  for (const lang of ['en', 'zh'] as const) {
    for (const width of [20, 28, 40, 68, 100]) {
      for (const selected of ['root', 'kid']) {
        for (const text of draw(lang, width, selected)) {
          const label = `${lang}/${width}/${selected}: ${JSON.stringify(text)}`
          if (UNDRAWN.test(text) || drawable(text) !== text) throw new Error(`${label} holds what the pane does not draw`)
          if (strWidth(text) > Math.max(16, width)) throw new Error(`${label} is wider than the pane`)
        }
      }
    }
  }

  // where there is room, each line is the tidy text and nothing else (the selected row is the bar, padded to the pane's width)
  const rule = '  ' + '─'.repeat(97)
  const bar = (left: string) => left + ' '.repeat(100 - strWidth(left))
  const t = draw('en', 100, 'root')
  expect(t[0]!.startsWith(`  Decision tree  Project ${TIDY} `)).toBe(true)
  expect(t.slice(1, 18)).toEqual([
    '',
    `  Mainline  Title ${TIDY}`,
    '',
    bar(`▌ ✓ Title ${TIDY}`),
    `    ✓ Kid ${TIDY}`,
    rule,
    `▾ Title ${TIDY}`,
    '  ✓ Adopted   user   10-09',
    '',
    `  Summary ${TIDY}`,
    '',
    `  Rationale  Because ${TIDY}`,
    `  Evidence   label ${TIDY}  value ${TIDY} [❤, CN]  run_\u{1F468}\u{1F469}\u{1F467}`,
    `             only a note ❤${' '.repeat(strWidth(`label ${TIDY}`) - strWidth('only a note ❤'))}  note ${TIDY}`,
    `  Sources    docs/${TIDY}.md  1.txt`,
    '  Tags       tag❤, CN',
    rule,
  ])
  const k = draw('en', 100, 'kid')
  expect(k.slice(4, 13)).toEqual([
    `▎ ✓ Title ${TIDY}`,
    bar(`▌   ✓ Kid ${TIDY}`),
    rule,
    `▾ Kid ${TIDY}`,
    '  ✓ Adopted   model   10-10',
    '',
    `  Notes  10-10 user  Note ${TIDY} ${TIDY}`,
    rule,
    '[footer 7]',
  ])
})

test('pane: a title that is only invisible characters draws as untitled', () => {
  // a zero-width space, a joiner, an emoji selector, a word joiner, a byte order mark, a soft hyphen,
  // a skin tone, a tag letter, and half of a surrogate pair
  const codePoints = [0x200b, 0x200d, 0xfe0f, 0x2060, 0xfeff, 0xad, 0x1f3fd, 0xe0067, 0xd83d]
  for (const cp of codePoints) expect(isAltered(cp)).toBe(true)
  const INVISIBLE = String.fromCodePoint(...codePoints)
  expect(INVISIBLE.charCodeAt(INVISIBLE.length - 1)).toBe(0xd83d) // it really ends in half a pair
  expect(drawable(INVISIBLE)).toBe('')

  const nodes = [
    node('ghost', null, { title: INVISIBLE, decidedAt: noon(10, 9) }),
    node('blank', 'ghost', { title: ' \n\t ', decidedAt: noon(10, 9) }),
    node('half', 'ghost', { title: `a${INVISIBLE}b`, decidedAt: noon(10, 9) }),
  ]
  for (const [lang, untitled] of [
    ['zh', '（无标题）'],
    ['en', '(untitled)'],
  ] as const) {
    const i = input({ lang, model: modelOf(nodes), ui: { ...UI0, selected: 'ghost' } })
    const layout = layoutPane(i)
    checkLayout(layout, i, lang)
    expect(layout.drawn).toEqual(['ghost', 'blank', 'half'])
    const t = textOf(layout)
    // two rows and the detail, none of them empty; the third title is what is left of it
    expect(t.filter(x => x.includes(untitled))).toHaveLength(3)
    expect(t.some(x => x.startsWith(`▌ ✓ ${untitled} `))).toBe(true)
    expect(t).toContain(`    ✓ ${untitled}`)
    expect(t).toContain('    ✓ ab')
    expect(t).toContain(`▾ ${untitled}`)
    // the node with something left shows it in its detail
    const half = textOf(layoutPane(input({ lang, model: modelOf(nodes), ui: { ...UI0, selected: 'half' } })))
    expect(half).toContain('▾ ab')
    expect(half.some(x => x.includes(untitled))).toBe(true)
  }
})
