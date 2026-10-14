import { expect, test } from 'claude-code/testing'

import { MAX_OWN, forkPoint, graphOf, isAhead, isOwn, orderTrees, treeInfoOf } from '../lib/forest'
import { eventFileName } from '../lib/events'
import { replay } from '../lib/replay'
import type { ReplayEntry } from '../lib/replay'
import type { DtGraphStep, DtStatus, DtTreeInfo } from '../types'

// ---------------------------------------------------------------- trees built from events, as the journal replays them

let seq = 0
const at = (month: number, day: number, hour = 12) => Date.UTC(2026, month - 1, day, hour)

/** `ms` is the day the step was decided on; `rec` the moment it was recorded (the same, unless it says otherwise). */
type Step = { id: string; parent: string | null; status?: DtStatus; ms: number; rec?: number; trunk?: boolean }

function entry(ms: number, event: Record<string, unknown>): ReplayEntry {
  seq += 1
  return { name: eventFileName(ms, 'aaaaaa', seq), event: { v: 1, session: 'aaaaaa', actor: 'user', ts: new Date(ms).toISOString(), ...event } as never }
}
const start = (ms: number) => entry(ms, { op: 'start' })
const add = (s: Step) =>
  entry(s.rec ?? s.ms, { op: 'add', id: s.id, node: { title: `title ${s.id}`, parent: s.parent, status: s.status ?? 'adopted', kind: 'decision', trunk: s.trunk ?? false, decidedAt: new Date(s.ms).toISOString() } })

/** A tree opened from another after its first `count` events: the copies, the fork marker, then what it records itself. */
function fork(base: { name: string; entries: ReplayEntry[] }, count: number, ms: number, title?: string): ReplayEntry[] {
  // (the events a version counts: the marker of a tree that was itself opened from another is not one of them)
  const copied = base.entries.filter(e => e.event!.op !== 'fork').slice(0, count)
  const last = copied[copied.length - 1]
  return [...copied, entry(ms, { op: 'fork', base: { tree: base.name, at: last === undefined ? null : last.name, count }, ...(title !== undefined ? { text: title } : {}) })]
}

/** Main: a start and six steps (the last one planned), a branch hanging from the second step. */
const MAIN_STEPS: Step[] = [
  { id: 's0', parent: null, ms: at(9, 2), trunk: true },
  { id: 's1', parent: 's0', ms: at(9, 14), trunk: true },
  { id: 'b1', parent: 's1', status: 'rejected', ms: at(9, 14, 13) },
  { id: 's2', parent: 's1', ms: at(9, 21), trunk: true },
  { id: 's3', parent: 's2', ms: at(10, 1), trunk: true },
  { id: 's4', parent: 's3', ms: at(10, 6), trunk: true },
  { id: 's5', parent: 's4', status: 'planned', ms: at(10, 6, 13), trunk: true },
]
const MAIN_ENTRIES = [start(at(9, 1)), ...MAIN_STEPS.map(add)]
const MAIN = { name: 'main', entries: MAIN_ENTRIES }

/** The versions of main the other trees were opened at: the start and two steps, and the start, three steps and the branch. */
const CLOUD_COUNT = 3 // start, s0, s1
const CRDT_COUNT = 5 // start, s0, s1, b1, s2
const CLOUD_ENTRIES = [
  ...fork(MAIN, CLOUD_COUNT, at(9, 15), 'Server-first sync, offline later'),
  add({ id: 'c1', parent: 's1', ms: at(9, 16), trunk: true }),
  add({ id: 'c2', parent: 'c1', ms: at(9, 22), trunk: true }),
]
const CRDT_ENTRIES = [
  ...fork(MAIN, CRDT_COUNT, at(9, 25), 'CRDT text engine instead of paragraph merge'),
  add({ id: 'x1', parent: 's2', ms: at(9, 28), trunk: true }),
  add({ id: 'x2', parent: 'x1', status: 'planned', ms: at(10, 7), trunk: true }),
]

const infoOf = (name: string, entries: ReplayEntry[]) =>
  treeInfoOf(
    name,
    replay(entries),
    entries.map(e => ({ name: e.name, event: e.event! })),
  )

const MAIN_INFO = infoOf('main', MAIN_ENTRIES)
const CLOUD_INFO = infoOf('cloud-first', CLOUD_ENTRIES)
const CRDT_INFO = infoOf('crdt-engine', CRDT_ENTRIES)

// ---------------------------------------------------------------- what is known of a tree

test('tree info: the first tree knows its size, its steps and who touched it last', () => {
  expect(MAIN_INFO).toMatchObject({ name: 'main', title: 'title s0', fork: null, nodes: 7, steps: 6, events: 8, lastActor: 'user' })
  expect(MAIN_INFO.lastEventAt).toBe(new Date(at(10, 6, 13)).toISOString())
  // every step is its own, oldest first; the head is the newest one adopted
  expect(MAIN_INFO.own.map(s => s.id)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5'])
  expect(MAIN_INFO.own.filter(s => s.head).map(s => s.id)).toEqual(['s4'])
  expect(MAIN_INFO.own[5]).toMatchObject({ id: 's5', status: 'planned', title: 'title s5', at: new Date(at(10, 6, 13)).toISOString() })
})

test('tree info: a tree opened from another has only the steps it recorded itself as its own', () => {
  expect(CRDT_INFO).toMatchObject({ name: 'crdt-engine', title: 'CRDT text engine instead of paragraph merge', nodes: 6, steps: 5, events: 7 })
  expect(CRDT_INFO.fork).toEqual({ tree: 'main', at: MAIN_ENTRIES[CRDT_COUNT - 1]!.name, count: CRDT_COUNT })
  expect(CRDT_INFO.own.map(s => s.id)).toEqual(['x1', 'x2'])
  // its head is x1: the newest step adopted, and it is one of its own
  expect(CRDT_INFO.own.map(s => s.head)).toEqual([true, false])
  // events do not count the marker that says where it began
  expect(CLOUD_INFO.events).toBe(CLOUD_COUNT + 2)
})

test('tree info: a copy of a tree whose head was copied has no head of its own', () => {
  const entries = [...fork(MAIN, 8, at(10, 8)), add({ id: 'p1', parent: 's5', status: 'planned', ms: at(10, 9), trunk: true })]
  const info = infoOf('only-plans', entries)
  expect(info.own.map(s => [s.id, s.head])).toEqual([['p1', false]])
  expect(info.steps).toBe(7)
})

test('tree info: a tree started empty owns every step, and a tree with none has an empty list', () => {
  const empty = fork({ name: 'main', entries: [] }, 0, at(10, 8))
  const info = infoOf('blank', [...empty, add({ id: 'r0', parent: null, ms: at(10, 9), trunk: true })])
  expect(info.fork).toEqual({ tree: 'main', at: null, count: 0 })
  expect(info.own.map(s => s.id)).toEqual(['r0'])
  expect(infoOf('nothing', empty).own).toEqual([])
  expect(infoOf('nothing', empty)).toMatchObject({ nodes: 0, steps: 0, events: 0, lastActor: 'user' })
  // a tree with no events at all
  expect(infoOf('none', [])).toMatchObject({ nodes: 0, steps: 0, events: 0, lastActor: null, lastEventAt: null, fork: null, title: null })
})

test('tree info: only the newest steps are kept, and a retracted step is not one', () => {
  const many: Step[] = Array.from({ length: MAX_OWN + 7 }, (_, k) => ({ id: `m${k}`, parent: k === 0 ? null : `m${k - 1}`, ms: at(9, 1) + k * 3_600_000, trunk: true }))
  const info = infoOf('long', [start(at(9, 1)), ...many.map(add)])
  expect(info.steps).toBe(MAX_OWN + 7)
  expect(info.own).toHaveLength(MAX_OWN)
  expect(info.own[0]!.id).toBe('m7')
  expect(info.own[info.own.length - 1]!.id).toBe(`m${MAX_OWN + 6}`)
  const gone = infoOf('gone', [start(at(9, 1)), add({ id: 'g0', parent: null, ms: at(9, 2), trunk: true }), add({ id: 'g1', parent: 'g0', ms: at(9, 3), trunk: true }), entry(at(9, 4), { op: 'retract', id: 'g1' })])
  expect(gone.own.map(s => s.id)).toEqual(['g0'])
  expect(gone.steps).toBe(1)
})

test('isOwn: a step is its tree’s own when its event is later than the last one copied', () => {
  expect(isOwn(null, 'anything.json')).toBe(true)
  expect(isOwn({ tree: 'main', at: null, count: 0 }, 'a.json')).toBe(true)
  expect(isOwn({ tree: 'main', at: '20261001T120000000Z_aaaaaa_0003.json', count: 3 }, '20261001T120000000Z_aaaaaa_0003.json')).toBe(false)
  expect(isOwn({ tree: 'main', at: '20261001T120000000Z_aaaaaa_0003.json', count: 3 }, '20261001T120000001Z_aaaaaa_0004.json')).toBe(true)
})

test('isAhead: planned, proposed and in-progress steps are work still ahead', () => {
  expect((['planned', 'proposed', 'in-progress'] as DtStatus[]).every(isAhead)).toBe(true)
  expect((['adopted', 'rejected', 'no-diff', 'withdrawn', 'superseded', 'deferred'] as DtStatus[]).some(isAhead)).toBe(false)
})

// ---------------------------------------------------------------- the order

/** A tree with only what the order and the graph look at. */
function bare(name: string, base: { tree: string; count: number; at?: string | null } | null, own: Partial<DtGraphStep>[] = []): DtTreeInfo {
  return {
    name,
    title: null,
    fork: base === null ? null : { tree: base.tree, count: base.count, at: base.at === undefined ? stamp(base.count) : base.at },
    nodes: own.length,
    steps: own.length,
    events: own.length,
    lastEventAt: null,
    lastActor: null,
    own: own.map((s, k) => ({ id: `${name}-${k}`, title: `title ${name}-${k}`, status: 'adopted', at: '2026-10-01T12:00:00.000Z', by: stamp(1000 + k, name), head: false, ...s })),
  }
}
/** An event file name that sorts by `n`: a stand-in for a time. */
const stamp = (n: number, tag = 'aaaaaa') => `${String(n).padStart(8, '0')}_${tag}.json`

test('the order: the first tree, then what was opened from it, the later point of it first, each followed by its own', () => {
  const main = bare('main', null)
  const early = bare('early', { tree: 'main', count: 5 })
  const late = bare('late', { tree: 'main', count: 9 })
  const mid = bare('mid', { tree: 'main', count: 7 })
  const child = bare('child', { tree: 'late', count: 3 })
  const grandchild = bare('grandchild', { tree: 'child', count: 2 })
  expect(orderTrees([early, grandchild, child, main, late, mid]).map(i => i.name)).toEqual(['main', 'late', 'child', 'grandchild', 'mid', 'early'])
  // the same version: by name
  const b = bare('b', { tree: 'main', count: 4 })
  const a = bare('a', { tree: 'main', count: 4 })
  expect(orderTrees([b, a, main]).map(i => i.name)).toEqual(['main', 'a', 'b'])
})

test('the order: a tree whose base is gone hangs from the first tree, and trees that name each other are still all listed', () => {
  const main = bare('main', null)
  const lost = bare('lost', { tree: 'deleted', count: 4 })
  expect(orderTrees([lost, main]).map(i => i.name)).toEqual(['main', 'lost'])
  const x = bare('x', { tree: 'y', count: 1 })
  const y = bare('y', { tree: 'x', count: 1 })
  expect(orderTrees([x, y, main]).map(i => i.name)).toEqual(['main', 'x', 'y'])
  // no first tree in the list: the others stand on their own, and a tree named after itself is not its own base
  const self = bare('self', { tree: 'self', count: 2 })
  expect(orderTrees([self, lost]).map(i => i.name)).toEqual(['lost', 'self'])
  expect(orderTrees([])).toEqual([])
})

// ---------------------------------------------------------------- where a lane leaves from

test('fork point: the step of the base the tree was opened at', () => {
  const byName = new Map([MAIN_INFO, CLOUD_INFO, CRDT_INFO].map(i => [i.name, i] as const))
  expect(forkPoint(CLOUD_INFO, byName)).toEqual({ tree: 'main', step: 's1' })
  expect(forkPoint(CRDT_INFO, byName)).toEqual({ tree: 'main', step: 's2' })
  expect(forkPoint(MAIN_INFO, byName)).toBeNull()
})

test('fork point: a tree opened from another tree leaves from that tree, or from where its steps came from', () => {
  const byName = new Map([MAIN_INFO, CRDT_INFO].map(i => [i.name, i] as const))
  // after the crdt-engine tree recorded x1: it leaves from x1
  const after = infoOf('after', [...fork({ name: 'crdt-engine', entries: CRDT_ENTRIES }, CRDT_COUNT + 1, at(10, 8)), add({ id: 'a1', parent: 'x1', ms: at(10, 9), trunk: true })])
  byName.set('after', after)
  expect(forkPoint(after, byName)).toEqual({ tree: 'crdt-engine', step: 'x1' })
  // right after it was opened: crdt-engine had recorded nothing of its own yet, so it leaves from main's s2
  const before = infoOf('before', [...fork({ name: 'crdt-engine', entries: CRDT_ENTRIES }, CRDT_COUNT, at(10, 8)), add({ id: 'b9', parent: 's2', ms: at(10, 9), trunk: true })])
  byName.set('before', before)
  expect(forkPoint(before, byName)).toEqual({ tree: 'main', step: 's2' })
})

test('fork point: nothing to leave from', () => {
  const byName = new Map([MAIN_INFO].map(i => [i.name, i] as const))
  // started empty, or a base that is not listed, or one that names itself
  expect(forkPoint(bare('blank', { tree: 'main', count: 0, at: null }), byName)).toBeNull()
  expect(forkPoint(bare('lost', { tree: 'deleted', count: 3 }), byName)).toBeNull()
  expect(forkPoint(bare('self', { tree: 'self', count: 3 }), new Map([['self', bare('self', { tree: 'self', count: 3 })]]))).toBeNull()
  // opened before main had recorded a step
  const lone = bare('main', null)
  expect(forkPoint(bare('early', { tree: 'main', count: 1 }), new Map([['main', lone]]))).toBeNull()
})

// ---------------------------------------------------------------- the graph

test('graph: every step of every tree once, in the order it was decided, with each lane joined where it was opened', () => {
  const g = graphOf([MAIN_INFO, CLOUD_INFO, CRDT_INFO])
  expect(g.lanes).toEqual(['main', 'crdt-engine', 'cloud-first'])
  expect(g.rows.map(r => `${r.tree}:${r.step.id}`)).toEqual([
    'main:s0',
    'main:s1',
    'cloud-first:c1',
    'main:s2',
    'cloud-first:c2',
    'crdt-engine:x1',
    'main:s3',
    'main:s4',
    'main:s5',
    'crdt-engine:x2',
  ])
  expect(g.rows.map(r => r.lane)).toEqual([0, 0, 2, 0, 2, 1, 0, 0, 0, 1])
  // the lane of cloud-first leaves main at s1, the lane of crdt-engine at s2
  expect(g.rows.filter(r => r.forks.length > 0).map(r => [r.step.id, r.forks])).toEqual([
    ['s1', [2]],
    ['s2', [1]],
  ])
  expect(g.rows.filter(r => r.first).map(r => r.step.id)).toEqual(['s0', 'c1', 'x1'])
  expect(g.rows.filter(r => r.last).map(r => r.step.id)).toEqual(['c2', 's5', 'x2'])
  expect(g.rows.filter(r => r.ahead).map(r => r.step.id)).toEqual(['s5', 'x2'])
})

test('graph: two trees opened from one step both leave from it', () => {
  const twin = infoOf('twin', [...fork(MAIN, CRDT_COUNT, at(10, 8)), add({ id: 't1', parent: 's2', ms: at(10, 9), trunk: true })])
  const g = graphOf([MAIN_INFO, CRDT_INFO, twin])
  expect(g.lanes).toEqual(['main', 'crdt-engine', 'twin'])
  expect(g.rows.find(r => r.step.id === 's2')!.forks).toEqual([1, 2])
})

test('graph: a step is never placed above the step its tree was opened from, whatever date it was decided on', () => {
  const early = infoOf('early-dated', [...fork(MAIN, CRDT_COUNT, at(10, 7)), add({ id: 'e1', parent: 's2', ms: at(1, 1), rec: at(10, 8), trunk: true })])
  const g = graphOf([MAIN_INFO, early])
  const ids = g.rows.map(r => r.step.id)
  expect(ids.indexOf('e1')).toBeGreaterThan(ids.indexOf('s2'))
  // its place is right after the step it left, ahead of the later steps of the lane it left
  expect(ids).toEqual(['s0', 's1', 's2', 'e1', 's3', 's4', 's5'])
})

test('graph: a lane lists its steps in the order of its rail, whatever order they were recorded in', () => {
  // k1 was recorded first but decided later: the rail puts the step decided first on top, and so does the lane
  const back = infoOf('backwards', [
    ...fork(MAIN, CRDT_COUNT, at(10, 7)),
    add({ id: 'k1', parent: 's2', ms: at(10, 20), rec: at(10, 8), trunk: true }),
    add({ id: 'k2', parent: 'k1', ms: at(10, 10), rec: at(10, 9), trunk: true }),
  ])
  expect(back.own.map(s => s.id)).toEqual(['k2', 'k1'])
  const ids = graphOf([MAIN_INFO, back]).rows.map(r => r.step.id)
  expect(ids.indexOf('k2')).toBeLessThan(ids.indexOf('k1'))
  expect(ids.indexOf('k2')).toBeGreaterThan(ids.indexOf('s2'))
})

test('graph: a tree with nothing of its own has no lane, and a tree of no known base has no join', () => {
  const idle = infoOf('idle', fork(MAIN, CRDT_COUNT, at(10, 8)))
  const g = graphOf([MAIN_INFO, idle])
  expect(g.lanes).toEqual(['main'])
  expect(g.rows).toHaveLength(6)
  const lost = bare('lost', { tree: 'deleted', count: 4 }, [{ at: '2026-10-02T12:00:00.000Z' }])
  const g2 = graphOf([MAIN_INFO, lost])
  expect(g2.lanes).toEqual(['main', 'lost'])
  expect(g2.rows.every(r => r.forks.length === 0)).toBe(true)
  expect(graphOf([])).toEqual({ lanes: [], rows: [] })
})

test('graph: steps with no date that parses go first, in their own order, and nothing breaks', () => {
  const odd = bare('main', null, [{ at: 'unknown' }, { at: '' }, { at: '2026-10-01T12:00:00.000Z' }])
  const g = graphOf([odd])
  expect(g.rows.map(r => r.step.id)).toEqual(['main-0', 'main-1', 'main-2'])
})
