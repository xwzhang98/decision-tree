import { test, expect } from 'claude-code/testing'

import type { DtActor, DtLang, DtStatus } from '../types'
import { parseConfig } from '../lib/config'
import { STATUSES } from '../lib/events'
import { Journal } from '../lib/journal'
import { addNode, importNodes, noteNode, recordNode, retractNode, startRecord, updateNode } from '../lib/ops'
import type { Ctx, Done } from '../lib/ops'
import { MemDisk } from './mem'

const ROOT = '/work/proj'
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)

function setup(session = 'aaaaaa', lang: DtLang = 'en', actor: DtActor = 'model') {
  const disk = new MemDisk()
  let clock = T0
  const make = (journal: Journal, a: DtActor = actor, l: DtLang = lang): Ctx => ({
    journal,
    lang: l,
    actor: a,
    now: () => (clock += 1000),
  })
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

test('start: writes config.json, a start event and the optional root, with the status command', async () => {
  const { disk, journal, ctx } = setup()
  const r = await startRecord(ctx, { title: 'orders', rootTitle: 'design v2 定稿', statusArgv: ['bash', 'scripts/status.sh'] })
  expect(expectOk(r)).toBe('Started recording decisions for orders, root design-v2')
  const cfg = parseConfig(disk.text(journal.configPath))
  expect('config' in cfg && cfg.config.title).toBe('orders')
  expect('config' in cfg && cfg.config.status?.argv).toEqual(['bash', 'scripts/status.sh'])
  const m = journal.model()
  expect(m.isStarted).toBe(true)
  expect(m.nodes).toHaveLength(1)
  expect(m.nodes[0]).toMatchObject({ id: 'design-v2', title: 'design v2 定稿', trunk: true, kind: 'milestone', status: 'adopted', parent: null })
})

test('start: without a root title only the config and the start event are written', async () => {
  const { disk, journal, ctx } = setup('bbbbbb', 'zh')
  const text = expectOk(await startRecord(ctx, { title: 'orders' }))
  expect(text).toBe('已开始记录 orders 的决定（数据在 .claude/decisions/）')
  expect(journal.model().nodes).toHaveLength(0)
  expect([...disk.files.keys()].filter(p => p.includes('/events/'))).toHaveLength(1)
})

test('start: a config.json that is there, or cannot be read just now, is never overwritten; the model is told in English, the person in the pane language', async () => {
  const { disk, journal, make } = setup('cccccc', 'zh')
  const model = make(journal, 'model')
  const person = make(journal, 'user')
  expectOk(await startRecord(person, { title: 'orders' }))
  const files = [...disk.files.keys()].sort()
  const config = disk.text(journal.configPath)

  // (the pane speaks Chinese here; the model reads its errors in English whatever the pane speaks)
  const english = '.claude/decisions/config.json already exists (or could not be read just now), so nothing was changed. Try again in a moment.'
  const chinese = '.claude/decisions/config.json 已经存在（或刚才读不出来），所以什么都没改。请稍后再试。'
  expect(expectError(await startRecord(model, { title: 'again' }))).toBe(english)
  expect(expectError(await startRecord(person, { title: 'again' }))).toBe(chinese)
  expect([...disk.files.keys()].sort()).toEqual(files)
  expect(disk.text(journal.configPath)).toBe(config)

  // the disk not answering about it is no reason to start over either
  disk.failing.add(journal.configPath)
  expect(expectError(await startRecord(model, { title: 'again' }))).toBe(english)
  expect(expectError(await startRecord(person, { title: 'again' }))).toBe(chinese)
  disk.failing.delete(journal.configPath)
  expect([...disk.files.keys()].sort()).toEqual(files)
  expect(disk.text(journal.configPath)).toBe(config)
})

test('record: adds a node under a parent, answers the receipt, and picks a slug id', async () => {
  const { journal, ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  const first = await recordNode(ctx, { title: 'Shared sockets adopted', parent: null, status: 'adopted', trunk: true })
  expect(expectOk(first)).toBe('Recorded shared-sockets-adopted (root, Adopted)')
  const second = await recordNode(ctx, {
    id: 'v22-adopted',
    title: 'Build version fixed at v2.2',
    parent: 'shared-sockets-adopted',
    status: 'adopted',
    decidedBy: 'user',
    summary: 'Use ratios for RAM, pools and queue sizes.',
    evidence: [{ label: 'warmed P99', value: -12.6, ci: '[-15.1, -10.4]', run: 'v22 s0' }],
    sources: ['reports/design_v22.md'],
  })
  expect(expectOk(second)).toBe('Recorded v22-adopted (under shared-sockets-adopted, Adopted)')
  const n = journal.model().nodes.find(x => x.id === 'v22-adopted')!
  expect(n).toMatchObject({ parent: 'shared-sockets-adopted', decidedBy: 'user', createdBy: 'model' })
  expect(n.evidence).toEqual([{ label: 'warmed P99', value: '-12.6', ci: '[-15.1, -10.4]', run: 'v22 s0' }])
  expect(n.sources).toEqual(['reports/design_v22.md'])
})

test('record: a Chinese title gets an automatic id, a taken id gets a suffix, a title piece names the parent', async () => {
  const { journal, ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  const a = await recordNode(ctx, { title: '连接池采用', parent: null, status: 'adopted' })
  expect(a.ok && a.id).toMatch(/^d-[a-z0-9]+$/)
  const b = await recordNode(ctx, { id: 'same-id', title: 'one', parent: '连接池', status: 'planned' })
  const c = await recordNode(ctx, { id: 'same-id', title: 'two', parent: null, status: 'planned' })
  expect(b.ok && b.id).toBe('same-id')
  expect(c.ok && c.id).toBe('same-id-2')
  expect(journal.model().nodes.find(x => x.id === 'same-id')!.parent).toBe(a.ok ? a.id : '')
})

test('record: says what is wrong, in terms the model can fix', async () => {
  const { ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  expect(expectError(await recordNode(ctx, { parent: null, status: 'adopted' }))).toContain('title is required')
  expect(expectError(await recordNode(ctx, { title: 'x', status: 'adopted' }))).toContain('parent is required')
  expect(expectError(await recordNode(ctx, { title: 'x', parent: null }))).toContain('status is required')
  expect(expectError(await recordNode(ctx, { title: 'x', parent: null, status: 'done' }))).toContain('status must be one of')
  expect(expectError(await recordNode(ctx, { title: 'x', parent: 'nobody', status: 'planned' }))).toContain('unknown node "nobody"')
  expect(expectError(await recordNode(ctx, { title: 'x'.repeat(200), parent: null, status: 'planned' }))).toContain('too long')
  expect(expectError(await recordNode(ctx, { title: 'x', parent: null, status: 'planned', decidedAt: 'last tuesday' }))).toContain('ISO 8601')
  expect(expectError(await recordNode(ctx, { title: 'x', parent: null, status: 'planned', evidence: [{ value: '1' }] }))).toContain('label')
})

test('record: two sessions that pick the same id at the same moment both end up with a node', async () => {
  const { disk, make } = setup()
  const a = new Journal(disk, ROOT, 'aaaaaa')
  const b = new Journal(disk, ROOT, 'bbbbbb')
  const ca = make(a)
  const cb = make(b)
  await recordNode(ca, { id: 'clash-id', title: 'from A', parent: null, status: 'planned' })
  // B has not seen A's file when it chooses its id: its first look at the disk finds nothing
  const realSync = b.sync.bind(b)
  let looks = 0
  b.sync = async () => (looks++ === 0 ? false : realSync())
  const rb = await recordNode(cb, { id: 'clash-id', title: 'from B', parent: null, status: 'planned' })
  b.sync = realSync
  await a.sync()
  await b.sync()
  expect(rb.ok && rb.id).toBe('clash-id-2')
  expect(a.model().nodes.map(n => n.id).sort()).toEqual(['clash-id', 'clash-id-2'])
  expect(JSON.stringify(a.model().nodes)).toBe(JSON.stringify(b.model().nodes))
  expect(a.model().warningCount).toBe(1) // B's first add is a duplicate and stays in the log
})

test('update: changes status with a decision time, appends evidence once, and supersedes', async () => {
  const { journal, ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  await recordNode(ctx, { id: 'old-take', title: 'old take', parent: null, status: 'in-progress' })
  await recordNode(ctx, { id: 'new-take', title: 'new take', parent: null, status: 'adopted' })

  const r1 = await updateNode(ctx, { id: 'old-take', status: 'adopted', summary: 'worked', addEvidence: [{ label: 'seed 0', value: '-12.6%' }] })
  expect(expectOk(r1)).toBe('Updated old-take: status Adopted, summary, 1 evidence added')
  const n1 = journal.model().nodes.find(n => n.id === 'old-take')!
  expect(n1.status).toBe('adopted')
  expect(n1.decidedAt).toMatch(/^2026-10-/)

  const r2 = await updateNode(ctx, { id: 'old-take', addEvidence: [{ label: 'seed 0', value: '-12.6%' }, { label: 'seed 1', value: '-13.5%' }] })
  expect(expectOk(r2)).toBe('Updated old-take: 1 evidence added')
  expect(journal.model().nodes.find(n => n.id === 'old-take')!.evidence).toHaveLength(2)

  const r3 = await updateNode(ctx, { id: 'old-take', supersededBy: 'new-take' })
  expect(expectOk(r3)).toContain('status Superseded')
  expect(expectOk(r3)).toContain('superseded by new-take')
  const n3 = journal.model().nodes.find(n => n.id === 'old-take')!
  expect(n3).toMatchObject({ status: 'superseded', supersededBy: 'new-take' })
})

test('update: nothing to change is not an error; a retracted node, a cycle and a bad id are', async () => {
  const { ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  await recordNode(ctx, { id: 'node-aa', title: 'a', parent: null, status: 'planned' })
  await recordNode(ctx, { id: 'node-bb', title: 'b', parent: 'node-aa', status: 'planned' })
  await recordNode(ctx, { id: 'node-cc', title: 'c', parent: null, status: 'planned' })
  expect(expectOk(await updateNode(ctx, { id: 'node-aa', status: 'planned' }))).toContain('No change')
  expect(expectError(await updateNode(ctx, { id: 'node-aa', parent: 'node-bb' }))).toContain('cycle')
  expect(expectError(await updateNode(ctx, { id: 'node-aa', supersededBy: 'node-aa' }))).toContain('cannot supersede itself')
  expect(expectError(await updateNode(ctx, { id: 'ghost', status: 'adopted' }))).toContain('unknown node "ghost"')
  expect(expectError(await updateNode(ctx, { status: 'adopted' }))).toContain('id is required')
  await retractNode(ctx, 'node-cc', 'mistake')
  expect(expectError(await updateNode(ctx, { id: 'node-cc', status: 'adopted' }))).toContain('retracted')
})

test('update: a new parent writes a move event; clearing a field writes null', async () => {
  const { journal, ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  await recordNode(ctx, { id: 'node-aa', title: 'a', parent: null, status: 'planned' })
  await recordNode(ctx, { id: 'node-bb', title: 'b', parent: null, status: 'planned', summary: 'to be cleared' })
  const r = await updateNode(ctx, { id: 'node-bb', parent: 'node-aa', summary: null })
  expect(expectOk(r)).toContain('Moved node-bb under node-aa')
  const n = journal.model().nodes.find(x => x.id === 'node-bb')!
  expect(n.parent).toBe('node-aa')
  expect(n.summary).toBeUndefined()
  const moveToRoot = await updateNode(ctx, { id: 'node-bb', parent: null })
  expect(expectOk(moveToRoot)).toContain('to the root')
})

test('note, retract and the receipts in Chinese', async () => {
  const { journal, make } = setup('cccccc', 'zh')
  const ctx = make(journal)
  await startRecord(ctx, { title: 'p' })
  const rec = await recordNode(ctx, { id: 'v22-adopted', title: '构建版本定为 v2.2', parent: null, status: 'adopted' })
  expect(expectOk(rec)).toBe('已记录 v22-adopted（根节点，采用）')
  expect(expectOk(await noteNode(ctx, { id: '构建版本', text: '两个 seed 方向一致' }))).toBe('已给 v22-adopted 加备注')
  expect(journal.model().nodes[0]!.notes[0]!.text).toBe('两个 seed 方向一致')
  expect(expectError(await noteNode(ctx, { id: 'v22-adopted', text: '  ' }))).toBe('text is required')
  expect(expectOk(await retractNode(ctx, 'v22-adopted', '记错了'))).toBe('已撤销 v22-adopted')
  expect(journal.model().nodes[0]!.retracted).toMatchObject({ reason: '记错了', actor: 'model' })
  expect(expectError(await retractNode(ctx, 'v22-adopted', 'again'))).toContain('already retracted')
})

test('manual operations are written as the user', async () => {
  const { journal, make } = setup()
  const ctx = make(journal, 'user')
  await startRecord(ctx, { title: 'p' })
  const r = await addNode(ctx, { title: '3 proxies', parent: null, status: 'planned', kind: 'decision', id: null, trunk: false })
  expect(r.ok).toBe(true)
  expect(journal.model().nodes[0]).toMatchObject({ createdBy: 'user', status: 'planned' })
})

test('import: a batch keeps its tree, uses its ids, and skips what cannot be used', async () => {
  const { journal, make } = setup()
  const ctx = make(journal, 'import')
  await startRecord(ctx, { title: 'p' })
  const text = expectOk(
    await importNodes(ctx, [
      { id: 'child-one', title: 'child', parent: 'root-one', status: 'adopted', decidedAt: '2026-10-09' },
      { id: 'root-one', title: 'root', parent: null, status: 'adopted', trunk: true, decidedAt: '2026-10-08T17:44:00-04:00', decidedBy: 'user' },
      { id: 'old-one', title: 'old', parent: 'root-one', status: 'superseded', supersededBy: 'child-one' },
      { title: 'no status here' },
      'not an object',
      { id: 'orphan-one', title: 'orphan', parent: 'nowhere', status: 'planned' },
    ]),
  )
  // the orphan's parent names nothing, so it is placed at the root, and the receipt says so
  expect(text).toBe('Imported 4 nodes (2 skipped) Placed at the root for lack of a usable parent: 1.')
  const by = new Map(journal.model().nodes.map(n => [n.id, n] as const))
  expect(by.get('child-one')!.parent).toBe('root-one')
  expect(by.get('root-one')!.parent).toBeNull()
  expect(by.get('orphan-one')!.parent).toBeNull()
  expect(by.get('old-one')!.supersededBy).toBe('child-one')
  expect(by.get('root-one')!).toMatchObject({ createdBy: 'import', decidedBy: 'user', trunk: true })
  expect(journal.model().warningCount).toBe(0)
})

test('import: ids that already exist get a suffix instead of being lost', async () => {
  const { journal, ctx } = setup()
  await startRecord(ctx, { title: 'p' })
  await recordNode(ctx, { id: 'taken-id', title: 'mine', parent: null, status: 'adopted' })
  const r = await importNodes(ctx, [{ id: 'taken-id', title: 'theirs', parent: null, status: 'adopted' }])
  expect(expectOk(r)).toBe('Imported 1 nodes (0 skipped)')
  expect(journal.model().nodes.map(n => n.id)).toEqual(['taken-id', 'taken-id-2'])
  expect(expectError(await importNodes(ctx, { not: 'an array' }))).toContain('not an array')
  expect(expectError(await importNodes(ctx, [{ title: 'x' }]))).toContain('No usable nodes')
})

test('import: the same file twice changes nothing the second time; what was edited since is left alone', async () => {
  const { disk, journal, make } = setup()
  const ctx = make(journal, 'import')
  await startRecord(ctx, { title: 'p' })
  const batch = [
    { id: 'seed-root', title: 'seed root', parent: null, status: 'adopted', trunk: true },
    { id: 'seed-one', title: 'first seed', parent: 'seed-root', status: 'planned', summary: 'as imported' },
    { id: 'seed-two', title: 'second seed', parent: 'seed-root', status: 'planned' },
  ]
  expect(expectOk(await importNodes(ctx, batch))).toBe('Imported 3 nodes (0 skipped)')

  // the person works on one of them in between
  const person = make(journal, 'user')
  expectOk(await updateNode(person, { id: 'seed-one', status: 'rejected', summary: 'tried it, no' }))
  const files = disk.files.size
  const before = JSON.stringify(journal.model().nodes)

  // the same file again, from a session that starts fresh: nothing is written, nothing is overwritten
  const later = new Journal(disk, ROOT, 'bbbbbb')
  expect(expectOk(await importNodes(make(later, 'import'), batch))).toBe('Nothing new: 3 already in the record.')
  expect(disk.files.size).toBe(files)
  await journal.sync()
  expect(JSON.stringify(journal.model().nodes)).toBe(before)
  expect(journal.model().nodes.map(n => n.id)).toEqual(['seed-root', 'seed-one', 'seed-two'])
  expect(journal.model().nodes[1]).toMatchObject({ status: 'rejected', summary: 'tried it, no' })

  // a longer file adds only what is new, hangs it under a node that is already there, and says what it left alone
  const longer = [...batch, { id: 'seed-three', title: 'third seed', parent: 'seed-one', status: 'proposed' }]
  expect(expectOk(await importNodes(ctx, longer))).toBe('Imported 1 nodes (0 skipped) Already in the record, left as they are: 3.')
  const by = new Map(journal.model().nodes.map(n => [n.id, n] as const))
  expect([...by.keys()]).toEqual(['seed-root', 'seed-one', 'seed-two', 'seed-three'])
  expect(by.get('seed-three')!.parent).toBe('seed-one')
  expect(by.get('seed-one')).toMatchObject({ status: 'rejected', summary: 'tried it, no' })
  expect(journal.model().warningCount).toBe(0)
})

test('import: a parent that is its own node, or a loop inside the file, puts nodes at the root and says how many', async () => {
  const { journal, make } = setup()
  const ctx = make(journal, 'import')
  await startRecord(ctx, { title: 'p' })
  const text = expectOk(
    await importNodes(ctx, [
      { id: 'self-one', title: 'its own parent', parent: 'self-one', status: 'planned' },
      { id: 'loop-aa', title: 'loop a', parent: 'loop-cc', status: 'planned' },
      { id: 'loop-bb', title: 'loop b', parent: 'loop-aa', status: 'planned' },
      { id: 'loop-cc', title: 'loop c', parent: 'loop-bb', status: 'planned' },
      { id: 'tail-one', title: 'hangs off the loop', parent: 'loop-bb', status: 'planned' },
    ]),
  )
  expect(text).toBe('Imported 5 nodes (0 skipped) Placed at the root for lack of a usable parent: 2.')
  const parents = Object.fromEntries(journal.model().nodes.map(n => [n.id, n.parent] as const))
  // the loop is cut at the node that comes last in the file; the rest of it keeps its parents
  expect(parents).toEqual({ 'self-one': null, 'loop-aa': 'loop-cc', 'loop-bb': 'loop-aa', 'loop-cc': null, 'tail-one': 'loop-bb' })
  // the cut was made before writing: replaying the files finds no cycle to cut
  expect(journal.model().warningCount).toBe(0)
})

test("who decided: a matter the person settles is theirs unless they said otherwise; the model's own calls are not assumed to be the person's", async () => {
  const { journal, make } = setup()
  const person = make(journal, 'user')
  const model = make(journal, 'model')
  await startRecord(person, { title: 'p' })
  const node = (id: string) => journal.model().nodes.find(n => n.id === id)!
  const record = async (c: Ctx, id: string, status: DtStatus, extra: Record<string, unknown> = {}) =>
    expectOk(await recordNode(c, { id, title: `${id} title`, parent: null, status, ...extra }))
  const update = async (c: Ctx, id: string, patch: Record<string, unknown>) => expectOk(await updateNode(c, { id, ...patch }))

  // the person records a matter: a settled status is theirs, an open one is nobody's yet
  const settled: DtStatus[] = ['adopted', 'rejected', 'no-diff', 'withdrawn', 'superseded']
  const open: DtStatus[] = ['in-progress', 'planned', 'proposed', 'deferred']
  expect([...settled, ...open].sort()).toEqual([...STATUSES].sort())
  for (const status of [...settled, ...open]) await record(person, `by-user-${status}`, status)
  for (const status of settled) expect(node(`by-user-${status}`).decidedBy).toBe('user')
  for (const status of open) expect(node(`by-user-${status}`).decidedBy).toBeUndefined()

  // unless they said otherwise
  await record(person, 'gate-said-so', 'rejected', { decidedBy: 'gate' })
  expect(node('gate-said-so').decidedBy).toBe('gate')

  // the model's own calls are the model's: it does not become the person's decision by being recorded
  await record(model, 'by-model', 'adopted')
  await record(model, 'user-told-model', 'adopted', { decidedBy: 'user' })
  expect(node('by-model')).toMatchObject({ createdBy: 'model', status: 'adopted' })
  expect(node('by-model').decidedBy).toBeUndefined()
  expect(node('user-told-model').decidedBy).toBe('user')

  // the same rule when a matter that was open becomes settled
  for (const id of ['open-a', 'open-b', 'open-c', 'open-d', 'open-f', 'open-g']) await record(model, id, 'planned')
  await record(model, 'open-e', 'planned', { decidedBy: 'gate' })
  await update(person, 'open-a', { status: 'adopted' })
  await update(model, 'open-b', { status: 'adopted' })
  await update(person, 'open-c', { status: 'rejected', decidedBy: 'gate' })
  await update(person, 'open-d', { status: 'in-progress' })
  await update(person, 'open-e', { status: 'adopted' })
  await update(person, 'open-f', { supersededBy: 'open-a' })
  await update(model, 'open-g', { supersededBy: 'open-a' })
  expect(node('open-a')).toMatchObject({ status: 'adopted', decidedBy: 'user' })
  expect(node('open-b').status).toBe('adopted')
  expect(node('open-b').decidedBy).toBeUndefined()
  expect(node('open-c')).toMatchObject({ status: 'rejected', decidedBy: 'gate' })
  expect(node('open-d').status).toBe('in-progress')
  expect(node('open-d').decidedBy).toBeUndefined()
  // a node that already says who decided keeps it
  expect(node('open-e')).toMatchObject({ status: 'adopted', decidedBy: 'gate' })
  // superseding is settling too
  expect(node('open-f')).toMatchObject({ status: 'superseded', decidedBy: 'user' })
  expect(node('open-g').status).toBe('superseded')
  expect(node('open-g').decidedBy).toBeUndefined()
})

test('errors the person reads are in their language; the ones the model reads stay English', async () => {
  const { disk, journal, make } = setup('dddddd', 'zh')
  const person = make(journal, 'user') // reads Chinese
  const model = make(journal, 'model') // the same pane, but the model reads English
  const english = make(journal, 'user', 'en') // a person who reads English
  await startRecord(person, { title: 'p' })
  await recordNode(person, { id: 'node-aa', title: '节点甲', parent: null, status: 'planned' })
  await recordNode(person, { id: 'node-bb', title: '节点乙', parent: 'node-aa', status: 'planned' })
  await recordNode(person, { id: 'node-cc', title: '节点丙', parent: null, status: 'planned' })
  await retractNode(person, 'node-cc', '记错了')

  // the same mistakes, one after another; none of them writes anything
  const mistakes = async (c: Ctx): Promise<string[]> => [
    expectError(await recordNode(c, { title: 'x', status: 'planned' })),
    expectError(await recordNode(c, { title: 'x'.repeat(200), parent: null, status: 'planned' })),
    expectError(await updateNode(c, { status: 'adopted' })),
    expectError(await updateNode(c, { id: 'ghost', status: 'adopted' })),
    expectError(await updateNode(c, { id: 'node-aa', parent: 'node-bb' })),
    expectError(await updateNode(c, { id: 'node-aa', supersededBy: 'node-aa' })),
    expectError(await updateNode(c, { id: 'node-cc', status: 'adopted' })),
    expectError(await noteNode(c, { id: 'node-aa', text: '  ' })),
    expectError(await retractNode(c, 'node-cc', 'again')),
  ]
  const files = disk.files.size
  expect(await mistakes(person)).toEqual([
    '需要 parent（节点 id；根节点用 null）',
    '标题太长（200 > 120 个字符）；标题只写一行，其余放进 summary',
    '需要节点 id',
    '没有节点 "ghost"；用 decision_tree 查看 id',
    '把 node-aa 移到 node-bb 下会形成环',
    'node-aa 不能取代自己',
    'node-cc 已撤销，不能再修改',
    '需要文字',
    'node-cc 已经撤销了',
  ])
  const forModel = [
    'parent is required (a node id, or null for a root)',
    'title is too long (200 > 120 characters); keep it to one short line and put the rest in summary',
    'id is required',
    'unknown node "ghost"; call decision_tree to see the ids',
    'moving node-aa under node-bb would make a cycle',
    'node-aa cannot supersede itself',
    'node-cc was retracted; it can no longer be changed',
    'text is required',
    'node-cc is already retracted',
  ]
  expect(await mistakes(model)).toEqual(forModel)
  // English is what a person who reads English sees, not a mode of the model
  expect(await mistakes(english)).toEqual(forModel)
  expect(disk.files.size).toBe(files)

  // a disk that refuses the write is told the same way
  disk.write = async () => {
    throw new Error('EROFS: read-only file system\nsecond line')
  }
  expect(expectError(await noteNode(person, { id: 'node-aa', text: 'x' }))).toBe('写不进记录：EROFS: read-only file system')
  expect(expectError(await noteNode(model, { id: 'node-aa', text: 'x' }))).toBe('Cannot write the record: EROFS: read-only file system')
  expect(expectError(await noteNode(english, { id: 'node-aa', text: 'x' }))).toBe('Cannot write the record: EROFS: read-only file system')
})
