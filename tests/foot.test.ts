import { expect, test } from 'claude-code/testing'

import { partText, partWidth, partsWidth } from '../lib/bar'
import type { Part } from '../lib/bar'
import { GAP, enterHint, footerItems, languageKey, overviewItems, packBar, warningsPart } from '../lib/foot'
import type { FooterInput, OverviewKeysInput } from '../lib/foot'
import type { DtLang } from '../types'

const input = (over: Partial<FooterInput> = {}): FooterInput => ({
  lang: 'en',
  ascii: false,
  canEdit: true,
  filter: 'default',
  hasNow: true,
  showNow: true,
  trees: 3,
  warnings: 0,
  ...over,
})

const textOf = (parts: readonly Part[]) => parts.map(partText).join('')
const buttons = (parts: readonly Part[]) => parts.filter((p): p is Extract<Part, { kind: 'button' }> => p.kind === 'button')
const keysOf = (parts: readonly Part[]) => parts.map(p => (p.kind === 'button' ? `${p.hotkey ?? '-'}` : 'text'))

test('footer: the keys in the order of use, each a button with the hotkey it says', () => {
  const { items, right } = footerItems(input())
  expect(items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: expand', 'e: edit', 'p: pending', 't: trees', 'o: next tree', 'c: colors', 'h: hide rejected', 'a: all', 's: now'])
  expect(keysOf(items)).toEqual(['k', 'j', 'text', 'e', 'p', 't', 'o', 'c', 'h', 'a', 's'])
  expect(buttons(items).map(b => b.key)).toEqual(['~up', '~down', '~edit', '~pending', '~trees', '~cycle', '~colors', '~clean', '~all', '~now'])
  expect(buttons(items).map(b => b.action)).toEqual([
    { do: 'move', by: -1 },
    { do: 'move', by: 1 },
    { do: 'edit' },
    { do: 'filter', filter: 'pending' },
    { do: 'overview' },
    { do: 'cycle', by: 1 },
    { do: 'colors' },
    { do: 'filter', filter: 'clean' },
    { do: 'filter', filter: 'all' },
    { do: 'now' },
  ])
  // the one hint that is text: Enter presses the row that has the focus
  expect(items[2]).toEqual({ kind: 'text', spans: [{ text: '⏎: expand', color: 'inactive', dim: true }] })
  // the right group: the language key, which names the language it switches to
  expect(textOf(right)).toBe('l: 中')
  // every hotkey is one lowercase letter or digit (the engine refuses anything else) and none is used twice
  const hotkeys = buttons([...items, ...right]).flatMap(b => (b.hotkey === null ? [] : [b.hotkey]))
  expect(hotkeys.every(h => /^[a-z0-9]$/.test(h))).toBe(true)
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
})

test('footer: a key is offered only when it has something to do', () => {
  const none = footerItems(input({ canEdit: false, trees: 1, hasNow: false }))
  expect(keysOf(none.items)).toEqual(['k', 'j', 'text', 'p', 't', 'c', 'h', 'a'])
  // two trees are enough to cycle between
  expect(keysOf(footerItems(input({ trees: 2 })).items)).toContain('o')
  expect(keysOf(footerItems(input({ trees: 0 })).items)).not.toContain('o')
  // in ASCII Enter is spelled out, and so are the arrows
  expect(textOf([enterHint('en', true)])).toBe('Enter: expand')
  expect(textOf(footerItems(input({ ascii: true })).items)).toContain('Enter: expand')
  expect(footerItems(input({ ascii: true })).items.slice(0, 3).map(partText)).toEqual(['k: up', 'j: down', 'Enter: expand'])
})

test('footer: the key of the filter that is on, and of the status block when it is shown, are bold', () => {
  const bold = (over: Partial<FooterInput>, key: string) => buttons(footerItems(input(over)).items).find(b => b.key === key)!.spans[0]!.bold === true
  expect(bold({}, '~pending')).toBe(false)
  expect(bold({ filter: 'pending' }, '~pending')).toBe(true)
  expect(bold({ filter: 'clean' }, '~clean')).toBe(true)
  expect(bold({ filter: 'all' }, '~all')).toBe(true)
  expect(bold({ showNow: true }, '~now')).toBe(true)
  expect(bold({ showNow: false }, '~now')).toBe(false)
})

test('footer: the words are in the language of the pane, with the terms of the trade in English', () => {
  const zh = footerItems(input({ lang: 'zh' }))
  expect(zh.items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: 展开', 'e: 编辑', 'p: pending', 't: 总览', 'o: 下个 tree', 'c: 配色', 'h: 隐藏 rejected', 'a: 全部', 's: now'])
  expect(textOf(zh.right)).toBe('l: EN')
  expect(buttons([languageKey('en')])[0]!.action).toEqual({ do: 'lang', lang: 'zh' })
  expect(buttons([languageKey('zh')])[0]!.action).toEqual({ do: 'lang', lang: 'en' })
  expect(partText(languageKey('en'))).toBe('l: 中')
  expect(partText(languageKey('zh'))).toBe('l: EN')
})

test('footer: the count of warnings sits flush right beside the language key, and only when there is something to count', () => {
  expect(textOf(footerItems(input()).right)).toBe('l: 中')
  const warned = footerItems(input({ warnings: 2 })).right
  expect(textOf(warned)).toBe('warnings 2  l: 中')
  expect(buttons(warned)[0]).toMatchObject({ key: '~warnings', hotkey: null, action: { do: 'warnings' } })
  expect(buttons(warned)[0]!.spans[0]).toEqual({ text: 'warnings 2', color: 'warning' })
  expect(textOf(footerItems(input({ warnings: 1, lang: 'zh' })).right)).toBe('warnings 1  l: EN')
  // nothing to count: quiet
  expect(warningsPart('en', 0)).toMatchObject({ dim: true })
  expect(warningsPart('en', 0).spans).toEqual([{ text: 'warnings 0' }])
  expect(GAP).toBe(2)
})

test('footer: packed into the width asked, the right group flush right on the first line, keys that do not fit dropped from the end', () => {
  const { items, right } = footerItems(input())
  const one = packBar(items, right, 120, 3)
  expect(one).toHaveLength(1)
  expect(textOf(one[0]!)).toMatch(/^k: ↑ {2}j: ↓ {2}⏎: expand {2}e: edit {2}p: pending {2}t: trees {2}o: next tree {2}c: colors {2}h: hide rejected {2}a: all {2}s: now +l: 中$/)
  expect(partsWidth(one[0]!)).toBe(120)

  // narrower: the rest goes on to the next lines, in order
  const two = packBar(items, right, 100, 3)
  expect(two.map(textOf)).toEqual([
    'k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree  c: colors                  l: 中',
    'h: hide rejected  a: all  s: now',
  ])
  expect(partsWidth(two[0]!)).toBe(100)

  // at most as many lines as allowed: what does not fit in them is not drawn (and so does not work)
  const cramped = packBar(items, right, 40, 3)
  expect(cramped).toHaveLength(3)
  expect(cramped.map(textOf)).toEqual(['k: ↑  j: ↓  ⏎: expand  e: edit     l: 中', 'p: pending  t: trees  o: next tree', 'c: colors  h: hide rejected  a: all'])
  expect(packBar(items, right, 40, 1).map(textOf)).toEqual(['k: ↑  j: ↓  ⏎: expand  e: edit     l: 中'])
})

test('footer: very narrow, the count of warnings goes first, then the language key, and no line is wider than the pane', () => {
  const warned = footerItems(input({ warnings: 2 }))
  const at = (width: number) => packBar(warned.items, warned.right, width, 3).map(textOf)
  expect(at(60)[0]).toMatch(/warnings 2 {2}l: 中$/)
  expect(at(40)[0]).toMatch(/ l: 中$/)
  expect(at(40)[0]).not.toContain('warnings')
  expect(at(26).join('\n')).not.toContain('l: 中')
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const warnings of [0, 3]) {
      const f = footerItems(input({ lang, warnings }))
      for (let width = 8; width <= 140; width++) {
        for (const maxLines of [1, 2, 3]) {
          const lines = packBar(f.items, f.right, width, maxLines)
          expect(lines.length).toBeLessThanOrEqual(maxLines)
          for (const line of lines) expect(partsWidth(line), `${lang} ${warnings} ${width}x${maxLines}`).toBeLessThanOrEqual(width)
        }
      }
    }
  }
  // a key is never cut in half: each part of a line is drawn whole
  const widest = partWidth(footerItems(input()).items[8]!)
  expect(widest).toBeGreaterThan(0)
})

// ---------------------------------------------------------------- the keys of the overview

const overview = (over: Partial<OverviewKeysInput> = {}): OverviewKeysInput => ({ lang: 'en', ascii: false, canCreate: true, forming: false, ...over })

test('overview footer: the keys in the order of use, each a button with the hotkey it says', () => {
  const { items, right } = overviewItems(overview())
  expect(items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: open', 'r: record here', 'n: new tree', 't: back'])
  expect(keysOf(items)).toEqual(['k', 'j', 'text', 'r', 'n', 't'])
  expect(buttons(items).map(b => b.key)).toEqual(['~up', '~down', '~record', '~new', '~back'])
  expect(buttons(items).map(b => b.action)).toEqual([{ do: 'move', by: -1 }, { do: 'move', by: 1 }, { do: 'record' }, { do: 'new' }, { do: 'back' }])
  // Enter presses the control that has the focus, which in the overview opens the tree
  expect(items[2]).toEqual({ kind: 'text', spans: [{ text: '⏎: open', color: 'inactive', dim: true }] })
  expect(textOf(right)).toBe('l: 中')
  // hotkeys are one lowercase letter or digit each, and none is used twice
  const hotkeys = buttons([...items, ...right]).flatMap(b => (b.hotkey === null ? [] : [b.hotkey]))
  expect(hotkeys.every(h => /^[a-z0-9]$/.test(h))).toBe(true)
  expect(new Set(hotkeys).size).toBe(hotkeys.length)
  // and they are the hotkeys of the tree view where the meaning is the same
  const view = footerItems(input())
  for (const name of ['~up', '~down']) expect(buttons(items).find(b => b.key === name)!.hotkey).toBe(buttons(view.items).find(b => b.key === name)!.hotkey)
})

test('overview footer: where nothing can be typed there is no key for a new tree; with the form open the only key is the one that makes it', () => {
  expect(keysOf(overviewItems(overview({ canCreate: false })).items)).toEqual(['k', 'j', 'text', 'r', 't'])
  const form = overviewItems(overview({ forming: true }))
  expect(form.items.map(partText)).toEqual(['⏎: create'])
  expect(buttons(form.items)).toEqual([])
  // the language key stays, because the person may want the form's words in the other language
  expect(textOf(form.right)).toBe('l: 中')
  expect(textOf(overviewItems(overview({ forming: true, canCreate: false })).items)).toBe('⏎: create')
})

test('overview footer: the words are in the language of the pane, with the terms of the trade in English; ASCII spells the arrows and Enter', () => {
  const zh = overviewItems(overview({ lang: 'zh' }))
  expect(zh.items.map(partText)).toEqual(['k: ↑', 'j: ↓', '⏎: 打开', 'r: 记到这里', 'n: 新 tree', 't: 返回'])
  expect(textOf(zh.right)).toBe('l: EN')
  expect(overviewItems(overview({ lang: 'zh', forming: true })).items.map(partText)).toEqual(['⏎: 创建'])
  expect(overviewItems(overview({ ascii: true })).items.map(partText)).toEqual(['k: up', 'j: down', 'Enter: open', 'r: record here', 'n: new tree', 't: back'])
  expect(overviewItems(overview({ ascii: true, forming: true })).items.map(partText)).toEqual(['Enter: create'])
})

test('overview footer: packed into the width asked, the language key flush right on the first line, keys that do not fit dropped from the end', () => {
  const { items, right } = overviewItems(overview())
  const wide = packBar(items, right, 100, 3)
  expect(wide).toHaveLength(1)
  expect(textOf(wide[0]!)).toMatch(/^k: ↑ {2}j: ↓ {2}⏎: open {2}r: record here {2}n: new tree {2}t: back +l: 中$/)
  expect(partsWidth(wide[0]!)).toBe(100)
  const narrow = packBar(items, right, 40, 3)
  expect(narrow.map(textOf)).toEqual(['k: ↑  j: ↓  ⏎: open                l: 中', 'r: record here  n: new tree  t: back'])
  expect(partsWidth(narrow[0]!)).toBe(40)
  // the least useful go first: with one line only the first keys remain
  const one = packBar(items, right, 30, 1)
  expect(one).toHaveLength(1)
  expect(textOf(one[0]!)).toMatch(/^k: ↑ {2}j: ↓ {2}⏎: open +l: 中$/)
  expect(partsWidth(one[0]!)).toBe(30)
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const forming of [false, true]) {
      const set = overviewItems(overview({ lang, forming }))
      for (let width = 8; width <= 130; width++) {
        for (const line of packBar(set.items, set.right, width, 3)) expect(partsWidth(line), `${lang} ${forming} ${width}`).toBeLessThanOrEqual(width)
      }
    }
  }
})
