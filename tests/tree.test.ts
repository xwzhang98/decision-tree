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

test('rows: trunk nodes open, everything else old is collapsed with a count of what it hides', () => {
  const rows = rowsOf([
    mk('root-a', null, { trunk: true }),
    mk('mid-a', 'root-a', { trunk: true }),
    mk('plain-a', 'root-a'),
    mk('deep-a', 'plain-a'),
    mk('deep-b', 'plain-a'),
    mk('leaf-a', 'mid-a'),
  ])
  expect(ids(rows)).toEqual(['root-a', 'mid-a', 'leaf-a', 'plain-a'])
  const plain = rows.find(r => r.node.id === 'plain-a')!
  expect(plain.hiddenKids).toBe(2)
  expect(plain.childCount).toBe(2)
  expect(plain.isExpanded).toBe(false)
  expect(rows.find(r => r.node.id === 'root-a')!.isExpanded).toBe(true)
})

test('rows: a row is as deep as its parent plus one, and a node comes right after its parent', () => {
  const rows = rowsOf([
    mk('r1', null, { trunk: true }),
    mk('a1', 'r1', { trunk: true }),
    mk('a2', 'a1', { trunk: true }),
    mk('a3', 'a1', { trunk: true }),
    mk('b1', 'r1', { trunk: true }),
    mk('b2', 'b1', { trunk: true }),
  ])
  expect(ids(rows)).toEqual(['r1', 'a1', 'a2', 'a3', 'b1', 'b2'])
  expect(rows.map(r => r.depth)).toEqual([0, 1, 2, 2, 1, 2])
  expect(rows.map(r => r.childCount)).toEqual([2, 2, 0, 0, 1, 0])
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
  expect(rows.find(r => r.node.id === 'old-branch')!.hiddenKids).toBe(1)
})

test('rows: what the person expanded or collapsed beats the defaults', () => {
  const nodes = [mk('r', null, { trunk: true }), mk('t', 'r', { trunk: true }), mk('c', 't'), mk('x', 'r'), mk('y', 'x')]
  expect(ids(rowsOf(nodes))).toEqual(['r', 't', 'c', 'x'])
  expect(ids(rowsOf(nodes, { collapsed: ['t'] }))).toEqual(['r', 't', 'x'])
  expect(ids(rowsOf(nodes, { expanded: ['x'] }))).toEqual(['r', 't', 'c', 'x', 'y'])
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
      mk('v22-adopted', null, { title: '构建版本定为 v2.2' }),
      mk('dbpool-adopted', null, { title: '连接池采用' }),
      mk('v21-rejected', null, { title: 'v2.1: pool size absolute' }),
      mk('v21-again', null, { title: 'v2.1 retry' }),
      mk('gone-one', null, { title: '撤掉的', retracted: { ts: iso(NOW), actor: 'user' } }),
    ],
  })
  expect(resolveRef(idx, 'v22-adopted')).toMatchObject({ node: { id: 'v22-adopted' } })
  expect(resolveRef(idx, '连接池')).toMatchObject({ node: { id: 'dbpool-adopted' } })
  expect(resolveRef(idx, 'V22-ADOPTED')).toMatchObject({ node: { id: 'v22-adopted' } })
  expect(resolveRef(idx, 'v2.1')).toEqual({ error: 'ambiguous', ids: ['v21-rejected', 'v21-again'] })
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
  expect(rowIndex(rows, 'x')).toBe(3)
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
