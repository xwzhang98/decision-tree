import { test, expect } from 'claude-code/testing'

import { Runtime } from '../lib/runtime'
import { OFF_LINE, PAUSED_LINE } from '../lib/prompt'
import { FakeEngine, ROOT, configPath, eventFiles, eventsOf } from './port'

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

async function started(title = 'orders') {
  const b = await boot()
  const answer = await b.rt.toolCall(b.p, 'decision_log_start', { title, rootTitle: 'design v2 定稿' })
  return { ...b, answer }
}

const text = (a: { result: string } | { deny: string }): string => ('result' in a ? a.result : `DENY: ${a.deny}`)

// ---------------------------------------------------------------- off

test('off: one tool, a one-line prompt, no files, and the pane says how to start', async () => {
  const { rt, engine } = await boot()
  expect(rt.mode).toBe('off')
  expect(engine.tools.map(t => t.name)).toEqual(['decision_log_start'])
  expect(engine.tools[0]?.isDeferred).toBe(false)
  expect([...engine.disk.files.keys()]).toEqual([])
  expect(rt.section()).toEqual({ id: 'decision-tree:record', text: OFF_LINE, scope: 'session' })
  expect(engine.cells.project).toMatchObject({ root: ROOT, mode: 'off', config: null })
  expect(engine.activeTimers).toBe(1)
})

test('off: the other tools are denied with the way to turn recording on', async () => {
  const { rt, p } = await boot()
  const r = await rt.toolCall(p, 'decision_record', { title: 'x', parent: null, status: 'adopted' })
  expect(r).toEqual({ deny: expect.stringContaining('decision_log_start') })
  const t = await rt.toolCall(p, 'decision_tree', {})
  expect('deny' in t).toBe(true)
})

// ---------------------------------------------------------------- start

test('start (model): writes config and events, registers the other tools, opens the pane unfocused', async () => {
  const { rt, engine, answer } = await started()
  expect(text(answer)).toBe('Started recording decisions for orders, root design-v2')
  expect(rt.mode).toBe('recording')
  expect(engine.tools.map(t => t.name).sort()).toEqual(['decision_log_start', 'decision_new_tree', 'decision_note', 'decision_record', 'decision_tree', 'decision_update', 'decision_use_tree'])
  const cfg = JSON.parse(engine.disk.text(configPath()))
  expect(cfg).toMatchObject({ v: 1, title: 'orders', recording: true })
  expect(eventsOf(engine).map(e => e.op)).toEqual(['start', 'add'])
  expect(eventsOf(engine)[1]).toMatchObject({ id: 'design-v2', actor: 'model', node: { title: 'design v2 定稿', trunk: true, status: 'adopted' } })
  // tree.json is a derived snapshot
  const tree = JSON.parse(engine.disk.text(`${ROOT}/.claude/decisions/tree.json`))
  expect(tree.project).toBe('orders')
  expect(tree.nodes).toHaveLength(1)
  // the pane opened, without asking for the keyboard
  expect(engine.opens).toHaveLength(1)
  expect(engine.opens[0]).toMatchObject({ id: 'decision-tree', columns: 72 })
  expect(engine.opens[0]?.focus).toBeUndefined()
  // the page's state follows
  expect(engine.cells.project.mode).toBe('recording')
  expect(engine.cells.model.nodes).toHaveLength(1)
  expect(rt.section()?.text).toContain('Decision record ON')
})

test('start: the second call says it is already on, and a gitignore of .claude/ is reported', async () => {
  const { rt, p, engine } = await started()
  expect(text(await rt.toolCall(p, 'decision_log_start', { title: 'again' }))).toContain('already being recorded')
  expect(eventsOf(engine)).toHaveLength(2)

  const other = new FakeEngine()
  other.gitIgnored = true
  const b = await boot(other)
  const a = await b.rt.toolCall(b.p, 'decision_log_start', { title: 'ignored' })
  expect(text(a)).toContain('.gitignore ignores .claude/')
})

test('start: a title is required, and a broken config.json is not overwritten', async () => {
  const { rt, p } = await boot()
  expect(await rt.toolCall(p, 'decision_log_start', {})).toEqual({ deny: expect.stringContaining('title') })

  const e = new FakeEngine()
  e.put(configPath(), '{ not json')
  const b = await boot(e)
  const r = await b.rt.toolCall(b.p, 'decision_log_start', { title: 'x' })
  expect('deny' in r && r.deny).toContain('config.json')
  expect(e.disk.text(configPath())).toBe('{ not json')
  expect(b.rt.mode).toBe('off')
  expect(e.cells.project.configError).not.toBeNull()
})

// ---------------------------------------------------------------- record, update, note, tree

test('record: one event per call, a one-line receipt, and the pane state moves', async () => {
  const { rt, engine, p } = await started()
  const r = await rt.toolCall(p, 'decision_record', {
    title: 'dbpool adopted',
    parent: 'design-v2',
    status: 'adopted',
    summary: 'P99 suite -12.6%',
    evidence: [{ label: 'v22 s0', value: '-12.6%', ci: '[-15.1, -10.4]', run: 'v22_s0' }],
  })
  expect(text(r)).toBe('Recorded dbpool-adopted (under design-v2, Adopted)')
  expect(eventFiles(engine)).toHaveLength(3)
  expect(engine.cells.model.nodes.map(n => n.id).sort()).toEqual(['dbpool-adopted', 'design-v2'])
  expect(engine.cells.model.nodes.find(n => n.id === 'dbpool-adopted')).toMatchObject({ createdBy: 'model', evidence: [{ label: 'v22 s0', run: 'v22_s0' }] })
  const tree = JSON.parse(engine.disk.text(`${ROOT}/.claude/decisions/tree.json`))
  expect(tree.nodes).toHaveLength(2)
})

test('record: a bad call is denied with something the model can act on, and writes nothing', async () => {
  const { rt, engine, p } = await started()
  const before = eventFiles(engine).length
  const noStatus = await rt.toolCall(p, 'decision_record', { title: 'x', parent: 'design-v2', status: 'good' })
  expect('deny' in noStatus && noStatus.deny).toContain('status')
  const noParent = await rt.toolCall(p, 'decision_record', { title: 'x', parent: 'nowhere', status: 'adopted' })
  expect('deny' in noParent && noParent.deny).toContain('decision_tree')
  expect(eventFiles(engine)).toHaveLength(before)
})

test('update and note: a change event each, a receipt each', async () => {
  const { rt, engine, p } = await started()
  await rt.toolCall(p, 'decision_record', { title: 'dbpool adopted', parent: 'design-v2', status: 'proposed' })
  const u = await rt.toolCall(p, 'decision_update', { id: 'dbpool-adopted', status: 'adopted', summary: 'confirmed' })
  expect(text(u)).toBe('Updated dbpool-adopted: status Adopted, summary')
  const n = await rt.toolCall(p, 'decision_note', { id: 'dbpool-adopted', text: 'seed 2 agrees' })
  expect(text(n)).toBe('Noted on dbpool-adopted')
  const node = engine.cells.model.nodes.find(x => x.id === 'dbpool-adopted')
  expect(node).toMatchObject({ status: 'adopted', summary: 'confirmed' })
  expect(node?.notes.map(x => x.text)).toEqual(['seed 2 agrees'])
  expect(eventsOf(engine).slice(-2).map(e => e.op)).toEqual(['update', 'note'])
})

test('decision_tree: the mainline and the latest nodes, or one node in detail', async () => {
  const { rt, p } = await started()
  await rt.toolCall(p, 'decision_record', { title: 'dbpool adopted', parent: 'design-v2', status: 'adopted', summary: 'P99 -12.6%' })
  const all = text(await rt.toolCall(p, 'decision_tree', {}))
  expect(all).toContain('design-v2')
  expect(all).toContain('dbpool-adopted')
  const one = text(await rt.toolCall(p, 'decision_tree', { id: 'dbpool-adopted' }))
  expect(one).toContain('P99 -12.6%')
})

// ---------------------------------------------------------------- pause

test('pause: nothing is recorded, the prompt says so, and resume turns it back on', async () => {
  const { rt, engine, p } = await started()
  expect(await rt.command(p, 'decide', 'pause')).toBe('Decision recording paused')
  expect(rt.mode).toBe('paused')
  expect(JSON.parse(engine.disk.text(configPath())).recording).toBe(false)
  const r = await rt.toolCall(p, 'decision_record', { title: 'x', parent: 'design-v2', status: 'adopted' })
  expect(text(r)).toContain('paused')
  expect(eventFiles(engine)).toHaveLength(2)
  await rt.onTurnStart(p)
  expect(rt.section()?.text).toBe(PAUSED_LINE)
  expect(engine.cells.project.mode).toBe('paused')

  expect(await rt.command(p, 'decide', 'resume')).toBe('Decision recording resumed')
  expect(rt.mode).toBe('recording')
  const again = await rt.toolCall(p, 'decision_record', { title: 'after resume', parent: 'design-v2', status: 'planned' })
  expect(text(again)).toContain('Recorded')
})
