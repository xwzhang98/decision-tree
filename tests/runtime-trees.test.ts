import { test, expect } from 'claude-code/testing'

import { Runtime } from '../lib/runtime'
import { FakeEngine, ROOT, configPath, eventFiles, eventsOf } from './port'

const DIR = `${ROOT}/.claude/decisions`

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

const text = (a: { result: string } | { deny: string }): string => ('result' in a ? a.result : `DENY: ${a.deny}`)

/** A project with a mainline of three decisions: events #1 start, #2 design-v2, #3 dbpool, #4 v22. */
async function project(session = 'abcdef0123456789') {
  const b = await boot(new FakeEngine(), session)
  expect(await b.rt.command(b.p, 'decide', 'start orders')).toContain('Started recording')
  await b.rt.command(b.p, 'decide', 'add Design v2 --id design-v2 --status adopted --trunk')
  await b.rt.command(b.p, 'decide', 'add Shared sockets --id dbpool --parent design-v2 --status adopted')
  await b.rt.command(b.p, 'decide', 'add Build v2.2 --id v22 --parent design-v2 --status planned')
  return b
}

/** The events of one tree on the fake disk, parsed, in file-name order. */
function treeEvents(engine: FakeEngine, tree: string): Record<string, unknown>[] {
  const prefix = `${DIR}/trees/${tree}/events/`
  return [...engine.disk.files.keys()]
    .filter(p => p.startsWith(prefix))
    .sort()
    .map(p => JSON.parse(engine.disk.text(p)) as Record<string, unknown>)
}

const mainFiles = (engine: FakeEngine): string[] => [...engine.disk.files.keys()].filter(p => p.startsWith(`${DIR}/events/`)).sort()

/** What another machine (or a git pull) would bring over: every file of one disk onto another. */
function copyDisk(from: FakeEngine, to: FakeEngine): void {
  for (const [path, f] of from.disk.files) to.put(path, f.text)
}

const FELL_BACK = 'has no such tree'
const FOLLOWED = (name: string) => `Now recording in tree ${name} (the project switched to it).`

// ---------------------------------------------------------------- opening and switching

test('/decide new: copies a version, switches this session at once, and the receipt is all it says', async () => {
  const { rt, engine, p } = await project()
  const toasts = engine.toasts.length
  const r = await rt.command(p, 'decide', 'new sql-v3 --at #3 --title SQL 第三版')
  expect(r).toMatch(/^Opened tree sql-v3, from main at #3 \(\d\d-\d\d \d\d:\d\d\): 2 nodes\. Recording there now\.$/)

  expect(engine.cells.project.tree).toBe('sql-v3')
  expect(engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3, title: 'SQL 第三版', actor: 'user' })
  expect(engine.cells.model.nodes.map(n => n.id)).toEqual(['design-v2', 'dbpool'])
  expect(JSON.parse(engine.disk.text(configPath())).tree).toBe('sql-v3')
  // the person was told by the receipt: no toast on top of it
  expect(engine.toasts).toHaveLength(toasts)

  // the model is told which tree it is in, once the turn starts
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toContain('Current tree: sql-v3 (from main at #3 (')
  expect(rt.section()?.text).not.toContain('v22')
})

test('/decide new --stay opens the tree and leaves recording where it was', async () => {
  const { rt, engine, p } = await project()
  const r = await rt.command(p, 'decide', 'new later --stay')
  expect(r).toContain('Opened tree later, from main at #4')
  expect(r).toContain('Still recording in main; /decide tree use later switches.')
  expect(engine.cells.project.tree).toBe('main')
  expect('tree' in JSON.parse(engine.disk.text(configPath()))).toBe(false)
  expect(treeEvents(engine, 'later').map(e => e.op)).toEqual(['start', 'add', 'add', 'add', 'fork'])
  // /decide use switches to it
  expect(await rt.command(p, 'decide', 'use later')).toBe('Recording in tree later now.')
  expect(engine.cells.project.tree).toBe('later')
})

test('after /decide new, commands and tools all record into the new tree, and main stays as it was', async () => {
  const { rt, engine, p } = await project()
  const before = mainFiles(engine)
  const mainSnapshot = engine.disk.text(`${DIR}/tree.json`)
  await rt.command(p, 'decide', 'new sql-v3 --at #3')

  expect(await rt.command(p, 'decide', 'add SQL first try --id sql-first --parent design-v2 --status planned')).toContain('Recorded sql-first')
  expect(text(await rt.toolCall(p, 'decision_record', { title: 'SQL second try', parent: 'sql-first', status: 'proposed' }))).toContain('Recorded sql-second-try')
  expect(text(await rt.toolCall(p, 'decision_update', { id: 'dbpool', status: 'rejected' }))).toContain('Updated dbpool')
  expect(text(await rt.toolCall(p, 'decision_note', { id: 'sql-first', text: 'run it twice' }))).toBe('Noted on sql-first')

  // main has not gained a file, and its snapshot is as it was
  expect(mainFiles(engine)).toEqual(before)
  expect(engine.disk.text(`${DIR}/tree.json`)).toBe(mainSnapshot)
  expect(eventFiles(engine)).toEqual(before)

  // the new tree holds what it copied, its fork event, and what came after
  const own = treeEvents(engine, 'sql-v3')
  expect(own.map(e => e.op)).toEqual(['start', 'add', 'add', 'fork', 'add', 'add', 'update', 'note'])
  expect(own.at(-1)).toMatchObject({ op: 'note', id: 'sql-first', actor: 'model' })
  expect(own.at(-2)).toMatchObject({ op: 'update', id: 'dbpool', actor: 'model' })

  // its own snapshot says which tree it is
  const snap = JSON.parse(engine.disk.text(`${DIR}/trees/sql-v3/tree.json`))
  expect(snap.tree).toBe('sql-v3')
  expect(snap.nodes.map((n: { id: string }) => n.id)).toEqual(['design-v2', 'dbpool', 'sql-first', 'sql-second-try'])

  // the pane's state is the new tree's; main's dbpool is still adopted
  expect(engine.cells.model.nodes.find(n => n.id === 'dbpool')?.status).toBe('rejected')
  expect(eventsOf(engine).length).toBe(4)
  expect(await rt.command(p, 'decide', 'use main')).toBe('Recording in tree main now.')
  expect(engine.cells.project.tree).toBe('main')
  expect(engine.cells.model.nodes.find(n => n.id === 'dbpool')?.status).toBe('adopted')
  expect(engine.cells.model.nodes.map(n => n.id)).toEqual(['design-v2', 'dbpool', 'v22'])
  expect('tree' in JSON.parse(engine.disk.text(configPath()))).toBe(false)
  await rt.onTurnStart(p)
  expect(rt.section()?.text).not.toContain('Current tree')
})

test('/decide new, then /decide use back and forth: each tree keeps its own record', async () => {
  const { rt, engine, p } = await project()
  const ids = () => engine.cells.model.nodes.map(n => n.id)
  const nodeOf = (id: string) => engine.cells.model.nodes.find(n => n.id === id)

  // sql-v3 starts from main's first three events and goes its own way
  await rt.command(p, 'decide', 'new sql-v3 --at #3')
  await rt.command(p, 'decide', 'add Run with SQL --id next-step --parent dbpool --status planned')
  await rt.command(p, 'decide', 'status dbpool rejected')
  expect(ids()).toEqual(['design-v2', 'dbpool', 'next-step'])

  // main goes its own way: an id taken in one tree is free in the other, and dbpool is still adopted there
  expect(await rt.command(p, 'decide', 'use main')).toBe('Recording in tree main now.')
  expect(ids()).toEqual(['design-v2', 'dbpool', 'v22'])
  expect(engine.cells.model.fork).toBeNull()
  expect(nodeOf('dbpool')?.status).toBe('adopted')
  expect(await rt.command(p, 'decide', 'add Run without SQL --id next-step --parent v22 --status planned')).toBe('Recorded next-step (under v22, Planned)')

  // and back: sql-v3 is as it was left, with its own next-step and its own dbpool
  expect(await rt.command(p, 'decide', 'use sql-v3')).toBe('Recording in tree sql-v3 now.')
  expect(ids()).toEqual(['design-v2', 'dbpool', 'next-step'])
  expect(nodeOf('next-step')?.title).toBe('Run with SQL')
  expect(nodeOf('dbpool')?.status).toBe('rejected')
  expect(engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3 })
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toContain('Current tree: sql-v3 (from main at #3 (')
  expect(rt.section()?.text).toContain('next-step · planned · Run with SQL')
  expect(rt.section()?.text).not.toContain('v22')
  await rt.command(p, 'decide', 'note next-step uses the new loss')

  expect(await rt.command(p, 'decide', 'use main')).toBe('Recording in tree main now.')
  expect(nodeOf('next-step')?.title).toBe('Run without SQL')
  expect(nodeOf('next-step')?.notes).toEqual([])
  await rt.onTurnStart(p)
  expect(rt.section()?.text).not.toContain('Current tree')
  expect(rt.section()?.text).toContain('next-step · planned · Run without SQL')

  // on disk: two records, each with its own events and its own snapshot
  expect(mainFiles(engine)).toHaveLength(5)
  expect(treeEvents(engine, 'sql-v3').map(e => e.op)).toEqual(['start', 'add', 'add', 'fork', 'add', 'update', 'note'])
  const snapshotIds = (path: string): string[] => JSON.parse(engine.disk.text(path)).nodes.map((n: { id: string }) => n.id)
  expect(snapshotIds(`${DIR}/tree.json`)).toEqual(['design-v2', 'dbpool', 'v22', 'next-step'])
  expect(snapshotIds(`${DIR}/trees/sql-v3/tree.json`)).toEqual(['design-v2', 'dbpool', 'next-step'])
  expect('tree' in JSON.parse(engine.disk.text(configPath()))).toBe(false)
})

// ---------------------------------------------------------------- a second session, and what the tests below share

const MINUTE = 60_000

/** A moment in the machine's own time zone: `10-10 12:20` the way a receipt writes it, `2026-10-10 12:20` the way --at is typed. */
function localText(ms: number, withYear = false): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  const day = `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
  return withYear ? `${d.getFullYear()}-${day}` : day
}

const idsOf = (engine: FakeEngine): string[] => engine.cells.model.nodes.map(n => n.id)

const toastsOf = (engine: FakeEngine): string[] => engine.toasts.map(t => t.text)

/** The event file names of one tree on the fake disk, in order. */
const namesOf = (engine: FakeEngine, tree: string): string[] =>
  [...engine.disk.files.keys()]
    .filter(p => p.startsWith(`${DIR}/trees/${tree}/events/`))
    .sort()
    .map(p => p.split('/').at(-1)!)

/** What the session says when config.json names a tree that is not here. */
const STAYED = (name: string, current = 'main') => `config.json names tree ${name}, but this project has no such tree (yet); staying on ${current}.`

/** Another session of the same project: its own engine and clock, on a copy of this disk. */
async function otherSession(from: FakeEngine, session = 'bbbbbb1111111111') {
  const engine = new FakeEngine()
  copyDisk(from, engine)
  return boot(engine, session)
}

/** Part of one disk reaching another, the way a git pull brings it: in no set order. */
function bring(from: FakeEngine, to: FakeEngine, wanted: (path: string) => boolean): void {
  for (const [path, f] of from.disk.files) if (wanted(path)) to.put(path, f.text)
}

test('a session that starts later begins on the tree the project is recording in, without a toast', async () => {
  const first = await project('aaaaaa0000000000')
  await first.rt.command(first.p, 'decide', 'new sql-v3 --at #3')
  await first.rt.command(first.p, 'decide', 'add SQL first try --id sql-first --parent design-v2 --status planned')

  // a second session opens in the same folder (here: on a copy of its files)
  const later = await otherSession(first.engine)
  expect(later.engine.cells.project).toMatchObject({ mode: 'recording', tree: 'sql-v3', config: { tree: 'sql-v3' } })
  expect(later.engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3, actor: 'user' })
  expect(idsOf(later.engine)).toEqual(['design-v2', 'dbpool', 'sql-first'])
  expect(later.engine.toasts).toEqual([])
  await later.rt.onTurnStart(later.p)
  expect(later.rt.section()?.text).toContain('Current tree: sql-v3 (from main at #3 (')

  // nothing to announce at the poll either: the project is where this session is
  await later.engine.advance(10_000)
  expect(later.engine.toasts).toEqual([])

  // what it records goes into that tree, and main does not notice
  const main = mainFiles(later.engine)
  expect(await later.rt.command(later.p, 'decide', 'add Later one --id later-one --parent sql-first --status planned')).toBe('Recorded later-one (under sql-first, Planned)')
  expect(mainFiles(later.engine)).toEqual(main)
  expect(treeEvents(later.engine, 'sql-v3').at(-1)).toMatchObject({ op: 'add', id: 'later-one', session: 'bbbbbb' })
})

// ---------------------------------------------------------------- what is wrong with a request

test('/decide new: what is wrong is said in a line and nothing is written', async () => {
  const { rt, engine, p } = await project()
  const writes = engine.disk.writes.length
  const files = [...engine.disk.files.keys()].sort()

  const wrong: [string, string][] = [
    ['new main', '"main" is the first tree of the project; pick another name'],
    ['new x', '"x" cannot be a tree name: use 2-32 letters, digits and hyphens (a longer or Chinese name goes in --title)'],
    ['new 新树', '"新树" cannot be a tree name: use 2-32 letters, digits and hyphens (a longer or Chinese name goes in --title)'],
    ['new sql-v3 --at #99', 'there is no version #99: main has 4 events (#1 to #4)'],
    ['new sql-v3 --at banana', 'cannot tell which version "banana" is; use current, #N (see /decide tree log), a date or time such as 2026-10-08 17:44, or a node id'],
    ['new sql-v3 --at 2026-01-01', `nothing had been recorded in main by then; its first event is from ${localText(engine.nowMs)}`],
    ['new sql-v3 --from nowhere', 'there is no tree named nowhere; /decide tree lists them'],
    ['use nowhere', 'there is no tree named nowhere; /decide tree lists them'],
  ]
  const got: [string, string][] = []
  for (const [args] of wrong) got.push([args, await rt.command(p, 'decide', args)])
  expect(got).toEqual(wrong)
  for (const [, line] of got) expect(line).not.toContain('\n')

  // no name at all: the line says what is missing, with the usage after it, still one line
  for (const args of ['new', 'tree new', 'use', 'tree use', 'switch']) {
    const line = await rt.command(p, 'decide', args)
    expect(line).toMatch(/^Missing a tree name\. Usage: \/decide start .* \| tree \[new <name>/)
    expect(line).not.toContain('\n')
  }

  // nothing was written, nothing moved, nobody was toasted
  expect(engine.disk.writes).toHaveLength(writes)
  expect([...engine.disk.files.keys()].sort()).toEqual(files)
  expect(engine.cells.project.tree).toBe('main')
  expect('tree' in JSON.parse(engine.disk.text(configPath()))).toBe(false)
  expect(engine.toasts).toEqual([])
})

test('/decide new twice with one name: the second says the tree is there and what to do', async () => {
  const { rt, engine, p } = await project()
  expect(await rt.command(p, 'decide', 'new sql-v3 --at #3 --stay')).toContain('Opened tree sql-v3, from main at #3')
  const files = [...engine.disk.files.keys()].sort()
  const writes = engine.disk.writes.length

  const THERE = 'tree sql-v3 already exists; pick another name, or switch to it with /decide tree use sql-v3'
  expect(await rt.command(p, 'decide', 'new sql-v3')).toBe(THERE)
  expect(await rt.command(p, 'decide', 'new sql-v3 --at #2 --title again')).toBe(THERE)
  // the same name written another way is the same tree, and a blank one is no way round it
  expect(await rt.command(p, 'decide', 'new SQL v3')).toBe(THERE)
  expect(await rt.command(p, 'decide', 'tree create sql-v3 --empty')).toBe(THERE)

  // the tree that is there was not touched, and nobody was moved
  expect(engine.disk.writes).toHaveLength(writes)
  expect([...engine.disk.files.keys()].sort()).toEqual(files)
  expect(treeEvents(engine, 'sql-v3').map(e => e.op)).toEqual(['start', 'add', 'add', 'fork'])
  expect(engine.cells.project.tree).toBe('main')

  // what it says to do works, and from inside that tree the answer is the same
  expect(await rt.command(p, 'decide', 'tree use sql-v3')).toBe('Recording in tree sql-v3 now.')
  expect(idsOf(engine)).toEqual(['design-v2', 'dbpool'])
  expect(await rt.command(p, 'decide', 'new sql-v3')).toBe(THERE)
  expect(engine.disk.writes).toHaveLength(writes + 1) // only config.json, for the switch
})

test('/decide new --at: a number, a node, a piece of a title, a time', async () => {
  // project()'s four events, but ten minutes apart, so that a time can fall between two of them
  const engine = new FakeEngine()
  const { rt, p } = await boot(engine)
  const t0 = engine.nowMs
  await rt.command(p, 'decide', 'start orders')
  engine.nowMs = t0 + 10 * MINUTE
  await rt.command(p, 'decide', 'add Design v2 --id design-v2 --status adopted --trunk')
  engine.nowMs = t0 + 20 * MINUTE
  await rt.command(p, 'decide', 'add Shared sockets --id dbpool --parent design-v2 --status adopted')
  engine.nowMs = t0 + 30 * MINUTE
  await rt.command(p, 'decide', 'add Build v2.2 --id v22 --parent design-v2 --status planned')
  const names = mainFiles(engine).map(f => f.split('/').at(-1))
  expect(names).toHaveLength(4)

  // [the tree, how the version is written, the event it ends at, the nodes it holds]
  const cases: [string, string, number, string[]][] = [
    ['by-number', '#2', 2, ['design-v2']],
    ['by-node', 'dbpool', 3, ['design-v2', 'dbpool']],
    ['by-title', '"build v2"', 4, ['design-v2', 'dbpool', 'v22']],
    ['by-time', localText(t0 + 5 * MINUTE, true), 1, []],
  ]
  for (const [tree, at, count, ids] of cases) {
    const nodes = ids.length === 1 ? '1 node' : `${ids.length} nodes`
    const when = localText(t0 + (count - 1) * 10 * MINUTE)
    expect(await rt.command(p, 'decide', `new ${tree} --at ${at} --stay`)).toBe(
      `Opened tree ${tree}, from main at #${count} (${when}): ${nodes}. Still recording in main; /decide tree use ${tree} switches.`,
    )
    // the fork event says where it began, by the name of the last event file it copied
    const events = treeEvents(engine, tree)
    expect(events).toHaveLength(count + 1)
    expect(events.at(-1)).toMatchObject({ op: 'fork', base: { tree: 'main', count, at: names[count - 1] } })
    expect(JSON.parse(engine.disk.text(`${DIR}/trees/${tree}/tree.json`)).nodes.map((n: { id: string }) => n.id)).toEqual(ids)
  }

  // a piece of a title has to point at one node: "v2" is in two
  expect(await rt.command(p, 'decide', 'new by-both --at "v2" --stay')).toBe('"v2" matches several nodes (design-v2, v22); use an id')
  expect(treeEvents(engine, 'by-both')).toEqual([])
  expect(engine.cells.project.tree).toBe('main')
})

// ---------------------------------------------------------------- paused, and not recorded at all

test('while recording is paused the person can still open and switch trees, and is told; the model cannot', async () => {
  const { rt, engine, p } = await project()
  expect(await rt.command(p, 'decide', 'pause')).toBe('Decision recording paused')
  const NOTE = 'Recording is paused; /decide resume turns it back on.'

  // the person's own commands work, and each receipt says what comes next
  expect(await rt.command(p, 'decide', 'new sql-v3 --at #3')).toMatch(
    /^Opened tree sql-v3, from main at #3 \(\d\d-\d\d \d\d:\d\d\): 2 nodes\. Recording there now\. Recording is paused; \/decide resume turns it back on\.$/,
  )
  expect(engine.cells.project).toMatchObject({ mode: 'paused', tree: 'sql-v3' })
  expect(JSON.parse(engine.disk.text(configPath()))).toMatchObject({ recording: false, tree: 'sql-v3' })
  expect(await rt.command(p, 'decide', 'use main')).toBe(`Recording in tree main now. ${NOTE}`)
  expect(await rt.command(p, 'decide', 'use sql-v3')).toBe(`Recording in tree sql-v3 now. ${NOTE}`)
  // looking is not recording: the list and the log carry no such note
  expect(await rt.command(p, 'decide', 'tree')).toContain('* sql-v3  from main at #3')
  expect(await rt.command(p, 'decide', 'tree')).not.toContain('paused')
  expect(await rt.command(p, 'decide', 'log 2')).not.toContain('paused')

  // the model is told it is not recorded, and nothing is written
  const files = [...engine.disk.files.keys()].sort()
  const writes = engine.disk.writes.length
  const BLOCK = { result: 'Not recorded: decision recording is paused (the user can run /decide resume).' }
  expect(await rt.toolCall(p, 'decision_new_tree', { name: 'by-model' })).toEqual(BLOCK)
  expect(await rt.toolCall(p, 'decision_new_tree', { name: 'blank', empty: true, stay: true })).toEqual(BLOCK)
  expect(await rt.toolCall(p, 'decision_use_tree', { name: 'main' })).toEqual(BLOCK)
  expect(engine.disk.writes).toHaveLength(writes)
  expect([...engine.disk.files.keys()].sort()).toEqual(files)
  expect(engine.cells.project.tree).toBe('sql-v3')

  // the prompt says paused, not which tree
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toContain('paused')
  expect(rt.section()?.text).not.toContain('Current tree')

  // after /decide resume the model records into the tree the person chose
  expect(await rt.command(p, 'decide', 'resume')).toBe('Decision recording resumed')
  expect(text(await rt.toolCall(p, 'decision_record', { title: 'SQL first try', parent: 'design-v2', status: 'planned' }))).toBe('Recorded sql-first-try (under design-v2, Planned)')
  expect(treeEvents(engine, 'sql-v3').at(-1)).toMatchObject({ op: 'add', id: 'sql-first-try', actor: 'model' })
  expect(mainFiles(engine)).toHaveLength(4)
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toContain('Current tree: sql-v3 (from main at #3 (')
})

test('a project that is not recorded: the commands say how to start, the tools deny, nothing is written', async () => {
  const { rt, engine, p } = await boot()
  const HOW = 'Decisions are not being recorded in this project. Run /decide start [title] first.'
  for (const args of ['new sql-v3', 'tree new sql-v3 --empty', 'use main', 'switch main', 'tree', 'trees', 'tree list', 'log', 'log 5', 'tree history']) {
    expect([args, await rt.command(p, 'decide', args)]).toEqual([args, HOW])
  }

  const DENIED = { deny: 'Decisions are not being recorded in this project. If the user wants that, call decision_log_start.' }
  expect(await rt.toolCall(p, 'decision_new_tree', { name: 'sql-v3' })).toEqual(DENIED)
  expect(await rt.toolCall(p, 'decision_new_tree', { name: 'blank', empty: true })).toEqual(DENIED)
  expect(await rt.toolCall(p, 'decision_use_tree', { name: 'main' })).toEqual(DENIED)
  expect(await rt.toolCall(p, 'decision_tree', { trees: true })).toEqual(DENIED)
  expect(await rt.toolCall(p, 'decision_tree', { log: 5 })).toEqual(DENIED)

  // not a file, not a pane state, not a toast; and only the tool that starts it is on offer
  expect([...engine.disk.files.keys()]).toEqual([])
  expect(engine.cells.project).toMatchObject({ mode: 'off', tree: 'main', config: null })
  expect(engine.toasts).toEqual([])
  expect(engine.tools.map(t => t.name)).toEqual(['decision_log_start'])

  // what it says to do works: once started, the same command opens a tree
  await rt.command(p, 'decide', 'start orders')
  expect(await rt.command(p, 'decide', 'new sql-v3')).toMatch(/^Opened tree sql-v3, from main at #1 \(\d\d-\d\d \d\d:\d\d\): 0 nodes\. Recording there now\.$/)
})

// ---------------------------------------------------------------- the model's tools

test('the model opens a tree when asked, lists them, reads the one it is in, and switches back', async () => {
  const { rt, engine, p } = await project()
  const toasts = engine.toasts.length

  const opened = text(await rt.toolCall(p, 'decision_new_tree', { name: 'sql-v3', at: '#3', title: 'SQL 第三版' }))
  expect(opened).toMatch(/^Opened tree sql-v3, from main at #3 \(\d\d-\d\d \d\d:\d\d\): 2 nodes\. Recording there now\.$/)
  expect(engine.cells.project.tree).toBe('sql-v3')
  expect(engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3, title: 'SQL 第三版', actor: 'model' })
  expect(JSON.parse(engine.disk.text(configPath())).tree).toBe('sql-v3')
  // the tool's answer is the receipt: no toast on top of it
  expect(engine.toasts).toHaveLength(toasts)

  // the list: every tree, the one in use starred, where each began
  const list = text(await rt.toolCall(p, 'decision_tree', { trees: true })).split('\n')
  expect(list).toHaveLength(3)
  expect(list[0]).toBe('Trees in this project (recording in sql-v3):')
  expect(list[1]).toBe('  main    3 nodes, 4 events')
  expect(list[2]).toMatch(/^\* sql-v3  from main at #3 \(\d\d-\d\d \d\d:\d\d\) · 2 nodes, 3 events · "SQL 第三版"$/)

  // reading the tree it is in: a header that names the tree, then that tree's nodes only
  const read = text(await rt.toolCall(p, 'decision_tree', {}))
  expect(read).toMatch(/^Tree: sql-v3 \(from main at #3 \(\d\d-\d\d \d\d:\d\d\)\)\. decision_tree with trees: true lists the project's trees\.\n/)
  expect(read).toContain('dbpool · adopted · Shared sockets · design-v2')
  expect(read).not.toContain('v22')
  expect(text(await rt.toolCall(p, 'decision_tree', { id: 'dbpool' }))).toMatch(/^Tree: sql-v3 \(from main at #3 /)
  expect(text(await rt.toolCall(p, 'decision_tree', { log: 2 })).split('\n')[0]).toBe('Tree sql-v3: 3 events; the last 2 (use #N as --at):')

  // and back to main: no header, main's own nodes, the pointer gone from config.json
  expect(text(await rt.toolCall(p, 'decision_use_tree', { name: 'main' }))).toBe('Recording in tree main now.')
  expect(engine.cells.project.tree).toBe('main')
  expect('tree' in JSON.parse(engine.disk.text(configPath()))).toBe(false)
  const main = text(await rt.toolCall(p, 'decision_tree', {}))
  expect(main).not.toContain('Tree:')
  expect(main).toContain('v22 · planned · Build v2.2 · design-v2')
  expect(text(await rt.toolCall(p, 'decision_use_tree', { name: 'main' }))).toBe('Already recording in tree main.')
  expect(engine.toasts).toHaveLength(toasts)

  // the section the model reads follows at the next turn
  await rt.onTurnStart(p)
  expect(rt.section()?.text).not.toContain('Current tree')
})

test("the model's mistakes come back as denials that say what to do", async () => {
  const { rt, engine, p } = await project()
  await rt.command(p, 'decide', 'new sql-v3 --at #3 --stay')
  const files = [...engine.disk.files.keys()].sort()
  const writes = engine.disk.writes.length
  const config = engine.disk.text(configPath())

  const NO_NAME = 'a tree needs a name (letters, digits and hyphens, 2-32 characters, e.g. sql-v3)'
  const NO_TREE = 'there is no tree named nowhere; /decide tree lists them'
  const calls: ['decision_new_tree' | 'decision_use_tree', Record<string, unknown>, string][] = [
    ['decision_new_tree', {}, NO_NAME],
    ['decision_new_tree', { name: 42 }, NO_NAME],
    ['decision_new_tree', { name: 'main' }, '"main" is the first tree of the project; pick another name'],
    ['decision_new_tree', { name: 'x' }, '"x" cannot be a tree name: use 2-32 letters, digits and hyphens (a longer or Chinese name goes in --title)'],
    ['decision_new_tree', { name: 'sql-v3' }, 'tree sql-v3 already exists; pick another name, or switch to it with /decide tree use sql-v3'],
    ['decision_new_tree', { name: 'next-try', at: '#99' }, 'there is no version #99: main has 4 events (#1 to #4)'],
    ['decision_new_tree', { name: 'next-try', at: 'banana' }, 'cannot tell which version "banana" is; use current, #N (see /decide tree log), a date or time such as 2026-10-08 17:44, or a node id'],
    ['decision_new_tree', { name: 'next-try', from: 'nowhere' }, NO_TREE],
    ['decision_use_tree', {}, NO_NAME],
    ['decision_use_tree', { name: 'nowhere' }, NO_TREE],
  ]
  for (const [tool, args, sentence] of calls) {
    expect([tool, args, await rt.toolCall(p, tool, args)]).toEqual([tool, args, { deny: sentence }])
  }

  // a denial writes nothing and moves nobody
  expect(engine.disk.writes).toHaveLength(writes)
  expect([...engine.disk.files.keys()].sort()).toEqual(files)
  expect(engine.disk.text(configPath())).toBe(config)
  expect(engine.cells.project.tree).toBe('main')

  // the model does what the denial said
  expect(await rt.toolCall(p, 'decision_use_tree', { name: 'sql-v3' })).toEqual({ result: 'Recording in tree sql-v3 now.' })
  expect(engine.cells.project.tree).toBe('sql-v3')
})

test('the model can open a blank tree and a tree beside the current one without switching', async () => {
  const { rt, engine, p } = await project()
  const config = engine.disk.text(configPath())

  // a blank tree: a start event and a fork event, no nodes; recording stays where it was
  const blank = text(await rt.toolCall(p, 'decision_new_tree', { name: 'scratch', empty: true, stay: true, title: 'a blank page' }))
  expect(blank).toBe('Opened tree scratch, started empty: 0 nodes. Still recording in main; /decide tree use scratch switches.')
  expect(treeEvents(engine, 'scratch').map(e => e.op)).toEqual(['start', 'fork'])
  expect(treeEvents(engine, 'scratch').at(-1)).toMatchObject({ op: 'fork', actor: 'model', text: 'a blank page', base: { tree: 'main', at: null, count: 0 } })
  expect(engine.cells.project.tree).toBe('main')
  expect(engine.disk.text(configPath())).toBe(config)

  // the person moves to another tree; the model opens one beside it, copied from main, and the session stays put
  await rt.command(p, 'decide', 'new sql-v3 --at #3')
  const beside = text(await rt.toolCall(p, 'decision_new_tree', { name: 'beside-main', from: 'main', at: '#2', stay: true }))
  expect(beside).toMatch(/^Opened tree beside-main, from main at #2 \(\d\d-\d\d \d\d:\d\d\): 1 node\. Still recording in sql-v3; \/decide tree use beside-main switches\.$/)
  expect(treeEvents(engine, 'beside-main').map(e => e.op)).toEqual(['start', 'add', 'fork'])
  expect(treeEvents(engine, 'beside-main').at(-1)).toMatchObject({ actor: 'model', base: { tree: 'main', count: 2 } })
  expect(engine.cells.project.tree).toBe('sql-v3')
  expect(JSON.parse(engine.disk.text(configPath())).tree).toBe('sql-v3')
  expect(idsOf(engine)).toEqual(['design-v2', 'dbpool'])

  // all four are in the list, the one in use starred
  const list = text(await rt.toolCall(p, 'decision_tree', { trees: true })).split('\n')
  expect(list).toHaveLength(5)
  expect(list[0]).toBe('Trees in this project (recording in sql-v3):')
  expect(list[1]).toBe('  main         3 nodes, 4 events')
  expect(list[2]).toMatch(/^ {2}beside-main {2}from main at #2 \(\d\d-\d\d \d\d:\d\d\) · 1 node, 2 events$/)
  expect(list[3]).toBe('  scratch      started empty · 0 nodes, 1 event · "a blank page"')
  expect(list[4]).toMatch(/^\* sql-v3 {7}from main at #3 \(\d\d-\d\d \d\d:\d\d\) · 2 nodes, 3 events$/)

  // the model moves into the blank tree: the prompt says how it began, and the first decision there is a root
  expect(await rt.toolCall(p, 'decision_use_tree', { name: 'scratch' })).toEqual({ result: 'Recording in tree scratch now.' })
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toContain('Current tree: scratch (started empty). What you record goes into it, and the list below is its.')
  expect(rt.section()?.text).toContain('Nothing is recorded yet: the first decision has parent null.')
  expect(text(await rt.toolCall(p, 'decision_record', { title: 'First thing here', parent: null, status: 'planned' }))).toBe('Recorded first-thing-here (root, Planned)')
  expect(idsOf(engine)).toEqual(['first-thing-here'])
  expect(engine.cells.model.fork).toMatchObject({ tree: 'main', at: null, count: 0, title: 'a blank page' })
})

// ---------------------------------------------------------------- several sessions, one project

test('another session follows when one switches trees, at its next poll, and says so', async () => {
  const a = await project('aaaaaa0000000000')
  const b = await otherSession(a.engine)
  expect(b.engine.cells.project.tree).toBe('main')

  // A opens a tree; the files reach B (a shared folder, a git pull)
  await a.rt.command(a.p, 'decide', 'new sql-v3 --at #3')
  copyDisk(a.engine, b.engine)
  await b.engine.advance(4000)
  expect(b.engine.cells.project.tree).toBe('main') // not before its poll
  expect(b.engine.toasts).toEqual([])
  await b.engine.advance(1000)
  expect(b.engine.cells.project.tree).toBe('sql-v3')
  expect(toastsOf(b.engine)).toEqual([FOLLOWED('sql-v3')])
  expect(idsOf(b.engine)).toEqual(['design-v2', 'dbpool'])
  expect(b.engine.cells.model.fork).toMatchObject({ tree: 'main', count: 3 })
  await b.rt.onTurnStart(b.p)
  expect(b.rt.section()?.text).toContain('Current tree: sql-v3 (from main at #3 (')

  // A made the switch itself and was told by the receipt: its own poll says nothing
  await a.engine.advance(10_000)
  expect(a.engine.toasts).toEqual([])

  // B records there; when B goes back to main, A follows in turn
  expect(await b.rt.command(b.p, 'decide', 'add From B --id from-b --parent dbpool --status planned')).toBe('Recorded from-b (under dbpool, Planned)')
  expect(treeEvents(b.engine, 'sql-v3').at(-1)).toMatchObject({ id: 'from-b', session: 'bbbbbb' })
  expect(mainFiles(b.engine)).toHaveLength(4)
  expect(await b.rt.command(b.p, 'decide', 'use main')).toBe('Recording in tree main now.')
  expect(toastsOf(b.engine)).toEqual([FOLLOWED('sql-v3')]) // B's own switch is not announced to B
  copyDisk(b.engine, a.engine)
  await a.engine.advance(5000)
  expect(a.engine.cells.project.tree).toBe('main')
  expect(toastsOf(a.engine)).toEqual([FOLLOWED('main')])
  expect(idsOf(a.engine)).toEqual(['design-v2', 'dbpool', 'v22'])
  expect(a.engine.cells.model.fork).toBeNull()
})

test('a tool call or a command here follows a switch made elsewhere at once, without waiting for the poll', async () => {
  const a = await project('aaaaaa0000000000')
  const b = await otherSession(a.engine)

  // A opens a tree, and its files reach B between two of B's polls
  await a.rt.command(a.p, 'decide', 'new sql-v3 --at #3')
  copyDisk(a.engine, b.engine)
  expect(b.engine.cells.project.tree).toBe('main')

  // the model here records: into the tree the project is on now, not into the one this session knew a moment ago
  const main = mainFiles(b.engine)
  expect(text(await b.rt.toolCall(b.p, 'decision_record', { id: 'model-one', title: 'Model one', parent: 'design-v2', status: 'planned' }))).toBe('Recorded model-one (under design-v2, Planned)')
  expect(mainFiles(b.engine)).toEqual(main)
  expect(treeEvents(b.engine, 'sql-v3').at(-1)).toMatchObject({ op: 'add', id: 'model-one', session: 'bbbbbb' })
  expect(b.engine.cells.project.tree).toBe('sql-v3')
  expect(toastsOf(b.engine)).toEqual([FOLLOWED('sql-v3')]) // said once, by whatever noticed first

  // A goes back to main; the person here types a command before the poll comes round
  await a.rt.command(a.p, 'decide', 'use main')
  copyDisk(a.engine, b.engine)
  const sql = treeEvents(b.engine, 'sql-v3').length
  expect(await b.rt.command(b.p, 'decide', 'add Typed one --id typed-one --parent v22 --status planned')).toBe('Recorded typed-one (under v22, Planned)')
  expect(treeEvents(b.engine, 'sql-v3')).toHaveLength(sql)
  expect(mainFiles(b.engine)).toHaveLength(main.length + 1)
  expect(b.engine.cells.project.tree).toBe('main')
  expect(toastsOf(b.engine)).toEqual([FOLLOWED('sql-v3'), FOLLOWED('main')])

  // and the model reading: the tree the project is on when it asks
  await a.rt.command(a.p, 'decide', 'use sql-v3')
  copyDisk(a.engine, b.engine)
  const read = text(await b.rt.toolCall(b.p, 'decision_tree', {}))
  expect(read).toMatch(/^Tree: sql-v3 \(/)
  expect(read).toContain('model-one')
  expect(read).not.toContain('typed-one')

  // paused elsewhere: the model's next call is told so at once, and writes nothing
  await a.rt.command(a.p, 'decide', 'pause')
  copyDisk(a.engine, b.engine)
  const before = [...b.engine.disk.files.keys()].sort()
  expect(text(await b.rt.toolCall(b.p, 'decision_note', { id: 'design-v2', text: 'too late' }))).toBe('Not recorded: decision recording is paused (the user can run /decide resume).')
  expect([...b.engine.disk.files.keys()].sort()).toEqual(before)
  expect(b.rt.mode).toBe('paused')
})

test('events another session adds to the tree in use show up at the next poll', async () => {
  const a = await project('aaaaaa0000000000')
  await a.rt.command(a.p, 'decide', 'new sql-v3 --at #3')
  const b = await otherSession(a.engine)
  expect(b.engine.cells.project.tree).toBe('sql-v3')

  // A's clock is a minute ahead of B's; A records, and the file reaches B
  await a.engine.advance(60_000)
  await a.rt.command(a.p, 'decide', 'add From A --id from-a --parent design-v2 --status planned')
  copyDisk(a.engine, b.engine)
  expect(idsOf(b.engine)).toEqual(['design-v2', 'dbpool'])
  await b.engine.advance(5000)
  expect(idsOf(b.engine)).toEqual(['design-v2', 'dbpool', 'from-a'])
  expect(b.engine.toasts).toEqual([]) // the same tree: nothing to announce

  // B answers. Its clock is behind A's, but what it writes sorts after what it has read
  await b.rt.command(b.p, 'decide', 'add From B --id from-b --parent from-a --status planned')
  const names = namesOf(b.engine, 'sql-v3')
  expect(names.at(-2)).toContain('_aaaaaa_')
  expect(names.at(-1)).toContain('_bbbbbb_')
  expect(names.at(-1)! > names.at(-2)!).toBe(true)
  copyDisk(b.engine, a.engine)
  await a.engine.advance(5000)
  expect(idsOf(a.engine)).toEqual(['design-v2', 'dbpool', 'from-a', 'from-b'])
  expect(idsOf(b.engine)).toEqual(idsOf(a.engine))
  expect(a.engine.toasts).toEqual([])

  // something writing to main (a script, a session that has not switched) is not this tree's
  const script = { v: 1, op: 'add', id: 'from-script', ts: '2026-10-10T13:00:00.000Z', session: 'script', actor: 'gate', node: { title: 'From a script', parent: null, status: 'adopted', kind: 'decision' } }
  a.engine.put(`${DIR}/events/20261010T130000000Z_script_0000.json`, JSON.stringify(script))
  await a.engine.advance(5000)
  expect(idsOf(a.engine)).toEqual(['design-v2', 'dbpool', 'from-a', 'from-b'])
  expect(a.engine.toasts).toEqual([])
  // it is in main, for whoever goes there
  expect(await a.rt.command(a.p, 'decide', 'use main')).toBe('Recording in tree main now.')
  expect(idsOf(a.engine)).toEqual(['design-v2', 'dbpool', 'v22', 'from-script'])
})

test('config.json naming a tree that is not here (yet): stay put, say so once, switch when it arrives', async () => {
  const a = await project('aaaaaa0000000000')
  // on another machine somebody opens sql-v3; config.json reaches this one before the tree's events do
  const far = await otherSession(a.engine, 'ffffff2222222222')
  await far.rt.command(far.p, 'decide', 'new sql-v3 --at #3')
  bring(far.engine, a.engine, path => path === configPath())

  await a.engine.advance(5000)
  expect(a.engine.cells.project).toMatchObject({ mode: 'recording', tree: 'main', config: { tree: 'sql-v3' } })
  expect(toastsOf(a.engine)).toEqual([STAYED('sql-v3')])
  expect(toastsOf(a.engine)[0]).toContain(FELL_BACK)

  // every poll looks again and says nothing new; recording goes on in the tree it is in
  await a.engine.advance(15_000)
  expect(toastsOf(a.engine)).toEqual([STAYED('sql-v3')])
  expect(await a.rt.command(a.p, 'decide', 'add Meanwhile --id meanwhile --parent v22 --status planned')).toBe('Recorded meanwhile (under v22, Planned)')
  expect(mainFiles(a.engine)).toHaveLength(5)

  // the tree's events arrive: the next poll switches, and says that the project did
  bring(far.engine, a.engine, path => path.startsWith(`${DIR}/trees/sql-v3/`))
  await a.engine.advance(5000)
  expect(a.engine.cells.project.tree).toBe('sql-v3')
  expect(toastsOf(a.engine)).toEqual([STAYED('sql-v3'), FOLLOWED('sql-v3')])
  expect(idsOf(a.engine)).toEqual(['design-v2', 'dbpool']) // the tree as it was opened, without what was recorded in main meanwhile

  // from then on it records there, and further polls have nothing to say
  await a.rt.command(a.p, 'decide', 'add Arrived --id arrived --parent dbpool --status planned')
  expect(treeEvents(a.engine, 'sql-v3').at(-1)).toMatchObject({ op: 'add', id: 'arrived' })
  expect(mainFiles(a.engine)).toHaveLength(5)
  await a.engine.advance(10_000)
  expect(toastsOf(a.engine)).toHaveLength(2)
})

test('a tree that is only half there (events but no fork event yet) is not switched to', async () => {
  const a = await project('aaaaaa0000000000')
  const far = await otherSession(a.engine, 'ffffff2222222222')
  await far.rt.command(far.p, 'decide', 'new sql-v3 --at #3')
  const names = namesOf(far.engine, 'sql-v3')
  expect(names).toHaveLength(4)
  // the fork event is written last, so it sorts last
  const fork = `${DIR}/trees/sql-v3/events/${names.at(-1)}`
  expect(JSON.parse(far.engine.disk.text(fork)).op).toBe('fork')

  // config.json and the copied events have arrived; the fork event has not
  bring(far.engine, a.engine, path => path === configPath() || (path.startsWith(`${DIR}/trees/sql-v3/events/`) && path !== fork))
  await a.engine.advance(5000)
  expect(a.engine.cells.project).toMatchObject({ tree: 'main', config: { tree: 'sql-v3' } })
  expect(toastsOf(a.engine)).toEqual([STAYED('sql-v3')])

  // the folder is there but it is not a tree yet: the list says so, and so does /decide use
  expect((await a.rt.command(a.p, 'decide', 'tree')).split('\n').at(-1)).toBe('  sql-v3  unfinished copy (no fork event yet)')
  expect(await a.rt.command(a.p, 'decide', 'use sql-v3')).toBe('there is no tree named sql-v3; /decide tree lists them')

  // a session that starts now stays on main as well, and says why
  const late = await otherSession(a.engine, 'cccccc3333333333')
  expect(late.engine.cells.project.tree).toBe('main')
  expect(toastsOf(late.engine)).toEqual([STAYED('sql-v3')])

  // polls go by: nothing new is said, nothing is switched
  await a.engine.advance(15_000)
  await late.engine.advance(15_000)
  expect(toastsOf(a.engine)).toEqual([STAYED('sql-v3')])
  expect(toastsOf(late.engine)).toEqual([STAYED('sql-v3')])
  expect(a.engine.cells.project.tree).toBe('main')
  expect(late.engine.cells.project.tree).toBe('main')

  // the fork event arrives: now it is a tree, and both follow
  bring(far.engine, a.engine, path => path === fork)
  bring(far.engine, late.engine, path => path === fork)
  await a.engine.advance(5000)
  await late.engine.advance(5000)
  for (const session of [a, late]) {
    expect(session.engine.cells.project.tree).toBe('sql-v3')
    expect(toastsOf(session.engine)).toEqual([STAYED('sql-v3'), FOLLOWED('sql-v3')])
    expect(idsOf(session.engine)).toEqual(['design-v2', 'dbpool'])
  }
})

// ---------------------------------------------------------------- language

test('in Chinese: the receipts, the list and the log', async () => {
  const { rt, engine, p } = await project()
  expect(await rt.command(p, 'decide', 'lang zh')).toBe('语言已设为 zh')
  const WHEN = '\\d\\d-\\d\\d \\d\\d:\\d\\d'

  expect(await rt.command(p, 'decide', 'new sql-v3 --at #3 --title SQL 第三版')).toMatch(new RegExp(`^已新开 tree「sql-v3」，基于 main 的 #3（${WHEN}）：2 个节点。现在记录到这里。$`))
  expect(await rt.command(p, 'decide', 'new later --stay')).toMatch(new RegExp(`^已新开 tree「later」，基于 sql-v3 的 #3（${WHEN}）：2 个节点。仍在记录到「sql-v3」；/decide tree use later 可以切换。$`))
  expect(await rt.command(p, 'decide', 'use main')).toBe('现在记录到 tree「main」。')
  expect(await rt.command(p, 'decide', 'use main')).toBe('已经在记录到 tree「main」。')

  // the list: counts and origins in Chinese, the title as it was written
  const list = (await rt.command(p, 'decide', 'tree')).split('\n')
  expect(list).toHaveLength(4)
  expect(list[0]).toBe('这个项目的 tree（正在记录到「main」）：')
  expect(list[1]).toBe('* main    3 个节点，4 个事件')
  expect(list[2]).toMatch(new RegExp(`^ {2}later {3}基于 sql-v3 的 #3（${WHEN}） · 2 个节点，3 个事件$`))
  expect(list[3]).toMatch(new RegExp(`^ {2}sql-v3 {2}基于 main 的 #3（${WHEN}） · 2 个节点，3 个事件 · "SQL 第三版"$`))

  // the log: a Chinese header, and event lines that read the same in both languages
  const log = (await rt.command(p, 'decide', 'log 2')).split('\n')
  expect(log).toHaveLength(3)
  expect(log[0]).toBe('Tree「main」：共 4 个事件，最近 2 个（--at 里写 #N）：')
  expect(log[1]).toMatch(new RegExp(`^#3  ${WHEN}  user    add dbpool "Shared sockets"$`))
  expect(log[2]).toMatch(new RegExp(`^#4  ${WHEN}  user    add v22 "Build v2.2"$`))
  await rt.command(p, 'decide', 'use sql-v3')
  const own = (await rt.command(p, 'decide', 'log')).split('\n')
  expect(own).toHaveLength(5)
  expect(own[0]).toBe('Tree「sql-v3」：共 3 个事件（--at 里写 #N）：')
  expect(own[1]).toMatch(new RegExp(`^开出时基于 main 的 #3（${WHEN}）$`))
  expect(own[2]).toMatch(new RegExp(`^#1  ${WHEN}  user    start$`))

  // what is wrong is said in Chinese too
  expect(await rt.command(p, 'decide', 'new x')).toBe('"x" 不能做 tree 名：用 2–32 个字母、数字或连字符（中文或更长的名字放进 --title）')
  expect(await rt.command(p, 'decide', 'new main')).toBe('"main" 是项目的第一棵 tree，请换个名字')
  expect(await rt.command(p, 'decide', 'new later')).toBe('tree「later」已经存在；换个名字，或用 /decide tree use later 切过去')
  expect(await rt.command(p, 'decide', 'use nowhere')).toBe('没有叫「nowhere」的 tree；/decide tree 可以列出所有 tree')
  expect(await rt.command(p, 'decide', 'new next-try --at #99')).toBe('没有 #99 这个版本：「sql-v3」一共 3 个事件（#1 到 #3）')
  expect(await rt.command(p, 'decide', 'use')).toMatch(/^缺少 tree 名。用法：\/decide start \[标题\]/)

  // the model reads English in the same project
  expect(text(await rt.toolCall(p, 'decision_tree', { trees: true })).split('\n')[0]).toBe('Trees in this project (recording in sql-v3):')
  expect(text(await rt.toolCall(p, 'decision_tree', { log: 1 })).split('\n')[0]).toBe('Tree sql-v3: 3 events; the last 1 (use #N as --at):')
  expect(text(await rt.toolCall(p, 'decision_new_tree', { name: 'later' }))).toBe('DENY: tree later already exists; pick another name, or switch to it with /decide tree use later')
  expect(engine.cells.lang).toBe('zh')
})

test('the toast for following another session is in the language of the project', async () => {
  const a = await project('aaaaaa0000000000')
  expect(await a.rt.command(a.p, 'decide', 'lang zh')).toBe('语言已设为 zh')
  // the other session never set a language of its own: config.json, which is the project's, says Chinese
  const b = await otherSession(a.engine)
  expect(b.rt.lang).toBe('zh')

  await a.rt.command(a.p, 'decide', 'new sql-v3 --at #3')
  copyDisk(a.engine, b.engine)
  await b.engine.advance(5000)
  expect(b.engine.cells.project.tree).toBe('sql-v3')
  expect(toastsOf(b.engine)).toEqual(['现在记录到 tree「sql-v3」（项目已切换到它）。'])

  // the toast for a tree that has not arrived is in Chinese too
  const config = JSON.parse(b.engine.disk.text(configPath()))
  b.engine.put(configPath(), `${JSON.stringify({ ...config, tree: 'later-one' }, null, 2)}\n`)
  await b.engine.advance(5000)
  expect(toastsOf(b.engine)).toEqual(['现在记录到 tree「sql-v3」（项目已切换到它）。', 'config.json 指向 tree「later-one」，但这个项目里还没有它；暂时留在「sql-v3」。'])

  // the project's language, not the person's: an English project stays English for someone writing Chinese
  const en = await project('eeeeee4444444444')
  expect(await en.rt.command(en.p, 'decide', 'lang en')).toBe('Language set to en')
  const reader = await otherSession(en.engine, 'dddddd5555555555')
  await reader.rt.onPrompt(reader.p, '你好，接着上次的工作')
  expect(reader.rt.lang).toBe('en')
  await en.rt.command(en.p, 'decide', 'new sql-v3 --at #3')
  copyDisk(en.engine, reader.engine)
  await reader.engine.advance(5000)
  expect(toastsOf(reader.engine)).toEqual([FOLLOWED('sql-v3')])
})
