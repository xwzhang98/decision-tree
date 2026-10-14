import { test, expect } from 'claude-code/testing'

import { NEW_KEYS, stepKey, treeKey } from '../lib/bar'
import { Runtime } from '../lib/runtime'
import { FakeEngine, ROOT, configPath } from './port'

const DIR = `${ROOT}/.claude/decisions`

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

/** A project with a mainline of three decisions: events #1 start, #2 notes-app, #3 sqlite, #4 merge. */
async function project(session = 'abcdef0123456789') {
  const b = await boot(new FakeEngine(), session)
  expect(await b.rt.command(b.p, 'decide', 'start notes-app')).toContain('Started recording')
  await b.rt.command(b.p, 'decide', 'add Notes app --id notes-app --status adopted --trunk')
  await b.rt.command(b.p, 'decide', 'add Local storage --id sqlite --parent notes-app --status adopted')
  await b.rt.command(b.p, 'decide', 'add Merge by paragraph --id merge --parent notes-app --status planned')
  return b
}

/** The same, with two more trees opened from it that the project does not record into: side-b (from #3) and later (from #4). */
async function withTrees(session = 'abcdef0123456789') {
  const b = await project(session)
  expect(await b.rt.command(b.p, 'decide', 'new side-b --at #3 --stay --title Another route')).toContain('Opened tree side-b')
  expect(await b.rt.command(b.p, 'decide', 'new later --stay')).toContain('Opened tree later')
  return b
}

type Booted = Awaited<ReturnType<typeof boot>>

const view = (b: Booted) => b.engine.cells.ui
const names = (b: Booted) => b.engine.cells.trees.map(x => x.name)
const nodeIds = (b: Booted) => b.engine.cells.model.nodes.map(n => n.id)
const toastsOf = (b: Booted) => b.engine.toasts.map(t => t.text)
const lastFocus = (b: Booted) => b.engine.focuses.at(-1)?.key
/** How many times the pane's state was written, by cell. */
const writesTo = (b: Booted, cell: string) => b.engine.writes.filter(w => w === cell).length
/** The whole disk as one string: equal before and after means nothing was written. */
const diskOf = (b: Booted) => JSON.stringify([...b.engine.disk.files].map(([path, f]) => [path, f.text]).sort())

function copyDisk(from: FakeEngine, to: FakeEngine, wanted: (path: string) => boolean = () => true): void {
  for (const [path, f] of from.disk.files) if (wanted(path)) to.put(path, f.text)
}

/** Another session of the same project: its own engine and clock, on a copy of this disk. */
async function otherSession(from: FakeEngine, session = 'bbbbbb1111111111') {
  const engine = new FakeEngine()
  copyDisk(from, engine)
  return boot(engine, session)
}

// ---------------------------------------------------------------- opening the overview

test('the trees are listed from the first: the first tree, then the ones opened later in it, the newest fork point first', async () => {
  const b = await withTrees()
  expect(names(b)).toEqual(['main', 'later', 'side-b'])
  expect(b.engine.cells.trees.map(x => x.fork?.count ?? null)).toEqual([null, 4, 3])
  // (what a tree is for: the title it was opened with; the first tree has none, and says what its oldest step says)
  expect(b.engine.cells.trees.map(x => x.title)).toEqual(['Notes app', null, 'Another route'])
  expect(b.engine.cells.trees.map(x => x.nodes)).toEqual([3, 3, 2])
  // the project records into the first tree
  expect(b.engine.cells.project.tree).toBe('main')
})

test('the overview opens on the tree the pane was showing, with every tree listed, and writes nothing to the disk', async () => {
  const b = await withTrees()
  const disk = diskOf(b)
  expect(view(b)).toMatchObject({ view: 'tree', tree: null, pick: null })
  await b.rt.openOverview(b.p)
  expect(view(b)).toMatchObject({ view: 'trees', tree: null, pick: 'main', newTree: null, editing: null })
  expect(lastFocus(b)).toBe(treeKey('main'))
  expect(diskOf(b)).toBe(disk)
  // from the tree view of another tree, it opens with that one highlighted
  await b.rt.showTree(b.p, 'side-b')
  await b.rt.openOverview(b.p)
  expect(view(b)).toMatchObject({ view: 'trees', tree: 'side-b', pick: 'side-b' })
  expect(lastFocus(b)).toBe(treeKey('side-b'))
  expect(diskOf(b)).toBe(disk)
})

test('opening the overview closes a form that was open in the tree view, and the form for a new tree', async () => {
  const b = await withTrees()
  await b.rt.select(b.p, 'sqlite')
  await b.rt.startEdit(b.p, 'sqlite')
  expect(view(b).editing).not.toBeNull()
  await b.rt.openOverview(b.p)
  expect(view(b)).toMatchObject({ view: 'trees', editing: null, newTree: null })
  // (the form for a new tree is closed by opening the overview again, as by going back)
  await b.rt.openNewTree(b.p)
  expect(view(b).newTree).not.toBeNull()
  await b.rt.openOverview(b.p)
  expect(view(b).newTree).toBeNull()
})

test('a project that is not recorded has no overview to open, and nothing changes', async () => {
  const b = await boot()
  const writes = writesTo(b, 'ui')
  await b.rt.openOverview(b.p)
  expect(view(b).view).toBe('tree')
  expect(writesTo(b, 'ui')).toBe(writes)
  await b.rt.openNewTree(b.p)
  expect(view(b).newTree).toBeNull()
  expect(b.engine.cells.trees).toEqual([])
})

test('opening the overview reads the disk again: a tree another session opened is there at once, not at the next poll', async () => {
  const a = await project('aaaaaa0000000000')
  const b = await otherSession(a.engine)
  expect(names(b)).toEqual(['main'])
  await a.rt.command(a.p, 'decide', 'new from-a --at #3 --stay')
  copyDisk(a.engine, b.engine)
  expect(names(b)).toEqual(['main']) // (not before it looks)
  await b.rt.openOverview(b.p)
  expect(names(b)).toEqual(['main', 'from-a'])
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'main' })
})

// ---------------------------------------------------------------- the list of trees

test('the list is the same list while nothing changes, so that the pane is not drawn again for it', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  const list = b.engine.cells.trees
  const writes = writesTo(b, 'trees')
  await b.engine.advance(60_000)
  expect(b.engine.cells.trees).toBe(list)
  expect(writesTo(b, 'trees')).toBe(writes)
})

test('what another session writes to one tree changes the facts about that tree only, at the next poll', async () => {
  const a = await withTrees('aaaaaa0000000000')
  const b = await otherSession(a.engine)
  const before = Object.fromEntries(a.engine.cells.trees.map(x => [x.name, x]))

  // B records in side-b and goes back to main; only side-b's files reach A
  expect(await b.rt.command(b.p, 'decide', 'use side-b')).toBe('Recording in tree side-b now.')
  expect(await b.rt.command(b.p, 'decide', 'add Try the WAL --id try-wal --parent sqlite --status planned')).toContain('Recorded try-wal')
  expect(await b.rt.command(b.p, 'decide', 'use main')).toBe('Recording in tree main now.')
  copyDisk(b.engine, a.engine, path => path.includes('/trees/side-b/'))
  await a.engine.advance(20_000)

  const after = Object.fromEntries(a.engine.cells.trees.map(x => [x.name, x]))
  expect(Object.keys(after)).toEqual(['main', 'later', 'side-b'])
  expect(after['main']).toBe(before['main'])
  expect(after['later']).toBe(before['later'])
  expect(after['side-b']).not.toBe(before['side-b'])
  expect(after['side-b']).toMatchObject({ nodes: 3, lastActor: 'user' })
  expect(a.engine.cells.project.tree).toBe('main')
})

test('a tree that is only half there (events, but no fork event yet) is not listed', async () => {
  const a = await withTrees('aaaaaa0000000000')
  const b = await otherSession(a.engine)
  await b.rt.command(b.p, 'decide', 'new half --at #3 --stay')
  // the events arrive before the one that says where the tree began
  const names2 = [...b.engine.disk.files.keys()].filter(path => path.includes('/trees/half/events/')).sort()
  expect(names2.length).toBeGreaterThan(1)
  for (const path of names2.slice(0, -1)) a.engine.put(path, b.engine.disk.text(path))
  await a.engine.advance(20_000)
  expect(names(a)).toEqual(['main', 'later', 'side-b'])
  // and the last one makes it a tree
  a.engine.put(names2.at(-1)!, b.engine.disk.text(names2.at(-1)!))
  await a.engine.advance(20_000)
  expect(names(a)).toEqual(['main', 'later', 'half', 'side-b'])
})

test('a tree whose folder is gone leaves the list, and a pane that was showing it goes back to the tree recorded into', async () => {
  const b = await withTrees()
  await b.rt.showTree(b.p, 'side-b')
  expect(view(b).tree).toBe('side-b')
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite'])
  for (const path of [...b.engine.disk.files.keys()]) if (path.includes('/trees/side-b/')) b.engine.disk.remove(path)
  await b.engine.advance(20_000)
  expect(names(b)).toEqual(['main', 'later'])
  expect(view(b).tree).toBeNull()
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'merge'])
})

// ---------------------------------------------------------------- moving about

test('j and k move the highlight a tree at a time and stop at the ends, and the focus ring goes with it', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  expect(view(b).pick).toBe('main')
  await b.rt.move(b.p, 1)
  expect(view(b).pick).toBe('later')
  expect(lastFocus(b)).toBe(treeKey('later'))
  await b.rt.move(b.p, 1)
  expect(view(b).pick).toBe('side-b')
  expect(lastFocus(b)).toBe(treeKey('side-b'))
  // at the end: it stays, and nothing is written
  const writes = writesTo(b, 'ui')
  await b.rt.move(b.p, 1)
  expect(view(b).pick).toBe('side-b')
  expect(writesTo(b, 'ui')).toBe(writes)
  await b.rt.move(b.p, -5)
  expect(view(b).pick).toBe('main')
  // moving about only moves the highlight: the pane still shows the tree it showed
  expect(view(b)).toMatchObject({ view: 'trees', tree: null })
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'merge'])
})

test('with no highlight on the tree being looked at, a move starts from the tree recorded into', async () => {
  const b = await withTrees()
  await b.rt.showTree(b.p, 'side-b')
  await b.rt.openOverview(b.p)
  expect(view(b).pick).toBe('side-b')
  await b.rt.move(b.p, -1)
  expect(view(b).pick).toBe('later')
  // a highlight on a tree that is not there starts again from the first
  await b.rt.pickTree(b.p, 'no-such-tree')
  await b.rt.move(b.p, 1)
  expect(view(b).pick).toBe('later')
})

test('a click or a Tab that puts the focus on a line of the overview highlights its tree; any other control does not', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.focusedControl(b.p, treeKey('side-b', 1))
  expect(view(b).pick).toBe('side-b')
  await b.rt.focusedControl(b.p, stepKey('later', 'merge'))
  expect(view(b).pick).toBe('later')
  const writes = writesTo(b, 'ui')
  for (const key of ['~up', '~record', '~lang', 'sqlite', '~tree:', NEW_KEYS.name]) await b.rt.focusedControl(b.p, key)
  expect(view(b).pick).toBe('later')
  // the same tree again writes nothing
  await b.rt.focusedControl(b.p, treeKey('later'))
  expect(writesTo(b, 'ui')).toBe(writes)
  // in the tree view there are no lines of the overview: the focus on one means nothing
  await b.rt.back(b.p)
  await b.rt.focusedControl(b.p, treeKey('side-b'))
  expect(view(b)).toMatchObject({ view: 'tree', pick: null })
})

// ---------------------------------------------------------------- opening a tree from the overview

test('a press on a tree highlights it; a second press, on the tree highlighted, opens it', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.pressTree(b.p, 'side-b', null)
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'side-b' })
  await b.rt.pressTree(b.p, 'side-b', null)
  expect(view(b)).toMatchObject({ view: 'tree', tree: 'side-b', pick: null, newTree: null })
  // what the pane draws now is that tree's mainline, which this session only reads
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite'])
  expect(b.engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3, title: 'Another route' })
  // (the tree recorded into is not "viewed": the pane follows it)
  await b.rt.openOverview(b.p)
  await b.rt.pressTree(b.p, 'main', null)
  await b.rt.pressTree(b.p, 'main', null)
  expect(view(b)).toMatchObject({ view: 'tree', tree: null })
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'merge'])
})

test('a press on a step of the graph is a press on its tree: it opens the tree at that step, and selects it', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  // the tree highlighted is already the one pressed: one press is enough
  await b.rt.pressTree(b.p, 'main', 'merge')
  expect(view(b)).toMatchObject({ view: 'tree', tree: null, pick: null, selected: 'merge' })
  expect(lastFocus(b)).toBe('merge')
  // on another tree the first press highlights it, and the second opens it there
  await b.rt.openOverview(b.p)
  await b.rt.pressTree(b.p, 'side-b', 'sqlite')
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'side-b' })
  await b.rt.pressTree(b.p, 'side-b', 'sqlite')
  expect(view(b)).toMatchObject({ view: 'tree', tree: 'side-b', selected: 'sqlite' })
  expect(lastFocus(b)).toBe('sqlite')
  // a step the tree does not have opens the tree without selecting any
  await b.rt.openOverview(b.p)
  await b.rt.pressTree(b.p, 'side-b', 'merge')
  expect(view(b)).toMatchObject({ view: 'tree', tree: 'side-b' })
  expect(view(b).selected).not.toBe('merge')
})

test('while the form for a new tree is open, a press only says which tree it opens from', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.pressTree(b.p, 'side-b', null)
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'side-b' })
  expect(view(b).newTree).not.toBeNull()
  await b.rt.pressTree(b.p, 'side-b', null)
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'side-b' })
  expect(view(b).newTree).not.toBeNull()
})

test('Enter opens the tree highlighted, and does nothing outside the overview or for a tree that is not there', async () => {
  const b = await withTrees()
  const writes = writesTo(b, 'ui')
  await b.rt.openPicked(b.p)
  expect(writesTo(b, 'ui')).toBe(writes)
  await b.rt.openOverview(b.p)
  await b.rt.move(b.p, 1)
  await b.rt.openPicked(b.p)
  expect(view(b)).toMatchObject({ view: 'tree', tree: 'later', pick: null })
  // a highlight on a tree that is gone: the overview stays
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'no-such-tree')
  await b.rt.openPicked(b.p)
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'no-such-tree' })
  await b.rt.pressTree(b.p, 'no-such-tree', null)
  expect(view(b).view).toBe('trees')
})

// ---------------------------------------------------------------- tabs, back

test('a tab shows that tree in the tree view, the tree recorded into as itself and any other read only', async () => {
  const b = await withTrees()
  await b.rt.showTree(b.p, 'side-b')
  expect(view(b)).toMatchObject({ view: 'tree', tree: 'side-b', pick: null })
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite'])
  await b.rt.showTree(b.p, 'later')
  expect(view(b).tree).toBe('later')
  await b.rt.showTree(b.p, 'main')
  expect(view(b).tree).toBeNull()
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'merge'])
  // a tree that is not there changes nothing
  const writes = writesTo(b, 'ui')
  await b.rt.showTree(b.p, 'no-such-tree')
  expect(writesTo(b, 'ui')).toBe(writes)
  expect(view(b).tree).toBeNull()
  // the selection stays when the node is in the tree that is shown next, and goes when it is not
  await b.rt.select(b.p, 'merge')
  await b.rt.showTree(b.p, 'later')
  expect(view(b).selected).toBe('merge')
  await b.rt.showTree(b.p, 'side-b')
  expect(view(b).selected).toBeNull()
})

test('the next tree and the one before follow the order of the tabs, and go round', async () => {
  const b = await withTrees()
  const shown = () => view(b).tree ?? 'main'
  await b.rt.cycleTree(b.p, 1)
  expect(shown()).toBe('later')
  await b.rt.cycleTree(b.p, 1)
  expect(shown()).toBe('side-b')
  await b.rt.cycleTree(b.p, 1)
  expect(shown()).toBe('main')
  expect(view(b).tree).toBeNull()
  await b.rt.cycleTree(b.p, -1)
  expect(shown()).toBe('side-b')
  await b.rt.cycleTree(b.p, -1)
  expect(shown()).toBe('later')
  // one tree is all there is: nothing to go to
  const one = await project()
  const writes = writesTo(one, 'ui')
  await one.rt.cycleTree(one.p, 1)
  expect(writesTo(one, 'ui')).toBe(writes)
})

test('going back from the overview returns to the tree, and closes the form; in the tree there is nothing to go back from', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.back(b.p)
  expect(view(b)).toMatchObject({ view: 'tree', pick: null, newTree: null })
  // the focus ring goes to a node of the tree again
  expect(lastFocus(b)?.startsWith('~')).toBe(false)
  const writes = writesTo(b, 'ui')
  await b.rt.back(b.p)
  expect(writesTo(b, 'ui')).toBe(writes)
})

test('a tree that is not the one recorded into is read only: the form for editing is not offered, and the person is told how to record in it', async () => {
  const b = await withTrees()
  await b.rt.showTree(b.p, 'side-b')
  const toasts = toastsOf(b).length
  await b.rt.startEdit(b.p, 'sqlite')
  expect(view(b).editing).toBeNull()
  expect(toastsOf(b).slice(toasts)).toEqual(['This is side-b, which is read only here. Press t, select it and press r to record in it.'])
  // the tree recorded into can be edited
  await b.rt.showTree(b.p, 'main')
  await b.rt.startEdit(b.p, 'sqlite')
  expect(view(b).editing).toMatchObject({ id: 'sqlite' })
})

// ---------------------------------------------------------------- recording into a tree from the overview

test('r records into the tree highlighted: the project switches to it, for every session, and the person is told', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'side-b')
  const toasts = toastsOf(b).length
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).slice(toasts)).toEqual(['Recording in tree side-b now.'])
  expect(b.engine.cells.project.tree).toBe('side-b')
  expect(JSON.parse(b.engine.disk.text(configPath())).tree).toBe('side-b')
  // the overview stays, and now marks that tree
  expect(view(b)).toMatchObject({ view: 'trees', pick: 'side-b' })
  // what is recorded from now on goes there
  expect(await b.rt.command(b.p, 'decide', 'add Try WAL --id try-wal --parent sqlite --status planned')).toContain('Recorded try-wal')
  // (the pane follows the tree recorded into, so it shows the new step)
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'try-wal'])
})

test('r on the tree already recorded into says so, and r on the first tree takes the project back to it', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  const toasts = toastsOf(b).length
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).slice(toasts)).toEqual(['Already recording in tree main.'])
  await b.rt.pickTree(b.p, 'later')
  await b.rt.recordPicked(b.p)
  expect(b.engine.cells.project.tree).toBe('later')
  await b.rt.pickTree(b.p, 'main')
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).at(-1)).toBe('Recording in tree main now.')
  expect(b.engine.cells.project.tree).toBe('main')
  expect('tree' in JSON.parse(b.engine.disk.text(configPath()))).toBe(false)
})

test('r works while recording is paused, as /decide tree use does, and adds that the recording is paused', async () => {
  const b = await withTrees()
  await b.rt.command(b.p, 'decide', 'pause')
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'side-b')
  const toasts = toastsOf(b).length
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).slice(toasts)).toEqual(['Recording in tree side-b now. Recording is paused; /decide resume turns it back on.'])
  expect(b.engine.cells.project.tree).toBe('side-b')
  expect(b.rt.mode).toBe('paused')
})

test('r outside the overview does nothing', async () => {
  const b = await withTrees()
  const disk = diskOf(b)
  const toasts = toastsOf(b).length
  await b.rt.recordPicked(b.p)
  expect(diskOf(b)).toBe(disk)
  expect(toastsOf(b)).toHaveLength(toasts)
  expect(b.engine.cells.project.tree).toBe('main')
})

test('r follows a tree another session opened a moment ago, which the list has not caught up with', async () => {
  const a = await project('aaaaaa0000000000')
  const b = await otherSession(a.engine)
  await a.rt.command(a.p, 'decide', 'new from-a --at #3 --stay')
  copyDisk(a.engine, b.engine)
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'from-a')
  await b.rt.recordPicked(b.p)
  expect(b.engine.cells.project.tree).toBe('from-a')
  expect(toastsOf(b).at(-1)).toBe('Recording in tree from-a now.')
})

// ---------------------------------------------------------------- the form for a new tree

test('n opens the form, which keeps what is typed in it, and cancelling closes it and puts the focus back on the tree highlighted', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'later')
  await b.rt.openNewTree(b.p)
  expect(view(b).newTree).toEqual({ name: '', at: '', title: '', error: null })
  expect(lastFocus(b)).toBe(NEW_KEYS.name)
  await b.rt.newTreeField(b.p, 'name', 'try-a')
  await b.rt.newTreeField(b.p, 'at', '#2')
  await b.rt.newTreeField(b.p, 'title', 'A first try')
  expect(view(b).newTree).toEqual({ name: 'try-a', at: '#2', title: 'A first try', error: null })
  // pressing n again keeps the form as it is
  await b.rt.openNewTree(b.p)
  expect(view(b).newTree).toEqual({ name: 'try-a', at: '#2', title: 'A first try', error: null })
  await b.rt.cancelNewTree(b.p)
  expect(view(b)).toMatchObject({ view: 'trees', newTree: null, pick: 'later' })
  expect(lastFocus(b)).toBe(treeKey('later'))
  // nothing was written anywhere but the pane's state
  expect(names(b)).toEqual(['main', 'later', 'side-b'])
  // with no form, typing into a field and cancelling mean nothing
  const closed = view(b)
  await b.rt.newTreeField(b.p, 'name', 'x')
  await b.rt.cancelNewTree(b.p)
  expect(view(b)).toBe(closed)
})

test('a tree is opened from the tree highlighted, at the version written (as it is now when none is), and the project records into it from then on', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'side-b')
  await b.rt.openNewTree(b.p)
  const toasts = toastsOf(b).length
  // (the text of the field Enter was pressed in comes with the call: it may be newer than the state's copy)
  await b.rt.createTree(b.p, { name: 'try-a', at: '#2', title: 'A first try' })
  expect(view(b)).toMatchObject({ view: 'tree', tree: null, pick: null, newTree: null, editing: null, selected: null })
  expect(b.engine.cells.project.tree).toBe('try-a')
  expect(JSON.parse(b.engine.disk.text(configPath())).tree).toBe('try-a')
  expect(b.engine.cells.model.fork).toMatchObject({ tree: 'side-b', count: 2, title: 'A first try', actor: 'user' })
  expect(nodeIds(b)).toEqual(['notes-app'])
  expect(toastsOf(b).slice(toasts)).toHaveLength(1)
  expect(toastsOf(b).at(-1)).toMatch(/^Opened tree try-a, from side-b at #2 \(\d\d-\d\d \d\d:\d\d\): 1 node\. Recording there now\.$/)
  // (listed after the tree it was opened from)
  expect(names(b)).toEqual(['main', 'later', 'side-b', 'try-a'])
})

test('from the first tree with no version written, the new tree is a copy of it as it is now', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.newTreeField(b.p, 'name', 'copy-now')
  await b.rt.createTree(b.p)
  expect(b.engine.cells.project.tree).toBe('copy-now')
  expect(b.engine.cells.model.fork).toMatchObject({ tree: 'main', count: 4 })
  expect(nodeIds(b)).toEqual(['notes-app', 'sqlite', 'merge'])
  expect(toastsOf(b).at(-1)).toContain('from main at #4')
})

test('what is wrong with the form is said in the form, in one line, and nothing is written', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  const disk = diskOf(b)
  const toasts = toastsOf(b).length
  const tryIt = async (fields: { name: string; at?: string; title?: string }, error: RegExp) => {
    for (const [field, value] of Object.entries({ at: '', title: '', ...fields })) await b.rt.newTreeField(b.p, field as 'name' | 'at' | 'title', value)
    await b.rt.createTree(b.p)
    expect(view(b).newTree?.error, JSON.stringify(fields)).toMatch(error)
    expect(view(b).newTree?.error?.includes('\n')).toBe(false)
    // the form stays as it was typed, the view stays, and the focus goes back to the name
    expect(view(b).view).toBe('trees')
    expect(view(b).newTree).toMatchObject(fields)
    expect(lastFocus(b)).toBe(NEW_KEYS.name)
    expect(diskOf(b)).toBe(disk)
  }
  await tryIt({ name: '' }, /^a tree needs a name/)
  await tryIt({ name: 'x' }, /^"x" cannot be a tree name/)
  await tryIt({ name: '新方案' }, /^"新方案" cannot be a tree name/)
  await tryIt({ name: 'main' }, /^"main" is the first tree of the project/)
  await tryIt({ name: 'side-b' }, /^tree side-b already exists/)
  // (the version is looked up in the tree it opens from: main, whose four events are #1 to #4)
  await tryIt({ name: 'try-a', at: '#99' }, /^there is no version #99: main has 4 events \(#1 to #4\)/)
  expect(toastsOf(b)).toHaveLength(toasts)
  // typing in a field clears the complaint
  await b.rt.newTreeField(b.p, 'name', 'try-b')
  expect(view(b).newTree?.error).toBeNull()
  expect(b.engine.cells.project.tree).toBe('main')
})

test('a name written with spaces and capitals is made into a tree name', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.newTreeField(b.p, 'name', 'Try It Again')
  await b.rt.createTree(b.p)
  expect(view(b)).toMatchObject({ view: 'tree', newTree: null })
  expect(b.engine.cells.project.tree).toBe('try-it-again')
})

test('the form from a project whose recording is paused opens the tree and says that the recording is paused', async () => {
  const b = await withTrees()
  await b.rt.command(b.p, 'decide', 'pause')
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.newTreeField(b.p, 'name', 'paused-try')
  await b.rt.createTree(b.p)
  expect(view(b).view).toBe('tree')
  expect(b.engine.cells.project.tree).toBe('paused-try')
  expect(toastsOf(b).at(-1)).toMatch(/Recording there now\. Recording is paused; \/decide resume turns it back on\.$/)
})

test('a form for a project that stopped being recorded under it says so, and opens nothing', async () => {
  const b = await withTrees()
  await b.rt.openOverview(b.p)
  await b.rt.openNewTree(b.p)
  await b.rt.newTreeField(b.p, 'name', 'try-a')
  b.engine.disk.remove(configPath())
  await b.rt.createTree(b.p)
  expect(view(b).newTree).toMatchObject({ name: 'try-a', error: 'Decisions are not being recorded in this project. Run /decide start [title] first.' })
  expect(view(b).view).toBe('trees')
  expect(names(b)).not.toContain('try-a')
})

test('in Chinese the toasts and the complaints of the form are Chinese, and the names stay as they were written', async () => {
  const b = await withTrees()
  expect(await b.rt.command(b.p, 'decide', 'lang zh')).toMatch(/zh/)
  await b.rt.openOverview(b.p)
  await b.rt.pickTree(b.p, 'side-b')
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).at(-1)).toBe('现在记录到 tree「side-b」。')
  await b.rt.recordPicked(b.p)
  expect(toastsOf(b).at(-1)).toBe('已经在记录到 tree「side-b」。')
  await b.rt.openNewTree(b.p)
  await b.rt.createTree(b.p)
  expect(view(b).newTree?.error).toBe('tree 需要一个名字（字母、数字、连字符，2–32 个字符，例如 crdt-engine）')
  await b.rt.newTreeField(b.p, 'name', 'try-a')
  await b.rt.createTree(b.p)
  expect(toastsOf(b).at(-1)).toMatch(/^已新开 tree「try-a」，/)
  expect(b.engine.cells.project.tree).toBe('try-a')
})
