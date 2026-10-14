import { test, expect } from 'claude-code/testing'

import type { DecisionEvent, DtNode } from '../types'
import { eventFileName, isoLocal } from '../lib/events'
import { buildIndex } from '../lib/tree'
import { describeEvent, numbered, parseWhen, resolveVersion, stampMs, whenOf, whenOfName } from '../lib/versions'
import type { Entry } from '../lib/versions'

const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)
const MIN = 60_000
const p2 = (n: number) => String(n).padStart(2, '0')

/** A date and time as the person would write it for this instant (the machine's own zone). */
function local(ms: number, parts: 'date' | 'minute' | 'second' = 'minute'): string {
  const d = new Date(ms)
  const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  if (parts === 'date') return date
  const clock = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  return parts === 'minute' ? `${date} ${clock}` : `${date} ${clock}:${p2(d.getSeconds())}`
}

function ev(op: DecisionEvent['op'], ms: number, rest: Partial<DecisionEvent> = {}): DecisionEvent {
  return { v: 1, op, ts: isoLocal(ms), session: 'abcdef', actor: 'user', ...rest }
}

/** Six events a minute apart: a start, then five adds. */
function history(): { list: Entry[]; nodes: DtNode[] } {
  const list: Entry[] = [{ name: eventFileName(T0 + MIN, 'abcdef', 0), event: ev('start', T0 + MIN) }]
  const nodes: DtNode[] = []
  const adds: [string, string][] = [
    ['notes-app', 'notes app 立项'],
    ['sqlite-adopted', '存储层采用'],
    ['merge-adopted', '合并规则定为 v1.2'],
    ['merge-rerun', '合并规则 v1.2 重跑'],
    ['sql-next', '下一步做 sql'],
  ]
  adds.forEach(([id, title], i) => {
    const ms = T0 + (i + 2) * MIN
    const name = eventFileName(ms, 'abcdef', 0)
    list.push({ name, event: ev('add', ms, { id, node: { title, parent: null, status: 'adopted', kind: 'decision' } }) })
    nodes.push({ id, title, parent: null, status: 'adopted', kind: 'decision', createdAt: isoLocal(ms), createdBy: 'user', updatedAt: isoLocal(ms), notes: [], addedBy: name })
  })
  return { list, nodes }
}

const H = history()
const IDX = buildIndex({ nodes: H.nodes })
const at = (spec: string, now = T0 + 60 * MIN) => resolveVersion(spec, H.list, IDX, now)
const count = (spec: string, now?: number): number | string => {
  const r = at(spec, now)
  return r.ok ? r.count : r.error
}

// ---------------------------------------------------------------- the version a word names

test('versions: nothing, current and its synonyms mean everything so far', () => {
  for (const spec of ['', '  ', 'current', 'Now', 'HEAD', 'latest', '当前', '最新', '@current', '@']) expect(count(spec)).toBe(6)
  const r = at('')
  expect(r.ok && r.at).toBe(H.list[5]!.name)
})

test('versions: #N is the first N events', () => {
  expect(count('#1')).toBe(1)
  expect(count('#4')).toBe(4)
  expect(count('# 6')).toBe(6)
  const r = at('#3')
  expect(r.ok && r.at).toBe(H.list[2]!.name)
  expect(r.ok && r.when).toBe(whenOf(H.list[2]!.event))
  expect(at('#0')).toMatchObject({ ok: false, error: 'number', n: 0, max: 6 })
  expect(at('#7')).toMatchObject({ ok: false, error: 'number', n: 7, max: 6 })
})

test('versions: a tree with no events has no version to start from', () => {
  expect(resolveVersion('current', [], IDX, T0)).toEqual({ ok: false, error: 'empty' })
  expect(resolveVersion('#1', [], IDX, T0)).toEqual({ ok: false, error: 'empty' })
})

test('versions: a time is the tree as it was by the end of the minute, day or second given', () => {
  // events at 12:01 ... 12:06 UTC
  expect(count(local(T0 + 3 * MIN))).toBe(3)
  expect(count(local(T0 + 3 * MIN + 30_000, 'second'))).toBe(3)
  expect(count(local(T0 + 3 * MIN, 'second'))).toBe(3)
  expect(count(local(T0 + 2 * MIN - 1000, 'second'))).toBe(1)
  expect(count(`${local(T0 + 4 * MIN)}`.replace(' ', 'T'))).toBe(4)
  // the whole day
  expect(count(local(T0 + 2 * MIN, 'date'), T0 + 60 * MIN)).toBe(6)
  // with a zone it is that instant, whatever the machine's zone
  expect(count('2026-10-10T12:03:00Z')).toBe(3)
  expect(count('2026-10-10T08:03:00-04:00')).toBe(3)
  expect(count('2026-10-10 12:04+00:00')).toBe(4)
  // later than everything is the current version
  expect(count(local(T0 + 600 * MIN))).toBe(6)
})

test('versions: before the first event there is nothing to start from', () => {
  const r = at(local(T0 - 10 * MIN))
  expect(r).toMatchObject({ ok: false, error: 'before' })
  expect(r.ok === false && r.error === 'before' && r.first).toBe(whenOf(H.list[0]!.event))
})

test('versions: times can be written the way they are said', () => {
  const d = new Date(T0 + 3 * MIN)
  const month = d.getMonth() + 1
  const day = d.getDate()
  const clock = `${d.getHours()}:${p2(d.getMinutes())}`
  const now = T0 + 60 * MIN
  expect(count(`${p2(month)}-${p2(day)} ${clock}`, now)).toBe(3)
  expect(count(`${month}月${day}日 ${clock}`, now)).toBe(3)
  expect(count(`${d.getFullYear()}年${month}月${day}日 ${d.getHours()}点${p2(d.getMinutes())}分`, now)).toBe(3)
  expect(count(`${month}/${day} ${clock}`, now)).toBe(3)
  // a clock time alone is today's
  expect(count(clock, now)).toBe(3)
})

test('versions: the end of what a time covers, and the odd cases', () => {
  const noon = new Date(2026, 9, 8, 12, 0, 0).getTime()
  const now = new Date(2026, 9, 10, 9, 0, 0).getTime()
  expect(parseWhen('2026-10-08', now)).toBe(new Date(2026, 9, 8, 23, 59, 59, 999).getTime())
  expect(parseWhen('2026-10-08 12:00', now)).toBe(noon + 59_999)
  expect(parseWhen('2026-10-08 12:00:30', now)).toBe(noon + 30_999)
  expect(parseWhen('10-08 12:00', now)).toBe(noon + 59_999)
  // no year, and that day has not come yet this year: last year's
  expect(parseWhen('12-25', now)).toBe(new Date(2025, 11, 25, 23, 59, 59, 999).getTime())
  // a clock time later than now is yesterday's
  expect(parseWhen('17:44', now)).toBe(new Date(2026, 9, 9, 17, 44, 59, 999).getTime())
  // dates that do not exist, and things that are not dates
  expect(parseWhen('2026-02-30', now)).toBeNull()
  expect(parseWhen('2026-13-01', now)).toBeNull()
  expect(parseWhen('2026-10-08 25:00', now)).toBeNull()
  expect(parseWhen('merge-adopted', now)).toBeNull()
  expect(parseWhen('2.2', now)).toBeNull()
})

test('versions: the stamp in an event file name, whole or cut short', () => {
  const name3 = H.list[2]!.name
  expect(count(name3)).toBe(3)
  expect(count(name3.replace(/\.json$/, ''))).toBe(3)
  const minute = name3.slice(0, 13) // 20261010T1203: by the end of that minute
  expect(count(minute)).toBe(3)
  expect(at('20250101T000000Z')).toMatchObject({ ok: false, error: 'before' })
  expect(count('20301231T000000Z')).toBe(6)
  expect(stampMs(name3)).toBe(T0 + 3 * MIN)
  expect(stampMs('not-a-stamp.json')).toBeNull()
  expect(whenOfName(name3)).toBe(whenOf(H.list[2]!.event))
  expect(whenOfName('whatever.json')).toBe('')
})

test('versions: a node is the tree as it was when that node was recorded', () => {
  expect(count('notes-app')).toBe(2)
  expect(count('merge-adopted')).toBe(4)
  expect(count('node:merge-adopted')).toBe(4)
  expect(count('节点：notes-app')).toBe(2)
  // a piece of the title
  expect(count('存储层')).toBe(3)
  expect(count('立项')).toBe(2)
  // more than one node
  expect(at('merge')).toMatchObject({ ok: false, error: 'ambiguous', ref: 'merge' })
  const amb = at('merge')
  expect(amb.ok === false && amb.error === 'ambiguous' && amb.ids.sort()).toEqual(['merge-adopted', 'merge-rerun'])
  // nothing
  expect(at('no such thing')).toMatchObject({ ok: false, error: 'unknown', spec: 'no such thing' })
  expect(at('node:nothing')).toMatchObject({ ok: false, error: 'unknown' })
})

test('versions: a node whose event is not among the numbered ones is not a version', () => {
  const lost: DtNode = { ...H.nodes[0]!, id: 'lost-node', title: 'lost', addedBy: 'somewhere-else.json' }
  const idx = buildIndex({ nodes: [...H.nodes, lost] })
  expect(resolveVersion('lost-node', H.list, idx, T0)).toMatchObject({ ok: false, error: 'unknown' })
})

test('versions: the fork marker is not counted', () => {
  const marker: Entry = { name: eventFileName(T0 + 9 * MIN, 'abcdef', 1), event: ev('fork', T0 + 9 * MIN, { base: { tree: 'main', at: H.list[2]!.name, count: 3 } }) }
  expect(numbered([...H.list, marker])).toHaveLength(6)
  expect(numbered([...H.list, marker]).some(e => e.event.op === 'fork')).toBe(false)
})

// ---------------------------------------------------------------- the log

test('describeEvent: one short phrase per event', () => {
  expect(describeEvent(H.list[0]!.event)).toBe('start')
  expect(describeEvent(H.list[1]!.event)).toBe('add notes-app "notes app 立项"')
  expect(describeEvent(ev('update', T0, { id: 'a-node', patch: { status: 'rejected', summary: 'x' } }))).toBe('update a-node status rejected')
  expect(describeEvent(ev('update', T0, { id: 'a-node', patch: { summary: 'x', rationale: 'y' } }))).toBe('update a-node summary, rationale')
  expect(describeEvent(ev('update', T0, { id: 'a-node', patch: { addEvidence: [] } }))).toBe('update a-node addEvidence')
  expect(describeEvent(ev('note', T0, { id: 'a-node', text: 'hi' }))).toBe('note a-node')
  expect(describeEvent(ev('move', T0, { id: 'a-node', parent: 'other' }))).toBe('move a-node → other')
  expect(describeEvent(ev('move', T0, { id: 'a-node', parent: null }))).toBe('move a-node → root')
  expect(describeEvent(ev('retract', T0, { id: 'a-node' }))).toBe('retract a-node')
  expect(describeEvent(ev('fork', T0))).toBe('fork')
  expect(describeEvent(ev('add', T0, { id: 'x-node', node: { title: 'a'.repeat(100), parent: null, status: 'adopted', kind: 'decision' } }))).toBe(`add x-node "${'a'.repeat(39)}…"`)
})
