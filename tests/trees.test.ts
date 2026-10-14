import { test, expect } from 'claude-code/testing'

import type { DtActor, DtLang, DtStatus } from '../types'
import { defaultConfig, parseConfig, serializeConfig } from '../lib/config'
import { isTreeName, stampMs, treeNameOf } from '../lib/events'
import { Journal } from '../lib/journal'
import { newTree, noteNode, recordNode, retractNode, startRecord, treeList, treeLog, updateNode, useTree } from '../lib/ops'
import type { Ctx, Done, NewTreeInput } from '../lib/ops'
import { MemDisk } from './mem'

const ROOT = '/work/proj'
const DIR = `${ROOT}/.claude/decisions`
const CONFIG = `${DIR}/config.json`
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)
const MIN = 60_000
const p2 = (n: number) => String(n).padStart(2, '0')

// ---------------------------------------------------------------- what the tests stand on

type Options = { session?: string; lang?: DtLang; actor?: DtActor; disk?: MemDisk }

/** A disk, a journal and a way to make a `Ctx` over any journal; every look at the clock is a minute later than the last. */
function setup({ session = 'aaaaaa', lang = 'en', actor = 'model', disk = new MemDisk() }: Options = {}) {
  let clock = T0
  const make = (journal: Journal, a: DtActor = actor, l: DtLang = lang): Ctx => ({ journal, lang: l, actor: a, now: () => (clock += MIN) })
  const journal = new Journal(disk, ROOT, session)
  return { disk, journal, ctx: make(journal), make }
}

function expectOk(d: Done): string {
  if (!d.ok) throw new Error(`expected ok, got error: ${d.error}`)
  return d.text
}
function expectError(d: Done): string {
  if (d.ok) throw new Error(`expected an error, got: ${d.text}`)
  return d.error
}

const MAINLINE: [id: string, title: string, parent: string | null, status: DtStatus][] = [
  ['notes-app', 'notes app 立项', null, 'adopted'],
  ['sqlite-adopted', '存储层采用', 'notes-app', 'adopted'],
  ['merge-adopted', '合并规则定为 v1.2', 'notes-app', 'adopted'],
  ['merge-rerun', '合并规则 v1.2 重跑', 'merge-adopted', 'adopted'],
  ['sql-next', '下一步做 sql', 'merge-adopted', 'planned'],
]
const IDS = MAINLINE.map(([id]) => id)

/** A project of six events, a minute apart: #1 the start (12:01 UTC) and #2 to #6 the five decisions of MAINLINE. */
async function project(options: Options = {}) {
  const s = setup(options)
  expectOk(await startRecord(s.ctx, { title: 'orders' }))
  for (const [id, title, parent, status] of MAINLINE) expectOk(await recordNode(s.ctx, { id, title, parent, status }))
  return s
}

/** The folder a tree keeps its event files in. */
const eventsDirOf = (tree: string) => (tree === 'main' ? `${DIR}/events` : `${DIR}/trees/${tree}/events`)

/** The event files of one tree on the disk, [file name, text], in file-name order. */
function filesOf(disk: MemDisk, tree: string): [string, string][] {
  const prefix = `${eventsDirOf(tree)}/`
  return [...disk.files]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, f]): [string, string] => [path.slice(prefix.length), f.text])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}
const namesOf = (disk: MemDisk, tree: string): string[] => filesOf(disk, tree).map(([name]) => name)
const opsOf = (disk: MemDisk, tree: string): string[] => filesOf(disk, tree).map(([, text]) => JSON.parse(text).op as string)

/** A fresh journal over one tree: what another session reads from the files. */
async function reopen(disk: MemDisk, tree = 'main'): Promise<Journal> {
  const j = new Journal(disk, ROOT, 'zzzzzz', tree)
  await j.sync()
  return j
}

/** A date and time as the person would type it for this instant (the machine's own zone). */
function local(ms: number, parts: 'date' | 'minute' | 'second' = 'minute'): string {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  if (parts === 'date') return date
  const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  return parts === 'minute' ? `${date} ${clock}` : `${date} ${clock}:${p2(d.getSeconds())}`
}
/** `MM-DD HH:MM`: how the receipts and the log show a time. */
const when = (ms: number): string => local(ms).slice(5)
/** The same for the instant an event file's name is stamped with. */
const whenOfFile = (name: string): string => when(stampMs(name)!)

// ---------------------------------------------------------------- names

test('tree names: used as they are, or made into one when only punctuation and capitals have to change', async () => {
  // a name that already is one stays as it is
  for (const name of ['side-b', 'v2', 'main-2', '2026-10-08', 'a'.repeat(32)]) {
    expect(treeNameOf(name)).toEqual({ name })
    expect(isTreeName(name)).toBe(true)
  }
  // capitals, spaces and punctuation become single hyphens, and none is left at an end
  expect(treeNameOf('Side B')).toEqual({ name: 'side-b' })
  expect(treeNameOf('  Local Storage!  ')).toEqual({ name: 'local-storage' })
  expect(treeNameOf('try #2: no-diff?')).toEqual({ name: 'try-2-no-diff' })
  expect(treeNameOf('v1.2_rerun')).toEqual({ name: 'v1-2-rerun' })
  expect(treeNameOf('--lead and trail--')).toEqual({ name: 'lead-and-trail' })
  // a long one is cut at 32 characters, and not in the middle of a hyphen
  expect(treeNameOf('local storage with the new editor final')).toEqual({ name: 'local-storage-with-the-new-edito' })
  expect(treeNameOf(`${'x'.repeat(31)} tail`)).toEqual({ name: 'x'.repeat(31) })
  expect(isTreeName('Side B')).toBe(false)

  // what cannot be a name says why
  expect(treeNameOf('')).toEqual({ error: 'empty' })
  expect(treeNameOf('   ')).toEqual({ error: 'empty' })
  expect(treeNameOf('main')).toEqual({ error: 'main' })
  expect(treeNameOf(' Main! ')).toEqual({ error: 'main' })
  // other scripts are not turned into something else behind the person's back: that is what --title is for
  expect(treeNameOf('第三版')).toEqual({ error: 'invalid' })
  expect(treeNameOf('sql 第三版')).toEqual({ error: 'invalid' })
  expect(treeNameOf('v')).toEqual({ error: 'invalid' })
  expect(treeNameOf('!!!')).toEqual({ error: 'invalid' })

  // a tree opened as `Side B` is the tree `side-b`
  const { disk, ctx } = await project()
  const r = await newTree(ctx, { name: 'Side B' })
  expect(expectOk(r)).toContain('Opened tree side-b, from main at #6')
  expect(r.ok ? r.id : undefined).toBe('side-b')
  expect(namesOf(disk, 'side-b')).toHaveLength(7)
})

// ---------------------------------------------------------------- opening a tree

test('new tree: a long --title is cut at a character, and what cannot be shown on one line is not kept', async () => {
  const pair = '\u{1F600}' // one character, two UTF-16 units
  const forkOf = (disk: MemDisk, tree: string) => JSON.parse(filesOf(disk, tree).at(-1)![1]) as { op: string; text?: string }
  const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

  const a = await project()
  expectOk(await newTree(a.ctx, { name: 'cut-a', title: `${'x'.repeat(119)}${pair}tail` }))
  expect(forkOf(a.disk, 'cut-a')).toMatchObject({ op: 'fork', text: `${'x'.repeat(119)}${pair}` })
  expect(lone.test(forkOf(a.disk, 'cut-a').text!)).toBe(false)

  const b = await project()
  expectOk(await newTree(b.ctx, { name: 'cut-b', title: `${'x'.repeat(120)}${pair}` }))
  expect(forkOf(b.disk, 'cut-b').text).toBe('x'.repeat(120))

  // the line breaks and control characters of a pasted label go before the cut, and a label with nothing left has no text at all
  const c = await project()
  expectOk(await newTree(c.ctx, { name: 'cut-c', title: '另一条\n路线\u0007 再试' }))
  expect(forkOf(c.disk, 'cut-c').text).toBe('另一条 路线 再试')
  const d = await project()
  expectOk(await newTree(d.ctx, { name: 'cut-d', title: ' \n\u0007 ' }))
  expect('text' in forkOf(d.disk, 'cut-d')).toBe(false)

  // and the tree reads it back whole
  expect((await reopen(a.disk, 'cut-a')).model().fork?.title).toBe(`${'x'.repeat(119)}${pair}`)
})

test('new tree: a copy of everything so far, then a fork event; the original does not change', async () => {
  const { disk, ctx } = await project()
  const main = filesOf(disk, 'main')
  expect(main).toHaveLength(6)
  const configBefore = JSON.parse(disk.text(CONFIG))
  const writes = disk.writes.length

  const r = await newTree(ctx, { name: 'side-b' })
  expect(expectOk(r)).toBe(`Opened tree side-b, from main at #6 (${when(T0 + 6 * MIN)}): 5 nodes. Recording there now.`)
  expect(r.ok ? r.id : undefined).toBe('side-b')

  // the six files, byte for byte under the same names, and the fork event after them
  const copy = filesOf(disk, 'side-b')
  expect(copy).toHaveLength(7)
  expect(copy.slice(0, 6)).toEqual(main)
  expect(copy[6]![0] > main[5]![0]).toBe(true)
  const fork = JSON.parse(copy[6]![1])
  expect(fork).toMatchObject({ v: 1, op: 'fork', session: 'aaaaaa', actor: 'model', base: { tree: 'main', at: main[5]![0], count: 6 } })
  expect('text' in fork).toBe(false)

  // the new tree replays to the same decisions and knows where it began
  const m = (await reopen(disk, 'side-b')).model()
  expect(m.nodes.map(n => n.id)).toEqual(IDS)
  expect(m.isStarted).toBe(true)
  expect(m.fork).toMatchObject({ tree: 'main', at: main[5]![0], count: 6, actor: 'model' })
  expect([m.eventCount, m.warningCount]).toEqual([7, 0])
  const snapshot = JSON.parse(disk.text(`${DIR}/trees/side-b/tree.json`))
  expect(snapshot).toMatchObject({ project: 'orders', tree: 'side-b', fork: { tree: 'main', count: 6 } })
  expect(snapshot.nodes).toHaveLength(5)

  // main: the same files, nothing written to its folder, and still no fork of its own
  expect(filesOf(disk, 'main')).toEqual(main)
  expect(disk.writes.slice(writes).filter(path => path.startsWith(`${DIR}/events/`))).toEqual([])
  expect((await reopen(disk, 'main')).model().fork).toBeNull()
  // only config.json moved, and only by naming the new tree
  expect(JSON.parse(disk.text(CONFIG))).toEqual({ ...configBefore, tree: 'side-b' })
})

test('new tree: what is recorded afterwards goes only to the tree it is recorded in', async () => {
  const { disk, journal, ctx, make } = await project()
  expectOk(await newTree(ctx, { name: 'side-b', at: '#4' }))
  const mainFiles = filesOf(disk, 'main')
  const copied = namesOf(disk, 'side-b')
  expect(copied).toHaveLength(5) // four events and the fork event

  // a session that follows config.json records into the new tree
  const inSql = make(journal.sibling('side-b'))
  expectOk(await recordNode(inSql, { id: 'sql-first', title: 'SQL first try', parent: 'notes-app', status: 'planned' }))
  expectOk(await updateNode(inSql, { id: 'sqlite-adopted', status: 'rejected' }))
  expectOk(await noteNode(inSql, { id: 'sql-first', text: 'run it twice' }))
  expect(filesOf(disk, 'main')).toEqual(mainFiles)
  const own = namesOf(disk, 'side-b')
  expect(own).toHaveLength(8)
  expect(own.slice(0, 5)).toEqual(copied) // what came after sorts after the fork event
  expect(opsOf(disk, 'side-b').slice(4)).toEqual(['fork', 'add', 'update', 'note'])

  const sql = (await reopen(disk, 'side-b')).model()
  expect(sql.nodes.map(n => n.id)).toEqual(['notes-app', 'sqlite-adopted', 'merge-adopted', 'sql-first'])
  expect(sql.nodes.find(n => n.id === 'sqlite-adopted')!.status).toBe('rejected')
  expect(sql.nodes.find(n => n.id === 'sql-first')!.notes.map(n => n.text)).toEqual(['run it twice'])
  // main did not hear of any of it
  const mainBefore = (await reopen(disk, 'main')).model()
  expect(mainBefore.nodes.map(n => n.id)).toEqual(IDS)
  expect(mainBefore.nodes.find(n => n.id === 'sqlite-adopted')!.status).toBe('adopted')

  // and the other way round: a session that is on main records into main, and the new tree does not hear of it
  const next = await recordNode(ctx, { id: 'sql-first', title: 'Main has its own', parent: 'sql-next', status: 'planned' })
  expect(next.ok ? next.id : undefined).toBe('sql-first') // ids are per tree: the same one is free in main
  expect(namesOf(disk, 'main')).toHaveLength(7)
  expect(namesOf(disk, 'side-b')).toEqual(own)
  const mainNow = (await reopen(disk, 'main')).model()
  const sqlNow = (await reopen(disk, 'side-b')).model()
  expect(mainNow.nodes.find(n => n.id === 'sql-first')!.title).toBe('Main has its own')
  expect(sqlNow.nodes.find(n => n.id === 'sql-first')!.title).toBe('SQL first try')
  expect(sqlNow.nodes).toHaveLength(4)
})

test('new tree: --at #N copies the first N events', async () => {
  const { disk, ctx } = await project()
  const main = filesOf(disk, 'main')

  const r = await newTree(ctx, { name: 'early', at: '#3' })
  expect(expectOk(r)).toBe(`Opened tree early, from main at #3 (${when(T0 + 3 * MIN)}): 2 nodes. Recording there now.`)
  const early = filesOf(disk, 'early')
  expect(early).toHaveLength(4)
  expect(early.slice(0, 3)).toEqual(main.slice(0, 3))
  expect(JSON.parse(early[3]![1]).base).toEqual({ tree: 'main', at: main[2]![0], count: 3 })
  const m = (await reopen(disk, 'early')).model()
  expect(m.nodes.map(n => n.id)).toEqual(['notes-app', 'sqlite-adopted'])
  expect(m.fork).toMatchObject({ tree: 'main', count: 3 })
  // the events after #3 stayed behind
  for (const [name] of main.slice(3)) expect(early.some(([n]) => n === name)).toBe(false)

  // the first event alone is a start with nothing on it; a space after the # does not matter
  const first = await newTree(ctx, { name: 'just-start', at: '#1' })
  expect(expectOk(first)).toBe(`Opened tree just-start, from main at #1 (${when(T0 + MIN)}): 0 nodes. Recording there now.`)
  expect(opsOf(disk, 'just-start')).toEqual(['start', 'fork'])
  // the last one is everything, and so are "current" and its synonyms
  for (const [name, at] of [['via-number', '# 6'], ['via-current', 'current'], ['via-chinese', '当前'], ['via-nothing', '']] as const) {
    expect(expectOk(await newTree(ctx, { name, at }))).toContain('from main at #6')
    expect(filesOf(disk, name).slice(0, 6)).toEqual(main)
  }
})

test('new tree: --at a node is the tree as it was when that node was recorded', async () => {
  const { disk, ctx } = await project()
  // main moves on: a summary on an early node (#7) and a late node (#8)
  expectOk(await updateNode(ctx, { id: 'notes-app', summary: 'written after sql-next' }))
  expectOk(await recordNode(ctx, { id: 'late-node', title: 'A late decision', parent: null, status: 'planned' }))

  // by id: the tree right after that node's add, so the summary of #7 is not in it
  const r = await newTree(ctx, { name: 'at-sql-next', at: 'sql-next' })
  expect(expectOk(r)).toBe(`Opened tree at-sql-next, from main at #6 (${when(T0 + 6 * MIN)}): 5 nodes. Recording there now.`)
  const before = (await reopen(disk, 'at-sql-next')).model()
  expect(before.nodes.map(n => n.id)).toEqual(IDS)
  expect(before.nodes[0]!.summary).toBeUndefined()

  // the later node has it
  expect(expectOk(await newTree(ctx, { name: 'at-late-node', at: 'late-node' }))).toContain('from main at #8')
  const after = (await reopen(disk, 'at-late-node')).model()
  expect(after.nodes.map(n => n.id)).toEqual([...IDS, 'late-node'])
  expect(after.nodes[0]!.summary).toBe('written after sql-next')

  // `node:` says it is a node; a piece of its title will do, in any script; the id may be in any case
  const ways = [
    ['with-prefix', 'node:merge-adopted', 4],
    ['with-title', '存储层', 3],
    ['with-more-title', '立项', 2],
    ['with-last-bit', '重跑', 5],
    ['with-capitals', 'MERGE-ADOPTED', 4],
  ] as const
  for (const [name, spec, count] of ways) {
    const done = expectOk(await newTree(ctx, { name, at: spec }))
    expect(done).toContain(`from main at #${count} (${when(T0 + count * MIN)})`)
    expect(filesOf(disk, name)).toHaveLength(count + 1)
    expect(filesOf(disk, name).slice(0, count)).toEqual(filesOf(disk, 'main').slice(0, count))
  }
})

test('new tree: --at a time is the tree as it was by then', async () => {
  const { disk, ctx } = await project() // events at 12:01, 12:02 ... 12:06 UTC
  const main = filesOf(disk, 'main')
  const nodesAt = async (name: string, at: string): Promise<number> => {
    const done = expectOk(await newTree(ctx, { name, at }))
    return Number(/ (\d+) nodes?\./.exec(done)![1])
  }

  // a time with a minute in it is the end of that minute
  const r = await newTree(ctx, { name: 'by-then', at: local(T0 + 3 * MIN) })
  expect(expectOk(r)).toBe(`Opened tree by-then, from main at #3 (${when(T0 + 3 * MIN)}): 2 nodes. Recording there now.`)
  expect(filesOf(disk, 'by-then').slice(0, 3)).toEqual(main.slice(0, 3))
  expect(opsOf(disk, 'by-then')).toEqual(['start', 'add', 'add', 'fork'])
  expect((await reopen(disk, 'by-then')).model().fork).toMatchObject({ tree: 'main', count: 3, at: main[2]![0] })

  // with seconds, the end of that second: half way through minute 4 is still the tree of #4, a second before #5 too
  expect(await nodesAt('half-way', local(T0 + 4 * MIN + 30_000, 'second'))).toBe(3)
  expect(await nodesAt('just-before', local(T0 + 5 * MIN - 1000, 'second'))).toBe(3)
  expect(namesOf(disk, 'just-before')).toHaveLength(5)
  // the same instant with a zone, whatever the machine's own
  expect(await nodesAt('with-zone', '2026-10-10T12:02:00Z')).toBe(1)
  expect(await nodesAt('with-offset', '2026-10-10T08:05:00-04:00')).toBe(4)
  // a whole day is everything recorded in it
  expect(await nodesAt('that-day', local(T0 + 2 * MIN, 'date'))).toBe(5)
  // later than anything recorded is the current tree
  expect(await nodesAt('long-after', local(T0 + 600 * MIN))).toBe(5)
  expect(filesOf(disk, 'long-after').slice(0, 6)).toEqual(main)
})

test('new tree: --empty has a start event and a fork event, and no nodes', async () => {
  const { disk, ctx } = await project()
  const r = await newTree(ctx, { name: 'blank', empty: true, title: ' A fresh\n start ' })
  expect(expectOk(r)).toBe('Opened tree blank, started empty: 0 nodes. Recording there now.')
  expect(r.ok ? r.id : undefined).toBe('blank')

  const files = filesOf(disk, 'blank')
  expect(files.map(([, text]) => JSON.parse(text).op)).toEqual(['start', 'fork'])
  expect(JSON.parse(files[0]![1])).toMatchObject({ v: 1, op: 'start', session: 'aaaaaa', actor: 'model' })
  // the title is one line of text on the fork event; nothing came from main
  expect(JSON.parse(files[1]![1])).toMatchObject({ op: 'fork', text: 'A fresh start', base: { tree: 'main', at: null, count: 0 } })
  const mainNames = namesOf(disk, 'main')
  expect(files.some(([name]) => mainNames.includes(name))).toBe(false)

  const m = (await reopen(disk, 'blank')).model()
  expect(m.isStarted).toBe(true)
  expect(m.nodes).toEqual([])
  expect(m.fork).toMatchObject({ tree: 'main', at: null, count: 0, title: 'A fresh start', actor: 'model' })
  expect(m.warningCount).toBe(0)
  expect(JSON.parse(disk.text(`${DIR}/trees/blank/tree.json`))).toMatchObject({ tree: 'blank', nodes: [] })
  // and recording goes there now
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('blank')
})

test('new tree: --stay opens it and leaves recording where it was', async () => {
  const { disk, journal, ctx, make } = await project()
  const configBefore = disk.text(CONFIG)

  const r = await newTree(ctx, { name: 'later', stay: true })
  expect(expectOk(r)).toBe(
    `Opened tree later, from main at #6 (${when(T0 + 6 * MIN)}): 5 nodes. Still recording in main; /decide tree use later switches.`,
  )
  expect(r.ok ? r.id : undefined).toBe('later')
  expect(disk.text(CONFIG)).toBe(configBefore) // not a byte of it
  expect(JSON.parse(disk.text(CONFIG))).not.toHaveProperty('tree')
  expect(namesOf(disk, 'later')).toHaveLength(7)
  expect((await reopen(disk, 'later')).model().fork).toMatchObject({ tree: 'main', count: 6 })

  // switching is a separate step
  expect(expectOk(await useTree(ctx, 'later'))).toBe('Recording in tree later now.')
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('later')

  // "where it was" is the tree the session is in: from there, the copy is of that tree and the pointer stays on it
  const inLater = make(journal.sibling('later'))
  const again = expectOk(await newTree(inLater, { name: 'another', stay: true }))
  expect(again).toBe(
    `Opened tree another, from later at #6 (${when(T0 + 6 * MIN)}): 5 nodes. Still recording in later; /decide tree use another switches.`,
  )
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('later')
})

test('new tree: from another tree, and a fork of a fork carries one fork event, its own', async () => {
  const { disk, journal, ctx, make } = await project()
  expectOk(await newTree(ctx, { name: 'side-b', at: '#4', stay: true }))
  const inSql = make(journal.sibling('side-b'))
  expectOk(await recordNode(inSql, { id: 'sql-first', title: 'SQL first try', parent: 'notes-app', status: 'planned' }))
  expectOk(await recordNode(inSql, { id: 'sql-second', title: 'SQL second try', parent: 'sql-first', status: 'proposed' }))
  // side-b: the four events it copied, its own fork event among them, then two of its own
  const sql = filesOf(disk, 'side-b')
  expect(opsOf(disk, 'side-b')).toEqual(['start', 'add', 'add', 'add', 'fork', 'add', 'add'])
  const sqlEvents = sql.filter((_, i) => i !== 4)

  // opened from the session that is on main, naming the tree to copy
  const r = await newTree(ctx, { name: 'deeper', from: ' Side-B ' })
  expect(expectOk(r)).toBe(`Opened tree deeper, from side-b at #6 (${whenOfFile(sql[6]![0])}): 5 nodes. Recording there now.`)
  const deeper = filesOf(disk, 'deeper')
  expect(opsOf(disk, 'deeper')).toEqual(['start', 'add', 'add', 'add', 'add', 'add', 'fork']) // one fork event, and it is the last
  expect(deeper.slice(0, 6)).toEqual(sqlEvents) // side-b's own fork event is left out
  expect(deeper.some(([name]) => name === sql[4]![0])).toBe(false)
  expect(JSON.parse(deeper[6]![1]).base).toEqual({ tree: 'side-b', at: sql[6]![0], count: 6 })
  const m = (await reopen(disk, 'deeper')).model()
  expect(m.fork).toMatchObject({ tree: 'side-b', at: sql[6]![0], count: 6 })
  expect(m.nodes.map(n => n.id)).toEqual(['notes-app', 'sqlite-adopted', 'merge-adopted', 'sql-first', 'sql-second'])
  expect(m.warningCount).toBe(0)

  // #N counts events, not the fork marker that sits among them: #5 is the four copied and sql-first
  expectOk(await newTree(ctx, { name: 'shallower', from: 'side-b', at: '#5' }))
  expect(namesOf(disk, 'shallower').slice(0, 5)).toEqual(sqlEvents.slice(0, 5).map(([name]) => name))
  expect(opsOf(disk, 'shallower')).toEqual(['start', 'add', 'add', 'add', 'add', 'fork'])
  expect(JSON.parse(filesOf(disk, 'shallower')[5]![1]).base).toEqual({ tree: 'side-b', at: sql[5]![0], count: 5 })

  // without --from it is the tree the session is in, and from inside a tree main can be named too
  expect(expectOk(await newTree(inSql, { name: 'in-use', stay: true }))).toContain('from side-b at #6')
  const back = await newTree(inSql, { name: 'from-main', from: 'main', at: '#2', stay: true })
  expect(expectOk(back)).toBe(
    `Opened tree from-main, from main at #2 (${when(T0 + 2 * MIN)}): 1 node. Still recording in side-b; /decide tree use from-main switches.`,
  )
  expect(opsOf(disk, 'from-main')).toEqual(['start', 'add', 'fork'])
})

test('new tree: bad names, taken names, unknown bases, bad versions', async () => {
  const { disk, ctx } = await project()
  expectOk(await newTree(ctx, { name: 'taken', stay: true }))
  expectOk(await newTree(ctx, { name: 'blank', empty: true, stay: true }))
  const files = () => [...disk.files].map(([path, f]) => [path, f.text])
  const snapshot = files()
  const writes = disk.writes.length
  const refused = async (input: NewTreeInput) => expectError(await newTree(ctx, input))

  // names
  expect(await refused({ name: '' })).toBe('a tree needs a name (letters, digits and hyphens, 2-32 characters, e.g. crdt-engine)')
  expect(await refused({ name: 'Main' })).toBe('"main" is the first tree of the project; pick another name')
  expect(await refused({ name: ' 第三版 ' })).toBe(
    '"第三版" cannot be a tree name: use 2-32 letters, digits and hyphens (a longer or Chinese name goes in --title)',
  )
  expect(await refused({ name: 'x' })).toContain('"x" cannot be a tree name')
  // a name that is taken, however it is written
  expect(await refused({ name: 'taken' })).toBe('tree taken already exists; pick another name, or switch to it with /decide tree use taken')
  expect(await refused({ name: 'Taken!' })).toContain('tree taken already exists')
  // a tree to copy that is not there
  expect(await refused({ name: 'new-one', from: 'nope' })).toBe('there is no tree named nope; /decide tree lists them')
  expect(await refused({ name: 'new-one', from: 'No Such Tree' })).toBe('there is no tree named no such tree; /decide tree lists them')
  // a version that is not there
  expect(await refused({ name: 'new-one', at: '#0' })).toBe('there is no version #0: main has 6 events (#1 to #6)')
  expect(await refused({ name: 'new-one', at: '#9' })).toBe('there is no version #9: main has 6 events (#1 to #6)')
  expect(await refused({ name: 'new-one', from: 'blank', at: '#2' })).toBe('there is no version #2: blank has 1 event (only #1)')
  expect(await refused({ name: 'new-one', at: local(T0 - 10 * MIN) })).toBe(
    `nothing had been recorded in main by then; its first event is from ${when(T0 + MIN)}`,
  )
  expect(await refused({ name: 'new-one', at: 'merge' })).toBe('"merge" matches several nodes (merge-adopted, merge-rerun); use an id')
  expect(await refused({ name: 'new-one', at: 'no such thing' })).toBe(
    'cannot tell which version "no such thing" is; use current, #N (see /decide tree log), a date or time such as 2026-10-08 17:44, or a node id',
  )

  // nothing was written by any of them
  expect(files()).toEqual(snapshot)
  expect(disk.writes.length).toBe(writes)
  expect(namesOf(disk, 'new-one')).toEqual([])
})

test('new tree: a project that is not recording has nothing to copy', async () => {
  // no config.json: the project was never started
  const { disk, journal, ctx, make } = setup()
  const notStarted = 'Decisions are not being recorded in this project. Run /decide start [title] first.'
  expect(expectError(await newTree(ctx, { name: 'side-b' }))).toBe(notStarted)
  expect(expectError(await newTree(ctx, { name: 'blank', empty: true }))).toBe(notStarted)
  const person = make(journal, 'user', 'zh')
  expect(expectError(await newTree(person, { name: 'side-b' }))).toBe('这个项目还没有开始记录决定。先运行 /decide start [title]。')
  expect(disk.files.size).toBe(0)

  // a config.json that cannot be read just now says nothing either way: it is not "not started" (which
  // would send the person to /decide start, and that refuses to write over a file it could not read), and
  // still nothing is written
  disk.put(CONFIG, serializeConfig(defaultConfig('orders', '2026-10-10T12:00:00.000+00:00')))
  disk.failing.add(CONFIG)
  const unreadable = expectError(await newTree(ctx, { name: 'side-b' }))
  expect(unreadable).toMatch(/^Cannot read config\.json just now \(EIO: cannot read .*config\.json\); nothing was changed\. Try again\.$/)
  expect(expectError(await newTree(person, { name: 'side-b' }))).toMatch(/^现在读不了 config\.json（EIO: cannot read .*config\.json），什么都没改。请再试一次。$/)
  expect(expectError(await useTree(ctx, 'main'))).toBe(unreadable)
  disk.failing.delete(CONFIG)

  // started in config.json but nothing recorded: there is no version to start from, and --empty is the way
  const nothing = 'tree main has no events yet, so there is no version to start from; use --empty for a blank tree'
  expect(expectError(await newTree(ctx, { name: 'side-b' }))).toBe(nothing)
  expect(expectError(await newTree(ctx, { name: 'side-b', at: '#1' }))).toBe(nothing)
  expect(disk.writes).toEqual([])
  expect([...disk.files.keys()]).toEqual([CONFIG])
  const blank = await newTree(ctx, { name: 'side-b', empty: true })
  expect(expectOk(blank)).toBe('Opened tree side-b, started empty: 0 nodes. Recording there now.')
  expect(opsOf(disk, 'side-b')).toEqual(['start', 'fork'])
})

test('new tree: a tree nobody opened is nothing to copy from, and a blank one is', async () => {
  const { disk, ctx } = await project()
  const main = filesOf(disk, 'main')

  // no such tree; and a folder with copied files in it but no fork event is a copy that never finished, not a tree
  expect(expectError(await newTree(ctx, { name: 'copy', from: 'ghost' }))).toBe('there is no tree named ghost; /decide tree lists them')
  disk.put(`${eventsDirOf('half')}/${main[0]![0]}`, main[0]![1])
  disk.put(`${eventsDirOf('half')}/${main[1]![0]}`, main[1]![1])
  expect(expectError(await newTree(ctx, { name: 'copy', from: 'half' }))).toBe('there is no tree named half; /decide tree lists them')
  expect(namesOf(disk, 'copy')).toEqual([])

  // a blank tree is a tree: it has its start event to copy
  expectOk(await newTree(ctx, { name: 'blank', empty: true, stay: true }))
  const blank = filesOf(disk, 'blank')
  const r = await newTree(ctx, { name: 'from-blank', from: 'blank' })
  expect(expectOk(r)).toBe(`Opened tree from-blank, from blank at #1 (${whenOfFile(blank[0]![0])}): 0 nodes. Recording there now.`)
  const copy = filesOf(disk, 'from-blank')
  expect(opsOf(disk, 'from-blank')).toEqual(['start', 'fork'])
  expect(copy[0]).toEqual(blank[0]) // the start event of the blank tree, as it was
  expect(JSON.parse(copy[1]![1]).base).toEqual({ tree: 'blank', at: blank[0]![0], count: 1 })
  const m = (await reopen(disk, 'from-blank')).model()
  expect(m.isStarted).toBe(true)
  expect(m.nodes).toEqual([])
})

test('new tree: an earlier attempt that did not finish is taken over, or refused when it would leave strays', async () => {
  const { disk, ctx } = await project()
  const main = filesOf(disk, 'main')
  const put = (tree: string, [name, text]: [string, string]) => disk.put(`${eventsDirOf(tree)}/${name}`, text)

  // an attempt that stopped after two files, the second cut short: no fork event, so the tree is not there
  put('side-b', main[0]!)
  put('side-b', [main[1]![0], main[1]![1].slice(0, 12)])
  expect((await reopen(disk, 'side-b')).model().fork).toBeNull()
  expect(expectOk(await newTree(ctx, { name: 'side-b', at: '#4' }))).toContain('Opened tree side-b, from main at #4')
  const taken = filesOf(disk, 'side-b')
  expect(taken).toHaveLength(5)
  expect(taken.slice(0, 4)).toEqual(main.slice(0, 4)) // the files are main's, the cut one made whole
  expect(opsOf(disk, 'side-b')).toEqual(['start', 'add', 'add', 'add', 'fork'])
  expect((await reopen(disk, 'side-b')).model().warningCount).toBe(0)

  // an attempt that copied everything but the fork event, now asked for a shorter version: three files would be strays
  for (const file of main) put('short', file)
  const writes = disk.writes.length
  const configText = disk.text(CONFIG)
  expect(expectError(await newTree(ctx, { name: 'short', at: '#3' }))).toBe(
    'trees/short/ already holds 3 event files from an earlier attempt that did not finish; delete that folder or pick another name',
  )
  expect(disk.writes.length).toBe(writes)
  expect(disk.text(CONFIG)).toBe(configText)
  expect(namesOf(disk, 'short')).toEqual(main.map(([name]) => name))
  expect(opsOf(disk, 'short')).not.toContain('fork')

  // any file that is not part of this copy is one, whatever is in it; so is the start event of an --empty that stopped
  disk.put(`${eventsDirOf('junk')}/20261010T000000000Z_zzzzzz_0000.json`, 'not even json')
  expect(expectError(await newTree(ctx, { name: 'junk' }))).toContain('trees/junk/ already holds')
  put('blank', main[0]!)
  expect(expectError(await newTree(ctx, { name: 'blank', empty: true }))).toContain('trees/blank/ already holds 1 event files')
  // other kinds of file are not events and are no reason to refuse
  disk.put(`${eventsDirOf('notes')}/README.md`, '# notes')
  expectOk(await newTree(ctx, { name: 'notes', at: '#2' }))

  // once the person has cleared the folder, the same request goes through
  for (const [name] of main) disk.remove(`${eventsDirOf('short')}/${name}`)
  expectOk(await newTree(ctx, { name: 'short', at: '#3' }))
  expect(opsOf(disk, 'short')).toEqual(['start', 'add', 'add', 'fork'])
})

/** A disk that says yes to a write and keeps nothing: a network folder that lost a file. */
class LossyDisk extends MemDisk {
  readonly lost = new Set<string>()
  override async write(path: string, text: string): Promise<void> {
    if (!this.lost.has(path)) return super.write(path, text)
    this.writes.push(path)
  }
}

test('new tree: a copy that cannot be read through is not switched to and has no fork event', async () => {
  const { disk, ctx, make } = await project()
  const main = filesOf(disk, 'main')
  const configText = disk.text(CONFIG)
  const person = make(ctx.journal, 'user', 'zh')

  // reading one of main's events fails half way through the copy
  const bad = `${DIR}/events/${main[3]![0]}`
  disk.failing.add(bad)
  expect(expectError(await newTree(ctx, { name: 'side-b' }))).toBe(`Cannot write the record: EIO: cannot read ${bad}`)
  expect(expectError(await newTree(person, { name: 'side-b' }))).toBe(`写不进记录：EIO: cannot read ${bad}`)
  expect(opsOf(disk, 'side-b')).not.toContain('fork')
  expect(disk.text(CONFIG)).toBe(configText)
  expect(JSON.parse(disk.text(CONFIG))).not.toHaveProperty('tree')
  // so the folder is a copy that stopped: not a tree to use, and the list says so
  expect((await reopen(disk, 'side-b')).model().fork).toBeNull()
  expect(expectError(await useTree(ctx, 'side-b'))).toBe('there is no tree named side-b; /decide tree lists them')
  expect(expectOk(await treeList(ctx))).toContain('side-b  unfinished copy (no fork event yet)')

  // the disk comes back: the same request takes the folder over and finishes
  disk.failing.delete(bad)
  expectOk(await newTree(ctx, { name: 'side-b' }))
  expect(filesOf(disk, 'side-b').slice(0, 6)).toEqual(main)
  expect(opsOf(disk, 'side-b').filter(op => op === 'fork')).toHaveLength(1)
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('side-b')

  // a copy that did not throw but did not land either is caught by looking at what is there afterwards
  const lossy = new LossyDisk()
  const lossyProject = await project({ disk: lossy })
  lossy.lost.add(`${eventsDirOf('later')}/${filesOf(lossy, 'main')[2]![0]}`)
  const kept = lossy.text(CONFIG)
  const incomplete = 'copying the events did not finish, so nothing was switched; try again'
  expect(expectError(await newTree(lossyProject.ctx, { name: 'later' }))).toBe(incomplete)
  expect(expectError(await newTree(lossyProject.make(lossyProject.journal, 'user', 'zh'), { name: 'later' }))).toBe(
    '复制 event 没有做完，没有切换；请再试一次',
  )
  expect(namesOf(lossy, 'later')).toHaveLength(5)
  expect(opsOf(lossy, 'later')).not.toContain('fork')
  expect(lossy.text(CONFIG)).toBe(kept)
  lossy.lost.clear()
  expectOk(await newTree(lossyProject.ctx, { name: 'later' }))
  expect(namesOf(lossy, 'later')).toHaveLength(7)
  expect(JSON.parse(lossy.text(CONFIG)).tree).toBe('later')
})

// ---------------------------------------------------------------- switching

test('use tree: points config.json at an existing tree, and main removes the pointer', async () => {
  const { disk, ctx } = await project()
  expectOk(await newTree(ctx, { name: 'side-b', stay: true }))
  expectOk(await newTree(ctx, { name: 'other-one', empty: true, stay: true }))
  // a key that a newer version of the mod added is not lost on the way
  const base = { ...JSON.parse(disk.text(CONFIG)), futureKey: { a: 1 } }
  disk.put(CONFIG, `${JSON.stringify(base, null, 2)}\n`)

  const r = await useTree(ctx, 'side-b')
  expect(expectOk(r)).toBe('Recording in tree side-b now.')
  expect(r.ok ? r.id : undefined).toBe('side-b')
  expect(JSON.parse(disk.text(CONFIG))).toEqual({ ...base, tree: 'side-b' })
  const parsed = parseConfig(disk.text(CONFIG))
  expect('config' in parsed ? parsed.config.tree : 'unreadable').toBe('side-b')

  // from one tree to another, the name made into one as when a tree is opened
  expect(expectOk(await useTree(ctx, ' Other One '))).toBe('Recording in tree other-one now.')
  expect(JSON.parse(disk.text(CONFIG))).toEqual({ ...base, tree: 'other-one' })

  // main is always there, in whatever case; it takes the key away and leaves the rest
  const main = await useTree(ctx, ' MAIN ')
  expect(expectOk(main)).toBe('Recording in tree main now.')
  expect(main.ok ? main.id : undefined).toBe('main')
  expect(JSON.parse(disk.text(CONFIG))).toEqual(base)
  expect(disk.text(CONFIG)).not.toContain('"tree"')
  const back = parseConfig(disk.text(CONFIG))
  expect('config' in back ? back.config.tree : 'unreadable').toBeUndefined()
})

test('use tree: one that does not exist, and one that is only half a copy, are refused', async () => {
  const { disk, ctx } = await project()
  const main = filesOf(disk, 'main')
  const configText = disk.text(CONFIG)
  const writes = disk.writes.length

  expect(expectError(await useTree(ctx, 'ghost'))).toBe('there is no tree named ghost; /decide tree lists them')
  // a copy that stopped half way: event files, but no fork event
  disk.put(`${eventsDirOf('half')}/${main[0]![0]}`, main[0]![1])
  disk.put(`${eventsDirOf('half')}/${main[1]![0]}`, main[1]![1])
  expect(expectError(await useTree(ctx, 'half'))).toBe('there is no tree named half; /decide tree lists them')
  // what is not a name at all gets the same answer, with the text as it was typed
  expect(expectError(await useTree(ctx, ' 第三版 '))).toBe('there is no tree named 第三版; /decide tree lists them')
  expect(expectError(await useTree(ctx, '   '))).toBe('a tree needs a name (letters, digits and hyphens, 2-32 characters, e.g. crdt-engine)')
  // none of that touched config.json
  expect(disk.text(CONFIG)).toBe(configText)
  expect(disk.writes.length).toBe(writes)
  // and a config.json that is not JSON is not written over
  disk.put(CONFIG, '{ not json')
  expect(expectError(await useTree(ctx, 'main'))).toBe('Cannot write the record: config.json is not valid JSON')
  expect(disk.text(CONFIG)).toBe('{ not json')
  disk.put(CONFIG, configText)

  // the half copy becomes a tree when it is finished under the same name, and not before
  expectOk(await newTree(ctx, { name: 'half', at: '#2', stay: true }))
  expect(expectOk(await useTree(ctx, 'half'))).toBe('Recording in tree half now.')
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('half')

  // nothing to switch in a project that was never started
  const fresh = setup()
  expect(expectError(await useTree(fresh.ctx, 'half'))).toBe(
    'Decisions are not being recorded in this project. Run /decide start [title] first.',
  )
})

test('use tree: already there says so and writes nothing', async () => {
  const { disk, journal, ctx, make } = await project()
  const configText = disk.text(CONFIG)
  let writes = disk.writes.length

  // main, with no pointer in config.json
  const r = await useTree(ctx, 'main')
  expect(expectOk(r)).toBe('Already recording in tree main.')
  expect(r.ok ? r.id : undefined).toBe('main')
  expect(expectOk(await useTree(ctx, ' Main '))).toBe('Already recording in tree main.')
  expect(disk.writes.length).toBe(writes)
  expect(disk.text(CONFIG)).toBe(configText)

  // a tree that config.json names and this session is in
  expectOk(await newTree(ctx, { name: 'side-b' }))
  const inSql = make(journal.sibling('side-b'))
  writes = disk.writes.length
  const named = disk.text(CONFIG)
  expect(expectOk(await useTree(inSql, 'side-b'))).toBe('Already recording in tree side-b.')
  expect(expectOk(await useTree(inSql, 'Side B'))).toBe('Already recording in tree side-b.')
  expect(disk.writes.length).toBe(writes)
  expect(disk.text(CONFIG)).toBe(named)

  // a session that has not followed config.json yet is not "already" there: it is told it records there now
  expect(expectOk(await useTree(ctx, 'side-b'))).toBe('Recording in tree side-b now.')
  expect(JSON.parse(disk.text(CONFIG)).tree).toBe('side-b')
})

// ---------------------------------------------------------------- list and log

test('tree list: main first, then the others, each with where it began and how big it is', async () => {
  const { disk, journal, ctx, make } = await project()
  // a project with only main
  expect(expectOk(await treeList(ctx))).toBe(['Trees in this project (recording in main):', '* main  5 nodes, 6 events'].join('\n'))

  expectOk(await newTree(ctx, { name: 'side-b', at: '#4', title: '另一条路线', stay: true }))
  const inSql = make(journal.sibling('side-b'))
  expectOk(await recordNode(inSql, { id: 'sql-first', title: 'SQL first try', parent: 'notes-app', status: 'planned' }))
  expectOk(await newTree(ctx, { name: 'tiny', at: '#2', stay: true }))
  expectOk(await newTree(ctx, { name: 'blank', empty: true, stay: true }))
  // a copy that stopped half way is listed too, as what it is
  const first = filesOf(disk, 'main')[0]!
  disk.put(`${eventsDirOf('half')}/${first[0]}`, first[1])
  // main moves on: a retracted node is not counted, the retraction is an event
  expectOk(await retractNode(ctx, 'sql-next', 'recorded by mistake'))

  const list = expectOk(await treeList(ctx)).split('\n')
  expect(list).toEqual([
    'Trees in this project (recording in main):',
    '* main    4 nodes, 7 events',
    '  blank   started empty · 0 nodes, 1 event',
    '  half    unfinished copy (no fork event yet)',
    `  side-b  from main at #4 (${when(T0 + 4 * MIN)}) · 4 nodes, 5 events · "另一条路线"`,
    `  tiny    from main at #2 (${when(T0 + 2 * MIN)}) · 1 node, 2 events`,
  ])

  // the star is on the tree the session is in
  const fromSql = expectOk(await treeList(inSql)).split('\n')
  expect(fromSql[0]).toBe('Trees in this project (recording in side-b):')
  expect(fromSql.filter(line => line.startsWith('*'))).toEqual([list[4]!.replace(/^ /, '*')])
  expect(fromSql.slice(1).map(line => line.slice(2, 8).trim())).toEqual(['main', 'blank', 'half', 'side-b', 'tiny'])
})

test('tree log: the last events, numbered, with who and what', async () => {
  const { disk, journal, ctx, make } = await project()
  const user = make(journal, 'user')
  expectOk(await updateNode(user, { id: 'sqlite-adopted', status: 'rejected' }))
  expectOk(await noteNode(ctx, { id: 'merge-adopted', text: 'both seeds agree' }))
  expectOk(await updateNode(user, { id: 'sql-next', parent: 'notes-app' }))
  expectOk(await retractNode(ctx, 'merge-rerun', 'duplicate'))
  const names = namesOf(disk, 'main')
  expect(names).toHaveLength(10)
  const at = (k: number) => whenOfFile(names[k - 1]!)

  const all = expectOk(await treeLog(ctx, null)).split('\n')
  expect(all).toEqual([
    'Tree main: 10 events (use #N as --at):',
    ` #1  ${at(1)}  model   start`,
    ` #2  ${at(2)}  model   add notes-app "notes app 立项"`,
    ` #3  ${at(3)}  model   add sqlite-adopted "存储层采用"`,
    ` #4  ${at(4)}  model   add merge-adopted "合并规则定为 v1.2"`,
    ` #5  ${at(5)}  model   add merge-rerun "合并规则 v1.2 重跑"`,
    ` #6  ${at(6)}  model   add sql-next "下一步做 sql"`,
    ` #7  ${at(7)}  user    update sqlite-adopted status rejected`,
    ` #8  ${at(8)}  model   note merge-adopted`,
    ` #9  ${at(9)}  user    move sql-next → notes-app`,
    `#10  ${at(10)}  model   retract merge-rerun`,
  ])
  expect(at(1)).toBe(when(T0 + MIN)) // the first event is the first minute of the clock

  // the last few: the numbers are the events' own, so #8 is #8 whatever is shown
  const last3 = expectOk(await treeLog(ctx, 3)).split('\n')
  expect(last3[0]).toBe('Tree main: 10 events; the last 3 (use #N as --at):')
  expect(last3.slice(1)).toEqual(all.slice(-3))
  // by default twelve, never fewer than one, and more than there are is all of them
  for (let i = 0; i < 4; i++) expectOk(await noteNode(ctx, { id: 'sql-next', text: `run ${i}` }))
  const twelve = expectOk(await treeLog(ctx, null)).split('\n')
  expect(twelve[0]).toBe('Tree main: 14 events; the last 12 (use #N as --at):')
  expect(twelve).toHaveLength(13)
  expect(twelve[1]).toMatch(/^ #3 {2}\d\d-\d\d \d\d:\d\d {2}model {3}add sqlite-adopted/)
  expect(twelve.at(-1)).toMatch(/^#14 {2}\d\d-\d\d \d\d:\d\d {2}model {3}note sql-next$/)
  expect(expectOk(await treeLog(ctx, 0)).split('\n')).toHaveLength(2)
  expect(expectOk(await treeLog(ctx, 500)).split('\n')[0]).toBe('Tree main: 14 events (use #N as --at):')

  // a tree opened from another says where from; the fork marker itself is no event and has no number
  expectOk(await newTree(ctx, { name: 'side-b', at: '#4' }))
  const inSql = make(journal.sibling('side-b'), 'user')
  expectOk(await recordNode(inSql, { id: 'sql-first', title: 'SQL first try', parent: 'notes-app', status: 'planned' }))
  const own = namesOf(disk, 'side-b')
  expect(expectOk(await treeLog(inSql, null)).split('\n')).toEqual([
    'Tree side-b: 5 events (use #N as --at):',
    `opened from main at #4 (${at(4)})`,
    `#1  ${at(1)}  model   start`,
    `#2  ${at(2)}  model   add notes-app "notes app 立项"`,
    `#3  ${at(3)}  model   add sqlite-adopted "存储层采用"`,
    `#4  ${at(4)}  model   add merge-adopted "合并规则定为 v1.2"`,
    `#5  ${whenOfFile(own[5]!)}  user    add sql-first "SQL first try"`,
  ])

  // a tree with nothing in it yet
  expect(expectOk(await treeLog(make(journal.sibling('nothing-yet')), null))).toBe('Tree nothing-yet has no events yet.')
})

test('tree log and the receipts are in Chinese for the person and English for the model', async () => {
  // the pane is in Chinese: the person's commands answer in it, the model's tools still read English
  const { disk, journal, make } = await project({ lang: 'zh' })
  const person = make(journal, 'user')
  const model = make(journal, 'model')
  const at4 = when(T0 + 4 * MIN)

  // opening a tree
  expect(expectOk(await newTree(person, { name: 'side-b', at: '#4', title: '另一条路线', stay: true }))).toBe(
    `已新开 tree「side-b」，基于 main 的 #4（${at4}）：3 个 node。仍在记录到「main」；/decide tree use side-b 可以切换。`,
  )
  expect(expectOk(await newTree(model, { name: 'side-c', at: '#4', stay: true }))).toBe(
    `Opened tree side-c, from main at #4 (${at4}): 3 nodes. Still recording in main; /decide tree use side-c switches.`,
  )
  expect(expectOk(await newTree(person, { name: 'blank', empty: true, stay: true }))).toBe(
    '已新开 tree「blank」，从空白开始：0 个 node。仍在记录到「main」；/decide tree use blank 可以切换。',
  )
  expect(expectOk(await newTree(model, { name: 'empty', empty: true, stay: true }))).toBe(
    'Opened tree empty, started empty: 0 nodes. Still recording in main; /decide tree use empty switches.',
  )
  // switching, and being there already
  expect(expectOk(await useTree(person, 'side-b'))).toBe('现在记录到 tree「side-b」。')
  expect(expectOk(await useTree(model, 'side-b'))).toBe('Recording in tree side-b now.')
  expect(expectOk(await useTree(make(journal.sibling('side-b'), 'user'), 'side-b'))).toBe('已经在记录到 tree「side-b」。')
  expect(expectOk(await useTree(make(journal.sibling('side-b'), 'model'), 'side-b'))).toBe('Already recording in tree side-b.')

  // what is refused
  expect(expectError(await newTree(person, { name: 'main' }))).toBe('"main" 是项目的第一棵 tree，请换个名字')
  expect(expectError(await newTree(model, { name: 'main' }))).toBe('"main" is the first tree of the project; pick another name')
  expect(expectError(await newTree(person, { name: 'next-one', at: '#99' }))).toBe('没有 #99 这个 version：「main」一共 6 个 event（#1 到 #6）')
  expect(expectError(await newTree(model, { name: 'next-one', at: '#99' }))).toBe(
    'there is no version #99: main has 6 events (#1 to #6)',
  )
  expect(expectError(await useTree(person, 'ghost'))).toBe('没有叫「ghost」的 tree；/decide tree 可以列出所有 tree')
  expect(expectError(await useTree(model, 'ghost'))).toBe('there is no tree named ghost; /decide tree lists them')

  // the list
  disk.put(`${eventsDirOf('half')}/${filesOf(disk, 'main')[0]![0]}`, filesOf(disk, 'main')[0]![1])
  const zhList = expectOk(await treeList(person)).split('\n')
  expect(zhList[0]).toBe('这个项目的 tree（正在记录到「main」）：')
  expect(zhList[1]).toBe('* main    5 个 node，6 个 event')
  expect(zhList).toContain('  blank   从空白开始 · 0 个 node，1 个 event')
  expect(zhList).toContain('  half    没做完的复制（还没有 fork event）')
  expect(zhList).toContain(`  side-b  基于 main 的 #4（${at4}） · 3 个 node，4 个 event · "另一条路线"`)
  const enList = expectOk(await treeList(model)).split('\n')
  expect(enList[0]).toBe('Trees in this project (recording in main):')
  expect(enList[1]).toBe('* main    5 nodes, 6 events')
  expect(enList).toContain('  blank   started empty · 0 nodes, 1 event')
  expect(enList).toContain('  half    unfinished copy (no fork event yet)')
  expect(enList).toContain(`  side-b  from main at #4 (${at4}) · 3 nodes, 4 events · "另一条路线"`)

  // the log: the sentences around it are translated, the events in it (who and what) are not
  const inSql = (a: DtActor) => make(journal.sibling('side-b'), a)
  const zhLog = expectOk(await treeLog(inSql('user'), 2)).split('\n')
  const enLog = expectOk(await treeLog(inSql('model'), 2)).split('\n')
  expect(zhLog[0]).toBe('Tree「side-b」：共 4 个 event，最近 2 个（--at 里写 #N）：')
  expect(zhLog[1]).toBe(`开出时基于 main 的 #4（${at4}）`)
  expect(enLog[0]).toBe('Tree side-b: 4 events; the last 2 (use #N as --at):')
  expect(enLog[1]).toBe(`opened from main at #4 (${at4})`)
  expect(zhLog.slice(2)).toEqual(enLog.slice(2))
  expect(enLog.slice(2)).toEqual([
    `#3  ${when(T0 + 3 * MIN)}  model   add sqlite-adopted "存储层采用"`,
    `#4  ${at4}  model   add merge-adopted "合并规则定为 v1.2"`,
  ])
  expect(expectOk(await treeLog(make(journal.sibling('later-on'), 'user'), null))).toBe('Tree「later-on」还没有 event。')
  expect(expectOk(await treeLog(make(journal.sibling('later-on'), 'model'), null))).toBe('Tree later-on has no events yet.')
  expect(expectOk(await treeLog(person, null)).split('\n')[0]).toBe('Tree「main」：共 6 个 event（--at 里写 #N）：')
})
