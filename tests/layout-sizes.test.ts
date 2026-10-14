import { expect, test } from 'claude-code/testing'

import { EDIT_ROWS, layoutPane } from '../lib/layout'
import type { PaneInput, PaneLayout } from '../lib/layout'
import { describeArgv } from '../lib/status'
import type { DtLang } from '../types'
import { NOW_PENDING, crdtModel, notesModel, notesTm, nowApproved } from './notes'
import { allowOf, check, input, rowsOf, textOf, ui } from './panes'

const WIDTHS = [16, 20, 24, 30, 36, 44, 52, 60, 72, 80, 100, 132]
const ROWS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 28, 34, 40, 60]

const other = (lang: DtLang): DtLang => (lang === 'en' ? 'zh' : 'en')

/** Every state a pane can be in, as a function of the language it is drawn in. */
const STATES: Record<string, (lang: DtLang) => Partial<PaneInput>> = {
  tree: lang => ({ lang, model: notesModel(lang) }),
  foreign: lang => ({ lang, model: notesModel(other(lang)), translating: 9 }),
  translated: lang => ({ lang, model: notesModel(other(lang)), tm: notesTm(other(lang)) }),
  now: lang => ({ lang, model: notesModel(lang), statusInterval: 30, now: nowApproved() }),
  stale: lang => ({ lang, model: notesModel(lang), statusInterval: 30, now: nowApproved({ fetchedAt: 1, error: 'timed out after 15000 ms' }) }),
  asking: lang => ({ lang, model: notesModel(lang), statusInterval: 30, now: NOW_PENDING }),
  crdt: lang => ({ lang, model: crdtModel(lang), ui: ui({ tree: 'crdt-engine', selected: 'x3' }) }),
  pending: lang => ({ lang, model: notesModel(lang), ui: ui({ filter: 'pending', selected: 'n8' }) }),
  clean: lang => ({ lang, model: notesModel(lang), ui: ui({ filter: 'clean' }) }),
  all: lang => ({ lang, model: notesModel(lang), ui: ui({ filter: 'all', selected: 'n14' }) }),
  editing: lang => ({ lang, model: notesModel(lang), ui: ui({ editing: { id: 'n3', status: 'adopted', summary: '' } }) }),
  nothing: lang => ({ lang, model: { ...notesModel(lang), nodes: [] } }),
  warned: lang => ({ lang, model: { ...notesModel(lang), warningCount: 3, warnings: ['a', 'b', 'c'] } }),
  paused: lang => ({ lang, model: notesModel(lang), project: { ...input().project, mode: 'paused' } }),
  off: lang => ({ lang, project: { ...input().project, mode: 'off', config: null } }),
  pinned: lang => ({ lang, model: notesModel(lang), pin: true }),
}

// One test for each state, so that a failure names the state and none of them is slow.
for (const [name, state] of Object.entries(STATES)) {
  test(`sizes: the pane ${name} is never wider than its width or taller than its rows, in either language and in ASCII`, { timeoutMs: 30000 }, () => {
    for (const lang of ['en', 'zh'] as DtLang[]) {
      for (const ascii of [false, true]) {
        for (const width of WIDTHS) {
          if (ascii && width % 8 !== 4 && width !== 16 && width !== 100) continue
          for (const rows of ROWS) {
            const i = input({ ...state(lang), width, rows, ascii })
            check(layoutPane(i), i, `${name}/${lang}${ascii ? '/ascii' : ''}/${width}x${rows}`)
          }
        }
      }
    }
  })
}

test('sizes: the selected row is always in the rail, whichever row it is and however small the pane', () => {
  const ids = notesModel('en').nodes.map(n => n.id)
  for (const selected of ids) {
    for (const width of [24, 44, 80]) {
      for (const rows of [5, 8, 12, 16, 24, 40]) {
        const i = input({ width, rows, ui: ui({ selected }) })
        const layout = layoutPane(i)
        check(layout, i, `${selected} ${width}x${rows}`)
        expect(layout.selected, `${selected} ${width}x${rows}`).toBe(selected)
        expect(rowsOf(layout).filter(r => r.selected).map(r => r.id)).toEqual([selected])
      }
    }
  }
})

test('sizes: a docked pane has its keys on its last rows once it has the rows for a rail', () => {
  for (const [name, state] of Object.entries(STATES)) {
    if (name === 'off') continue
    for (const lang of ['en', 'zh'] as DtLang[]) {
      for (const width of [30, 60, 100]) {
        for (const rows of [12, 16, 24, 40, 60]) {
          const layout = layoutPane(input({ ...state(lang), width, rows, pin: true }))
          expect(layout.height, `${name}/${lang}/${width}x${rows}`).toBe(rows)
          expect(layout.blocks[layout.blocks.length - 1]!.kind).toBe('bar')
        }
      }
    }
  }
})

test('sizes: the form for editing never costs the pane more rows than it has', () => {
  for (const rows of ROWS) {
    for (const width of WIDTHS) {
      const i = input({ ...STATES.editing!('en'), width, rows })
      const layout = layoutPane(i)
      check(layout, i, `${width}x${rows}`)
      const form = layout.blocks.filter(b => b.kind === 'edit')
      // the form has all its rows, and from nine rows up the pane has them to give
      expect(form.length).toBeLessThanOrEqual(1)
      if (form.length === 1) expect(layout.height).toBeGreaterThanOrEqual(EDIT_ROWS)
      if (rows >= 9) expect(layout.height, `${width}x${rows}`).toBeLessThanOrEqual(rows)
    }
  }
})

// ---------------------------------------------------------------- the command waiting for the person's OK

/** The text of the lines, without the frame and the blanks, so that a command broken across lines reads as one. */
const squeeze = (lines: readonly string[]) => lines.join('').replace(/[│\s]/g, '')

/** Everything the pane draws between the top of the status frame and the button. */
function aboveButton(layout: PaneLayout): string[] {
  const t = textOf(layout)
  const top = t.findIndex(l => l.includes('╭─ Now'))
  const at = layout.blocks.findIndex(b => b.kind === 'allow')
  return t.slice(top + 1, at)
}

const ARGV = NOW_PENDING.argv
const WORDS = Array.from({ length: 13 }, (_, k) => `w${String(k + 1).padStart(2, '0')}`.padEnd(30, 'x'))

/** What the pane must do with a command waiting for approval, at one size. */
function checkAsking(lang: DtLang, width: number, rows: number): void {
  const whole = squeeze([describeArgv(ARGV)])
  const i = input({ ...STATES.asking!(lang), width, rows })
  const layout = layoutPane(i)
  const label = `${lang} ${width}x${rows}`
  check(layout, i, label)
  const allows = layout.blocks.filter(b => b.kind === 'allow')
  expect(allows.length, label).toBeLessThanOrEqual(1)
  const t = textOf(layout)
  if (allows.length === 1) {
    expect(allowOf(layout)!.argv, label).toEqual(ARGV)
    // the whole command is drawn above the button, inside the frame, and the frame closes right under it
    expect(squeeze(aboveButton(layout)), label).toContain(whole)
    const at = layout.blocks.findIndex(b => b.kind === 'allow')
    expect(t[at + 1]!.startsWith('  ╰'), label).toBe(true)
  } else {
    // no button, no part of the command: the person is not shown what they cannot allow
    expect(squeeze(t), label).not.toContain('scripts/status')
  }
  // the notice (or the command) is among the last things to go: with 8 rows there is a status frame
  if (rows >= 8) expect(t.some(l => l.includes('╭─ Now')), label).toBe(true)
}

test('approval: the button is offered only with the whole command above it, at every size (English)', { timeoutMs: 30000 }, () => {
  for (let width = 16; width <= 140; width += 3) for (let rows = 3; rows <= 70; rows++) checkAsking('en', width, rows)
})

test('approval: the button is offered only with the whole command above it, at every size (Chinese)', { timeoutMs: 30000 }, () => {
  for (let width = 16; width <= 140; width += 3) for (let rows = 3; rows <= 70; rows++) checkAsking('zh', width, rows)
})

/** Whether the pane offers the button at that size. */
const offers = (lang: DtLang, width: number, rows: number) => allowOf(layoutPane(input({ ...STATES.asking!(lang), width, rows }))) !== undefined

test('approval: once the button fits, more rows never take it away', { timeoutMs: 30000 }, () => {
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 16; width <= 140; width += 6) {
      let had = false
      for (let rows = 3; rows <= 70; rows++) {
        const has = offers(lang, width, rows)
        if (had) expect(has, `${lang} ${width}x${rows}: the button went away with more rows`).toBe(true)
        had = had || has
      }
    }
  }
})

test('approval: once the button fits, more columns never take it away', { timeoutMs: 30000 }, () => {
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let rows = 10; rows <= 70; rows += 6) {
      let had = false
      for (let width = 16; width <= 140; width += 2) {
        const has = offers(lang, width, rows)
        if (had) expect(has, `${lang} ${width}x${rows}: the button went away with more columns`).toBe(true)
        had = had || has
      }
    }
  }
})

test('approval: a command too long to read in the pane is never offered, whatever the size', () => {
  const long = { ...NOW_PENDING, argv: WORDS }
  for (let width = 16; width <= 100; width += 4) {
    for (let rows = 3; rows <= 70; rows += 3) {
      const layout = layoutPane(input({ ...STATES.asking!('en'), now: long, width, rows }))
      expect(allowOf(layout), `${width}x${rows}`).toBeUndefined()
      expect(squeeze(textOf(layout)), `${width}x${rows}`).not.toContain(WORDS[0]!.trim())
    }
  }
  // wide enough, it fits again
  expect(allowOf(layoutPane(input({ ...STATES.asking!('en'), now: long, width: 160, rows: 60 })))).toBeDefined()
})

test('approval: a command that is already allowed, or a status block switched off, has no button', () => {
  for (let rows = 6; rows <= 50; rows += 4) {
    expect(allowOf(layoutPane(input({ ...STATES.now!('en'), rows })))).toBeUndefined()
    expect(allowOf(layoutPane(input({ ...STATES.asking!('en'), rows, ui: ui({ showNow: false }) })))).toBeUndefined()
    expect(allowOf(layoutPane(input({ ...STATES.asking!('en'), rows, statusInterval: null })))).toBeUndefined()
  }
})
