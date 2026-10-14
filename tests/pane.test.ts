// The pane as the engine draws it: mounted on every surface through the test kit, read back as the tree of
// elements the surface would be handed, and acted on the way a person does (press, type, pick). What the layout
// decides (which rows, how wide, in what order) has its own tests in layout.test.ts; here it is whether the engine
// is handed the right thing and whether each press and each key does what its label says.

import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'

import { strWidth } from '../lib/width'
import { EDITABLE, SURFACES, blocksOf, elementOf, keysOf, linesOf, manyNodes, mountPane, rowKeys, runsOf, textOf } from './draw'
import type { El } from './draw'
import { NOW, eventsOn, seed, seedNotes, slash, submit, world } from './engine'
import { MAIN_RAW } from './notes'
import { ROOT } from './port'

const WIDTHS = [48, 60, 80, 110]

/** The rail of the notes-app sample, top to bottom: each step of the mainline, then what hangs from it. */
const RAIL = ['n0', 'n12', 'n13', 'n1', 'n14', 'n2', 'n4', 'n11', 'n3', 'n5', 'n6', 'n7', 'n15', 'n16', 'n8', 'n9', 'n10']

const STATUS = ['bash', 'scripts/status.sh']

const SAMPLE = JSON.stringify({
  updatedAt: '2026-10-13T15:27:00Z',
  lanes: [{ name: 'ALPHA', run: 'sync-bench s0', state: 'running', step: 1700, total: 2000, eta: '18:40' }],
  next: [{ text: 'restore-test s1', eta: '05:05' }],
  warnings: [],
})

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

/** A world whose clock reads the sample's NOW, with the notes-app sample on its disk. */
function notesWorld(on: On, options: Parameters<typeof seedNotes>[1] = {}) {
  const w = world(on, { now: NOW })
  seedNotes(w, options)
  return w
}

const textIn = (tree: unknown) => linesOf(tree).join('\n')

/** The line the selection's mark is on. */
const selectedLine = (tree: unknown) => linesOf(tree).find(l => l.startsWith('▌')) ?? ''

/** The line of the first row whose text has `piece` in it. */
const lineWith = (tree: unknown, piece: string) => linesOf(tree).find(l => l.includes(piece)) ?? ''

// ---------------------------------------------------------------- what is drawn

for (const surface of SURFACES) {
  test(`${surface}: a project that is off invites the person to start, and draws no tree`, async ($, on) => {
    const w = world(on, { now: NOW })
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface)
    const tree = await ui.drawn()
    const said = textIn(tree).replace(/\s+/g, ' ') // (the sentence is wrapped to the width of the pane)
    expect(said).toContain('/decide start')
    expect(said).toContain('/decide init')
    expect(rowKeys(tree)).toEqual([])
    expect(w.disk.files.size).toBe(0) // looking writes nothing
  })

  test(`${surface}: every decision is one Button keyed by its id, and no line is wider than the pane`, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    for (const columns of WIDTHS) {
      const ui = await mountPane($, surface, { columns })
      const tree = await ui.drawn()
      expect(rowKeys(tree)).toEqual(RAIL)
      expect(new Set(keysOf(tree)).size).toBe(keysOf(tree).length) // keys are unique
      for (const line of linesOf(tree)) expect(strWidth(line)).toBeLessThanOrEqual(columns)
      // exactly one row carries the selection's mark
      const marked = linesOf(tree).filter(l => l.startsWith('▌'))
      expect(marked).toHaveLength(1)
      expect(marked[0]).toContain('Notes app')
      // a row's accessible label is its line, without the padding
      const first = await ui.find({ key: 'n0' })
      expect(first?.type).toBe('Button')
      expect(String(first?.props.label)).toContain('Notes app')
      await ui.unmount()
    }
  })
}

test('the seeded project is the sample: every row says the title it was recorded with', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 110, rows: 48 })
  const tree = await ui.drawn()
  for (const r of MAIN_RAW) expect(textOf(elementOf(tree, r.id)), r.id).toContain(r.en)
})

test('the strip, the line of state and the frame of the details say where things stand', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 40 })
  const tree = await ui.drawn()
  const lines = linesOf(tree)
  // the project's name on the left, the switch of language on the right
  expect(lines[0]).toMatch(/^ {2}notes-app {2,}EN {2}中$/)
  // how much there is, and that it is being recorded (the clock is the machine's own, so only its shape is looked at)
  expect(lines[1]).toMatch(/^ {2}17 decisions {3}mainline 6 steps {2,}● recording {3}updated \d\d:\d\d$/)
  // the frame of the selected decision: its status, who decided it and when
  expect(lineWith(tree, 'Details')).toMatch(/^ {2}╭─ Details ─+ {2}✓ adopted {2}user {2}09-02 ─╮$/)

  // the glyph of each status on its row
  expect(lineWith(tree, 'Release bar')).toContain('✓')
  expect(lineWith(tree, 'Keep JSON files')).toContain('✗')
  expect(lineWith(tree, 'Merge window')).toContain('=')
  expect(lineWith(tree, 'Replay 200')).toContain('◐')
  expect(lineWith(tree, 'Soak test')).toContain('○')
  expect(lineWith(tree, 'Staged rollout')).toContain('◌')
  expect(lineWith(tree, 'Compress operations')).toContain('⊘')
  expect(lineWith(tree, 'Desktop client')).toContain('‖')
})

test('ASCII glyphs: display.asciiGlyphs swaps every symbol for plain characters', async ($, on) => {
  notesWorld(on, { ascii: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 40 })
  const tree = await ui.drawn()
  const lines = linesOf(tree)
  // the switch to Chinese is the one thing that is not ASCII: it is always written 中 (in the strip, and in the key of the footer)
  expect(lines[0]).toMatch(/EN {2}中$/)
  expect(lines.slice(1).join('\n').replace('l: 中', 'l: zh')).toMatch(/^[\x20-\x7e\n]*$/)

  expect(lines[1]).toContain('* recording') // the recording dot
  expect(selectedLine(tree)).toBe('')
  expect(lines.find(l => l.startsWith('>'))).toContain('Notes app') // the selection's mark
  expect(lineWith(tree, 'Keep JSON files')).toMatch(/^ {2}\|- x /) // a rejected branch hanging from the spine
  expect(lineWith(tree, 'Release bar')).toMatch(/^ {2}\|- \+ /)
  expect(lineWith(tree, 'Title conflicts')).toMatch(/^ {2}\| {2}`- \? /) // a branch of a branch
  expect(lines.some(l => /^ {2}\+- Details -+/.test(l))).toBe(true)
  // the keys: arrows are spelled out
  const text = textIn(tree)
  expect(text).toContain('k: up')
  expect(text).toContain('j: down')
  expect(text).toContain('Enter: expand')
})

test('a pane docked and a pane inline draw the same tree; inline stays short', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const docked = await mountPane($, 'terminal', { columns: 70, rows: 40 })
  const dockedTree = await docked.drawn()
  await docked.unmount()
  const inline = await mountPane($, 'terminal', { columns: 70, rows: 40, placement: 'inline' })
  const inlineTree = await inline.drawn()
  expect(linesOf(dockedTree)).toHaveLength(40) // docked, it has the whole height and the keys on its last rows
  expect(linesOf(inlineTree).length).toBeLessThanOrEqual(16)
  expect(rowKeys(dockedTree)).toContain('n0')
  expect(rowKeys(inlineTree)).toContain('n0')
  expect(selectedLine(inlineTree)).toContain('Notes app')
})

// ---------------------------------------------------------------- the look

test('the selected row is one bar: all of it on the selection colour from edge to edge, its mark in the accent, and no other row has a background', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })

  const expectBarOn = async (id: string) => {
    const tree = await ui.drawn()
    for (const key of rowKeys(tree)) {
      const runs = runsOf(elementOf(tree, key))
      expect(runs.some(r => r.text === '')).toBe(false) // a piece of no columns draws nothing
      if (key !== id) {
        expect(runs.filter(r => r.backgroundColor !== undefined)).toEqual([])
        continue
      }
      expect(runs.every(r => r.backgroundColor === 'subtle')).toBe(true)
      expect(runs[0]).toEqual({ text: '▌', color: 'blueBright', backgroundColor: 'subtle' })
      // the title of an adopted step is bold; the title of a branch keeps its weight
      expect(runs.some(r => r.bold === true)).toBe(['n0', 'n3'].includes(id))
      expect(strWidth(runs.map(r => r.text).join(''))).toBe(80) // the bar runs to the edge of the pane
    }
  }

  await expectBarOn('n0')
  await ui.press({ key: 'n3' })
  await expectBarOn('n3')
  await ui.press({ key: '~down' })
  await expectBarOn('n5')
})

test('colours: a terminal gets the terminal\'s own sixteen colours, every other surface the theme\'s keys', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  // [what is drawn, its colour on a terminal, its colour in the theme]
  const looks: [string, string, string][] = [
    ['✓', 'green', 'success'],
    ['┠', 'magenta', 'merged'], // the mainline
    ['Release bar:', 'blueBright', 'ide'], // the words before a colon
    ['99.5%', 'yellow', 'warning'], // a number
  ]
  for (const [surface, column] of [['terminal', 1], ['desktop', 2], ['vscode', 2]] as const) {
    const ui = await mountPane($, surface, { columns: 80, rows: 48 })
    const runs = runsOf(elementOf(await ui.drawn(), 'n13'))
    for (const look of looks) {
      const run = runs.find(r => r.text === look[0])
      expect(run?.color, `${surface} ${look[0]}`).toBe(look[column])
    }
    await ui.unmount()
  }
})

test('the mainline is a thin spine in the margin: its dots, its stubs and the line between its steps share one colour', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  const tree = await ui.drawn()

  // a step is a dot in the margin, a branch a stub on the spine
  for (const key of ['n1', 'n2', 'n3']) expect(runsOf(elementOf(tree, key))[2]).toEqual({ text: '●', color: 'magenta' })
  for (const key of ['n12', 'n13', 'n14', 'n4', 'n11', 'n5', 'n6', 'n7']) expect(runsOf(elementOf(tree, key))[2]).toEqual({ text: '┠', color: 'magenta' })
  // the line between two steps
  const between = blocksOf(tree).filter(b => textOf(b) === '  ┃')
  expect(between.length).toBeGreaterThan(0)
  for (const b of between) expect(runsOf(b)[1]).toEqual({ text: '┃', color: 'magenta' })
  // a branch of a branch hangs from the stub, and the spine goes on beside it
  expect(runsOf(elementOf(tree, 'n15')).slice(2, 4)).toEqual([{ text: '┃', color: 'magenta' }, { text: '  ' }])
})

test('a row has no status words and, off the mainline, no date: the glyph says what it is', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 48 })
  const tree = await ui.drawn()
  const steps = ['n0', 'n1', 'n2', 'n3', 'n16', 'n8']
  for (const key of rowKeys(tree)) {
    const line = textOf(elementOf(tree, key))
    expect(line).not.toMatch(/Adopted|Rejected|Planned|Withdrawn|In progress|adopted|rejected|planned|withdrawn/)
    if (steps.includes(key)) expect(line).toMatch(/\d\d-\d\d\s*$/)
    else expect(line).not.toMatch(/\d\d-\d\d/)
  }
})

test('the keys, the Allow button and the form for editing start where the text does, two columns in', async ($, on) => {
  notesWorld(on, { statusArgv: STATUS })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 40 })

  let tree = await ui.drawn()
  const isKey = (k: string) => !k.startsWith('~lang-') && k !== '~allow'
  const footers = blocksOf(tree).filter((b): b is El => (b as El).type === 'Box' && (b as El).props?.flexDirection === 'row' && keysOf(b).some(isKey))
  expect(footers.length).toBeGreaterThan(0)
  for (const f of footers) expect(textOf(f.children?.[0])).toBe('  ')

  // the button sits inside the frame of the status block: the frame's edge, a blank, the button, the other edge
  const allow = blocksOf(tree).find(b => keysOf(b).includes('~allow')) as El | undefined
  expect(allow?.type).toBe('Box')
  expect(textOf(allow?.children?.[0])).toBe('  │ ')
  expect(textOf(allow).startsWith('  │ Allow')).toBe(true)
  expect(textOf(allow).endsWith('│')).toBe(true)

  await ui.press({ key: '~edit' })
  tree = await ui.drawn()
  const form = blocksOf(tree).find(b => keysOf(b).includes('~summary')) as El | undefined
  expect(textOf(form?.children?.[0])).toBe('  Edit n0') // its title is a line of the pane
  const fields = form?.children?.[1] as El | undefined
  expect(fields?.props?.paddingLeft).toBe(2)
  expect(keysOf(fields)).toEqual(['~status', '~summary', '~save', '~cancel'])
})

test('a docked pane keeps its keys on its last rows, an inline one is only as tall as it needs', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const docked = await mountPane($, 'terminal', { columns: 80, rows: 36 })
  const dockedTree = await docked.drawn()
  await docked.unmount()
  expect(linesOf(dockedTree)).toHaveLength(36)
  const last = blocksOf(dockedTree).at(-1) as El | undefined
  expect(last?.type).toBe('Box')
  expect(last?.props?.flexDirection).toBe('row') // the last line of the keys
  const inline = await mountPane($, 'terminal', { columns: 80, rows: 36, placement: 'inline' })
  const inlineTree = await inline.drawn()
  expect(linesOf(inlineTree).length).toBeLessThan(36)
  expect(linesOf(inlineTree).length).toBeLessThanOrEqual(16)
  expect((blocksOf(inlineTree).at(-1) as El | undefined)?.props?.flexDirection).toBe('row')
})

// ---------------------------------------------------------------- selecting and opening

for (const surface of SURFACES) {
  test(`${surface}: the first press on a row selects it, the next opens or closes its children`, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80, rows: 60 })
    expect(rowKeys(await ui.drawn())).toContain('n5')

    await ui.press({ key: 'n3' })
    let tree = await ui.drawn()
    expect(linesOf(tree).filter(l => l.startsWith('▌'))).toHaveLength(1)
    expect(selectedLine(tree)).toContain('Conflicts: merge by paragraph')
    expect(textIn(tree)).toContain('Body text merges by paragraph') // its details
    expect(rowKeys(tree)).toContain('n5') // selecting did not close it

    await ui.press({ key: 'n3' })
    tree = await ui.drawn()
    for (const gone of ['n5', 'n6', 'n7', 'n15']) expect(rowKeys(tree)).not.toContain(gone)
    expect(selectedLine(tree)).toContain('+4') // the four it hides, counted

    await ui.press({ key: 'n3' })
    expect(rowKeys(await ui.drawn())).toContain('n15')

    // a leaf has nothing to open: pressing it twice only selects it
    const before = rowKeys(await ui.drawn())
    await ui.press({ key: 'n5' })
    await ui.press({ key: 'n5' })
    expect(rowKeys(await ui.drawn())).toEqual(before)
    expect(selectedLine(await ui.drawn())).toContain('Merge window')
  })
}

test('the focus ring follows the selection: Tab or an arrow onto a row selects it, onto a control does not', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  const marked = async () => selectedLine(await ui.drawn())

  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element: 'n8', origin: { kind: 'person' } })
  expect(await marked()).toContain('Beta to 500 testers')

  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element: '~edit', origin: { kind: 'person' } })
  expect(await marked()).toContain('Beta to 500 testers')

  // another plugin's element, or the engine's own stop, is none of its business
  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', origin: { kind: 'person' } })
  expect(await marked()).toContain('Beta to 500 testers')
})

test('the j and k keys step the selection, rows and all', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  const down = await ui.find({ key: '~down' })
  const up = await ui.find({ key: '~up' })
  expect(down?.props.hotkey).toBe('j')
  expect(up?.props.hotkey).toBe('k')
  const marked = async () => selectedLine(await ui.drawn())

  await ui.press({ key: '~down' })
  expect(await marked()).toContain('Desktop client') // the branch under the first step comes before the second step
  await ui.press({ key: '~down' })
  expect(await marked()).toContain('Release bar')
  await ui.press({ key: '~up' })
  expect(await marked()).toContain('Desktop client')
  for (let k = 0; k < 3; k++) await ui.press({ key: '~up' })
  expect(await marked()).toContain('Notes app') // stays on the first row
})

// ---------------------------------------------------------------- filters

test('p, h, a and s: the filters switch the rows and switch back; s hides the status block', async ($, on) => {
  notesWorld(on, { statusArgv: STATUS })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })

  const hotkeys = Object.fromEntries(
    await Promise.all(['~pending', '~clean', '~all', '~now', '~edit', '~trees', '~colors', '~lang'].map(async k => [k, (await ui.find({ key: k }))?.props.hotkey] as const)),
  )
  expect(hotkeys).toEqual({ '~pending': 'p', '~clean': 'h', '~all': 'a', '~now': 's', '~edit': 'e', '~trees': 't', '~colors': 'c', '~lang': 'l' })

  await ui.press({ key: '~pending' })
  expect(rowKeys(await ui.drawn())).toEqual(['n0', 'n1', 'n2', 'n3', 'n7', 'n15', 'n16', 'n8', 'n9', 'n10']) // the open work and the way down to it
  expect(textIn(await ui.drawn())).toContain('pending only') // the pane says what it is showing
  await ui.press({ key: '~pending' })
  expect(rowKeys(await ui.drawn())).toContain('n5')
  expect(textIn(await ui.drawn())).not.toContain('pending only')

  await ui.press({ key: '~clean' })
  const clean = rowKeys(await ui.drawn())
  for (const hidden of ['n14', 'n4', 'n11']) expect(clean).not.toContain(hidden) // what was rejected or withdrawn
  for (const shown of ['n0', 'n12', 'n3', 'n5', 'n8']) expect(clean).toContain(shown)
  await ui.press({ key: '~clean' })

  await ui.press({ key: '~all' })
  expect(rowKeys(await ui.drawn())).toHaveLength(17)

  expect(textIn(await ui.drawn())).toContain('Now')
  await ui.press({ key: '~now' })
  expect(textIn(await ui.drawn())).not.toContain('The status command wants to run')
  await ui.press({ key: '~now' })
  expect(textIn(await ui.drawn())).toContain('The status command wants to run')
})

test('with nothing matching the filter the pane says so instead of drawing an empty box', async ($, on) => {
  const w = world(on, { now: NOW })
  seed(w, [{ id: 'only-one', title: 'Only one decision', trunk: true }])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 70 })
  await ui.press({ key: '~pending' })
  expect(textIn(await ui.drawn())).toContain('Nothing matches this filter')
  expect(rowKeys(await ui.drawn())).toEqual([])
})

// ---------------------------------------------------------------- editing

for (const surface of EDITABLE) {
  test(`${surface}: e opens the form, a status and a summary become one update event by the user`, async ($, on) => {
    const w = notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80, rows: 60 })
    const before = eventsOn(w).length

    await ui.press({ key: 'n5' })
    await ui.press({ key: '~edit' })
    const status = await ui.find({ key: '~status' })
    const summary = await ui.find({ key: '~summary' })
    expect(status?.type).toBe('Select')
    expect(status?.props.value).toBe('no-diff')
    expect(summary?.type).toBe('Input')
    expect(summary?.props.autoFocus).toBe(true)

    await ui.select({ key: '~status', value: 'adopted' })
    await ui.input({ key: '~summary', text: 'kept at 5 s after the replay', kind: 'change' })
    expect((await ui.find({ key: '~status' }))?.props.value).toBe('adopted')
    expect((await ui.find({ key: '~summary' }))?.props.value).toBe('kept at 5 s after the replay')
    expect(eventsOn(w)).toHaveLength(before) // nothing is written until it is saved

    await ui.press({ key: '~save' })
    const events = eventsOn(w)
    expect(events).toHaveLength(before + 1)
    expect(events.at(-1)).toMatchObject({
      op: 'update',
      actor: 'user',
      id: 'n5',
      patch: { status: 'adopted', summary: 'kept at 5 s after the replay' },
    })
    // the form is gone and the row and the details show the change
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
    const tree = await ui.drawn()
    expect(lineWith(tree, 'Merge window')).toContain('✓')
    expect(textIn(tree)).toContain('kept at 5 s after the replay')
  })

  test(`${surface}: Enter in the summary saves what was typed; cancel writes nothing`, async ($, on) => {
    const w = notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80, rows: 60 })
    const before = eventsOn(w).length

    await ui.press({ key: 'n9' })
    await ui.press({ key: '~edit' })
    await ui.input({ key: '~summary', text: 'abandoned', kind: 'change' })
    await ui.press({ key: '~cancel' })
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
    expect(eventsOn(w)).toHaveLength(before)

    await ui.press({ key: '~edit' })
    await ui.input({ key: '~summary', text: 'three phones, one week', kind: 'submit' })
    expect(eventsOn(w).at(-1)).toMatchObject({ op: 'update', actor: 'user', id: 'n9', patch: { summary: 'three phones, one week' } })
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
  })
}

test('mobile has no text field: the edit key is not offered, and a form opened elsewhere falls back to a note', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'mobile', isInteractive: true })
  const ui = await mountPane($, 'mobile', { columns: 60, rows: 48 })
  expect(await ui.find({ key: '~edit' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Input' })).toEqual([])
  expect(await ui.findAll({ type: 'Select' })).toEqual([])

  // /decide with no arguments starts the edit of the selected node from the prompt
  const said = await slash($, 'decide')
  expect(JSON.stringify(said)).toContain('Editing n0')
  const tree = await ui.drawn()
  expect(textIn(tree)).toContain('Edit n0')
  expect(textIn(tree)).toContain('Editing needs a text field; use /decide status')
  expect(await ui.find({ key: '~save' })).toBeUndefined()
  const cancel = await ui.find({ key: '~cancel' })
  expect(cancel?.type).toBe('Button')
  await ui.press({ key: '~cancel' })
  expect(await ui.find({ key: '~cancel' })).toBeUndefined()
})

// ---------------------------------------------------------------- the language

test('the switch in the strip and the l key change the language of the pane; the choice is the person\'s own', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  const config = () => JSON.parse(w.disk.text(`${ROOT}/.claude/decisions/config.json`)) as { display: { language: string } }

  let tree = await ui.drawn()
  expect(linesOf(tree)[1]).toContain('17 decisions')
  expect(textIn(tree)).toContain('l: 中') // the key names the language it switches to

  await ui.press({ key: '~lang-zh' })
  tree = await ui.drawn()
  expect(linesOf(tree)[1]).toMatch(/^ {2}17 个决定 {3}mainline 6 steps {2,}● 记录中 {3}\d\d:\d\d 更新$/) // the chrome in Chinese, the technical words not
  expect(textIn(tree)).toContain('l: EN')
  expect(textIn(tree)).toContain('e: 编辑')
  expect(textIn(tree)).toContain('p: pending') // pending, tree, mainline: terms of the tool stay English
  expect(w.store.get(`pin:${ROOT}`)).toBe('zh')
  expect(config().display.language).toBe('auto') // nobody else's pane is touched

  await ui.press({ key: '~lang' })
  tree = await ui.drawn()
  expect(linesOf(tree)[1]).toContain('17 decisions')
  expect(w.store.get(`pin:${ROOT}`)).toBe('en')
  await ui.press({ key: '~lang-en' }) // choosing the language it already is leaves it as it is
  expect(linesOf(await ui.drawn())[1]).toContain('17 decisions')
})

test('a pinned language wins over the language of the prompts; /decide lang takes the pin off and fixes it for the project', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  const config = () => JSON.parse(w.disk.text(`${ROOT}/.claude/decisions/config.json`)) as { display: { language: string } }
  const second = async () => linesOf(await ui.drawn())[1] ?? ''

  await ui.press({ key: '~lang-zh' })
  await submit($, 'Please go on and run the second seed now')
  expect(await second()).toContain('个决定') // the person asked for Chinese; writing in English does not undo it

  await slash($, 'decide', 'lang en')
  expect(config().display.language).toBe('en')
  expect(w.store.get(`pin:${ROOT}`)).toBe('')
  expect(await second()).toContain('17 decisions')
  await submit($, '这个方向不错，先把这一步定下来，然后开始跑下一个实验')
  expect(await second()).toContain('17 decisions') // the project says English, whatever is typed

  await slash($, 'decide', 'lang auto')
  expect(await second()).toContain('17 decisions') // auto again: the last prompt that counted was English
  await submit($, '这个方向不错，先把这一步定下来，然后开始跑下一个实验')
  expect(await second()).toContain('个决定') // and now it follows the prompts
  await ui.press({ key: '~lang-en' })
  expect(await second()).toContain('17 decisions')
  await submit($, '继续吧，把这一步的结论写进去，再看下一个')
  expect(await second()).toContain('17 decisions') // the pin wins again
})

test('a pinned language is still there in the next session', async ($, on) => {
  const w = notesWorld(on)
  w.store.set(`pin:${ROOT}`, 'zh') // what an earlier session of this person stored
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  expect(linesOf(await ui.drawn())[1]).toContain('个决定')
})

// ---------------------------------------------------------------- the status block

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a new status command waits behind Allow; pressing it runs the command and draws the lanes`, async ($, on) => {
    const w = notesWorld(on, { statusArgv: STATUS })
    w.onRun = () => ok(SAMPLE)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await slash($, 'tree') // opens the pane: the command runs only while it is shown
    const ui = await mountPane($, surface, { columns: 80, rows: 48 })

    const before = textIn(await ui.drawn())
    expect(before).toContain('bash scripts/status.sh')
    expect(before).toContain('Allow')
    const allow = await ui.find({ key: '~allow' })
    expect(allow?.type).toBe('Button')
    expect(allow?.props.variant).toBe('primary')
    await w.clock.advance(120_000)
    expect(w.runs.filter(r => r[0] === 'bash')).toHaveLength(0) // nothing ran without the person

    await ui.press({ key: '~allow' })
    expect(w.runs.filter(r => r[0] === 'bash')).toEqual([STATUS])
    expect(await ui.find({ key: '~allow' })).toBeUndefined()
    const after = linesOf(await ui.drawn())
    const lane = after.find(l => l.includes('ALPHA'))
    expect(lane).toContain('sync-bench s0')
    expect(lane).toMatch(/█+░+/) // the bar: 1700 of 2000
    expect(lane).toContain('1700/2000')
    expect(after.join('\n')).toContain('restore-test s1')
    for (const line of after) expect(strWidth(line)).toBeLessThanOrEqual(80)
  })
}

test('a status command that starts failing leaves the last data on screen, marked stale, with the error under it', async ($, on) => {
  const w = notesWorld(on, { statusArgv: STATUS })
  w.onRun = () => ok(SAMPLE)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 48 })
  await ui.press({ key: '~allow' })
  expect(textIn(await ui.drawn())).not.toContain('stale')

  w.onRun = () => ({ exitCode: 255, stdout: '', stderr: 'ssh: connect to host login timed out\nsecond line' })
  await w.clock.advance(35_000)
  const text = textIn(await ui.drawn())
  expect(text).toContain('ALPHA') // the last data stays
  expect(text).toContain('stale')
  expect(text).toContain('ssh: connect to host login timed out')
  expect(text).not.toContain('second line')

  w.onRun = () => ok(SAMPLE)
  await w.clock.advance(35_000)
  expect(textIn(await ui.drawn())).not.toContain('stale')
})

test('when the status command changes, the person is asked again', async ($, on) => {
  const w = notesWorld(on, { statusArgv: STATUS })
  w.onRun = () => ok(SAMPLE)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 90, rows: 48 })
  await ui.press({ key: '~allow' })
  expect(await ui.find({ key: '~allow' })).toBeUndefined()

  const config = JSON.parse(w.disk.text(`${ROOT}/.claude/decisions/config.json`))
  w.disk.put(`${ROOT}/.claude/decisions/config.json`, JSON.stringify({ ...config, status: { ...config.status, argv: ['bash', 'scripts/other.sh'] } }))
  await w.clock.advance(10_000) // the next poll of config.json
  expect((await ui.find({ key: '~allow' }))?.type).toBe('Button')
  expect(textIn(await ui.drawn())).toContain('bash scripts/other.sh')
  const runs = w.runs.filter(r => r[0] === 'bash').length
  await w.clock.advance(60_000)
  expect(w.runs.filter(r => r[0] === 'bash')).toHaveLength(runs)
})

// ---------------------------------------------------------------- a long tree

test('a tree longer than the pane is windowed around the selection, with page rows to move by', async ($, on) => {
  const w = world(on, { now: NOW })
  seed(w, manyNodes(80))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 70, rows: 24 })

  let tree = await ui.drawn()
  expect(linesOf(tree).length).toBeLessThanOrEqual(24)
  expect(rowKeys(tree).length).toBeLessThan(81)
  expect(keysOf(tree)).toContain('~page-down')
  expect(keysOf(tree)).not.toContain('~page-up')
  expect(textIn(tree)).toMatch(/▼ \d+ more below/)
  const first = rowKeys(tree)[0]

  await ui.press({ key: '~page-down' })
  tree = await ui.drawn()
  expect(keysOf(tree)).toContain('~page-up')
  expect(selectedLine(tree)).toContain('decision number') // the selection moved a page down, off the root
  expect(first).toBe('big-root')
  for (const line of linesOf(tree)) expect(strWidth(line)).toBeLessThanOrEqual(70)

  // paging on reaches the last decision, and then there is no page below
  for (let k = 0; k < 20 && keysOf(tree).includes('~page-down'); k++) {
    await ui.press({ key: '~page-down' })
    tree = await ui.drawn()
  }
  expect(rowKeys(tree)).toContain('big-079')
  expect(keysOf(tree)).not.toContain('~page-down')
})

test('every surface draws a long tree within its rows', async ($, on) => {
  const w = world(on, { now: NOW })
  seed(w, manyNodes(120))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  for (const rows of [10, 16, 30]) {
    const ui = await mountPane($, 'terminal', { columns: 60, rows })
    const lines = linesOf(await ui.drawn())
    expect(lines.length).toBeLessThanOrEqual(Math.max(rows, 6))
    await ui.unmount()
  }
})

test('the text of every Button is what its line shows', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80, rows: 48 })
  for (const el of await ui.findAll({ type: 'Button' })) {
    expect(typeof el.key).toBe('string')
    expect(textOf(el).trim()).not.toBe('')
  }
})
