// The pane and the translator together, through the engine: the real hooks module, the pane mounted the way a
// surface mounts it, and a model that answers from a dictionary. What the Runtime does with each reply has its own
// tests (runtime-translate.test.ts); here it is what the person sees and what the host is asked.

import { test, expect } from 'claude-code/testing'

import { BATCH_ITEMS } from '../lib/translator'
import { elementOf, linesOf, mountPane, textOf } from './draw'
import { callTool, seed, seedNotes, slash, world } from './engine'
import { CONFLICTS, MAIN_RAW, NOW } from './notes'
import { ROOT } from './port'
import { targetOf, textsOf, translatesWith } from './translate'

const DECISIONS = `${ROOT}/.claude/decisions`

/** Every text of the notes-app sample in both languages: what a good translator would answer. */
const PAIRS: [en: string, zh: string][] = [
  ...MAIN_RAW.map((r): [string, string] => [r.en, r.zh]),
  [CONFLICTS.summary[0], CONFLICTS.summary[1]],
  [CONFLICTS.rationale[0], CONFLICTS.rationale[1]],
  ...CONFLICTS.evidence.flatMap((e): [string, string][] => [[e.label[0], e.label[1]], [e.value[0], e.value[1]]]),
  [CONFLICTS.note.text[0], CONFLICTS.note.text[1]],
]

const toEnglish = translatesWith(Object.fromEntries(PAIRS.map(([en, zh]) => [zh, en])))
const toChinese = translatesWith(Object.fromEntries(PAIRS.map(([en, zh]) => [en, zh])))
const translator: typeof toEnglish = request => (targetOf(request) === 'en' ? toEnglish(request) : toChinese(request))

const title = (id: string, lang: 'en' | 'zh'): string => {
  const r = MAIN_RAW.find(x => x.id === id)
  if (r === undefined) throw new Error(`no ${id} in the sample`)
  return lang === 'en' ? r.en : r.zh
}

const rowText = (tree: unknown, id: string): string => textOf(elementOf(tree, id))
const said = (tree: unknown): string => linesOf(tree).join('\n')

// ---------------------------------------------------------------- a project written in Chinese, read in English

test('an English pane over a project written in Chinese: the rows keep their Chinese and say 中 while the model translates, then read in English', async ($, on) => {
  const w = world(on, { now: NOW })
  seedNotes(w, { lang: 'zh', translate: true })
  // the model takes three seconds over each request
  w.onModel = async request => {
    await w.clock.sleep(3000)
    return translator(request)
  }
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 120, rows: 60 })

  let tree = await ui.drawn()
  expect(rowText(tree, 'n1')).toContain(title('n1', 'zh')) // (nothing is known yet; the poll comes at five seconds)
  expect(w.modelCalls).toHaveLength(0)

  await w.clock.advance(5000) // the poll finds what the pane lacks and asks
  expect(w.modelCalls).toHaveLength(1)
  const call = w.modelCalls[0]!
  expect(call.model).toBe('haiku')
  expect(targetOf(call)).toBe('en')
  expect(textsOf(call).length).toBeLessThanOrEqual(BATCH_ITEMS)
  tree = await ui.drawn()
  expect(said(tree)).toMatch(/◌ translating \d+/)
  expect(rowText(tree, 'n1')).toContain(title('n1', 'zh'))
  expect(rowText(tree, 'n1')).toContain('中') // the mark: this is the language it was written in, its English is on its way

  // the requests follow one another until nothing is left; every text goes once
  await w.clock.advance(3000)
  await w.clock.advance(3000)
  await w.clock.advance(3000)
  await w.clock.settle()
  tree = await ui.drawn()
  expect(said(tree)).not.toContain('translating')
  for (const id of ['n0', 'n1', 'n3', 'n16']) {
    expect(rowText(tree, id), id).toContain(title(id, 'en'))
    expect(rowText(tree, id), id).not.toContain('中')
  }
  const asked = w.modelCalls.flatMap(c => textsOf(c))
  expect(new Set(asked).size).toBe(asked.length)
  expect(w.modelCalls.every(c => targetOf(c) === 'en')).toBe(true)

  // what it learned is on the disk, in files of its own that a teammate's checkout brings along
  const files = [...w.disk.files.keys()].filter(p => p.startsWith(`${DECISIONS}/i18n/`))
  expect(files.length).toBeGreaterThan(0)
  expect(files.every(p => p.endsWith('.json'))).toBe(true)
  expect(JSON.parse(w.disk.text(files[0]!))).toMatchObject({ v: 1, lang: 'en', via: 'translator' })
})

test('the English the model was asked for is read from the disk next time: a new session over the same project asks for nothing', async ($, on) => {
  const w = world(on, { now: NOW })
  seedNotes(w, { lang: 'zh', translate: true })
  w.onModel = translator
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 120, rows: 60 })
  for (let k = 0; k < 6; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(rowText(await ui.drawn(), 'n2')).toContain(title('n2', 'en'))
  const first = w.modelCalls.length
  expect(first).toBeGreaterThan(0)
  await ui.unmount()

  // (the same disk; the session ended and another begins)
  await $.session.end({ sessionId: 'abcdef0123456789', reason: 'exit' } as never)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const again = await mountPane($, 'terminal', { columns: 120, rows: 60 })
  for (let k = 0; k < 6; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(rowText(await again.drawn(), 'n2')).toContain(title('n2', 'en'))
  expect(w.modelCalls).toHaveLength(first)
})

// ---------------------------------------------------------------- a project written in English, read in Chinese

test('a Chinese pane over a project written in English asks for Chinese versions, and only once the pane reads Chinese', async ($, on) => {
  const w = world(on, { now: NOW })
  seedNotes(w, { translate: true })
  w.onModel = translator
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 120, rows: 60 })

  for (let k = 0; k < 4; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.modelCalls).toHaveLength(0) // English over English needs nothing
  expect(said(await ui.drawn())).not.toContain('translating')

  await ui.press({ key: '~lang-zh' })
  await w.clock.settle()
  for (let k = 0; k < 4; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.modelCalls.length).toBeGreaterThan(0)
  expect(w.modelCalls.every(c => targetOf(c) === 'zh')).toBe(true)
  expect(w.modelCalls.every(c => c.model === 'haiku' && textsOf(c).length <= BATCH_ITEMS)).toBe(true)
  // the Chinese asks to keep the professional words in English
  expect(w.modelCalls[0]!.system).toContain('When in doubt, keep the English word')

  const tree = await ui.drawn()
  for (const id of ['n0', 'n1', 'n3', 'n16']) expect(rowText(tree, id), id).toContain(title(id, 'zh'))
  expect(rowText(tree, 'n1')).toContain('SQLite') // the tool's name stays what it is
  expect(said(tree)).not.toContain('translating')

  // and back to English, which was never in doubt
  const calls = w.modelCalls.length
  await ui.press({ key: '~lang-en' })
  await w.clock.settle()
  expect(rowText(await ui.drawn(), 'n1')).toContain(title('n1', 'en'))
  for (let k = 0; k < 4; k++) await w.clock.advance(5000)
  expect(w.modelCalls).toHaveLength(calls)
})

// ---------------------------------------------------------------- the English that comes with a decision

test('a decision the model recorded with its English version reads in English at once, and the model is never asked for it', async ($, on) => {
  const w = world(on, { now: NOW })
  seed(w, [{ id: 'notes-app', title: 'Notes app', trunk: true }], { translate: true })
  w.onModel = translator
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 40 })

  const result = await callTool($, 'decision_record', {
    id: 'local-storage',
    title: '本地存储用 SQLite',
    parent: 'notes-app',
    status: 'adopted',
    rationale: '离线时也要能读写，SQLite 单文件最省事。',
    en: { title: 'Use SQLite for local storage', rationale: 'Reads and writes must work offline, and one SQLite file is the least trouble.' },
  })
  expect(String((result as { result?: unknown }).result ?? '')).toContain('local-storage')

  let tree = await ui.drawn()
  expect(rowText(tree, 'local-storage')).toContain('Use SQLite for local storage')
  expect(rowText(tree, 'local-storage')).not.toContain('中')
  for (let k = 0; k < 4; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.modelCalls).toHaveLength(0)
  expect(said(await ui.drawn())).not.toContain('translating')

  // read in Chinese it is what was written; the English root is the only text the model has to bring over
  await ui.press({ key: '~lang-zh' })
  await w.clock.settle()
  for (let k = 0; k < 4; k++) await w.clock.advance(5000)
  await w.clock.settle()
  tree = await ui.drawn()
  expect(rowText(tree, 'local-storage')).toContain('本地存储用 SQLite')
  const asked = w.modelCalls.flatMap(c => textsOf(c))
  expect(asked).toEqual(['Notes app'])
})

// ---------------------------------------------------------------- switched off

test('/decide translate off: the model is not asked, the Chinese stays with its 中 mark, and on asks again', async ($, on) => {
  const w = world(on, { now: NOW })
  seedNotes(w, { lang: 'zh', translate: true })
  w.onModel = translator
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 120, rows: 60 })

  const off = await slash($, 'decide', 'translate off')
  expect(String((off as { text?: unknown }).text ?? '')).toContain('Translation is off')
  expect(JSON.parse(w.disk.text(`${DECISIONS}/config.json`)).display.translate).toBe(false)
  for (let k = 0; k < 6; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.modelCalls).toHaveLength(0)
  const tree = await ui.drawn()
  expect(rowText(tree, 'n1')).toContain(title('n1', 'zh'))
  expect(rowText(tree, 'n1')).toContain('中')
  expect(said(tree)).not.toContain('translating')

  await slash($, 'decide', 'translate on')
  for (let k = 0; k < 6; k++) await w.clock.advance(5000)
  await w.clock.settle()
  expect(w.modelCalls.length).toBeGreaterThan(0)
  expect(rowText(await ui.drawn(), 'n1')).toContain(title('n1', 'en'))
})

test('a model that cannot be had leaves the original text on screen, tells the person once, and the pane stops claiming to translate', async ($, on) => {
  const w = world(on, { now: NOW })
  seedNotes(w, { lang: 'zh', translate: true })
  w.onModel = null // (no model to be had: the host answers with an API error)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 120, rows: 60 })

  for (let k = 0; k < 40; k++) await w.clock.advance(5000) // 200 s: three tries (5 s, 35 s, 155 s)
  await w.clock.settle()
  expect(w.modelCalls).toHaveLength(3)
  expect(w.toasts.filter(t => t.includes('Translating'))).toHaveLength(1)
  const tree = await ui.drawn()
  expect(rowText(tree, 'n1')).toContain(title('n1', 'zh'))
  expect(said(tree)).not.toContain('translating')
})
