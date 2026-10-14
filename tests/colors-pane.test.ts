// The colours of the pane and the picker of colour schemes as the engine draws them: mounted on every surface through
// the test kit, read back as the tree of elements the surface would be handed, and acted on the way a person does (press
// the key, press a line). What the layout decides has its own tests in picker.test.ts, and what the Runtime does for each
// press in runtime-colors.test.ts; here it is whether the engine is handed the right controls and the right colours:
// the colours of a scheme on the rows of the pane, the colours of every scheme on its own line, and nothing kept until
// the person keeps it.

import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SCHEMES, effectiveScheme, findScheme, swatchOf } from '../lib/palettes'
import { strWidth } from '../lib/width'
import { SURFACES, blocksOf, elementOf, keysOf, linesOf, mountPane, rowKeys, runsOf, textOf } from './draw'
import { NOW, seedNotes, slash, world } from './engine'
import type { World } from './engine'
import { ROOT } from './port'

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

/** Every colour the drawn elements ask for (the `color` of a Text), wherever they sit. */
function colorsIn(tree: unknown): Set<string> {
  const out = new Set<string>()
  const walk = (x: unknown) => {
    if (x === null || typeof x !== 'object') return
    const el = x as { props?: Record<string, unknown>; children?: unknown[] }
    const color = el.props?.color
    if (typeof color === 'string') out.add(color)
    for (const c of el.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

const textIn = (tree: unknown) => linesOf(tree).join('\n')
const buttonsOf = (tree: unknown) => keysOf(tree, 'Button')
/** The buttons that are lines of the picker. */
const schemeKeysOf = (tree: unknown) => buttonsOf(tree).filter(k => k.startsWith('~scheme:'))
/** The scheme whose line carries the mark of the highlight. */
const highlighted = (tree: unknown): string[] => linesOf(tree).flatMap(l => /^▌ (\S+(?: \S+)*?) {2,}/.exec(l)?.[1] ?? [])
/** The first block of the pane that reads `needle`: a line of the sample, which is text and no button. */
const blockWith = (tree: unknown, needle: string) => blocksOf(tree).find(b => textOf(b).includes(needle))
/** The colours of the seven dots on the line of a scheme, in the order of the slots. */
const dotsOf = (tree: unknown, id: string): string[] => runsOf(elementOf(tree, `~scheme:${id}`)).filter(r => r.text === '●').map(r => r.color ?? '')
/** The colour of the word that says which scheme is in use. */
const inUseColour = (tree: unknown): string | undefined => {
  for (const id of SCHEMES.map(s => s.id)) {
    const hit = runsOf(elementOf(tree, `~scheme:${id}`)).find(r => r.text === 'in use')
    if (hit !== undefined) return hit.color
  }
  return undefined
}

// The names of the 16 colours a terminal has of its own (what the scheme "Terminal" paints with), and the keys of the
// theme (what a desktop or an editor paints with).
const ANSI = ['red', 'redBright', 'yellow', 'green', 'cyan', 'blueBright', 'magenta']
const THEME = ['error', 'claude', 'warning', 'success', 'planMode', 'ide', 'merged']

const NORD = findScheme('nord')!.accents!
const DRACULA = findScheme('dracula')!.accents!
const GRUVBOX = findScheme('gruvbox-dark')!.accents!

const hex = (colours: Set<string>) => [...colours].filter(c => c.startsWith('#'))

// ---------------------------------------------------------------- the colours of the tree view

for (const surface of SURFACES) {
  test(`${surface}: with nothing chosen the rows are painted in the scheme "Terminal" on a terminal, and in the keys of the theme anywhere else`, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 100, rows: 50 })
    const tree = await ui.drawn()
    const colours = colorsIn(tree)
    expect(hex(colours)).toEqual([])
    const own = surface === 'terminal' ? ANSI : THEME
    const other = surface === 'terminal' ? THEME : ANSI
    // adopted, rejected, a step in progress and the mainline
    for (const c of [own[0], own[3], own[5], own[6]]) expect(colours, `${surface}: ${c}`).toContain(c)
    for (const c of other) expect(colours, `${surface}: ${c}`).not.toContain(c)
    await ui.unmount()
  })
}

test('a scheme chosen with /decide colors paints the rows of an open pane at once, on every surface, and /decide colors reset takes it back', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const terminal = await mountPane($, 'terminal', { columns: 100, rows: 50, requestId: 'decision-tree' })
  const before = await terminal.drawn()
  expect(colorsIn(before)).toContain('green')

  expect(await decide($, 'colors nord')).toBe('Colors set to Nord.')
  expect(w.store.get('scheme')).toBe('nord')
  let tree = await terminal.drawn()
  const colours = colorsIn(tree)
  expect(colours).toContain(NORD.green)
  expect(colours).toContain(NORD.red)
  expect(colours).toContain(NORD.blue)
  expect(colours).toContain(NORD.purple)
  for (const c of [...ANSI, ...THEME]) expect(colours, c).not.toContain(c)
  // only the accents are repainted: the words, the grey and the selection stay the terminal's own
  expect(linesOf(tree)).toEqual(linesOf(before))

  // the scheme is kept for the person: another surface of the same session is drawn in it too
  const desktop = await mountPane($, 'desktop', { columns: 100, rows: 50, requestId: 'decision-tree' })
  expect(colorsIn(await desktop.drawn())).toContain(NORD.green)
  await desktop.unmount()

  expect(await decide($, 'colors reset')).toBe('Colors are back to the default (Terminal).')
  expect(w.store.get('scheme')).toBe('')
  tree = await terminal.drawn()
  expect(colorsIn(tree)).toContain('green')
  expect(hex(colorsIn(tree))).toEqual([])
})

test('the scheme "Theme" paints a terminal with the keys of the theme, as a desktop is', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  expect(await decide($, 'colors theme')).toBe('Colors set to Theme.')
  const colours = colorsIn(await ui.drawn())
  for (const c of [THEME[0], THEME[3], THEME[5], THEME[6]]) expect(colours, c).toContain(c)
  for (const c of ANSI) expect(colours, c).not.toContain(c)
  expect(hex(colours)).toEqual([])
})

test('a scheme kept in an earlier session paints the pane from the first drawing, in every project', async ($, on) => {
  const w = notesWorld(on)
  w.store.set('scheme', 'dracula')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  const colours = colorsIn(await ui.drawn())
  expect(colours).toContain(DRACULA.green)
  expect(colours).toContain(DRACULA.red)
  for (const c of ANSI) expect(colours, c).not.toContain(c)
})

test('a scheme another session chose arrives with the next poll', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  expect(colorsIn(await ui.drawn())).toContain('green')
  w.store.set('scheme', 'gruvbox-dark')
  await w.clock.advance(5000)
  const colours = colorsIn(await ui.drawn())
  expect(colours).toContain(GRUVBOX.green)
  expect(colours).not.toContain('green')
})

// ---------------------------------------------------------------- the picker

for (const surface of SURFACES) {
  test(`${surface}: c opens the picker, a line for each scheme with its seven colours, the sample under them, and no node of the tree`, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 100, rows: 60 })
    let tree = await ui.drawn()
    expect((await ui.find({ key: '~colors' }))?.props.hotkey).toBe('c')
    expect(rowKeys(tree).length).toBeGreaterThan(0)

    await ui.press({ key: '~colors' })
    tree = await ui.drawn()
    expect(rowKeys(tree)).toEqual([])
    // every scheme has its line, a button, in the order of the list
    expect(schemeKeysOf(tree)).toEqual(SCHEMES.map(s => `~scheme:${s.id}`))
    const first = await ui.find({ key: '~scheme:terminal' })
    expect(first?.type).toBe('Button')
    expect(String(first?.props.label)).toBe("Terminal, your terminal's own 16 colors, in use")
    expect(String((await ui.find({ key: '~scheme:nord' }))?.props.label)).toBe('Nord, cool and muted, for dark terminals')
    // the picker's words, the sample in its frame, and the keys of the picker
    const text = textIn(tree)
    expect(text).toContain('Colors   16 schemes')
    expect(text).toContain('It stays as you choose it, in every project.')
    expect(linesOf(tree).some(l => /^ {2}╭─ Preview ─+ Terminal ─╮$/.test(l))).toBe(true)
    expect(text).toContain('Sync: clients send operations every 5 s')
    expect(text).toContain('k: ↑  j: ↓  ⏎: use  r: default  c: back')
    for (const [key, hotkey] of [['~up', 'k'], ['~down', 'j'], ['~reset', 'r'], ['~back', 'c'], ['~lang', 'l']] as const) {
      expect((await ui.find({ key }))?.props.hotkey, key).toBe(hotkey)
    }
    expect((await ui.find({ key: '~use' }))?.type).toBe('Button')
    // (the keys of the tree view are not offered here)
    expect(buttonsOf(tree)).not.toContain('~colors')
    expect(buttonsOf(tree)).not.toContain('~edit')
    expect(new Set(keysOf(tree)).size).toBe(keysOf(tree).length)
    expect(highlighted(tree)).toEqual(['Terminal'])
    await ui.unmount()
  })
}

for (const surface of SURFACES) {
  test(`${surface}: every line shows the colours of its own scheme, whichever scheme is highlighted or in use`, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const ui = await mountPane($, surface, { columns: 100, rows: 60 })
    await ui.press({ key: '~colors' })
    const expected = (id: string) => swatchOf(effectiveScheme(findScheme(id)!, surface))

    for (const highlight of [null, 'one-light', 'monokai', 'theme']) {
      if (highlight !== null) await ui.press({ key: `~scheme:${highlight}` })
      const tree = await ui.drawn()
      for (const s of SCHEMES) expect(dotsOf(tree, s.id), `${surface}, ${highlight}: ${s.id}`).toEqual(expected(s.id))
    }
    // (the scheme "Terminal" shows what a terminal makes of its 16 colours; anywhere else it shows the keys of the theme it draws with)
    const tree = await ui.drawn()
    expect(dotsOf(tree, 'terminal')).toEqual(surface === 'terminal' ? ANSI : THEME)
    expect(dotsOf(tree, 'theme')).toEqual(THEME)
    expect(dotsOf(tree, 'nord')).toEqual(Object.values(NORD))
    await ui.unmount()
  })
}

test('trying a scheme on: the highlight paints the sample and the whole pane in it, and nothing is kept', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~colors' })
  let tree = await ui.drawn()
  // in the scheme in use ("Terminal") to begin with: the mainline, a try that was rejected, one that is under way
  expect(colorsIn(blockWith(tree, 'Sync: clients send operations'))).toContain('magenta')
  expect(colorsIn(blockWith(tree, 'Keep JSON files and add a lock file'))).toContain('red')
  expect(colorsIn(blockWith(tree, 'Replay 200 recorded sessions'))).toContain('blueBright')
  expect(inUseColour(tree)).toBe('green')
  expect(linesOf(tree).some(l => /╭─ Preview ─+ Terminal ─╮/.test(l))).toBe(true)

  // a press on a line highlights it: the sample, the word "in use", the keys, all in its colours
  await ui.press({ key: '~scheme:nord' })
  tree = await ui.drawn()
  expect(highlighted(tree)).toEqual(['Nord'])
  expect(linesOf(tree).some(l => /╭─ Preview ─+ Nord ─╮/.test(l))).toBe(true)
  const mainline = colorsIn(blockWith(tree, 'Sync: clients send operations'))
  expect(mainline).toContain(NORD.purple)
  expect(mainline).not.toContain('magenta')
  const rejected = colorsIn(blockWith(tree, 'Keep JSON files and add a lock file'))
  expect(rejected).toContain(NORD.red)
  expect(rejected).not.toContain('red')
  expect(colorsIn(blockWith(tree, 'Replay 200 recorded sessions'))).toContain(NORD.blue)
  expect(inUseColour(tree)).toBe(NORD.green)

  await ui.press({ key: '~scheme:dracula' })
  tree = await ui.drawn()
  expect(highlighted(tree)).toEqual(['Dracula'])
  expect(inUseColour(tree)).toBe(DRACULA.green)
  expect(colorsIn(blockWith(tree, 'Keep JSON files and add a lock file'))).toContain(DRACULA.red)
  expect(colorsIn(blockWith(tree, 'Keep JSON files and add a lock file'))).not.toContain(NORD.red)
  expect(colorsIn(blockWith(tree, 'Sync: clients send operations'))).toContain(DRACULA.purple)

  // nothing has been kept: not in the store, not told to the person
  expect(w.store.has('scheme')).toBe(false)
  expect(w.toasts).toEqual([])
})

test('the keys j and k move the highlight a scheme at a time, the sample follows, and the highlight stops at either end', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~colors' })
  const walk: string[] = []
  for (const key of ['~down', '~down', '~down', '~up', '~up', '~up', '~up', '~up']) {
    await ui.press({ key })
    walk.push(highlighted(await ui.drawn()).join(','))
  }
  expect(walk).toEqual(['Theme', 'One Dark', 'One Light', 'One Dark', 'Theme', 'Terminal', 'Terminal', 'Terminal'])

  // the last scheme is the end of the list
  for (let k = 0; k < SCHEMES.length + 3; k++) await ui.press({ key: '~down' })
  const tree = await ui.drawn()
  expect(highlighted(tree)).toEqual(['GitHub Light'])
  expect(linesOf(tree).some(l => /╭─ Preview ─+ GitHub Light ─╮/.test(l))).toBe(true)
  const light = findScheme('github-light')!.accents!
  expect(colorsIn(blockWith(tree, 'Storage: SQLite with a write-ahead log'))).toContain(light.purple)
  expect(colorsIn(blockWith(tree, 'Keep JSON files and add a lock file'))).toContain(light.red)
  expect(w.store.has('scheme')).toBe(false)
})

test('a press on the line highlighted keeps the scheme, for every project, and the tree view comes back in it', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  const tree0 = await ui.drawn()
  await ui.press({ key: '~colors' })
  await ui.press({ key: '~scheme:nord' })
  expect(w.store.has('scheme')).toBe(false)
  await ui.press({ key: '~scheme:nord' })

  expect(w.store.get('scheme')).toBe('nord')
  expect(w.toasts.at(-1)).toBe('Colors set to Nord.')
  const tree = await ui.drawn()
  expect(schemeKeysOf(tree)).toEqual([])
  expect(rowKeys(tree).length).toBeGreaterThan(0)
  expect(linesOf(tree)[0]).toBe(linesOf(tree0)[0])
  const colours = colorsIn(tree)
  expect(colours).toContain(NORD.green)
  expect(colours).toContain(NORD.red)
  for (const c of ANSI) expect(colours, c).not.toContain(c)

  // and the picker, opened again, finds it in use
  await ui.press({ key: '~colors' })
  const picker = await ui.drawn()
  expect(highlighted(picker)).toEqual(['Nord'])
  expect(String((await ui.find({ key: '~scheme:nord' }))?.props.label)).toBe('Nord, cool and muted, for dark terminals, in use')
  expect(String((await ui.find({ key: '~scheme:terminal' }))?.props.label)).toBe("Terminal, your terminal's own 16 colors, default")
  expect(inUseColour(picker)).toBe(NORD.green)
})

test('the button ⏎: use keeps the scheme that is highlighted', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  await ui.press({ key: '~colors' })
  await ui.press({ key: '~scheme:gruvbox-dark' })
  await ui.press({ key: '~use' })
  expect(w.store.get('scheme')).toBe('gruvbox-dark')
  expect(w.toasts.at(-1)).toBe('Colors set to Gruvbox Dark.')
  const tree = await ui.drawn()
  expect(rowKeys(tree).length).toBeGreaterThan(0)
  expect(colorsIn(tree)).toContain(GRUVBOX.green)
})

test('going back leaves the colours as they were: the pane is drawn in the scheme in use again, and nothing is kept', async ($, on) => {
  const w = notesWorld(on)
  w.store.set('scheme', 'dracula')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  const before = await ui.drawn()
  await ui.press({ key: '~colors' })
  await ui.press({ key: '~scheme:nord' })
  await ui.press({ key: '~scheme:monokai' })
  await ui.press({ key: '~back' })

  const tree = await ui.drawn()
  expect(linesOf(tree)).toEqual(linesOf(before))
  expect([...colorsIn(tree)].sort()).toEqual([...colorsIn(before)].sort())
  expect(colorsIn(tree)).toContain(DRACULA.green)
  expect(w.store.get('scheme')).toBe('dracula')
  expect(w.toasts).toEqual([])

  // c opens it and c closes it again, from the keyboard's side: the hotkey is the same button
  await ui.press({ key: '~colors' })
  expect(highlighted(await ui.drawn())).toEqual(['Dracula'])
  await ui.press({ key: '~back' })
  expect(rowKeys(await ui.drawn()).length).toBeGreaterThan(0)
})

test('r keeps the default scheme and goes back', async ($, on) => {
  const w = notesWorld(on)
  w.store.set('scheme', 'tokyo-night')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 50 })
  await ui.press({ key: '~colors' })
  expect(highlighted(await ui.drawn())).toEqual(['Tokyo Night'])
  await ui.press({ key: '~reset' })
  expect(w.store.get('scheme')).toBe('')
  expect(w.toasts.at(-1)).toBe('Colors are back to the default (Terminal).')
  const tree = await ui.drawn()
  expect(rowKeys(tree).length).toBeGreaterThan(0)
  expect(colorsIn(tree)).toContain('green')
  expect(hex(colorsIn(tree))).toEqual([])
})

test('the focus ring moving onto a line of the picker (a click, Tab) highlights its scheme', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~colors' })
  const focus = (element: string) => $.ui.focus({ component: 'Pane', requestId: 'decision-tree', plugin: 'decision-tree', element, origin: { kind: 'person' } })
  await focus('~scheme:solarized')
  expect(highlighted(await ui.drawn())).toEqual(['Solarized'])
  await focus('~scheme:catppuccin-latte')
  expect(highlighted(await ui.drawn())).toEqual(['Catppuccin Latte'])
  // a key that is not a line of the picker leaves it where it is
  await focus('~reset')
  expect(highlighted(await ui.drawn())).toEqual(['Catppuccin Latte'])
  expect(w.store.has('scheme')).toBe(false)
})

test('the picker and the overview and the tree view hand the view to one another: opening one closes the other', async ($, on) => {
  notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~trees' })
  expect(textIn(await ui.drawn())).toContain('Trees')
  await ui.press({ key: '~back' })
  await ui.press({ key: '~colors' })
  expect(schemeKeysOf(await ui.drawn())).toHaveLength(SCHEMES.length)
  expect(await ui.find({ key: '~trees' })).toBeUndefined()
  await ui.press({ key: '~back' })
  expect(await ui.find({ key: '~trees' })).toBeDefined()
  expect(schemeKeysOf(await ui.drawn())).toEqual([])
})

// ---------------------------------------------------------------- language and glyphs

test('the picker speaks the language of the pane: its own words Chinese, the names of the schemes as their authors write them', async ($, on) => {
  const w = notesWorld(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~colors' })
  await ui.press({ key: '~lang-zh' })
  const tree = await ui.drawn()
  const text = textIn(tree)
  expect(text).toContain('配色   16 个方案')
  expect(text).toContain('选好后在所有项目里都保持这个配色。')
  expect(text).toContain('k: ↑  j: ↓  ⏎: 使用  r: 默认  c: 返回')
  expect(text).toContain('l: EN')
  expect(String((await ui.find({ key: '~scheme:terminal' }))?.props.label)).toBe('Terminal, 用 terminal 自带的 16 色, 当前')
  expect(String((await ui.find({ key: '~scheme:nord' }))?.props.label)).toBe('Nord, 冷色、低饱和，适合深色')
  expect(linesOf(tree).some(l => /╭─ 预览 ─+ Terminal ─╮/.test(l))).toBe(true)
  // the sample reads in Chinese too, with its professional words in English
  expect(text).toContain('同步：客户端每 5 秒发送一次操作')
  expect(text).toContain('笔记 app：离线优先的重写')

  // and what is said to the person when a scheme is kept
  await ui.press({ key: '~scheme:nord' })
  await ui.press({ key: '~scheme:nord' })
  expect(w.toasts.at(-1)).toBe('配色已设为 Nord。')
})

test('with ASCII glyphs the picker is plain characters, the arrows are spelled out, and the language key still names 中', async ($, on) => {
  notesWorld(on, { ascii: true })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 100, rows: 60 })
  await ui.press({ key: '~colors' })
  const tree = await ui.drawn()
  const text = textIn(tree).replace(/[中…]/g, 'zh')
  expect(text).toMatch(/^[\x20-\x7e\n]*$/)
  expect(textIn(tree)).toContain('k: up  j: down  Enter: use  r: default  c: back')
  expect(linesOf(tree).some(l => /^ {2}\+- Preview -+ Terminal -\+$/.test(l))).toBe(true)
  // the swatches are dots of the plain kind
  expect(runsOf(elementOf(tree, '~scheme:nord')).filter(r => r.text === '*' || r.text === 'o').length).toBe(7)
})

// ---------------------------------------------------------------- sizes

for (const surface of SURFACES) {
  test(`${surface}: the picker fits panes of every size, with unique keys and no node rows`, { timeoutMs: 60000 }, async ($, on) => {
    notesWorld(on)
    await $.session.start({ cwd: ROOT, surface, isInteractive: true })
    const big = await mountPane($, surface, { columns: 100, rows: 60 })
    await big.press({ key: '~colors' })
    await big.unmount()
    for (const columns of [16, 24, 36, 48, 70, 110]) {
      for (const rows of [3, 6, 10, 16, 30, 60]) {
        const ui = await mountPane($, surface, { columns, rows })
        const tree = await ui.drawn()
        const label = `${columns}x${rows}`
        for (const line of linesOf(tree)) expect(strWidth(line), `${label}: ${line}`).toBeLessThanOrEqual(columns)
        expect(new Set(keysOf(tree)).size, label).toBe(keysOf(tree).length)
        expect(rowKeys(tree), label).toEqual([])
        expect(textIn(tree), label).toMatch(/EN {2}中/)
        // the scheme highlighted always has its line, unless the pane is too short for any
        if (rows >= 6) expect(schemeKeysOf(tree).length, label).toBeGreaterThan(0)
        await ui.unmount()
      }
    }
  })
}
