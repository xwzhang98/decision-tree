import { test, expect } from 'claude-code/testing'

import { schemeKey } from '../lib/bar'
import { Runtime } from '../lib/runtime'
import { DEFAULT_SCHEME, SCHEMES } from '../lib/palettes'
import { FakeEngine, ROOT } from './port'

async function boot(engine = new FakeEngine()) {
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

type Booted = Awaited<ReturnType<typeof boot>>

async function recorded(): Promise<Booted> {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start notes-app')
  await b.rt.command(b.p, 'decide', 'add Notes app --id notes-app --status adopted --trunk')
  return b
}

const toastsOf = (b: Booted): string[] => b.engine.toasts.map(t => t.text)
const NAMES = SCHEMES.map(s => s.name).join(', ')

// ---------------------------------------------------------------- what is in use

test('colors: with nothing chosen the default scheme is in use, and nothing is written to the disk for it', async () => {
  const b = await boot()
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  expect(b.engine.disk.files.size).toBe(0)
  expect(b.engine.store.has('scheme')).toBe(false)
})

test('colors: the scheme chosen in an earlier session is in use at the start, in every project', async () => {
  const engine = new FakeEngine()
  engine.store.set('scheme', 'nord')
  const b = await boot(engine)
  expect(b.engine.cells.scheme).toBe('nord')

  // another project of the same person (the store is theirs, not the project's)
  const other = new FakeEngine()
  other.cwd = '/work/other'
  other.store.set('scheme', 'nord')
  expect((await boot(other)).engine.cells.scheme).toBe('nord')
})

test('colors: a stored value that is no scheme of this version is the default', async () => {
  for (const stored of ['gone-scheme', '', 42, null, { id: 'nord' }]) {
    const engine = new FakeEngine()
    engine.store.set('scheme', stored)
    expect((await boot(engine)).engine.cells.scheme, JSON.stringify(stored)).toBe(DEFAULT_SCHEME)
  }
})

test('colors: a scheme another session chose arrives with the next poll', async () => {
  const b = await boot()
  b.engine.store.set('scheme', 'dracula')
  await b.engine.advance(5000)
  expect(b.engine.cells.scheme).toBe('dracula')
  // and its going back to the default does too
  b.engine.store.set('scheme', '')
  await b.engine.advance(5000)
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  // a poll that finds nothing new draws nothing again
  const before = b.engine.writes.filter(w => w === 'scheme').length
  await b.engine.advance(30_000)
  expect(b.engine.writes.filter(w => w === 'scheme').length).toBe(before)
})

test('colors: the scheme is published again after a /clear wiped the session state', async () => {
  const b = await recorded()
  await b.rt.command(b.p, 'decide', 'colors nord')
  b.engine.cells.scheme = DEFAULT_SCHEME
  b.engine.cells.project = { ...b.engine.cells.project, root: '' }
  b.engine.cells.owner = ''
  await b.engine.advance(5000)
  expect(b.engine.cells.scheme).toBe('nord')
})

// ---------------------------------------------------------------- /decide colors

test('/decide colors: without a name it says which scheme is in use and which there are', async () => {
  const b = await boot()
  expect(await b.rt.command(b.p, 'decide', 'colors')).toBe(`Colors: Terminal. Choose with /decide colors <name> (one of: ${NAMES}), or press c in the pane to try them on.`)
  await b.rt.command(b.p, 'decide', 'colors nord')
  expect(await b.rt.command(b.p, 'decide', 'colors')).toContain('Colors: Nord.')
  await b.rt.setLang(b.p, 'zh')
  expect(await b.rt.command(b.p, 'decide', 'colors')).toBe(`当前配色：Nord。用 /decide colors <name> 切换（可选：${NAMES}），或在 pane 里按 c 试色。`)
})

test('/decide colors <name>: keeps the scheme for every project, and the pane is drawn in it', async () => {
  const b = await boot()
  expect(await b.rt.command(b.p, 'decide', 'colors nord')).toBe('Colors set to Nord.')
  expect(b.engine.cells.scheme).toBe('nord')
  expect(b.engine.store.get('scheme')).toBe('nord')
  // the name as the picker shows it works, whatever the case and the blanks
  expect(await b.rt.command(b.p, 'decide', 'colors Gruvbox Dark')).toBe('Colors set to Gruvbox Dark.')
  expect(b.engine.store.get('scheme')).toBe('gruvbox-dark')
  expect(await b.rt.command(b.p, 'decide', 'colors  TOKYO_NIGHT  ')).toBe('Colors set to Tokyo Night.')
  expect(await b.rt.command(b.p, 'decide', 'colors "one light"')).toBe('Colors set to One Light.')
  expect(b.engine.cells.scheme).toBe('one-light')
  await b.rt.setLang(b.p, 'zh')
  expect(await b.rt.command(b.p, 'decide', 'colors catppuccin-mocha')).toBe('配色已设为 Catppuccin Mocha。')
  // the other spellings of the command
  expect(await b.rt.command(b.p, 'decide', 'colours dracula')).toBe('配色已设为 Dracula。')
  expect(await b.rt.command(b.p, 'decide', '配色 monokai')).toBe('配色已设为 Monokai。')
})

test('/decide colors: a name that is no scheme changes nothing and lists the schemes there are', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'colors nord')
  expect(await b.rt.command(b.p, 'decide', 'colors neon')).toBe(`No color scheme called "neon". Choose one of: ${NAMES}.`)
  expect(b.engine.cells.scheme).toBe('nord')
  expect(b.engine.store.get('scheme')).toBe('nord')
  await b.rt.setLang(b.p, 'zh')
  expect(await b.rt.command(b.p, 'decide', 'colors neon')).toBe(`没有叫 "neon" 的配色。可选：${NAMES}。`)
  // (a name that is an object's property is no scheme either)
  expect(await b.rt.command(b.p, 'decide', 'colors constructor')).toContain('没有叫 "constructor" 的配色')
})

test('/decide colors reset: back to the default scheme, kept as nothing', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'colors nord')
  expect(await b.rt.command(b.p, 'decide', 'colors reset')).toBe('Colors are back to the default (Terminal).')
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  expect(b.engine.store.get('scheme')).toBe('')
  await b.rt.command(b.p, 'decide', 'colors dracula')
  expect(await b.rt.command(b.p, 'decide', 'colors default')).toContain('back to the default')
  await b.rt.command(b.p, 'decide', 'colors dracula')
  await b.rt.setLang(b.p, 'zh')
  expect(await b.rt.command(b.p, 'decide', 'colors 默认')).toBe('配色恢复为默认（Terminal）。')
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
})

test('/decide colors: it needs no project and writes nothing to the project', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'colors nord')
  await b.rt.command(b.p, 'decide', 'colors reset')
  expect(b.engine.disk.files.size).toBe(0)
  expect(b.engine.cells.project.mode).toBe('off')
})

test('/decide help lists colors', async () => {
  const b = await boot()
  expect(await b.rt.command(b.p, 'decide', 'help')).toContain('colors [name|reset]')
})

// ---------------------------------------------------------------- the picker

test('picker: opening it puts the highlight on the scheme in use and the focus ring on its line', async () => {
  const b = await recorded()
  await b.rt.command(b.p, 'decide', 'colors nord')
  await b.rt.openColors(b.p)
  expect(b.engine.cells.ui.view).toBe('colors')
  expect(b.engine.cells.ui.pick).toBe('nord')
  expect(b.engine.focuses.at(-1)).toEqual({ requestId: 'decision-tree', key: schemeKey('nord') })
  // nothing is kept by looking
  expect(b.engine.store.get('scheme')).toBe('nord')
})

test('picker: j and k move the highlight a scheme at a time and stop at either end, the focus ring with it', async () => {
  const b = await recorded()
  await b.rt.openColors(b.p)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[0]!.id)
  await b.rt.move(b.p, 1)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[1]!.id)
  expect(b.engine.focuses.at(-1)?.key).toBe(schemeKey(SCHEMES[1]!.id))
  await b.rt.move(b.p, 3)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[4]!.id)
  await b.rt.move(b.p, -1)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[3]!.id)
  await b.rt.move(b.p, -100)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[0]!.id)
  await b.rt.move(b.p, -1)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[0]!.id)
  await b.rt.move(b.p, 100)
  expect(b.engine.cells.ui.pick).toBe(SCHEMES[SCHEMES.length - 1]!.id)
  // trying schemes on keeps none of them
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  expect(b.engine.store.has('scheme')).toBe(false)
  // the selection of the tree was not touched by any of it
  expect(b.engine.cells.ui.selected).not.toBe(SCHEMES[0]!.id)
})

test('picker: a press on a line highlights its scheme, and a press on the scheme highlighted keeps it, for every project', async () => {
  const b = await recorded()
  await b.rt.openColors(b.p)
  await b.rt.pressScheme(b.p, 'dracula')
  expect(b.engine.cells.ui.view).toBe('colors')
  expect(b.engine.cells.ui.pick).toBe('dracula')
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME) // (only highlighted: the pane is drawn in it while the picker is open)
  await b.rt.pressScheme(b.p, 'dracula')
  expect(b.engine.cells.scheme).toBe('dracula')
  expect(b.engine.store.get('scheme')).toBe('dracula')
  expect(toastsOf(b)).toContain('Colors set to Dracula.')
  // back at the tree, its selection where it was
  expect(b.engine.cells.ui.view).toBe('tree')
  expect(b.engine.cells.ui.pick).toBeNull()
})

test('picker: the key for "use" keeps the highlighted scheme (a click on ⏎: use), and does nothing outside the picker', async () => {
  const b = await recorded()
  await b.rt.useHighlighted(b.p)
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  expect(toastsOf(b)).toEqual([])

  await b.rt.openColors(b.p)
  await b.rt.move(b.p, 2)
  await b.rt.useHighlighted(b.p)
  expect(b.engine.cells.scheme).toBe(SCHEMES[2]!.id)
  expect(b.engine.store.get('scheme')).toBe(SCHEMES[2]!.id)
  expect(b.engine.cells.ui.view).toBe('tree')
})

test('picker: r keeps the default scheme and goes back; going back keeps nothing', async () => {
  const b = await recorded()
  await b.rt.command(b.p, 'decide', 'colors nord')
  await b.rt.openColors(b.p)
  await b.rt.move(b.p, 3)
  await b.rt.back(b.p)
  expect(b.engine.cells.ui.view).toBe('tree')
  expect(b.engine.cells.scheme).toBe('nord')

  await b.rt.openColors(b.p)
  await b.rt.resetColors(b.p)
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
  expect(b.engine.store.get('scheme')).toBe('')
  expect(toastsOf(b)).toContain('Colors are back to the default (Terminal).')
  expect(b.engine.cells.ui.view).toBe('tree')

  // outside the picker r does nothing
  await b.rt.command(b.p, 'decide', 'colors nord')
  await b.rt.resetColors(b.p)
  expect(b.engine.cells.scheme).toBe('nord')
})

test('picker: the toast speaks the pane\'s language', async () => {
  const b = await recorded()
  await b.rt.setLang(b.p, 'zh')
  await b.rt.openColors(b.p)
  await b.rt.pressScheme(b.p, 'nord')
  await b.rt.pressScheme(b.p, 'nord')
  expect(toastsOf(b)).toContain('配色已设为 Nord。')
})

test('picker: the focus ring moving onto a line (Tab, a click) moves the highlight; elsewhere it does not', async () => {
  const b = await recorded()
  await b.rt.focusedControl(b.p, schemeKey('nord'))
  expect(b.engine.cells.ui.pick).toBeNull() // (the picker is not open)
  await b.rt.openColors(b.p)
  await b.rt.focusedControl(b.p, schemeKey('nord'))
  expect(b.engine.cells.ui.pick).toBe('nord')
  const writes = b.engine.writes.length
  await b.rt.focusedControl(b.p, schemeKey('nord'))
  expect(b.engine.writes.length).toBe(writes) // (nothing new to write)
  await b.rt.focusedControl(b.p, '~lang-zh')
  expect(b.engine.cells.ui.pick).toBe('nord')
})

test('picker: a scheme this version does not know is not highlighted', async () => {
  const b = await recorded()
  await b.rt.openColors(b.p)
  await b.rt.pickScheme(b.p, 'neon')
  expect(b.engine.cells.ui.pick).toBe(DEFAULT_SCHEME)
  await b.rt.pressScheme(b.p, 'neon')
  expect(b.engine.cells.scheme).toBe(DEFAULT_SCHEME)
})

test('picker: it opens in a project that is not recorded, and leaving it leaves the view at the tree', async () => {
  const b = await boot()
  await b.rt.openColors(b.p)
  expect(b.engine.cells.ui.view).toBe('colors')
  await b.rt.pressScheme(b.p, 'monokai')
  await b.rt.pressScheme(b.p, 'monokai')
  expect(b.engine.cells.scheme).toBe('monokai')
  expect(b.engine.cells.ui.view).toBe('tree')
  expect(b.engine.disk.files.size).toBe(0)
})

test('picker: opening the picker closes a form that was open, and the overview\'s highlight is not the picker\'s', async () => {
  const b = await recorded()
  await b.rt.command(b.p, 'decide', 'tree new side --stay')
  await b.rt.openOverview(b.p)
  expect(b.engine.cells.ui.view).toBe('trees')
  await b.rt.openNewTree(b.p)
  expect(b.engine.cells.ui.newTree).not.toBeNull()
  await b.rt.openColors(b.p)
  expect(b.engine.cells.ui.view).toBe('colors')
  expect(b.engine.cells.ui.newTree).toBeNull()
  expect(b.engine.cells.ui.pick).toBe(DEFAULT_SCHEME) // (not the name of a tree)
  await b.rt.back(b.p)
  expect(b.engine.cells.ui.view).toBe('tree')
})

test('colors: the root of the project is not touched by any of it', async () => {
  const b = await recorded()
  const before = [...b.engine.disk.files.keys()].sort()
  await b.rt.openColors(b.p)
  await b.rt.move(b.p, 5)
  await b.rt.useHighlighted(b.p)
  await b.rt.command(b.p, 'decide', 'colors reset')
  expect([...b.engine.disk.files.keys()].sort()).toEqual(before)
  expect(ROOT).toBe('/work/proj')
})
