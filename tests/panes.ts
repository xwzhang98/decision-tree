// What the layout tests share: the input of a pane with sensible defaults, the layout as plain text, and the
// checks every layout must pass whatever it is of.

import { schemeKey, stepKey, treeKey } from '../lib/bar'
import { MAX_TREES, graphOf } from '../lib/forest'
import type { Block, PaneInput, PaneLayout } from '../lib/layout'
import { blockText, blockWidth } from '../lib/layout'
import { geometry, lanePlan } from '../lib/overview'
import { SCHEMES } from '../lib/palettes'
import { NEWTREE_ROWS } from '../lib/room'
import { EMPTY_TM, EMPTY_UI } from '../lib/state'
import type { DtLang, DtUi } from '../types'
import { NOW, NOW_NONE, NOW_PENDING, TREES, crdtModel, notesModel, nowApproved, projectOf, treesOf } from './notes'

/** The view state of a pane that has just opened, with the Conflicts step selected. */
export const ui = (over: Partial<DtUi> = {}): DtUi => ({ ...EMPTY_UI, selected: 'n3', ...over })

/** The input of a pane 100 columns by 48 rows, in English, over the notes-app sample. */
export function input(over: Partial<PaneInput> = {}): PaneInput {
  const lang: DtLang = over.lang ?? 'en'
  return {
    width: 100,
    rows: 48,
    lang,
    ascii: false,
    nowMs: NOW,
    project: projectOf(),
    model: notesModel(lang),
    ui: ui(),
    now: NOW_NONE,
    tm: EMPTY_TM,
    trees: TREES,
    translating: 0,
    statusInterval: null,
    canEdit: true,
    ...over,
  }
}

/** The clock reads the machine's own time, so a layout is compared with it left out. */
const clock = (s: string) => s.replace(/updated \d\d:\d\d/, 'updated HH:MM').replace(/\d\d:\d\d 更新/, 'HH:MM 更新')

/** Every block as the text it draws (a button as its hotkey and its words), the clock masked and the blanks at the right end cut. */
export const textOf = (layout: PaneLayout): string[] => layout.blocks.map(b => clock(blockText(b)).trimEnd())

export const rowsOf = (layout: PaneLayout) => layout.blocks.filter((b): b is Extract<Block, { kind: 'row' }> => b.kind === 'row')
export const allowOf = (layout: PaneLayout) => layout.blocks.find((b): b is Extract<Block, { kind: 'allow' }> => b.kind === 'allow')

/**
 * What every layout must satisfy: no block wider than the pane, the strip first, a row drawn when
 * there is something to draw, and the selection among them.
 */
export function check(layout: PaneLayout, i: PaneInput, label: string): void {
  const width = Math.max(16, i.width)
  const fail = (what: string) => {
    throw new Error(`${label}: ${what}`)
  }
  for (const b of layout.blocks) {
    if (blockWidth(b) > width) fail(`a ${b.kind} block is ${blockWidth(b)} wide in ${width}: ${JSON.stringify(blockText(b))}`)
  }
  if (layout.blocks[0]!.kind !== 'bar') fail('the strip comes first')
  const rows = rowsOf(layout)
  if (rows.length !== layout.drawn.length) fail('the rows drawn are not the ids listed')
  if (new Set(layout.drawn).size !== layout.drawn.length) fail('a row is drawn twice')
  if (i.project.mode !== 'off' && i.model.nodes.length > 0 && i.ui.filter === 'default' && layout.drawn.length === 0) fail('no row of the tree is drawn')
  if (layout.selected !== null && !layout.drawn.includes(layout.selected)) fail(`the selection ${layout.selected} is not drawn`)
  if (rows.filter(r => r.selected).length > 1) fail('more than one row is selected')
  const room = Math.max(3, Math.floor(i.rows))
  // a pane too short for its strip, state and keys still draws one row of the rail; the form for editing is drawn
  // whole however short the pane is (it cannot be used cut), which with the rule above it and one row of the rail is nine
  const least = layout.blocks.some(b => b.kind === 'edit') ? 9 : 4
  if (layout.height > Math.max(room, least)) fail(`${layout.height} rows used in ${room}`)
}

/**
 * What every layout of the overview must satisfy: no block wider than the pane, the strip first and the keys last,
 * the tree picked (and only it) marked, each line of the graph and of the list a control with a key of its own, the
 * picked tree in the list (or the form in its place), the graph's marks adding up, and no more rows than the pane has.
 */
export function checkOverview(layout: PaneLayout, i: PaneInput, label: string): void {
  const width = Math.max(16, i.width)
  const room = Math.max(3, Math.floor(i.rows))
  const fail = (what: string): never => {
    throw new Error(`${label}: ${what}`)
  }
  for (const b of layout.blocks) {
    if (blockWidth(b) > width) fail(`a ${b.kind} block is ${blockWidth(b)} wide in ${width}: ${JSON.stringify(blockText(b))}`)
  }
  if (layout.blocks[0]!.kind !== 'bar') fail('the strip comes first')
  if (layout.blocks[layout.blocks.length - 1]!.kind !== 'bar') fail('the keys come last')
  if (layout.drawn.length !== 0 || layout.selected !== null) fail('the overview has no rows of nodes')

  const trees = i.trees.slice(0, MAX_TREES)
  const names = trees.map(x => x.name)
  const forming = i.ui.newTree !== null
  const picked = layout.picked
  if (names.length === 0 ? picked !== null : picked === null || !names.includes(picked)) fail(`the picked tree is ${String(picked)}, of ${names.join(',')}`)

  // every line of the graph and of the list is a control of its own
  const controls = layout.blocks.filter((b): b is Extract<Block, { kind: 'tree' }> => b.kind === 'tree')
  const keys = new Set<string>()
  const claim = (key: string) => {
    if (keys.has(key)) fail(`two controls are keyed ${key}`)
    keys.add(key)
  }
  for (const b of controls) {
    const where = `${b.tree}${b.step === null ? `/${b.part}` : `:${b.step}`}`
    if (!names.includes(b.tree)) fail(`a line of ${b.tree}, which is not a tree here`)
    if (b.selected !== (b.tree === picked)) fail(`${where} is ${b.selected ? '' : 'not '}selected, the picked tree is ${String(picked)}`)
    claim(b.step !== null ? stepKey(b.tree, b.step) : treeKey(b.tree, b.part))
    // what a reader of buttons is told: words, without the frame, the lanes and the mark of the highlight
    if (b.label.trim() === '' || /[│╭╮╰╯▌┃┠┖╏━┓┳╋]/.test(b.label) || /\s{2}/.test(b.label)) fail(`${where} has the label ${JSON.stringify(b.label)}`)
    if (b.step !== null && !trees.find(x => x.name === b.tree)!.own.some(s => s.id === b.step)) fail(`${b.tree} has no step ${b.step}`)
  }
  for (const b of layout.blocks) if (b.kind === 'bar') for (const p of b.parts) if (p.kind === 'button') claim(p.key)

  // the list: each tree once, a second line right after its first; or the form in its place
  const listed = controls.filter(b => b.step === null)
  const firsts = listed.filter(b => b.part === 0).map(b => b.tree)
  if (firsts.join(',') !== layout.listed.join(',')) fail(`the list says ${layout.listed.join(',')} and draws ${firsts.join(',')}`)
  if (new Set(firsts).size !== firsts.length) fail('a tree is listed twice')
  listed.forEach((b, at) => {
    if (b.part === 1 && !(at > 0 && listed[at - 1]!.tree === b.tree && listed[at - 1]!.part === 0)) fail(`the second line of ${b.tree} does not follow its first`)
  })
  const forms = layout.blocks.filter(b => b.kind === 'newtree').length
  if (forming) {
    if (forms !== 1 || listed.length > 0) fail(`the form is drawn ${forms} times, with ${listed.length} lines of the list`)
  } else if (forms !== 0) {
    fail('a form is drawn that nobody opened')
  } else if (picked !== null && !layout.listed.includes(picked)) {
    fail(`the picked tree ${picked} is not in the list`)
  }

  // the graph: the marks above and below say how many steps are not drawn
  const geo = geometry(graphOf(trees), lanePlan(graphOf(trees).lanes.length, width))
  const steps = controls.filter(b => b.step !== null)
  const mark = (re: RegExp): number | undefined => {
    for (const b of layout.blocks) {
      const m = b.kind === 'text' ? re.exec(blockText(b)) : null
      if (m !== null) return Number(m[1])
    }
    return undefined
  }
  const above = mark(/^\s*(?:▲|\^)\D*(\d+)/)
  const below = mark(/^\s*(?:▼|v)\D*(\d+)/)
  if (above !== undefined || below !== undefined) {
    if (steps.length + (above ?? 0) + (below ?? 0) !== geo.rows.length) fail(`${steps.length} steps drawn, ${above ?? 0} above, ${below ?? 0} below, of ${geo.rows.length}`)
  } else if (steps.length > geo.rows.length) {
    fail(`${steps.length} steps drawn of ${geo.rows.length}`)
  }
  // the newest step of the picked tree is always in view (when its lane is drawn)
  const lane = picked === null ? -1 : graphOf(trees).lanes.indexOf(picked)
  if (steps.length > 0 && lane >= 0 && lane < geo.lanes.count) {
    const mine = geo.rows.filter(r => r.tree === picked)
    if (mine.length > 0 && !steps.some(b => b.tree === picked && b.step === mine[mine.length - 1]!.step.id)) fail(`the newest step of ${picked} is not drawn`)
  }

  // the rows
  const height = layout.blocks.reduce((sum, b) => sum + (b.kind === 'newtree' ? NEWTREE_ROWS : 1), 0)
  if (layout.height !== height) fail(`the height says ${layout.height}, the blocks add up to ${height}`)
  // a pane too short for its strip, state, one line of the list and keys still draws them; the form is drawn whole
  const least = forming ? 2 + 1 + NEWTREE_ROWS + 1 : 4
  if (layout.height > Math.max(room, least)) fail(`${layout.height} rows used in ${room}`)
  if (i.pin === true && room >= least && layout.height !== room) fail(`a docked pane of ${room} rows uses ${layout.height}`)
  // the switch of language is never the one to go (the key for it at the bottom is, in a pane too narrow for it)
  if (!/EN\s+中\s*$/.test(blockText(layout.blocks[0]!))) fail(`the strip has no switch of language: ${JSON.stringify(blockText(layout.blocks[0]!))}`)
}

/**
 * What every layout of the picker of colours must satisfy: no block wider than the pane, the strip first and the keys
 * last, a scheme highlighted (and only it) and drawn, each line a control with a key of its own, the marks of what is
 * above and below adding up, and no more rows than the pane has.
 */
export function checkColors(layout: PaneLayout, i: PaneInput, label: string): void {
  const width = Math.max(16, i.width)
  const room = Math.max(3, Math.floor(i.rows))
  const fail = (what: string): never => {
    throw new Error(`${label}: ${what}`)
  }
  for (const b of layout.blocks) {
    if (blockWidth(b) > width) fail(`a ${b.kind} block is ${blockWidth(b)} wide in ${width}: ${JSON.stringify(blockText(b))}`)
  }
  if (layout.blocks[0]!.kind !== 'bar') fail('the strip comes first')
  if (layout.blocks[layout.blocks.length - 1]!.kind !== 'bar') fail('the keys come last')
  if (layout.drawn.length !== 0 || layout.selected !== null) fail('the picker has no rows of nodes')

  const ids = SCHEMES.map(x => x.id)
  const controls = layout.blocks.filter((b): b is Extract<Block, { kind: 'scheme' }> => b.kind === 'scheme')
  if (layout.picked === null || !ids.includes(layout.picked)) fail(`the highlighted scheme is ${String(layout.picked)}`)
  if (controls.length === 0) fail('no scheme is drawn')
  if (controls.map(b => b.id).join(',') !== layout.listed.join(',')) fail(`the list says ${layout.listed.join(',')} and draws ${controls.map(b => b.id).join(',')}`)
  // in the order of the list, once each, the highlighted one among them and the only one selected
  const at = controls.map(b => ids.indexOf(b.id))
  if (at.some((x, k) => x < 0 || (k > 0 && x !== at[k - 1]! + 1))) fail(`the schemes drawn are not a run of the list: ${controls.map(b => b.id).join(',')}`)
  if (!layout.listed.includes(layout.picked!)) fail(`the highlighted scheme ${layout.picked} is not drawn`)
  for (const b of controls) {
    if (b.selected !== (b.id === layout.picked)) fail(`${b.id} is ${b.selected ? '' : 'not '}selected, the highlighted scheme is ${layout.picked}`)
    if (b.label.trim() === '' || /[│╭╮╰╯▌●]/.test(b.label) || /\s{2}/.test(b.label)) fail(`${b.id} has the label ${JSON.stringify(b.label)}`)
  }
  const keys = new Set<string>()
  const claim = (key: string) => {
    if (keys.has(key)) fail(`two controls are keyed ${key}`)
    keys.add(key)
  }
  for (const b of controls) claim(schemeKey(b.id))
  for (const b of layout.blocks) if (b.kind === 'bar') for (const p of b.parts) if (p.kind === 'button') claim(p.key)

  // the marks say how many schemes are not drawn
  const mark = (re: RegExp): number | undefined => {
    for (const b of layout.blocks) {
      const m = b.kind === 'page' ? re.exec(blockText(b)) : null
      if (m !== null) return Number(m[1])
    }
    return undefined
  }
  const above = mark(/^\s*(?:▲|\^)\D*(\d+)/)
  const below = mark(/^\s*(?:▼|v)\D*(\d+)/)
  if (above !== undefined || below !== undefined) {
    if (controls.length + (above ?? 0) + (below ?? 0) !== ids.length) fail(`${controls.length} schemes drawn, ${above ?? 0} above, ${below ?? 0} below, of ${ids.length}`)
    if ((above ?? 0) !== at[0]!) fail(`${above ?? 0} marked above and ${at[0]} are`)
  } else if (controls.length < ids.length && controls.length >= 5) {
    // (a pane too short for a window with marks draws the schemes it can, and says nothing)
    fail(`${controls.length} schemes drawn of ${ids.length} and nothing says so`)
  }

  if (layout.height !== layout.blocks.length) fail(`the height says ${layout.height}, there are ${layout.blocks.length} blocks`)
  const least = 4 // the strip, the state, one scheme, the keys
  if (layout.height > Math.max(room, least)) fail(`${layout.height} rows used in ${room}`)
  if (i.pin === true && room >= least && layout.height !== room) fail(`a docked pane of ${room} rows uses ${layout.height}`)
  if (!/EN\s+中\s*$/.test(blockText(layout.blocks[0]!))) fail(`the strip has no switch of language: ${JSON.stringify(blockText(layout.blocks[0]!))}`)
}

/** The picker of colours over the notes-app sample: the scheme in use is the default, Nord is highlighted. */
export function colorsInput(over: Partial<PaneInput> = {}): PaneInput {
  return input({ ui: ui({ view: 'colors', pick: 'nord' }), scheme: 'terminal', surface: 'terminal', ...over })
}

/** The overview of the notes-app sample: three trees, the one opened from the Sync step picked. */
export function overviewInput(over: Partial<PaneInput> = {}): PaneInput {
  const lang: DtLang = over.lang ?? 'en'
  return input({ trees: treesOf(lang), ui: ui({ view: 'trees', pick: 'crdt-engine' }), ...over })
}

/** The panes the tests draw whole, each by a name: the same ones the layout and the pane tests look at. */
export const SCENES = {
  main: () => input(),
  now: () => input({ width: 72, rows: 34, statusInterval: 30, now: nowApproved() }),
  pending: () => input({ width: 72, rows: 30, statusInterval: 30, now: NOW_PENDING }),
  crdt: () => input({ width: 80, rows: 36, model: crdtModel('en'), ui: ui({ tree: 'crdt-engine', selected: 'x3' }) }),
  pendingOnly: () => input({ width: 84, rows: 26, ui: ui({ filter: 'pending', selected: 'n8' }) }),
  zh: () => input({ width: 72, rows: 30, lang: 'zh' }),
  ascii: () => input({ width: 56, rows: 24, ascii: true }),
  waiting: () => input({ width: 84, rows: 26, model: notesModel('zh'), translating: 14 }),
  editing: () => input({ width: 84, rows: 26, ui: ui({ editing: { id: 'n3', status: 'adopted', summary: '' } }) }),
} as const satisfies Record<string, () => PaneInput>
