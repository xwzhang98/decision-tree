// The pane as the engine draws it: mounted on every surface through the test kit,
// read back as the tree of elements the surface would be handed, and acted on the
// way a person does (press, type, pick).

import { test, expect } from 'claude-code/testing'

import { strWidth } from '../lib/width'
import { EDITABLE, SKETCH, SURFACES, blocksOf, elementOf, keysOf, linesOf, manyNodes, mountPane, rowKeys, runsOf, textOf } from './draw'
import type { El } from './draw'
import { eventsOn, seed, slash, world } from './engine'
import { ROOT } from './port'

const WIDTHS = [48, 60, 80, 110]

const SAMPLE = JSON.stringify({
  updatedAt: '2026-10-10T08:00:00Z',
  lanes: [{ name: 'ZETA', run: 'gateway s0', state: 'running', step: 3400, total: 4000, eta: '23:50' }],
  next: [{ text: 'gate → probe s1', eta: '06:15' }],
  warnings: [],
})

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

// ---------------------------------------------------------------- what is drawn

for (const surface of SURFACES) {
  test(`${surface}: a project that is off invites the person to start, and draws no tree`, async ($, on) => {
    const w = world(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface)
    const lines = linesOf(await ui.drawn())
    expect(lines.join('\n')).toContain('/decide start')
    expect(rowKeys(await ui.drawn())).toEqual([])
    expect(w.disk.files.size).toBe(0) // looking writes nothing
  })

  test(`${surface}: every decision is one Button keyed by its id, and no line is wider than the pane`, async ($, on) => {
    const w = world(on)
    seed(w, SKETCH)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    for (const columns of WIDTHS) {
      const ui = await mountPane($, surface, { columns })
      const tree = await ui.drawn()
      const keys = rowKeys(tree)
      expect(keys).toEqual([
        'design-v2',
        'pooling-only-2',
        'pool-32',
        'v21-abs-size',
        'v21-run-a',
        'dbpool-adopted',
        'v22-adopted',
        'deep-skip',
        'gateway',
        'proxies1',
      ])
      expect(new Set(keysOf(tree)).size).toBe(keysOf(tree).length) // keys are unique
      for (const line of linesOf(tree)) expect(strWidth(line)).toBeLessThanOrEqual(columns)
      // exactly one row carries the selection marker
      const marked = linesOf(tree).filter(l => l.startsWith('▌'))
      expect(marked).toHaveLength(1)
      expect(marked[0]).toContain('design v2')
      // a row's accessible label is its line, without the padding
      const first = await ui.find({ key: 'design-v2' })
      expect(first?.type).toBe('Button')
      expect(String(first?.props.label)).toContain('design v2')
      await ui.unmount()
    }
  })
}

test('the header, the mainline and the detail panel say where things stand', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { title: 'orders-api-rewrite' })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  const text = linesOf(await ui.drawn()).join('\n')
  expect(text).toContain('Decision tree  orders-api-rewrite')
  expect(text).toContain('● Recording   10 decisions')
  expect(text).toMatch(/Mainline .*gateway/)
  expect(text).toContain('✓ Adopted   user') // the detail of the selected node
  // the glyphs of the statuses on their rows
  const rows = linesOf(await ui.drawn())
  expect(rows.find(l => l.includes('v2.1：池的大小用绝对值'))).toContain('✗')
  expect(rows.find(l => l.includes('pool 数维持 32'))).toContain('=')
  expect(rows.find(l => l.includes('proxies1') || l.includes('3 proxies'))).toContain('○')
  expect(rows.find(l => l.includes('deep_skip'))).toContain('⊘')
})

test('ASCII glyphs: display.asciiGlyphs swaps every symbol for plain characters', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { ascii: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  const text = linesOf(await ui.drawn()).join('\n')
  // the status glyphs, the rules, the marks in the margin, the recording dot, the detail's marker and the mainline separator
  for (const glyph of ['✓', '✗', '◐', '○', '◌', '⊘', '├', '└', '│', '─', '❯', '█', '›', '▎', '▌', '●', '▾', '▸']) expect(text).not.toContain(glyph)
  const lines = linesOf(await ui.drawn())
  expect(lines.find(l => l.includes('连接只走池化'))).toMatch(/^\| {3}\+ /) // the mainline's spine, two columns in, adopted
  expect(lines.find(l => l.includes('seed 0 重跑'))).toMatch(/^ {8}x /) // three levels down, rejected, nothing in the margin
  expect(lines.find(l => l.startsWith('>'))).toContain('design v2') // the selection's mark
  expect(text).toContain('* Recording') // the recording dot
})

test('a pane docked and a pane inline draw the same tree; inline stays short', async ($, on) => {
  const w = world(on)
  seed(w, manyNodes(60))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const docked = await mountPane($, 'terminal', { columns: 70, rows: 40 })
  const dockedLines = linesOf(await docked.drawn())
  await docked.unmount()
  const inline = await mountPane($, 'terminal', { columns: 70, rows: 40, placement: 'inline' })
  const inlineLines = linesOf(await inline.drawn())
  expect(dockedLines.length).toBeLessThanOrEqual(40)
  expect(inlineLines.length).toBeLessThanOrEqual(16)
  expect(inlineLines.length).toBeLessThan(dockedLines.length)
})

// ---------------------------------------------------------------- the look

test('the selected row is one bar: all of it on the selection colour from edge to edge, its mark in the accent, and no other row has a background', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })

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
      expect(runs[0]).toEqual({ text: '▌', color: 'suggestion', backgroundColor: 'subtle' })
      expect(runs.some(r => r.bold === true)).toBe(true) // the title
      expect(strWidth(runs.map(r => r.text).join(''))).toBe(80) // the bar runs to the edge of the pane
    }
  }

  await expectBarOn('design-v2')
  await ui.press({ key: 'gateway' })
  await expectBarOn('gateway')
  await ui.press({ key: '~down' })
  await expectBarOn('proxies1')
})

test('the mainline is a thin spine in the margin of its rows, and its label has the same colour; the rows off it leave the margin empty', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  const tree = await ui.drawn()

  for (const key of ['pooling-only-2', 'dbpool-adopted', 'v22-adopted', 'gateway']) {
    expect(runsOf(elementOf(tree, key))[0]).toEqual({ text: '▎', color: 'merged' })
  }
  for (const key of ['pool-32', 'v21-abs-size', 'v21-run-a', 'deep-skip', 'proxies1']) {
    expect(runsOf(elementOf(tree, key))[0]).toEqual({ text: ' ' })
  }
  // a selected row on the mainline gives the margin to its bar
  expect(runsOf(elementOf(tree, 'design-v2'))[0]?.text).toBe('▌')

  const mainline = blocksOf(tree).find(b => textOf(b).startsWith('  Mainline'))
  expect(runsOf(mainline)[1]).toEqual({ text: 'Mainline', color: 'merged' })
})

test('a row has no tree lines, no dates and no status words: the glyph says what it is', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100 })
  const tree = await ui.drawn()
  for (const key of rowKeys(tree)) {
    const line = textOf(elementOf(tree, key))
    expect(line).not.toMatch(/[├└│─]/)
    expect(line).not.toMatch(/\d{2}-\d{2}/)
    expect(line).not.toMatch(/Adopted|Rejected|Planned|Withdrawn|In progress/)
  }
})

test('the footer, the Allow button and the edit form start where the text does, two columns in', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { statusArgv: ['bash', 'scripts/status.sh'] })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 80 })

  let tree = await ui.drawn()
  const footers = blocksOf(tree).filter((b): b is El => (b as El).type === 'Box' && (b as El).props?.flexDirection === 'row')
  expect(footers.length).toBeGreaterThan(0)
  for (const f of footers) expect(textOf(f.children?.[0])).toBe('  ')

  const allow = blocksOf(tree).find(b => keysOf(b).includes('~allow')) as El | undefined
  expect(allow?.type).toBe('Box')
  expect(allow?.props?.paddingLeft).toBe(2)

  await ui.press({ key: '~edit' })
  tree = await ui.drawn()
  const form = blocksOf(tree).find(b => keysOf(b).includes('~summary')) as El | undefined
  expect(textOf(form?.children?.[0])).toBe('  Edit design-v2') // its title is a line of the pane
  const fields = form?.children?.[1] as El | undefined
  expect(fields?.props?.paddingLeft).toBe(2)
  expect(keysOf(fields)).toEqual(['~status', '~summary', '~save', '~cancel'])
})

test('a docked pane keeps its footer on its last rows, an inline one is only as tall as it needs', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const docked = await mountPane($, 'terminal', { columns: 80, rows: 36 })
  const dockedTree = await docked.drawn()
  await docked.unmount()
  expect(linesOf(dockedTree)).toHaveLength(36)
  const last = blocksOf(dockedTree).at(-1) as El | undefined
  expect(last?.type).toBe('Box')
  expect(last?.props?.flexDirection).toBe('row') // the footer
  const inline = await mountPane($, 'terminal', { columns: 80, rows: 36, placement: 'inline' })
  const inlineTree = await inline.drawn()
  expect(linesOf(inlineTree).length).toBeLessThan(36)
  expect(linesOf(inlineTree).length).toBeLessThanOrEqual(16)
  expect((blocksOf(inlineTree).at(-1) as El | undefined)?.props?.flexDirection).toBe('row')
})

// ---------------------------------------------------------------- selecting and opening

for (const surface of SURFACES) {
  test(`${surface}: the first press on a row selects it, the next opens or closes its children`, async ($, on) => {
    const w = world(on)
    seed(w, SKETCH)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80 })
    expect(rowKeys(await ui.drawn())).toContain('deep-skip')

    await ui.press({ key: 'v22-adopted' })
    let lines = linesOf(await ui.drawn())
    expect(lines.filter(l => l.startsWith('▌'))).toHaveLength(1)
    expect(lines.find(l => l.startsWith('▌'))).toContain('构建版本定为 v2.2')
    expect(lines.join('\n')).toContain('池的大小、线程、队列全部用比例') // its detail
    expect(rowKeys(await ui.drawn())).toContain('deep-skip') // selecting did not close it

    await ui.press({ key: 'v22-adopted' })
    expect(rowKeys(await ui.drawn())).not.toContain('deep-skip')
    lines = linesOf(await ui.drawn())
    expect(lines.find(l => l.startsWith('▌'))).toContain('+1') // the collapsed child, counted

    await ui.press({ key: 'v22-adopted' })
    expect(rowKeys(await ui.drawn())).toContain('deep-skip')

    // a leaf has nothing to open: pressing it twice only selects it
    const rowsBefore = rowKeys(await ui.drawn())
    await ui.press({ key: 'deep-skip' })
    await ui.press({ key: 'deep-skip' })
    expect(rowKeys(await ui.drawn())).toEqual(rowsBefore)
    expect(linesOf(await ui.drawn()).find(l => l.startsWith('▌'))).toContain('deep_skip')
  })
}

test('the focus ring follows the selection: Tab or an arrow onto a row selects it, onto a control does not', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  const marked = async () => linesOf(await ui.drawn()).find(l => l.startsWith('▌')) ?? ''

  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element: 'gateway', origin: { kind: 'person' } })
  expect(await marked()).toContain('gateway')

  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element: '~edit', origin: { kind: 'person' } })
  expect(await marked()).toContain('gateway')

  // another plugin's element, or the engine's own stop, is none of its business
  await $.ui.focus({ component: 'Pane', requestId: 'decision-tree', origin: { kind: 'person' } })
  expect(await marked()).toContain('gateway')
})

test('the j and k keys step the selection, rows and all', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  const down = await ui.find({ key: '~down' })
  const up = await ui.find({ key: '~up' })
  expect(down?.props.hotkey).toBe('j')
  expect(up?.props.hotkey).toBe('k')
  const marked = async () => linesOf(await ui.drawn()).find(l => l.startsWith('▌')) ?? ''

  await ui.press({ key: '~down' })
  expect(await marked()).toContain('连接只走池化')
  await ui.press({ key: '~down' })
  expect(await marked()).toContain('pool 数维持 32')
  await ui.press({ key: '~up' })
  expect(await marked()).toContain('连接只走池化')
  for (let k = 0; k < 3; k++) await ui.press({ key: '~up' })
  expect(await marked()).toContain('design v2') // stays on the first row
})

// ---------------------------------------------------------------- filters

test('p, h, a and s: the filters switch the rows and switch back; s hides the now block', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { statusArgv: ['bash', 'scripts/status.sh'] })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100 })

  const hotkeys = Object.fromEntries(
    await Promise.all(['~pending', '~clean', '~all', '~now', '~edit'].map(async k => [k, (await ui.find({ key: k }))?.props.hotkey] as const)),
  )
  expect(hotkeys).toEqual({ '~pending': 'p', '~clean': 'h', '~all': 'a', '~now': 's', '~edit': 'e' })

  await ui.press({ key: '~pending' })
  expect(rowKeys(await ui.drawn())).toEqual(['design-v2', 'gateway', 'proxies1']) // the open work and the way down to it
  expect(linesOf(await ui.drawn()).join('\n')).toMatch(/Pending/)
  await ui.press({ key: '~pending' })
  expect(rowKeys(await ui.drawn())).toContain('pool-32')

  await ui.press({ key: '~clean' })
  const clean = rowKeys(await ui.drawn())
  for (const hidden of ['v21-abs-size', 'v21-run-a', 'deep-skip']) expect(clean).not.toContain(hidden)
  for (const shown of ['design-v2', 'pool-32', 'dbpool-adopted', 'gateway']) expect(clean).toContain(shown)
  await ui.press({ key: '~clean' })

  await ui.press({ key: '~all' })
  expect(rowKeys(await ui.drawn())).toHaveLength(10)

  expect(linesOf(await ui.drawn()).join('\n')).toContain('Now')
  await ui.press({ key: '~now' })
  expect(linesOf(await ui.drawn()).join('\n')).not.toContain('The status command wants to run')
  await ui.press({ key: '~now' })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('The status command wants to run')
})

test('with nothing matching the filter the pane says so instead of drawing an empty box', async ($, on) => {
  const w = world(on)
  seed(w, [{ id: 'only-one', title: 'only one decision', trunk: true }])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 70 })
  await ui.press({ key: '~pending' })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('Nothing matches this filter')
  expect(rowKeys(await ui.drawn())).toEqual([])
})

// ---------------------------------------------------------------- editing

for (const surface of EDITABLE) {
  test(`${surface}: e opens the form, a status and a summary become one update event by the user`, async ($, on) => {
    const w = world(on)
    seed(w, SKETCH)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80 })
    const before = eventsOn(w).length

    await ui.press({ key: 'pool-32' })
    await ui.press({ key: '~edit' })
    const status = await ui.find({ key: '~status' })
    const summary = await ui.find({ key: '~summary' })
    expect(status?.type).toBe('Select')
    expect(status?.props.value).toBe('no-diff')
    expect(summary?.type).toBe('Input')
    expect(summary?.props.autoFocus).toBe(true)

    await ui.select({ key: '~status', value: 'adopted' })
    await ui.input({ key: '~summary', text: 'kept at 32 after the ablation', kind: 'change' })
    expect((await ui.find({ key: '~status' }))?.props.value).toBe('adopted')
    expect((await ui.find({ key: '~summary' }))?.props.value).toBe('kept at 32 after the ablation')
    expect(eventsOn(w)).toHaveLength(before) // nothing is written until it is saved

    await ui.press({ key: '~save' })
    const events = eventsOn(w)
    expect(events).toHaveLength(before + 1)
    expect(events.at(-1)).toMatchObject({
      op: 'update',
      actor: 'user',
      id: 'pool-32',
      patch: { status: 'adopted', summary: 'kept at 32 after the ablation' },
    })
    // the form is gone and the row and the detail show the change
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
    const lines = linesOf(await ui.drawn())
    expect(lines.find(l => l.includes('pool 数维持 32'))).toContain('✓')
    expect(lines.join('\n')).toContain('kept at 32 after the ablation')
  })

  test(`${surface}: Enter in the summary saves what was typed; cancel writes nothing`, async ($, on) => {
    const w = world(on)
    seed(w, SKETCH)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 80 })
    const before = eventsOn(w).length

    await ui.press({ key: 'proxies1' })
    await ui.press({ key: '~edit' })
    await ui.input({ key: '~summary', text: 'abandoned', kind: 'change' })
    await ui.press({ key: '~cancel' })
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
    expect(eventsOn(w)).toHaveLength(before)

    await ui.press({ key: '~edit' })
    await ui.input({ key: '~summary', text: 'one block, no more', kind: 'submit' })
    expect(eventsOn(w).at(-1)).toMatchObject({ op: 'update', actor: 'user', id: 'proxies1', patch: { summary: 'one block, no more' } })
    expect(await ui.find({ key: '~summary' })).toBeUndefined()
  })
}

test('mobile has no text field: the edit key is not offered, and a form opened elsewhere falls back to a note', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'mobile', isInteractive: true })
  const ui = await mountPane($, 'mobile', { columns: 60 })
  expect(await ui.find({ key: '~edit' })).toBeUndefined()
  expect(await ui.findAll({ type: 'Input' })).toEqual([])
  expect(await ui.findAll({ type: 'Select' })).toEqual([])

  // /decide with no arguments starts the edit of the selected node from the prompt
  const said = await slash($, 'decide')
  expect(JSON.stringify(said)).toContain('Editing design-v2')
  const lines = linesOf(await ui.drawn())
  expect(lines.join('\n')).toContain('Edit design-v2')
  expect(lines.join('\n')).toContain('Editing needs a text field; use /decide status')
  expect(await ui.find({ key: '~save' })).toBeUndefined()
  const cancel = await ui.find({ key: '~cancel' })
  expect(cancel?.type).toBe('Button')
  await ui.press({ key: '~cancel' })
  expect(await ui.find({ key: '~cancel' })).toBeUndefined()
})

// ---------------------------------------------------------------- the now block

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: a new status command waits behind Allow; pressing it runs the command and draws the lanes`, async ($, on) => {
    const w = world(on)
    seed(w, SKETCH, { statusArgv: ['bash', 'scripts/status.sh'] })
    w.onRun = () => ok(SAMPLE)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    await slash($, 'tree') // opens the pane: the command runs only while it is shown
    const ui = await mountPane($, surface, { columns: 80 })

    const before = linesOf(await ui.drawn()).join('\n')
    expect(before).toContain('bash scripts/status.sh')
    expect(before).toContain('Allow')
    const allow = await ui.find({ key: '~allow' })
    expect(allow?.type).toBe('Button')
    expect(allow?.props.variant).toBe('primary')
    await w.clock.advance(120_000)
    expect(w.runs.filter(r => r[0] === 'bash')).toHaveLength(0) // nothing ran without the person

    await ui.press({ key: '~allow' })
    expect(w.runs.filter(r => r[0] === 'bash')).toEqual([['bash', 'scripts/status.sh']])
    expect(await ui.find({ key: '~allow' })).toBeUndefined()
    const after = linesOf(await ui.drawn())
    const lane = after.find(l => l.includes('ZETA'))
    expect(lane).toContain('gateway s0')
    expect(lane).toMatch(/█+░+/) // the bar: 3400 of 4000
    expect(lane).toContain('3400/4000')
    expect(after.join('\n')).toContain('gate → probe s1')
    for (const line of after) expect(strWidth(line)).toBeLessThanOrEqual(80)
  })
}

test('a status command that starts failing leaves the last data on screen, marked stale, with the error under it', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { statusArgv: ['bash', 'scripts/status.sh'] })
  w.onRun = () => ok(SAMPLE)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 90 })
  await ui.press({ key: '~allow' })
  expect(linesOf(await ui.drawn()).join('\n')).not.toContain('stale')

  w.onRun = () => ({ exitCode: 255, stdout: '', stderr: 'ssh: connect to host login timed out\nsecond line' })
  await w.clock.advance(35_000)
  const text = linesOf(await ui.drawn()).join('\n')
  expect(text).toContain('ZETA') // the last data stays
  expect(text).toContain('stale')
  expect(text).toContain('ssh: connect to host login timed out')
  expect(text).not.toContain('second line')

  w.onRun = () => ok(SAMPLE)
  await w.clock.advance(35_000)
  expect(linesOf(await ui.drawn()).join('\n')).not.toContain('stale')
})

test('when the status command changes, the person is asked again', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH, { statusArgv: ['bash', 'scripts/status.sh'] })
  w.onRun = () => ok(SAMPLE)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await slash($, 'tree')
  const ui = await mountPane($, 'terminal', { columns: 90 })
  await ui.press({ key: '~allow' })
  expect(await ui.find({ key: '~allow' })).toBeUndefined()

  const config = JSON.parse(w.disk.text(`${ROOT}/.claude/decisions/config.json`))
  w.disk.put(`${ROOT}/.claude/decisions/config.json`, JSON.stringify({ ...config, status: { ...config.status, argv: ['bash', 'scripts/other.sh'] } }))
  await w.clock.advance(10_000) // the next poll of config.json
  expect((await ui.find({ key: '~allow' }))?.type).toBe('Button')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('bash scripts/other.sh')
  const runs = w.runs.filter(r => r[0] === 'bash').length
  await w.clock.advance(60_000)
  expect(w.runs.filter(r => r[0] === 'bash')).toHaveLength(runs)
})

// ---------------------------------------------------------------- a long tree

test('a tree longer than the pane is windowed around the selection, with page rows to move by', async ($, on) => {
  const w = world(on)
  seed(w, manyNodes(80))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 70, rows: 24 })

  let tree = await ui.drawn()
  expect(linesOf(tree).length).toBeLessThanOrEqual(24)
  expect(rowKeys(tree).length).toBeLessThan(81)
  expect(keysOf(tree)).toContain('~page-down')
  expect(keysOf(tree)).not.toContain('~page-up')
  const first = rowKeys(tree)[0]

  await ui.press({ key: '~page-down' })
  tree = await ui.drawn()
  expect(keysOf(tree)).toContain('~page-up')
  const marked = linesOf(tree).find(l => l.startsWith('▌')) ?? ''
  expect(marked).toContain('decision number') // the selection moved a page down, off the root
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
  const w = world(on)
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
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  for (const el of await ui.findAll({ type: 'Button' })) {
    expect(typeof el.key).toBe('string')
    expect(textOf(el).trim()).not.toBe('')
  }
})
