import { expect, test } from 'claude-code/testing'

import { schemeKey } from '../lib/bar'
import { blockText, layoutPane } from '../lib/layout'
import type { Block, PaneLayout } from '../lib/layout'
import { DEFAULT_SCHEME, SCHEMES, effectiveScheme, schemeOf, swatchOf } from '../lib/palettes'
import { pickerItems } from '../lib/foot'
import { partText } from '../lib/bar'
import type { DtLang } from '../types'
import { checkColors, colorsInput, textOf, ui } from './panes'

const WIDTHS = [16, 20, 24, 30, 36, 44, 52, 60, 72, 80, 100, 132]
const ROWS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 34, 40, 60]

const schemesOf = (layout: PaneLayout) => layout.blocks.filter((b): b is Extract<Block, { kind: 'scheme' }> => b.kind === 'scheme')
const lineOf = (layout: PaneLayout, id: string): string => blockText(schemesOf(layout).find(b => b.id === id)!)
const drawn = (over: Parameters<typeof colorsInput>[0] = {}) => layoutPane(colorsInput({ width: 80, rows: 44, ...over }))

// ---------------------------------------------------------------- what is drawn

test('picker: a line for each scheme in the order of the list, the highlighted one marked, a button of its own for each', () => {
  const layout = drawn()
  checkColors(layout, colorsInput({ width: 80, rows: 44 }), '80x44')
  expect(layout.listed).toEqual(SCHEMES.map(s => s.id))
  expect(layout.picked).toBe('nord')
  expect(schemesOf(layout).filter(b => b.selected).map(b => b.id)).toEqual(['nord'])
  expect(lineOf(layout, 'nord').startsWith('▌ Nord')).toBe(true)
  expect(lineOf(layout, 'one-dark').startsWith('  One Dark')).toBe(true)
  // the names are set in one column, and the swatches start in one column
  const starts = SCHEMES.map(s => lineOf(layout, s.id).indexOf('●'))
  expect(new Set(starts).size).toBe(1)
  // what a reader of buttons is told
  expect(schemesOf(layout).find(b => b.id === 'nord')!.label).toBe('Nord, cool and muted, for dark terminals')
  expect(schemesOf(layout).find(b => b.id === 'terminal')!.label).toBe("Terminal, your terminal's own 16 colors, in use")
  expect(schemeKey('nord')).toBe('~scheme:nord')
})

test('picker: the strip, the heading with the hint, and the keys', () => {
  const lines = textOf(drawn())
  expect(lines[0]).toMatch(/^ {2}notes-app {2,}EN {2}中$/)
  expect(lines[1]).toMatch(/^ {2}Colors {3}16 schemes {2,}It stays as you choose it, in every project\.$/)
  expect(lines[lines.length - 1]).toMatch(/^ {2}k: ↑ {2}j: ↓ {2}⏎: use {2}r: default {2}c: back {2,}l: 中$/)
  // nothing but the strip and the heading is a tab of trees
  expect(lines[0]).not.toContain('main')
})

test('picker: the scheme in use says so, and the default says so while it is not in use', () => {
  const first = drawn()
  expect(lineOf(first, 'terminal')).toMatch(/in use$/)
  expect(first.blocks.filter(b => blockText(b).endsWith('default'))).toHaveLength(0)

  const later = drawn({ scheme: 'nord' })
  expect(lineOf(later, 'nord').trimEnd()).toMatch(/in use$/)
  expect(lineOf(later, 'terminal').trimEnd()).toMatch(/default$/)
  expect(schemesOf(later).filter(b => /in use$/.test(blockText(b).trimEnd()))).toHaveLength(1)
  // a stored id this version does not know is the default
  expect(lineOf(drawn({ scheme: 'gone' }), 'terminal')).toMatch(/in use$/)

  const zh = drawn({ scheme: 'nord', lang: 'zh' })
  expect(lineOf(zh, 'nord').trimEnd()).toMatch(/当前$/)
  expect(lineOf(zh, 'terminal').trimEnd()).toMatch(/默认$/)
  expect(textOf(zh)[1]).toMatch(/^ {2}配色 {3}16 个方案 {2,}选好后在所有项目里都保持这个配色。$/)
})

test('picker: with nothing highlighted the scheme in use is, and a highlight that names no scheme falls back to it', () => {
  const none = drawn({ ui: ui({ view: 'colors', pick: null }), scheme: 'dracula' })
  expect(none.picked).toBe('dracula')
  const unknown = drawn({ ui: ui({ view: 'colors', pick: 'no-such' }), scheme: 'dracula' })
  expect(unknown.picked).toBe('dracula')
  expect(layoutPane(colorsInput({ ui: ui({ view: 'colors', pick: null }) })).picked).toBe(DEFAULT_SCHEME)
})

test('picker: the notes are the pane\'s language', () => {
  expect(lineOf(drawn(), 'one-dark')).toContain('Atom, for dark terminals')
  expect(lineOf(drawn({ lang: 'zh' }), 'one-dark')).toContain('Atom 的深色')
  expect(lineOf(drawn({ lang: 'zh' }), 'theme')).toContain('跟随 Claude Code 的 theme')
})

test('picker: it works in a project that is not recorded, and over any view the pane was in', () => {
  const off = drawn({ project: { ...colorsInput().project, mode: 'off', config: null } })
  checkColors(off, colorsInput({ width: 80, rows: 44, project: { ...colorsInput().project, mode: 'off', config: null } }), 'off')
  expect(off.listed).toHaveLength(SCHEMES.length)
  // (a view of trees that is open does not hide it: the view says which)
  expect(layoutPane(colorsInput({ ui: ui({ view: 'tree' }) })).listed).toEqual([])
})

// ---------------------------------------------------------------- the swatches

test('picker: a swatch is the scheme\'s seven colours, fixed, so that the scheme the pane is drawn in does not repaint them', () => {
  const layout = drawn()
  for (const s of SCHEMES) {
    const dots = schemesOf(layout).find(b => b.id === s.id)!.line.filter(sp => sp.text === '●')
    expect(dots, s.id).toHaveLength(7)
    expect(dots.map(d => d.color), s.id).toEqual(swatchOf(effectiveScheme(s, 'terminal')))
    expect(dots.every(d => d.fixed === true), s.id).toBe(true)
  }
  // the theme's swatch is the theme's own keys
  expect(schemesOf(layout).find(b => b.id === 'theme')!.line.filter(sp => sp.text === '●').map(d => d.color)).toEqual(['error', 'claude', 'warning', 'success', 'planMode', 'ide', 'merged'])
})

test('picker: the terminal\'s own colours are a terminal\'s: any other surface shows the theme\'s in their place', () => {
  const desktop = drawn({ surface: 'desktop' })
  const dots = schemesOf(desktop).find(b => b.id === 'terminal')!.line.filter(sp => sp.text === '●')
  expect(dots.map(d => d.color)).toEqual(swatchOf(schemeOf('theme')))
  expect(schemesOf(desktop).find(b => b.id === 'nord')!.line.filter(sp => sp.text === '●').map(d => d.color)).toEqual(swatchOf(schemeOf('nord')))
})

test('picker: ASCII mode draws plain dots, a plain mark and plain page marks', () => {
  const layout = drawn({ ascii: true, rows: 14, width: 60 })
  checkColors(layout, colorsInput({ ascii: true, rows: 14, width: 60 }), 'ascii')
  const lines = textOf(layout).join('\n')
  expect(lines).toContain('* * * * * * *')
  expect(lines).not.toContain('●')
  expect(lines).toMatch(/^> Nord/m)
  expect(lines).toContain('Enter: use')
  expect(lines).toMatch(/\bv \d+ more below/)
  expect(/[▲▼▌⏎↑↓]/.test(lines)).toBe(false)
})

// ---------------------------------------------------------------- the sample

test('picker: a sample of the pane is drawn under the list while the list keeps its length beside it, in a frame that names the scheme', () => {
  const lines = textOf(drawn())
  const top = lines.findIndex(l => l.includes('╭─ Preview'))
  expect(top).toBeGreaterThan(0)
  expect(lines[top]).toMatch(/Preview ─+ Nord ─╮$/)
  expect(lines[top + 1]).toContain('Notes app: offline-first rewrite')
  const sample = lines.slice(top, top + 9).join('\n')
  // the same rail as the real pane: steps, branches of each status, the head, the selected row with its bar
  expect(sample).toContain('Storage: SQLite with a write-ahead log')
  expect(sample).toContain('✗ Keep JSON files and add a lock file')
  expect(sample).toContain('◐ Replay 200 recorded sessions')
  expect(sample).toContain('◌ Staged rollout: 5% first')
  expect(sample).toContain('◉  Sync')
  expect(sample).toMatch(/│▌ +◉/)
  expect(lines[top + 8]).toMatch(/^ {2}╰─+╯$/)

  // it follows the highlight
  const other = textOf(drawn({ ui: ui({ view: 'colors', pick: 'github-light' }) }))
  expect(other.find(l => l.includes('╭─ Preview'))).toMatch(/Preview ─+ GitHub Light ─╮$/)

  // without the room for both, the list has it all
  expect(textOf(drawn({ rows: 16 })).some(l => l.includes('Preview'))).toBe(false)
  expect(textOf(drawn({ rows: 24 })).some(l => l.includes('Preview'))).toBe(true) // 24 rows: 11 schemes beside it
  expect(textOf(drawn({ rows: 20 })).some(l => l.includes('Preview'))).toBe(false)
})

test('picker: the sample reads in the pane\'s language, and its words are coloured like the real ones', () => {
  const zh = textOf(drawn({ lang: 'zh' })).join('\n')
  expect(zh).toContain('╭─ 预览')
  expect(zh).toContain('存储：SQLite 加预写日志')
  expect(zh).toContain('“浸泡测试”通过后，向 500 名测试者开放 beta')

  const layout = drawn()
  const kinds = (piece: string): (string | undefined)[] =>
    layout.blocks.flatMap(b => (b.kind === 'text' ? b.line.filter(sp => sp.text === piece).map(sp => sp.color) : []))
  expect(kinds('Storage:')).toContain('ide') // the topic of a title
  expect(kinds('SQLite')).toContain('planMode') // a technical word
  expect(kinds('"soak test"')).toContain('success') // a quote
  expect(kinds('200')).toContain('warning') // a number
})

// ---------------------------------------------------------------- the window

test('picker: a pane too short for the list draws a window around the highlight, with the marks of what is above and below', () => {
  const small = drawn({ rows: 14, width: 60, ui: ui({ view: 'colors', pick: 'dracula' }) })
  checkColors(small, colorsInput({ rows: 14, width: 60, ui: ui({ view: 'colors', pick: 'dracula' }) }), '60x14')
  const text = textOf(small)
  expect(text.some(l => /▲ \d+ more above/.test(l))).toBe(true)
  expect(text.some(l => /▼ \d+ more below/.test(l))).toBe(true)
  expect(small.listed).toContain('dracula')

  // the last scheme is reachable: the window shows the end of the list, and nothing is marked below
  const last = SCHEMES[SCHEMES.length - 1]!.id
  const end = drawn({ rows: 14, width: 60, ui: ui({ view: 'colors', pick: last }) })
  checkColors(end, colorsInput({ rows: 14, width: 60, ui: ui({ view: 'colors', pick: last }) }), 'end')
  expect(end.listed[end.listed.length - 1]).toBe(last)
  expect(textOf(end).some(l => l.includes('more below'))).toBe(false)
  expect(textOf(end).some(l => l.includes('more above'))).toBe(true)

  // the first one
  const first = drawn({ rows: 14, width: 60, ui: ui({ view: 'colors', pick: 'terminal' }) })
  expect(first.listed[0]).toBe('terminal')
  expect(textOf(first).some(l => l.includes('more above'))).toBe(false)

  // a page mark moves the highlight by a window
  const marks = small.blocks.filter((b): b is Extract<Block, { kind: 'page' }> => b.kind === 'page')
  expect(marks.map(m => m.dir)).toEqual(['up', 'down'])
  expect(marks.every(m => m.step >= 1)).toBe(true)
})

// ---------------------------------------------------------------- the line adapts to the room

test('picker: a narrow pane gives up the note, then the blanks between the dots, then the dots, the same in every line', () => {
  const at = (width: number) => schemesOf(drawn({ width, rows: 60 })).map(b => blockText(b))
  const every = (lines: string[], piece: string) => lines.every(l => l.includes(piece))

  const wide = at(100)
  expect(every(wide, '● ● ● ● ● ● ●')).toBe(true)
  expect(wide.find(l => l.includes('One Dark'))).toContain('Atom, for dark terminals')
  expect(wide.find(l => l.includes('Nord'))).toContain('cool and muted')

  const medium = at(56)
  expect(every(medium, '● ● ● ● ● ● ●')).toBe(true)
  expect(medium.some(l => l.includes('Atom'))).toBe(false)

  const narrow = at(40)
  expect(every(narrow, '●●●●●●●')).toBe(true)

  const tiny = at(24)
  expect(tiny.some(l => l.includes('●'))).toBe(false)
  expect(tiny.find(l => l.includes('Nord'))).toBeDefined()
})

// ---------------------------------------------------------------- the keys

test('picker: the keys are up, down, use, default and back, and use is a button too (a click keeps the scheme highlighted)', () => {
  const keys = pickerItems({ lang: 'en', ascii: false })
  expect(keys.items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: use', 'r: default', 'c: back'])
  expect(keys.items.map(p => (p.kind === 'button' ? p.action.do : 'text'))).toEqual(['move', 'move', 'use', 'reset', 'back'])
  expect(keys.items.map(p => (p.kind === 'button' ? p.key : ''))).toEqual(['~up', '~down', '~use', '~reset', '~back'])
  expect(keys.items.map(p => (p.kind === 'button' ? p.hotkey : null))).toEqual(['k', 'j', null, 'r', 'c'])
  expect(keys.right.map(partText)).toEqual(['l: 中'])

  expect(pickerItems({ lang: 'zh', ascii: false }).items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: 使用', 'r: 默认', 'c: 返回'])
  expect(pickerItems({ lang: 'en', ascii: true }).items.map(partText)).toEqual(['k: up', 'j: down', 'Enter: use', 'r: default', 'c: back'])
})

// ---------------------------------------------------------------- sizes

test('picker: never wider than the pane or taller than its rows, with every scheme highlighted, in either language and in ASCII', { timeoutMs: 30000 }, () => {
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const ascii of [false, true]) {
      for (const width of WIDTHS) {
        for (const rows of ROWS) {
          for (const s of SCHEMES) {
            // (every scheme is highlighted at a few sizes; the other sizes keep to three, which still reach both ends of the list)
            if (!(rows === 12 || rows === 24 || width === 44) && !['terminal', 'nord', 'github-light'].includes(s.id)) continue
            for (const pin of [false, true]) {
              const i = colorsInput({ lang, ascii, width, rows, pin, ui: ui({ view: 'colors', pick: s.id }), scheme: s.id === 'nord' ? 'terminal' : 'nord' })
              checkColors(layoutPane(i), i, `${lang}${ascii ? '/ascii' : ''}/${width}x${rows}/${s.id}${pin ? '/docked' : ''}`)
            }
          }
        }
      }
    }
  }
})

test('picker: a docked pane keeps its keys on its last rows', () => {
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const rows of [6, 12, 16, 24, 40, 60]) {
      const layout = layoutPane(colorsInput({ lang, width: 72, rows, pin: true }))
      expect(layout.height).toBe(rows)
      expect(layout.blocks[layout.blocks.length - 1]!.kind).toBe('bar')
    }
  }
})
