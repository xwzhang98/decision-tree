import { test, expect } from 'claude-code/testing'

import type { DtNode, DtUi } from '../types'
import {
  ancestorIds,
  buildIndex,
  effectiveSelection,
  recentNodes,
  resolveRef,
  rowIndex,
  supersededNodes,
  trunkNodes,
  visibleRows,
  windowRows,
} from '../lib/tree'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)
const DAY = 24 * 3600 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

let n = 0
function mk(id: string, parent: string | null, over: Partial<DtNode> = {}): DtNode {
  n += 1
  const at = iso(NOW - 30 * DAY + n * 1000) // old unless a test says otherwise
  return {
    id,
    title: `title ${id}`,
    parent,
    status: 'adopted',
    kind: 'decision',
    createdAt: at,
    createdBy: 'model',
    updatedAt: at,
    notes: [],
    addedBy: `${id}.json`,
    ...over,
  }
}

const UI: Pick<DtUi, 'expanded' | 'collapsed' | 'filter'> = { expanded: [], collapsed: [], filter: 'default' }
const rowsOf = (nodes: DtNode[], ui: Partial<typeof UI> = {}) => visibleRows(buildIndex({ nodes }), { ui: { ...UI, ...ui }, nowMs: NOW })
const ids = (rows: { node: DtNode }[]) => rows.map(r => r.node.id)

test('index: a missing parent makes a root, and siblings sort by decision time then record order', () => {
  const idx = buildIndex({
    nodes: [
      mk('late', null, { decidedAt: iso(NOW - 1 * DAY) }),
      mk('early', null, { decidedAt: iso(NOW - 9 * DAY) }),
      mk('orphan', 'does-not-exist'),
      mk('kid', 'early'),
    ],
  })
  expect((idx.children.get(null) ?? []).map(x => x.id)).toEqual(['orphan', 'early', 'late'])
  expect(idx.parentOf.get('orphan')).toBeNull()
  expect(idx.parentOf.get('kid')).toBe('early')
  expect(ancestorIds(idx, 'kid')).toEqual(['early'])
})

test('rows: the steps are the trunk nodes and the roots in the order they were decided, and a branch hangs from the nearest step above it', () => {
  const rows = rowsOf([
    mk('root-a', null, { trunk: true }),
    mk('step-a', 'root-a', { trunk: true }),
    mk('side-a', 'root-a'),
    mk('step-b', 'step-a', { trunk: true }),
    mk('side-b', 'step-a'),
    mk('side-c', 'side-b'),
  ])
  // the branches of a step come right after it, the next step after them
  expect(ids(rows)).toEqual(['root-a', 'side-a', 'step-a', 'side-b', 'step-b'])
  expect(rows.map(r => r.depth)).toEqual([0, 1, 0, 1, 0])
  expect(rows.map(r => r.step)).toEqual([0, 0, 1, 1, 2])
  // (side-c is folded into side-b: it is neither trunk nor recent)
  expect(rows.find(r => r.node.id === 'side-b')!.hiddenKids).toBe(1)
  expect(rows.find(r => r.node.id === 'side-b')!.childCount).toBe(1)
  expect(rows.find(r => r.node.id === 'side-b')!.isExpanded).toBe(false)
  // a step's own count is the branches hanging from it, not the step that follows it
  expect(rows.map(r => r.childCount)).toEqual([1, 0, 1, 1, 0])
  expect(rows.every(r => r.rail.step === (r.depth === 0))).toBe(true)
})

test('rows: steps come in the order they were decided, not the order of the tree', () => {
  const rows = rowsOf([
    mk('r', null, { trunk: true, decidedAt: iso(NOW - 9 * DAY) }),
    mk('late', 'r', { trunk: true, decidedAt: iso(NOW - 2 * DAY) }),
    mk('early', 'r', { trunk: true, decidedAt: iso(NOW - 5 * DAY) }),
    mk('under-late', 'late'),
  ])
  expect(ids(rows)).toEqual(['r', 'early', 'late', 'under-late'])
})

test('rows: a tree with nothing marked as trunk has its roots for steps; a trunk node below a plain one is still a step', () => {
  expect(ids(rowsOf([mk('r1', null), mk('a', 'r1'), mk('r2', null), mk('b', 'r2')]))).toEqual(['r1', 'a', 'r2', 'b'])
  const rows = rowsOf([mk('r', null), mk('plain', 'r'), mk('deep-step', 'plain', { trunk: true }), mk('under-deep', 'deep-step')])
  expect(ids(rows)).toEqual(['r', 'plain', 'deep-step', 'under-deep'])
  expect(rows.map(r => r.depth)).toEqual([0, 1, 0, 1])
})

test('rows: steps are open and old branches are folded with a count of what they hide', () => {
  const rows = rowsOf([
    mk('root-a', null, { trunk: true }),
    mk('mid-a', 'root-a', { trunk: true }),
    mk('plain-a', 'root-a'),
    mk('deep-a', 'plain-a'),
    mk('deep-b', 'plain-a'),
    mk('leaf-a', 'mid-a'),
  ])
  expect(ids(rows)).toEqual(['root-a', 'plain-a', 'mid-a', 'leaf-a'])
  const plain = rows.find(r => r.node.id === 'plain-a')!
  expect(plain.hiddenKids).toBe(2)
  expect(plain.childCount).toBe(2)
  expect(plain.isExpanded).toBe(false)
  expect(rows.find(r => r.node.id === 'root-a')!.isExpanded).toBe(true)
  // a step the person closed hides all the branches of its own, and counts them
  const shut = rowsOf([mk('r', null, { trunk: true }), mk('a', 'r'), mk('b', 'a', { status: 'planned' }), mk('c', 'r')], { collapsed: ['r'] })
  expect(ids(shut)).toEqual(['r'])
  expect(shut[0]!.hiddenKids).toBe(3)
})

test('rows: pending work and branches changed in the last 48 hours are open down to the change', () => {
  const rows = rowsOf([
    mk('root-p', null),
    mk('old-branch', 'root-p'),
    mk('old-leaf', 'old-branch'),
    mk('hot-branch', 'root-p'),
    mk('hot-mid', 'hot-branch'),
    mk('hot-leaf', 'hot-mid', { updatedAt: iso(NOW - 3600 * 1000) }),
    mk('todo-branch', 'root-p'),
    mk('todo-leaf', 'todo-branch', { status: 'planned' }),
  ])
  expect(ids(rows)).toEqual(['root-p', 'old-branch', 'hot-branch', 'hot-mid', 'hot-leaf', 'todo-branch', 'todo-leaf'])
  expect(rows.map(r => r.depth)).toEqual([0, 1, 1, 2, 3, 1, 2])
  expect(rows.find(r => r.node.id === 'old-branch')!.hiddenKids).toBe(1)
})

test('rows: what the rail needs to draw each row: the head, the way ahead, the end, the last branch and what follows', () => {
  const rows = rowsOf([
    mk('s1', null, { trunk: true }),
    mk('s1-a', 's1'),
    mk('s1-b', 's1', { status: 'rejected' }),
    mk('s2', 's1', { trunk: true }),
    mk('s3', 's2', { trunk: true, status: 'planned' }),
    mk('s3-a', 's3', { status: 'planned' }),
    mk('s3-b', 's3-a', { status: 'planned' }),
  ])
  expect(ids(rows)).toEqual(['s1', 's1-a', 's1-b', 's2', 's3', 's3-a', 's3-b'])
  const by = (id: string) => rows.find(r => r.node.id === id)!.rail
  // the head is the newest step that was adopted; the rail below s2 leads to a step still ahead
  expect(rows.filter(r => r.rail.head).map(r => r.node.id)).toEqual(['s2'])
  expect(by('s2').ahead).toBe(true)
  expect(by('s1').ahead).toBe(false)
  expect(by('s3').end).toBe(true)
  expect(by('s1').end).toBe(false)
  // the last branch that hangs straight from a step, and the rows that have more after them
  expect([by('s1-a').lastBranch, by('s1-b').lastBranch]).toEqual([false, true])
  expect([by('s1-a').more, by('s1-b').more]).toEqual([true, false])
  expect([by('s3-a').lastBranch, by('s3-b').lastBranch, by('s3-b').more]).toEqual([true, false, false])
  expect(by('s1-a').end).toBe(false)
  expect(by('s3-b').end).toBe(true)
})

test('rows: what the person expanded or collapsed beats the defaults', () => {
  const nodes = [mk('r', null, { trunk: true }), mk('t', 'r', { trunk: true }), mk('c', 't'), mk('x', 'r'), mk('y', 'x')]
  expect(ids(rowsOf(nodes))).toEqual(['r', 'x', 't', 'c'])
  expect(ids(rowsOf(nodes, { collapsed: ['t'] }))).toEqual(['r', 'x', 't'])
  expect(ids(rowsOf(nodes, { expanded: ['x'] }))).toEqual(['r', 'x', 'y', 't', 'c'])
})

test('filters: default hides retracted nodes, all shows them, and a retracted node with live children stays as their parent', () => {
  const alone = [mk('r', null, { trunk: true }), mk('oops', 'r', { retracted: { ts: iso(NOW), actor: 'user' } }), mk('fine', 'r')]
  expect(ids(rowsOf(alone))).toEqual(['r', 'fine'])
  expect(ids(rowsOf(alone, { filter: 'all' }))).toEqual(['r', 'oops', 'fine'])
  const withKid = [...alone, mk('under-oops', 'oops', { status: 'planned' })]
  expect(ids(rowsOf(withKid))).toEqual(['r', 'oops', 'under-oops', 'fine'])
})

test('filters: pending keeps pending nodes and the way down to them; clean drops dead ends only', () => {
  const nodes = [
    mk('r', null, { trunk: true }),
    mk('done-a', 'r'),
    mk('todo-a', 'r', { status: 'planned' }),
    mk('todo-b', 'done-a', { status: 'in-progress' }),
    mk('dead-end', 'r', { status: 'rejected' }),
    mk('dead-parent', 'r', { status: 'rejected' }),
    mk('alive-kid', 'dead-parent', { status: 'adopted' }),
    mk('gone', 'r', { status: 'withdrawn' }),
  ]
  expect(ids(rowsOf(nodes, { filter: 'pending' }))).toEqual(['r', 'done-a', 'todo-b', 'todo-a'])
  expect(ids(rowsOf(nodes, { filter: 'clean' }))).toEqual(expect.arrayContaining(['r', 'done-a', 'todo-a', 'dead-parent']))
  const clean = ids(rowsOf(nodes, { filter: 'clean' }))
  expect(clean).not.toContain('dead-end')
  expect(clean).not.toContain('gone')
  expect(clean).not.toContain('alive-kid') // its parent is kept for context but stays collapsed
  expect(rowsOf(nodes, { filter: 'clean' }).find(r => r.node.id === 'dead-parent')!.hiddenKids).toBe(1)
  expect(ids(rowsOf(nodes, { filter: 'clean', expanded: ['dead-parent'] }))).toContain('alive-kid')
  expect(ids(rowsOf(nodes, { filter: 'all' })).sort()).toEqual(nodes.map(x => x.id).sort())
})

test('lookup: an id, a title piece, or a clear error', () => {
  const idx = buildIndex({
    nodes: [
      mk('merge-adopted', null, { title: '合并规则定为 v1.2' }),
      mk('sqlite-adopted', null, { title: '存储层采用' }),
      mk('json-rejected', null, { title: 'v1.1: window size absolute' }),
      mk('json-again', null, { title: 'v1.1 retry' }),
      mk('gone-one', null, { title: '撤掉的', retracted: { ts: iso(NOW), actor: 'user' } }),
    ],
  })
  expect(resolveRef(idx, 'merge-adopted')).toMatchObject({ node: { id: 'merge-adopted' } })
  expect(resolveRef(idx, '存储层')).toMatchObject({ node: { id: 'sqlite-adopted' } })
  expect(resolveRef(idx, 'MERGE-ADOPTED')).toMatchObject({ node: { id: 'merge-adopted' } })
  expect(resolveRef(idx, 'v1.1')).toEqual({ error: 'ambiguous', ids: ['json-rejected', 'json-again'] })
  expect(resolveRef(idx, 'nothing like it')).toEqual({ error: 'none' })
  expect(resolveRef(idx, '')).toEqual({ error: 'none' })
  expect(resolveRef(idx, '撤掉')).toEqual({ error: 'none' })
  expect(resolveRef(idx, 'gone-one')).toMatchObject({ node: { id: 'gone-one' } })
})

test('window: follows the selection, stays inside the rows, and reports what is cut', () => {
  expect(windowRows(100, 0, null, 10)).toEqual({ start: 0, end: 10, above: 0, below: 90 })
  expect(windowRows(100, 50, null, 10)).toEqual({ start: 45, end: 55, above: 45, below: 45 })
  expect(windowRows(100, 99, null, 10)).toEqual({ start: 90, end: 100, above: 90, below: 0 })
  expect(windowRows(5, 2, null, 10)).toEqual({ start: 0, end: 5, above: 0, below: 0 })
  expect(windowRows(0, -1, null, 10)).toEqual({ start: 0, end: 0, above: 0, below: 0 })
  const pinned = windowRows(100, 5, 30, 10)
  expect(pinned.start).toBe(30)
})

test('selection: a hidden selection falls back to its nearest drawn ancestor, else the first row', () => {
  const nodes = [mk('r', null, { trunk: true }), mk('t', 'r', { trunk: true }), mk('c', 't'), mk('x', 'r'), mk('y', 'x')]
  const idx = buildIndex({ nodes })
  const rows = visibleRows(idx, { ui: UI, nowMs: NOW })
  expect(effectiveSelection(idx, rows, 'c')).toBe('c')
  expect(effectiveSelection(idx, rows, 'y')).toBe('x')
  expect(effectiveSelection(idx, rows, 'nobody')).toBe('r')
  expect(effectiveSelection(idx, rows, null)).toBe('r')
  expect(effectiveSelection(idx, [], 'c')).toBeNull()
  expect(rowIndex(rows, 'x')).toBe(1)
  expect(rowIndex(rows, null)).toBe(-1)
})

test('mainline, recent nodes and supersession', () => {
  const idx = buildIndex({
    nodes: [
      mk('b-second', null, { trunk: true, decidedAt: iso(NOW - 2 * DAY) }),
      mk('a-first', null, { trunk: true, decidedAt: iso(NOW - 5 * DAY) }),
      mk('side', null),
      mk('old-take', null, { status: 'superseded', supersededBy: 'b-second' }),
      mk('retracted', null, { trunk: true, retracted: { ts: iso(NOW), actor: 'user' } }),
    ],
  })
  expect(trunkNodes(idx).map(x => x.id)).toEqual(['a-first', 'b-second'])
  expect(recentNodes(idx, 2).map(x => x.id)).toEqual(['old-take', 'side'])
  expect(supersededNodes(idx, 'b-second').map(x => x.id)).toEqual(['old-take'])
})
