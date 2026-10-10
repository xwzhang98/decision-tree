// The hooks module as the engine runs it: every event goes in through `$` the way
// the REPL raises it, and what comes out is what the model, the person and the
// disk would see.

import { test, expect } from 'claude-code/testing'

import { MAX_SECTION } from '../lib/prompt'
import { SKETCH, linesOf, mountPane, rowKeys } from './draw'
import { callTool, compose, eventsOn, sectionOf, seed, slash, startTurn, submit, world } from './engine'
import { ROOT } from './port'

const DIR = `${ROOT}/.claude/decisions`
const CONFIG = `${DIR}/config.json`

const resultOf = (r: unknown): string => String((r as { result?: unknown }).result ?? '')
const denyOf = (r: unknown): string => String((r as { deny?: unknown }).deny ?? '')
const said = (r: unknown): string => String((r as { text?: unknown }).text ?? '')

// ---------------------------------------------------------------- session.start

test('session.start: the commands and the one tool a project that is off needs are registered by turn one', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  expect(w.commands.map(c => c.name).sort()).toEqual(['decide', 'tree'])
  expect(w.commands.find(c => c.name === 'decide')?.argumentHint).toContain('start')
  expect(w.tools.map(t => t.name)).toEqual(['decision_log_start'])
  const start = w.tools[0]
  expect(start?.isDeferred).toBe(false)
  expect(start?.inputSchema).toMatchObject({ required: ['title'] })
  expect(w.disk.files.size).toBe(0) // an unrecorded project is left alone
})

test('session.start: a project that is already recorded lists its six tools at once', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  // decision_log_start has nothing left to do in a project that is on
  expect(w.tools.map(t => t.name).sort()).toEqual(['decision_new_tree', 'decision_note', 'decision_record', 'decision_tree', 'decision_update', 'decision_use_tree'])
  // listed in full from the first request, not left for the model to search for
  expect(w.tools.every(t => t.isDeferred === false)).toBe(true)
})

test('the project root: the nearest folder above the cwd that has a record', async ($, on) => {
  const w = world(on, { cwd: `${ROOT}/src/deep` })
  seed(w, SKETCH)
  await $.session.start({ cwd: `${ROOT}/src/deep`, surface: 'terminal', isInteractive: true })
  expect(w.tools.map(t => t.name)).toContain('decision_record')
  await callTool($, 'decision_note', { id: 'design-v2', text: 'from a subfolder' })
  expect(eventsOn(w).at(-1)).toMatchObject({ op: 'note', text: 'from a subfolder' })
  expect([...w.disk.files.keys()].some(p => p.startsWith(`${ROOT}/src/`))).toBe(false)
})

test('the project root: else the top of the git repository', async ($, on) => {
  const w = world(on, { cwd: '/work/other/sub' })
  w.gitTop = '/work/other'
  await $.session.start({ cwd: '/work/other/sub', surface: 'terminal', isInteractive: true })
  await callTool($, 'decision_log_start', { title: 'other' })
  expect(w.disk.files.has('/work/other/.claude/decisions/config.json')).toBe(true)
  expect(w.disk.files.has('/work/other/sub/.claude/decisions/config.json')).toBe(false)
})

test('the project root: else the folder the session started in', async ($, on) => {
  const w = world(on, { cwd: '/work/plain' })
  await $.session.start({ cwd: '/work/plain', surface: 'terminal', isInteractive: true })
  await callTool($, 'decision_log_start', { title: 'plain' })
  expect(w.disk.files.has('/work/plain/.claude/decisions/config.json')).toBe(true)
})

// ---------------------------------------------------------------- off: the model's first tool

test('off: the other tools are denied with the way to turn recording on, and nothing is written', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const denied = await callTool($, 'decision_record', { title: 'x', parent: null, status: 'adopted' })
  expect(denyOf(denied)).toContain('decision_log_start')
  expect(denyOf(await callTool($, 'decision_tree'))).toContain('not being recorded')
  expect(w.disk.files.size).toBe(0)
})

test('decision_log_start turns the project on: config, a start event, the root, the other tools and the pane', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const r = await callTool($, 'decision_log_start', { title: 'orders-api-rewrite', rootTitle: 'design v2', statusArgv: ['bash', 'scripts/status.sh'] })
  expect(resultOf(r)).toMatch(/Started recording decisions for orders-api-rewrite, root design-v2/)

  const config = JSON.parse(w.disk.text(CONFIG))
  expect(config).toMatchObject({
    v: 1,
    title: 'orders-api-rewrite',
    recording: true,
    status: { argv: ['bash', 'scripts/status.sh'], intervalSec: 30, timeoutSec: 15 },
    display: { asciiGlyphs: false, autoOpen: true, language: 'auto' },
  })
  const events = eventsOn(w)
  expect(events.map(e => e.op)).toEqual(['start', 'add'])
  expect(events[1]).toMatchObject({ v: 1, actor: 'model', id: 'design-v2', node: { title: 'design v2', parent: null, status: 'adopted', kind: 'milestone', trunk: true } })
  expect(w.tools.map(t => t.name).sort()).toEqual([
    'decision_log_start',
    'decision_new_tree',
    'decision_note',
    'decision_record',
    'decision_tree',
    'decision_update',
    'decision_use_tree',
  ])
  expect(w.opens.at(-1)).toMatchObject({ id: 'decision-tree' })
  expect(w.opens.at(-1)?.focus).toBeUndefined() // the model starting it does not take the keyboard

  // the derived snapshot is rebuilt, and is not the source
  const tree = JSON.parse(w.disk.text(`${DIR}/tree.json`))
  expect(tree.nodes.map((n: { id: string }) => n.id)).toEqual(['design-v2'])
  expect(typeof tree.generatedAt).toBe('string')

  expect(resultOf(await callTool($, 'decision_log_start', { title: 'again' }))).toContain('already being recorded')
})

test('a record that cannot be read is not overwritten by decision_log_start', async ($, on) => {
  const w = world(on)
  w.disk.put(CONFIG, '{ not json')
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const denied = await callTool($, 'decision_log_start', { title: 'x' })
  expect(denyOf(denied)).toContain('config.json')
  expect(w.disk.text(CONFIG)).toBe('{ not json')
})

// ---------------------------------------------------------------- recording

test('record, update, note and tree: one event each, a one-line receipt, the snapshot follows', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await callTool($, 'decision_log_start', { title: 'orders', rootTitle: 'design v2' })

  const rec = await callTool($, 'decision_record', {
    id: 'dbpool-adopted',
    title: '连接池采用',
    parent: 'design-v2',
    status: 'adopted',
    decidedBy: 'gate',
    evidence: [{ label: 'v22 s0', value: 'P99 −12.6%', ci: '[−15.1, −10.4]', run: 'v22_s0' }],
  })
  expect(resultOf(rec)).toBe('Recorded dbpool-adopted (under design-v2, Adopted)')
  expect(eventsOn(w).at(-1)).toMatchObject({ op: 'add', actor: 'model', id: 'dbpool-adopted', node: { decidedBy: 'gate', parent: 'design-v2' } })

  const upd = await callTool($, 'decision_update', { id: 'dbpool-adopted', status: 'superseded', supersededBy: 'design-v2', addEvidence: [{ label: 'v22 s1', value: '−13.5%' }] })
  expect(resultOf(upd)).toMatch(/^Updated dbpool-adopted: /)
  expect(eventsOn(w).at(-1)).toMatchObject({ op: 'update', id: 'dbpool-adopted', patch: { status: 'superseded', supersededBy: 'design-v2' } })

  const note = await callTool($, 'decision_note', { id: 'dbpool-adopted', text: 'reran with seed 1 to be sure' })
  expect(resultOf(note)).toBe('Noted on dbpool-adopted')
  expect(eventsOn(w).at(-1)).toMatchObject({ op: 'note', id: 'dbpool-adopted', text: 'reran with seed 1 to be sure' })

  const tree = resultOf(await callTool($, 'decision_tree'))
  expect(tree).toContain('design-v2')
  expect(tree).toContain('dbpool-adopted')
  const detail = resultOf(await callTool($, 'decision_tree', { id: 'dbpool-adopted' }))
  expect(detail).toContain('v22 s0')
  expect(detail).toContain('reran with seed 1')

  const snapshot = JSON.parse(w.disk.text(`${DIR}/tree.json`))
  expect(snapshot.nodes.map((n: { id: string }) => n.id).sort()).toEqual(['dbpool-adopted', 'design-v2'])
  expect(snapshot.nodes.find((n: { id: string }) => n.id === 'dbpool-adopted').status).toBe('superseded')
})

test('a bad call is denied with something the model can act on, and writes nothing', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const before = eventsOn(w).length

  const noParent = denyOf(await callTool($, 'decision_record', { title: 'orphan', status: 'adopted' }))
  expect(noParent).toContain('parent is required')
  const unknown = denyOf(await callTool($, 'decision_record', { title: 'orphan', parent: 'nope-nope', status: 'adopted' }))
  expect(unknown).toContain('decision_tree')
  const badStatus = denyOf(await callTool($, 'decision_record', { title: 'x y z', parent: null, status: 'maybe' }))
  expect(badStatus).toContain('status')
  expect(denyOf(await callTool($, 'decision_update', { id: 'does-not-exist', status: 'adopted' }))).toContain('unknown node')
  expect(denyOf(await callTool($, 'decision_note', { id: 'design-v2', text: '   ' }))).toContain('text is required')
  expect(eventsOn(w)).toHaveLength(before)
})

test('tool calls from different sessions never overwrite each other', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const calls = await Promise.all([1, 2, 3, 4].map(k => callTool($, 'decision_record', { title: `parallel decision ${k}`, parent: 'design-v2', status: 'planned' })))
  for (const c of calls) expect(resultOf(c)).toMatch(/^Recorded /)
  const added = eventsOn(w).filter(e => e.op === 'add')
  expect(new Set(added.map(e => e.id)).size).toBe(added.length)
  expect(added).toHaveLength(SKETCH.length + 4)
})

// ---------------------------------------------------------------- the person's commands

test('/decide start, add, status, note and retract are the same events by the user', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })

  expect(said(await slash($, 'decide', 'status x adopted'))).toContain('Run /decide start')
  expect(said(await slash($, 'decide', 'start orders'))).toContain('Started recording decisions for orders')
  expect(JSON.parse(w.disk.text(CONFIG)).title).toBe('orders')
  expect(w.tools.map(t => t.name)).toContain('decision_record')

  expect(said(await slash($, 'decide', 'add Build version v2.2 --id build-v22 --status adopted --trunk'))).toContain('Recorded build-v22 (root, Adopted)')
  expect(said(await slash($, 'decide', 'add Api gate --parent build-v22 --status planned --id gateway'))).toContain('Recorded gateway (under build-v22, Planned)')
  expect(said(await slash($, 'decide', 'status gateway in-progress'))).toContain('Updated gateway: status In progress')
  expect(said(await slash($, 'decide', 'note gateway "waiting for the gate"'))).toBe('Noted on gateway')
  expect(said(await slash($, 'decide', 'retract gateway recorded under the wrong parent'))).toBe('Retracted gateway')

  const events = eventsOn(w)
  expect(events.map(e => [e.op, e.actor])).toEqual([
    ['start', 'user'],
    ['add', 'user'],
    ['add', 'user'],
    ['update', 'user'],
    ['note', 'user'],
    ['retract', 'user'],
  ])
  expect(events.at(-1)).toMatchObject({ reason: 'recorded under the wrong parent' })
  expect(said(await slash($, 'decide', 'status gateway adopted'))).toContain('retracted')
  expect(said(await slash($, 'decide', 'bogus'))).toContain('Usage: /decide')
})

test('/decide pause and resume: nothing is recorded while paused, and the model is told so', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(said(await slash($, 'decide', 'pause'))).toBe('Decision recording paused')
  expect(JSON.parse(w.disk.text(CONFIG)).recording).toBe(false)
  const before = eventsOn(w).length

  const blocked = await callTool($, 'decision_record', { title: 'while paused', parent: 'design-v2', status: 'adopted' })
  expect(resultOf(blocked)).toContain('paused')
  expect(eventsOn(w)).toHaveLength(before)
  expect((await sectionOf($))?.text).toContain('paused')

  // the person can still edit by hand while paused
  expect(said(await slash($, 'decide', 'note pool-32 a hand note'))).toBe('Noted on pool-32')

  expect(said(await slash($, 'decide', 'resume'))).toBe('Decision recording resumed')
  expect(resultOf(await callTool($, 'decision_record', { title: 'after resuming', parent: 'design-v2', status: 'adopted' }))).toMatch(/^Recorded /)
})

test('/decide import reads a JSON file in the project and keeps its tree', async ($, on) => {
  const w = world(on)
  seed(w, [{ id: 'design-v2', title: 'design v2', trunk: true }])
  w.disk.put(
    `${ROOT}/old/decisions.json`,
    JSON.stringify([
      { id: 'old-a', title: 'old decision a', parent: 'design-v2', status: 'adopted' },
      { id: 'old-b', title: 'old decision b', parent: 'old-a', status: 'rejected' },
      { title: 'no status' },
    ]),
  )
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(said(await slash($, 'decide', 'import old/decisions.json'))).toBe('Imported 2 nodes (1 skipped)')
  const added = eventsOn(w).filter(e => e.op === 'add' && e.actor === 'import')
  expect(added.map(e => e.id)).toEqual(['old-a', 'old-b'])
  expect(said(await slash($, 'decide', 'import missing.json'))).toContain('Cannot read missing.json')
})

test('/tree opens the pane and takes the keyboard; where no pane fits, the tree comes back as text', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(said(await slash($, 'tree'))).toBe('Opened the decision pane')
  expect(w.opens.at(-1)).toMatchObject({ id: 'decision-tree', focus: true })

  w.placed = false
  const text = said(await slash($, 'tree'))
  expect(text).toContain('This screen has no room for the pane')
  expect(text).toContain('design-v2')
})

// ---------------------------------------------------------------- the system prompt

test('prompt: a section the engine places after the shared ones, one line while off', async ($, on) => {
  world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const composed = await compose($)
  expect(composed.sections.at(0)?.id).toBe('base') // ours comes after the engine's
  expect(composed.sections.at(-1)?.id).toBe('decision-tree:record')
  const mine = await sectionOf($)
  expect(mine).toMatchObject({ id: 'decision-tree:record', scope: 'session' })
  expect(mine?.text).toContain('decision_log_start')
  expect(mine?.text.length).toBeLessThan(300)
})

test('prompt: when recording it briefs the model on the rules and the tree, within the size limit', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const mine = await sectionOf($)
  expect(mine?.scope).toBe('session')
  expect(mine?.text).toStartWith('Decision record ON: ')
  expect(mine?.text).toContain('decision_record / decision_update / decision_note / decision_tree')
  expect(mine?.text).toContain('Mainline:')
  expect(mine?.text).toContain('v22-adopted')
  expect(mine?.text.length).toBeLessThanOrEqual(MAX_SECTION)
})

test('prompt: a long record does not grow the prompt past the limit', async ($, on) => {
  const w = world(on)
  seed(
    w,
    Array.from({ length: 300 }, (_, k) => ({
      id: `node-${String(k).padStart(3, '0')}`,
      title: `a fairly long decision title number ${k} for the tree`,
      trunk: k % 3 === 0,
      parent: k === 0 ? null : 'node-000',
    })),
  )
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const mine = await sectionOf($)
  expect(mine?.text.length).toBeLessThanOrEqual(MAX_SECTION)
  expect(mine?.text).toContain('node-299') // the newest are the ones it lists
})

test('prompt: the section holds still during a turn and catches up when the next one starts', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await startTurn($, 'go on')
  const first = (await sectionOf($))?.text
  expect(first).toContain('v22-adopted')

  await callTool($, 'decision_record', { title: 'Brand new decision', id: 'brand-new', parent: 'design-v2', status: 'adopted' })
  expect((await sectionOf($))?.text).toBe(first) // the cache prefix is not disturbed mid-turn

  await startTurn($, 'next')
  const second = (await sectionOf($))?.text
  expect(second).not.toBe(first)
  expect(second).toContain('brand-new')
})

// ---------------------------------------------------------------- language

test('language: what the person writes in decides the language of receipts and the pane, per project', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('Decision tree')

  await submit($, '这个方向不错，先把构建版本定下来，然后开始跑 seed 1')
  expect(resultOf(await callTool($, 'decision_note', { id: 'design-v2', text: 'x' }))).toBe('已给 design-v2 加备注')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('决策树')
  expect(w.store.get(`lang:${ROOT}`)).toBe('zh')

  await submit($, '/decide status pool-32 adopted') // a command says nothing about the language
  await submit($, 'ok') // nor does noise
  expect(linesOf(await ui.drawn()).join('\n')).toContain('决策树')

  await submit($, 'Please go on and run the second seed now')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('Decision tree')
})

test('language: a later session of the project starts in the language the last one ended in', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  w.store.set(`lang:${ROOT}`, 'zh') // what an earlier session stored
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('决策树')
  expect(resultOf(await callTool($, 'decision_note', { id: 'design-v2', text: 'x' }))).toBe('已给 design-v2 加备注')
})

test('language: display.language fixes it whatever the person writes', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  const config = JSON.parse(w.disk.text(CONFIG))
  w.disk.put(CONFIG, JSON.stringify({ ...config, display: { ...config.display, language: 'zh' } }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await submit($, 'Please go on and run the second seed now')
  const ui = await mountPane($, 'terminal', { columns: 80 })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('决策树')
})

// ---------------------------------------------------------------- other sessions and scripts

test('another session or a script writing events shows up within a poll, in the open pane', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  expect(rowKeys(await ui.drawn())).not.toContain('gate-verdict')

  // a gate script appends an event file of its own
  w.disk.put(
    `${DIR}/events/20261010T120500000Z_gate01_0001.json`,
    JSON.stringify({
      v: 1,
      op: 'add',
      id: 'gate-verdict',
      ts: '2026-10-10T12:05:00.000Z',
      session: 'gate01',
      actor: 'gate',
      node: { title: 'probe s1 passes the gate', parent: 'gateway', status: 'adopted', kind: 'decision', decidedBy: 'gate' },
    }),
  )
  await w.clock.advance(6000)
  expect(rowKeys(await ui.drawn())).toContain('gate-verdict')
  // the snapshot is rebuilt by the next write of this session, from all the events
  await callTool($, 'decision_note', { id: 'gate-verdict', text: 'seen' })
  expect(JSON.parse(w.disk.text(`${DIR}/tree.json`)).nodes.some((n: { id: string }) => n.id === 'gate-verdict')).toBe(true)
})

test('a session paused elsewhere stops recording here within a poll', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(resultOf(await callTool($, 'decision_record', { title: 'first one', parent: 'design-v2', status: 'planned' }))).toMatch(/^Recorded /)

  const config = JSON.parse(w.disk.text(CONFIG))
  w.disk.put(CONFIG, JSON.stringify({ ...config, recording: false }))
  await w.clock.advance(6000)
  expect(resultOf(await callTool($, 'decision_record', { title: 'second one', parent: 'design-v2', status: 'planned' }))).toContain('paused')
})

test('session.end: the poll stops with the session, but not on /clear', async ($, on) => {
  const w = world(on)
  seed(w, SKETCH)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const polled = async () => {
    const before = w.disk.reads.length + w.disk.writes.length
    await w.clock.advance(11_000)
    return w.disk.reads.length + w.disk.writes.length - before
  }
  expect(await polled()).toBeGreaterThan(0)

  await $.session.end({ sessionId: 'abcdef0123456789', reason: 'clear', resume: { id: 'abcdef0123456789' } })
  expect(await polled()).toBeGreaterThan(0)

  await $.session.end({ sessionId: 'abcdef0123456789', reason: 'prompt_input_exit', resume: { id: 'abcdef0123456789' } })
  expect(await polled()).toBe(0)
})
