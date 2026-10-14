// The overview of the trees and the tabs of the strip as the engine draws them: mounted on every surface through the
// test kit, read back as the tree of elements the surface would be handed, and acted on the way a person does (press a
// line, press a key, type in the form). What the layout decides has its own tests in overview.test.ts, and what the
// Runtime does for each press in runtime-overview.test.ts; here it is whether the engine is handed the right controls
// and whether each of them does what its label says.

import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { strWidth } from '../lib/width'
import { EDITABLE, SURFACES, keysOf, linesOf, mountPane, rowKeys } from './draw'
import { NOW, seedNotes, slash, world } from './engine'
import type { World } from './engine'
import { ROOT } from './port'

const CONFIG = `${ROOT}/.claude/decisions/config.json`

type Surface = (typeof SURFACES)[number]

/** A world whose clock reads the sample's NOW, with the notes-app sample on its disk. */
function notesWorld(on: On, options: Parameters<typeof seedNotes>[1] = {}): World {
  const w = world(on, { now: NOW })
  seedNotes(w, options)
  return w
}

/** What `/decide` answers to the person. */
async function decide($: Engine, args: string): Promise<string> {
  const said = (await slash($, 'decide', args)) as { text?: string }
  return said.text ?? ''
}

/**
 * The sample, and two more trees opened from it: crdt-engine from the Sync step (n2) and cloud-first from the Storage
 * step (n1), each with steps of its own. The project is recorded into the first tree at the end.
 */
async function openTrees($: Engine, surface: Surface = 'terminal'): Promise<void> {
  await $.session.start({ cwd: ROOT, surface, isInteractive: true })
  expect(await decide($, 'new crdt-engine --from main --at n2 --title CRDT text engine instead of paragraph merge')).toContain('Opened tree crdt-engine')
  expect(await decide($, 'add CRDT text engine: merge by character --id crdt-merge --parent n2 --status adopted --trunk')).toContain('Recorded crdt-merge')
  expect(await decide($, 'add Keep it only if cold start stays under 2 s --id cold-start --parent crdt-merge --status planned --trunk')).toContain('Recorded cold-start')
  expect(await decide($, 'new cloud-first --from main --at n1 --title Server-first sync, offline later')).toContain('Opened tree cloud-first')
  expect(await decide($, 'add Sync: the server owns the data --id server-data --parent n1 --status adopted --trunk')).toContain('Recorded server-data')
  expect(await decide($, 'use main')).toBe('Recording in tree main now.')
}

/** The tree config.json says the project records into (none: the first). */
const configTree = (w: World): unknown => (JSON.parse(w.disk.text(CONFIG)) as { tree?: unknown }).tree

const TABS = ['~tab-main', '~tab-crdt-engine', '~tab-cloud-first']
const textIn = (tree: unknown) => linesOf(tree).join('\n')
const buttonsOf = (tree: unknown) => keysOf(tree, 'Button')
/** The buttons of the strip that are tabs. */
const tabsOf = (tree: unknown) => buttonsOf(tree).filter(k => k.startsWith('~tab-'))
/** The buttons that stand for a tree: the two lines of its entry in the list. */
const treeKeysOf = (tree: unknown) => buttonsOf(tree).filter(k => k.startsWith('~tree:'))
/** The buttons that stand for a step of the graph. */
const stepKeysOf = (tree: unknown) => buttonsOf(tree).filter(k => k.startsWith('~step:'))
/** The trees whose entry in the list carries the mark of the highlight. */
const markedEntries = (tree: unknown) => linesOf(tree).flatMap(l => /│▌● ([\w-]+)/.exec(l)?.[1] ?? [])
/** The line the selection's mark is on, in the tree view. */
const selectedLine = (tree: unknown) => linesOf(tree).find(l => l.startsWith('▌')) ?? ''
/** The line of the entry in the list that starts with the tree's name. */
const entryOf = (tree: unknown, name: string) => linesOf(tree).find(l => new RegExp(`│.● ${name} `).test(l)) ?? ''

// ---------------------------------------------------------------- the tabs

test('tabs: a button for each tree in the order of the lanes, a dot after the one recorded into, and the switch of language', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  const tree = await ui.drawn()
  expect(tabsOf(tree)).toEqual(TABS)
  expect(linesOf(tree)[0]).toMatch(/^ {2}notes-app {3}main ● {3}crdt-engine {3}cloud-first +EN {2}中$/)
  // the footer offers the overview and the next tree
  expect(buttonsOf(tree)).toEqual(expect.arrayContaining(['~trees', '~cycle']))
  expect((await ui.find({ key: '~trees' }))?.props.hotkey).toBe('t')
  expect((await ui.find({ key: '~cycle' }))?.props.hotkey).toBe('o')
})

test('tabs: a project of one tree has none, and no key for the next tree', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  const tree = await ui.drawn()
  expect(tabsOf(tree)).toEqual([])
  expect(buttonsOf(tree)).not.toContain('~cycle')
  expect(buttonsOf(tree)).toContain('~trees')
  expect(linesOf(tree)[0]).toMatch(/^ {2}notes-app +EN {2}中$/)
})

test('tabs: a tab shows that tree, which is read only unless it is the one recorded into, and the key for the next tree goes round them', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  const mainRows = rowKeys(await ui.drawn())
  expect(mainRows).toContain('n16')
  expect(await ui.find({ key: '~edit' })).toBeDefined()

  await ui.press({ key: '~tab-crdt-engine' })
  let tree = await ui.drawn()
  expect(rowKeys(tree)).toContain('crdt-merge')
  expect(rowKeys(tree)).not.toContain('n16')
  expect(linesOf(tree)[1]).toMatch(/○ read only {3}recording in main/)
  expect(textIn(tree)).toContain('↳ main #7')
  // an edit is written to the tree recorded into: it is not offered here
  expect(await ui.find({ key: '~edit' })).toBeUndefined()

  await ui.press({ key: '~cycle' })
  tree = await ui.drawn()
  expect(rowKeys(tree)).toContain('server-data')
  expect(rowKeys(tree)).not.toContain('crdt-merge')
  await ui.press({ key: '~cycle' })
  tree = await ui.drawn()
  expect(rowKeys(tree)).toEqual(mainRows)
  expect(linesOf(tree)[1]).toMatch(/● recording {3}updated/)
  expect(await ui.find({ key: '~edit' })).toBeDefined()

  // the tab of the tree recorded into brings the pane back to following it
  await ui.press({ key: '~tab-cloud-first' })
  await ui.press({ key: '~tab-main' })
  expect(rowKeys(await ui.drawn())).toEqual(mainRows)
})

// ---------------------------------------------------------------- the overview

for (const surface of SURFACES) {
  test(`${surface}: the overview draws every tree as lines that are buttons, and no node of any tree`, async ($, on) => {
    notesWorld(on)
    await openTrees($, surface)
    const ui = await mountPane($, surface, { columns: 90, rows: 40 })
    await ui.press({ key: '~trees' })
    const tree = await ui.drawn()
    expect(rowKeys(tree)).toEqual([])
    // each tree has the two lines of its entry in the list, and a point in the graph for each step it recorded itself
    expect(treeKeysOf(tree)).toEqual(['~tree:main', '~tree:main:2', '~tree:crdt-engine', '~tree:crdt-engine:2', '~tree:cloud-first', '~tree:cloud-first:2'])
    const steps = stepKeysOf(tree)
    expect(steps.filter(k => k.startsWith('~step:crdt-engine:'))).toEqual(['~step:crdt-engine:crdt-merge', '~step:crdt-engine:cold-start'])
    expect(steps.filter(k => k.startsWith('~step:cloud-first:'))).toEqual(['~step:cloud-first:server-data'])
    expect(steps.filter(k => k.startsWith('~step:main:'))).toContain('~step:main:n16')
    // the keys are unique, and every line is a Button with the words of its line as its label
    expect(new Set(keysOf(tree)).size).toBe(keysOf(tree).length)
    const first = await ui.find({ key: '~tree:crdt-engine' })
    expect(first?.type).toBe('Button')
    // (what a reader of buttons is told: the words of the line, without the frame)
    expect(String(first?.props.label)).toMatch(/^● crdt-engine \d+ decisions \d+ steps user \d\d:\d\d$/)
    expect(String((await ui.find({ key: '~tree:crdt-engine:2' }))?.props.label)).toBe('↳ main #7 (09-01) CRDT text engine instead of paragraph merge')
    expect(String((await ui.find({ key: '~step:cloud-first:server-data' }))?.props.label)).toMatch(/^Sync: the server owns the data, cloud-first, \d\d-\d\d$/)
    // the strip, the state line, the frame of the list and the keys
    const lines = linesOf(tree)
    expect(lines[0]).toMatch(/^ {2}notes-app {3}main ● {3}crdt-engine {3}cloud-first +EN {2}中$/)
    expect(lines[1]).toMatch(/^ {2}3 trees +● recording in main {3}updated \d\d:\d\d$/)
    expect(lines.some(l => /^ {2}╭─ Trees ─+ 1 \/ 3 ─╮$/.test(l))).toBe(true)
    expect(textIn(tree)).toContain('k: ↑  j: ↓  ⏎: open  r: record here')
    for (const [key, hotkey] of [['~up', 'k'], ['~down', 'j'], ['~record', 'r'], ['~back', 't'], ['~lang', 'l']] as const) {
      expect((await ui.find({ key }))?.props.hotkey, key).toBe(hotkey)
    }
    for (const line of lines) expect(strWidth(line)).toBeLessThanOrEqual(90)
    await ui.unmount()
  })
}

test('the overview opens with the tree the pane was showing highlighted, and back returns to the tree view as it was', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  const before = linesOf(await ui.drawn())
  await ui.press({ key: '~trees' })
  expect(markedEntries(await ui.drawn())).toEqual(['main'])
  await ui.press({ key: '~back' })
  expect(linesOf(await ui.drawn())).toEqual(before)

  // looking at another tree, the overview opens on that one
  await ui.press({ key: '~tab-cloud-first' })
  await ui.press({ key: '~trees' })
  expect(markedEntries(await ui.drawn())).toEqual(['cloud-first'])
  await ui.press({ key: '~back' })
  expect(rowKeys(await ui.drawn())).toContain('server-data')
})

test('a press on a line highlights its tree, and a press on the tree highlighted opens it', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  await ui.press({ key: '~tree:crdt-engine' })
  let tree = await ui.drawn()
  expect(markedEntries(tree)).toEqual(['crdt-engine'])
  expect(rowKeys(tree)).toEqual([]) // (still the overview)
  // the second line of the same entry is the same tree
  await ui.press({ key: '~tree:crdt-engine:2' })
  tree = await ui.drawn()
  expect(rowKeys(tree)).toContain('crdt-merge')
  expect(linesOf(tree)[1]).toMatch(/○ read only {3}recording in main/)
  // the strip: the tree being looked at is the one its tab says
  expect(tabsOf(tree)).toEqual(TABS)
})

test('a press on a point of the graph is a press on its tree: it opens the tree at that step', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  await ui.press({ key: '~step:cloud-first:server-data' })
  expect(markedEntries(await ui.drawn())).toEqual(['cloud-first'])
  await ui.press({ key: '~step:cloud-first:server-data' })
  const tree = await ui.drawn()
  expect(rowKeys(tree)).toContain('server-data')
  expect(selectedLine(tree)).toContain('Sync: the server owns the data')
})

test('the keys for up and down move the highlight a tree at a time, and stop at the ends', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  const walk: string[] = []
  for (const key of ['~down', '~down', '~down', '~up', '~up', '~up', '~up']) {
    await ui.press({ key })
    walk.push(markedEntries(await ui.drawn()).join(','))
  }
  expect(walk).toEqual(['crdt-engine', 'cloud-first', 'cloud-first', 'crdt-engine', 'main', 'main', 'main'])
})

test('the focus ring moving onto a line of the overview (a click, Tab) highlights its tree', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  const focus = (element: string) => $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element, origin: { kind: 'person' } })
  await focus('~tree:cloud-first:2')
  expect(markedEntries(await ui.drawn())).toEqual(['cloud-first'])
  await focus('~step:crdt-engine:cold-start')
  expect(markedEntries(await ui.drawn())).toEqual(['crdt-engine'])
  // a key that is not a line of the overview leaves it where it is
  await focus('~record')
  expect(markedEntries(await ui.drawn())).toEqual(['crdt-engine'])
})

test('r records into the tree highlighted: the dot of the strip, the state line and the entry of the list follow it, and the person is told', async ($, on) => {
  const w = notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  await ui.press({ key: '~tree:crdt-engine' })
  await ui.press({ key: '~record' })
  expect(w.toasts.at(-1)).toBe('Recording in tree crdt-engine now.')
  expect(configTree(w)).toBe('crdt-engine')
  let tree = await ui.drawn()
  expect(linesOf(tree)[0]).toMatch(/^ {2}notes-app {3}main {3}crdt-engine ● {3}cloud-first/)
  expect(linesOf(tree)[1]).toMatch(/^ {2}3 trees +● recording in crdt-engine/)
  expect(entryOf(tree, 'crdt-engine')).toMatch(/● recording/)
  expect(entryOf(tree, 'main')).not.toMatch(/recording/)
  expect(markedEntries(tree)).toEqual(['crdt-engine']) // (still the overview, still the same tree highlighted)

  // and back to the first tree
  await ui.press({ key: '~tree:main' })
  await ui.press({ key: '~record' })
  expect(w.toasts.at(-1)).toBe('Recording in tree main now.')
  expect(configTree(w)).toBeUndefined()
  tree = await ui.drawn()
  expect(entryOf(tree, 'main')).toMatch(/● recording/)
  expect(entryOf(tree, 'crdt-engine')).not.toMatch(/recording/)
})

test('while recording is paused the overview says so, and r still switches trees and says that the recording is paused', async ($, on) => {
  const w = notesWorld(on)
  await openTrees($)
  expect(await decide($, 'pause')).toMatch(/paused/i)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  let tree = await ui.drawn()
  expect(linesOf(tree)[1]).toMatch(/^ {2}3 trees +● paused {3}updated/)
  expect(entryOf(tree, 'main')).toMatch(/● paused/)
  await ui.press({ key: '~tree:cloud-first' })
  await ui.press({ key: '~record' })
  expect(w.toasts.at(-1)).toBe('Recording in tree cloud-first now. Recording is paused; /decide resume turns it back on.')
  tree = await ui.drawn()
  expect(entryOf(tree, 'cloud-first')).toMatch(/● paused/)
})

// ---------------------------------------------------------------- the form for a new tree

for (const surface of EDITABLE) {
  test(`${surface}: n opens the form, which has a field for the name, the version and the title, and makes no tree until it is sent`, async ($, on) => {
    const w = notesWorld(on)
    await openTrees($, surface)
    const ui = await mountPane($, surface, { columns: 90, rows: 48 })
    const trees = [...w.disk.files.keys()].filter(p => p.includes('/trees/')).length
    await ui.press({ key: '~trees' })
    await ui.press({ key: '~tree:cloud-first' })
    await ui.press({ key: '~new' })
    let tree = await ui.drawn()
    const name = await ui.find({ key: '~new-name' })
    expect(name?.type).toBe('Input')
    expect(name?.props.autoFocus).toBe(true)
    expect((await ui.find({ key: '~new-at' }))?.type).toBe('Input')
    expect((await ui.find({ key: '~new-title' }))?.type).toBe('Input')
    expect((await ui.find({ key: '~new-create' }))?.type).toBe('Button')
    expect((await ui.find({ key: '~new-cancel' }))?.type).toBe('Button')
    // it says which tree it opens from, the list gives its place to it, and the keys are the form's
    expect(textIn(tree)).toContain('New tree   Opens from cloud-first')
    expect(treeKeysOf(tree)).toEqual([])
    expect(textIn(tree)).toContain('You will record in it from then on.')
    expect(textIn(tree)).toContain('⏎: create')
    expect(buttonsOf(tree)).not.toContain('~record')

    // what is typed stays in the fields, and nothing is written until the form is sent
    await ui.input({ key: '~new-name', text: 'try-a', kind: 'change' })
    await ui.input({ key: '~new-at', text: '#3', kind: 'change' })
    expect((await ui.find({ key: '~new-name' }))?.props.value).toBe('try-a')
    expect((await ui.find({ key: '~new-at' }))?.props.value).toBe('#3')
    expect([...w.disk.files.keys()].filter(p => p.includes('/trees/')).length).toBe(trees)
    expect(configTree(w)).toBeUndefined()

    // Enter in the title sends what the other fields hold too: a copy of cloud-first up to its third event
    await ui.input({ key: '~new-title', text: 'A first try', kind: 'submit' })
    expect(configTree(w)).toBe('try-a')
    expect(w.toasts.at(-1)).toMatch(/^Opened tree try-a, from cloud-first at #3 \(\d\d-\d\d \d\d:\d\d\): 2 nodes\. Recording there now\.$/)
    tree = await ui.drawn()
    expect(await ui.find({ key: '~new-name' })).toBeUndefined()
    expect(rowKeys(tree)).toEqual(['n0', 'n12'])
    expect(tabsOf(tree)).toEqual([...TABS.slice(0, 1), '~tab-crdt-engine', '~tab-cloud-first', '~tab-try-a'])
    expect(linesOf(tree)[0]).toMatch(/cloud-first {3}try-a ●/)
    expect(textIn(tree)).toContain('↳ cloud-first #3')
    expect(textIn(tree)).toContain('A first try')
  })

  test(`${surface}: the button Create sends the form, and Enter in the name alone makes a copy of the tree as it is now`, async ($, on) => {
    const w = notesWorld(on)
    await openTrees($, surface)
    const ui = await mountPane($, surface, { columns: 90, rows: 48 })
    await ui.press({ key: '~trees' })
    await ui.press({ key: '~new' })
    await ui.input({ key: '~new-name', text: 'copy-now', kind: 'change' })
    await ui.press({ key: '~new-create' })
    expect(configTree(w)).toBe('copy-now')
    expect(w.toasts.at(-1)).toMatch(/^Opened tree copy-now, from main at #\d+ /)
    expect(rowKeys(await ui.drawn()).length).toBe(17)

    await ui.press({ key: '~trees' })
    await ui.press({ key: '~new' })
    await ui.input({ key: '~new-name', text: 'second-copy', kind: 'submit' })
    expect(configTree(w)).toBe('second-copy')
  })

  test(`${surface}: a mistake is said in the form, in red, and nothing is made; typing in a field clears it, and Cancel closes the form`, async ($, on) => {
    const w = notesWorld(on)
    await openTrees($, surface)
    const ui = await mountPane($, surface, { columns: 90, rows: 48 })
    const disk = [...w.disk.files.keys()].sort().join('\n')
    await ui.press({ key: '~trees' })
    await ui.press({ key: '~tree:crdt-engine' })
    await ui.press({ key: '~new' })

    await ui.input({ key: '~new-name', text: '', kind: 'submit' })
    let tree = await ui.drawn()
    expect(textIn(tree)).toContain('a tree needs a name (letters, digits and hyphens, 2-32 characters, e.g. crdt-engine)')
    expect(textIn(tree)).not.toContain('You will record in it from then on.')
    expect(await ui.find({ key: '~new-name' })).toBeDefined()
    await ui.input({ key: '~new-name', text: 'crdt-engine', kind: 'submit' })
    expect(textIn(await ui.drawn())).toContain('tree crdt-engine already exists')
    await ui.input({ key: '~new-at', text: '#99', kind: 'change' })
    await ui.input({ key: '~new-name', text: 'try-b', kind: 'submit' })
    expect(textIn(await ui.drawn())).toMatch(/there is no version #99: crdt-engine has \d+ events/)
    expect([...w.disk.files.keys()].sort().join('\n')).toBe(disk)
    expect(configTree(w)).toBeUndefined()
    // (what was typed is still in the fields)
    expect((await ui.find({ key: '~new-name' }))?.props.value).toBe('try-b')
    expect((await ui.find({ key: '~new-at' }))?.props.value).toBe('#99')

    await ui.input({ key: '~new-at', text: '#3', kind: 'change' })
    tree = await ui.drawn()
    expect(textIn(tree)).not.toContain('there is no version')
    expect(textIn(tree)).toContain('You will record in it from then on.')

    await ui.press({ key: '~new-cancel' })
    tree = await ui.drawn()
    expect(await ui.find({ key: '~new-name' })).toBeUndefined()
    expect(markedEntries(tree)).toEqual(['crdt-engine']) // (the tree that was highlighted still is)
    expect(textIn(tree)).toContain('k: ↑  j: ↓  ⏎: open  r: record here  n: new tree  t: back')
    expect([...w.disk.files.keys()].sort().join('\n')).toBe(disk)
  })
}

test('mobile has no text field: no key for a new tree, and a form opened on another surface is not drawn with fields', async ($, on) => {
  const w = notesWorld(on)
  await openTrees($, 'mobile')
  const phone = await mountPane($, 'mobile', { columns: 60, rows: 40 })
  await phone.press({ key: '~trees' })
  let tree = await phone.drawn()
  expect(buttonsOf(tree)).toEqual(expect.arrayContaining(['~record', '~back', '~up', '~down']))
  expect(await phone.find({ key: '~new' })).toBeUndefined()
  expect(textIn(tree)).not.toContain('new tree')
  expect(await phone.findAll({ type: 'Input' })).toEqual([])
  await phone.unmount()

  // the form was opened where there are fields (the state is the session's, and the other surface shares it)
  const desktop = await mountPane($, 'desktop', { columns: 90, rows: 40 })
  await desktop.press({ key: '~new' })
  expect(await desktop.find({ key: '~new-name' })).toBeDefined()
  await desktop.unmount()
  const again = await mountPane($, 'mobile', { columns: 60, rows: 40 })
  tree = await again.drawn()
  expect(await again.findAll({ type: 'Input' })).toEqual([])
  expect(textIn(tree)).toContain('Opening a tree needs text fields; use /decide tree new <name> here.')
  await again.press({ key: '~new-cancel' })
  expect(await again.find({ key: '~new-cancel' })).toBeUndefined()
  expect(treeKeysOf(await again.drawn())).toHaveLength(6)
  expect(configTree(w)).toBeUndefined()
})

// ---------------------------------------------------------------- language and glyphs

test('the overview speaks the language of the pane: its own words Chinese, the names of things as they were written', async ($, on) => {
  notesWorld(on)
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  await ui.press({ key: '~lang-zh' })
  let tree = await ui.drawn()
  const lines = linesOf(tree)
  expect(lines[0]).toMatch(/^ {2}notes-app {3}main ● {3}crdt-engine {3}cloud-first +EN {2}中$/)
  expect(lines[1]).toMatch(/^ {2}3 个 tree +● 正记录到 main {3}\d\d:\d\d 更新$/)
  expect(entryOf(tree, 'main')).toMatch(/● main +17 个决定 {2}6 steps +● 记录中 {2}\d\d:\d\d/)
  expect(textIn(tree)).toContain('k: ↑  j: ↓  ⏎: 打开  r: 记到这里  n: 新 tree  t: 返回')
  expect(textIn(tree)).toContain('l: EN')
  // the titles are as they were recorded (English here), marked as not yet rendered in Chinese
  expect(textIn(tree)).toMatch(/Notes app: offline-first rewrite for the spring release EN/)
  await ui.press({ key: '~lang-en' })
  tree = await ui.drawn()
  expect(linesOf(tree)[1]).toMatch(/^ {2}3 trees +● recording in main/)
  expect(textIn(tree)).not.toContain('个决定')
})

test('with ASCII glyphs the overview is plain characters, the arrows are spelled out, and the language key still names 中', async ($, on) => {
  notesWorld(on, { ascii: true })
  await openTrees($)
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 40 })
  await ui.press({ key: '~trees' })
  const tree = await ui.drawn()
  // (the ellipsis of a title that was cut is ordinary text here, as in the tree view)
  const text = textIn(tree).replace(/[中…]/g, 'zh')
  expect(text).toMatch(/^[\x20-\x7e\n]*$/)
  expect(textIn(tree)).toContain('k: up  j: down  Enter: open  r: record here  n: new tree  t: back')
  expect(linesOf(tree).some(l => /^ {2}\+- Trees -+ 1 \/ 3 -+\+$/.test(l))).toBe(true)
  expect(markedEntries(tree)).toEqual([])
  expect(linesOf(tree).some(l => l.includes('|>* main'))).toBe(true)
})

// ---------------------------------------------------------------- sizes

for (const surface of SURFACES) {
  test(`${surface}: the overview fits panes of every size, with unique keys and no node rows`, { timeoutMs: 60000 }, async ($, on) => {
    notesWorld(on)
    await openTrees($, surface)
    const big = await mountPane($, surface, { columns: 100, rows: 40 })
    await big.press({ key: '~trees' })
    await big.unmount()
    for (const columns of [16, 24, 36, 48, 70, 110]) {
      for (const rows of [3, 6, 10, 16, 30, 50]) {
        const ui = await mountPane($, surface, { columns, rows })
        const tree = await ui.drawn()
        const label = `${columns}x${rows}`
        for (const line of linesOf(tree)) expect(strWidth(line), `${label}: ${line}`).toBeLessThanOrEqual(columns)
        expect(new Set(keysOf(tree)).size, label).toBe(keysOf(tree).length)
        expect(rowKeys(tree), label).toEqual([])
        expect(textIn(tree), label).toMatch(/EN {2}中/)
        await ui.unmount()
      }
    }
  })
}
