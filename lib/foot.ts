// The keys at the bottom of the pane. Each is a button whose hotkey works while the pane holds the focus,
// so a key that is not drawn does not work: when the pane is narrow the least useful ones go first.
//
//   k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree  c: colors      warnings 2  l: 中
//   k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back                                    l: 中     (the overview)
//   k: ↑  j: ↓  ⏎: use  r: default  c: back                                                      l: 中     (the colours)
//
// The engine draws a hotkey button without chrome, as `key: label` (the key in the accent colour); that
// is why the hints read like this and are not key caps.

import type { DtFilter, DtLang } from '../types'
import type { Part } from './bar'
import { buttonPart, partWidth, partsWidth, textPart } from './bar'
import { t } from './i18n'
import { QUIET, S } from './style'

/** The columns between two keys. */
export const GAP = 2

/** What the bottom of the tree view depends on. */
export type FooterInput = {
  lang: DtLang
  ascii: boolean
  /** The pane has a text field to edit in, and shows the tree that is recorded into. */
  canEdit: boolean
  filter: DtFilter
  hasNow: boolean
  showNow: boolean
  /** How many trees the project has. */
  trees: number
  warnings: number
}

export type FooterItems = {
  /** The keys, most useful first. */
  items: Part[]
  /** The part flush right: the count of warnings, and the language key (never dropped). */
  right: Part[]
}

/** `l: 中` in an English pane, `l: EN` in a Chinese one: the key names the language it switches to. */
export function languageKey(lang: DtLang): Part {
  const to: DtLang = lang === 'zh' ? 'en' : 'zh'
  return buttonPart('~lang', { do: 'lang', lang: to }, [S(to === 'en' ? 'EN' : '中')], { hotkey: 'l' })
}

export function warningsPart(lang: DtLang, count: number): Part {
  return buttonPart('~warnings', { do: 'warnings' }, count > 0 ? [S(t(lang, 'pane.warnings', { n: count }), { color: 'warning' })] : [S(t(lang, 'pane.warnings', { n: count }))], { dim: count === 0 })
}

function key(id: string, hotkey: string, label: string, action: Parameters<typeof buttonPart>[1], active = false): Part {
  return buttonPart(`~${id}`, action, [S(label, active ? { bold: true } : {})], { hotkey })
}

/** The hint for Enter, which is the press of the focused row and so needs no button of its own. */
export function enterHint(lang: DtLang, ascii: boolean, label = t(lang, 'key.expand')): Part {
  return textPart([S(`${ascii ? 'Enter' : '⏎'}: ${label}`, QUIET)])
}

/** What the bottom of the overview depends on. */
export type OverviewKeysInput = {
  lang: DtLang
  ascii: boolean
  /** The pane has text fields to name a new tree in. */
  canCreate: boolean
  /** The form for a new tree is open. */
  forming: boolean
}

/** The keys of the overview, most useful first; while the form for a new tree is open, the one that makes it. */
export function overviewItems(f: OverviewKeysInput): FooterItems {
  const right: Part[] = [languageKey(f.lang)]
  if (f.forming) return { items: [enterHint(f.lang, f.ascii, t(f.lang, 'key.create'))], right }
  const items: Part[] = [
    key('up', 'k', f.ascii ? 'up' : '↑', { do: 'move', by: -1 }),
    key('down', 'j', f.ascii ? 'down' : '↓', { do: 'move', by: 1 }),
    enterHint(f.lang, f.ascii, t(f.lang, 'key.open')),
    key('record', 'r', t(f.lang, 'key.record'), { do: 'record' }),
  ]
  if (f.canCreate) items.push(key('new', 'n', t(f.lang, 'key.new'), { do: 'new' }))
  items.push(key('back', 't', t(f.lang, 'key.back'), { do: 'back' }))
  return { items, right }
}

/** What the bottom of the picker of colours depends on. */
export type PickerKeysInput = {
  lang: DtLang
  ascii: boolean
}

/** The keys of the picker of colours. `⏎: use` is a button too, so that a click can keep the scheme that is highlighted. */
export function pickerItems(f: PickerKeysInput): FooterItems {
  const items: Part[] = [
    key('up', 'k', f.ascii ? 'up' : '↑', { do: 'move', by: -1 }),
    key('down', 'j', f.ascii ? 'down' : '↓', { do: 'move', by: 1 }),
    buttonPart('~use', { do: 'use' }, [S(`${f.ascii ? 'Enter' : '⏎'}: ${t(f.lang, 'key.use')}`, QUIET)]),
    key('reset', 'r', t(f.lang, 'colors.default'), { do: 'reset' }),
    key('back', 'c', t(f.lang, 'key.back'), { do: 'back' }),
  ]
  return { items, right: [languageKey(f.lang)] }
}

/** The keys of the tree view, most useful first. */
export function footerItems(f: FooterInput): FooterItems {
  const items: Part[] = [
    key('up', 'k', f.ascii ? 'up' : '↑', { do: 'move', by: -1 }),
    key('down', 'j', f.ascii ? 'down' : '↓', { do: 'move', by: 1 }),
    enterHint(f.lang, f.ascii),
  ]
  if (f.canEdit) items.push(key('edit', 'e', t(f.lang, 'key.edit'), { do: 'edit' }))
  items.push(key('pending', 'p', t(f.lang, 'key.pending'), { do: 'filter', filter: 'pending' }, f.filter === 'pending'))
  items.push(key('trees', 't', t(f.lang, 'key.trees'), { do: 'overview' }))
  if (f.trees > 1) items.push(key('cycle', 'o', t(f.lang, 'key.tree'), { do: 'cycle', by: 1 }))
  items.push(key('colors', 'c', t(f.lang, 'key.colors'), { do: 'colors' }))
  items.push(key('clean', 'h', t(f.lang, 'key.clean'), { do: 'filter', filter: 'clean' }, f.filter === 'clean'))
  items.push(key('all', 'a', t(f.lang, 'key.all'), { do: 'filter', filter: 'all' }, f.filter === 'all'))
  if (f.hasNow) items.push(key('now', 's', t(f.lang, 'key.now'), { do: 'now' }, f.showNow))
  const right: Part[] = []
  if (f.warnings > 0) right.push(warningsPart(f.lang, f.warnings), textPart([S(' '.repeat(GAP))]))
  right.push(languageKey(f.lang))
  return { items, right }
}

/**
 * Packs the keys into at most `maxLines` lines of `width` columns. The right group (the warnings, the language
 * key) has first claim on the end of the first line; keys that do not fit are dropped from the end. Each line is
 * the parts to draw, the gaps and the padding between them included.
 */
export function packBar(items: readonly Part[], right: readonly Part[], width: number, maxLines: number): Part[][] {
  const gap = textPart([S(' '.repeat(GAP))])
  // narrow: the count of warnings goes first, then the right group altogether
  const groups = [right, right.filter(p => p.kind === 'button' && p.hotkey !== null), []]
  const keep = groups.find(g => g.length === 0 || width >= partsWidth(g) + 24) ?? []
  const reserve = keep.length > 0 ? partsWidth(keep) + GAP : 0

  const lines: Part[][] = [[]]
  let used = 0
  let limit = width - reserve
  for (const item of items) {
    const w = partWidth(item)
    const cur = lines[lines.length - 1]!
    const need = (cur.length > 0 ? GAP : 0) + w
    if (used + need <= limit) {
      if (cur.length > 0) cur.push(gap)
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
  if (keep.length > 0) {
    const first = lines[0]!
    const pad = Math.max(1, width - partsWidth(first) - partsWidth(keep))
    first.push(textPart([S(' '.repeat(pad))]), ...keep)
  }
  return lines
}
