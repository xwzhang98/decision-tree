import { test, expect } from 'claude-code/testing'

import { Runtime } from '../lib/runtime'
import { FakeEngine, ROOT, configPath, eventFiles, eventsOf } from './port'

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

async function on(title = 'orders') {
  const b = await boot()
  const r = await b.rt.command(b.p, 'decide', `start ${title}`)
  return { ...b, started: r }
}

const lastEvent = (e: FakeEngine) => eventsOf(e).at(-1) as Record<string, unknown>

// ---------------------------------------------------------------- start and the rest of the verbs

test('/decide start: writes the record, opens the pane with the keyboard, and says so', async () => {
  const { rt, engine, started } = await on('orders-api-rewrite')
  expect(started).toBe('Started recording decisions for orders-api-rewrite (data in .claude/decisions/)')
  expect(rt.mode).toBe('recording')
  expect(JSON.parse(engine.disk.text(configPath())).title).toBe('orders-api-rewrite')
  expect(eventsOf(engine).map(e => e.op)).toEqual(['start'])
  expect(engine.opens.at(-1)?.focus).toBe(true)
  // a user-made start registers the other tools too
  expect(engine.tools.map(t => t.name)).toContain('decision_record')
})

test('/decide start without a title uses the folder name; twice says it is already on', async () => {
  const b = await boot()
  expect(await b.rt.command(b.p, 'decide', 'start')).toContain('proj')
  expect(JSON.parse(b.engine.disk.text(configPath())).title).toBe('proj')
  expect(await b.rt.command(b.p, 'decide', 'start again')).toBe('Decisions are already being recorded here (proj).')
})

test('/decide add, status, note, retract write events by the user and answer in one line', async () => {
  const { rt, engine, p } = await on()
  expect(await rt.command(p, 'decide', 'add Build version v2.2 --id build-v22 --status planned --trunk')).toBe('Recorded build-v22 (root, Planned)')
  expect(lastEvent(engine)).toMatchObject({ op: 'add', actor: 'user', id: 'build-v22' })
  expect(await rt.command(p, 'decide', 'add Pool size absolute --parent build-v22 --status proposed')).toContain('under build-v22')

  expect(await rt.command(p, 'decide', 'status build-v22 adopted')).toBe('Updated build-v22: status Adopted')
  expect(lastEvent(engine)).toMatchObject({ op: 'update', actor: 'user', id: 'build-v22', patch: { status: 'adopted' } })

  expect(await rt.command(p, 'decide', 'note build-v22 two seeds agree')).toBe('Noted on build-v22')
  expect(lastEvent(engine)).toMatchObject({ op: 'note', actor: 'user', text: 'two seeds agree' })

  expect(await rt.command(p, 'decide', 'retract pool-size-absolute wrong run')).toBe('Retracted pool-size-absolute')
  expect(lastEvent(engine)).toMatchObject({ op: 'retract', actor: 'user', reason: 'wrong run' })
  expect(engine.cells.model.nodes.find(n => n.id === 'pool-size-absolute')?.retracted).toBeDefined()
})

test('/decide: a title piece finds the node, an unknown or ambiguous one says why, nothing is written', async () => {
  const { rt, engine, p } = await on()
  await rt.command(p, 'decide', 'add Pool size absolute --id pool-abs --status proposed')
  await rt.command(p, 'decide', 'add Pool size ratio --id pool-ratio --status proposed')
  const before = eventFiles(engine).length
  expect(await rt.command(p, 'decide', 'status "size absolute" adopted')).toBe('Updated pool-abs: status Adopted')
  expect(await rt.command(p, 'decide', 'status pool adopted')).toContain('matches several nodes')
  expect(await rt.command(p, 'decide', 'status nothing-here adopted')).toContain('No node matches')
  expect(await rt.command(p, 'decide', 'status pool-abs banana')).toContain('Unknown status "banana"')
  expect(await rt.command(p, 'decide', 'status')).toContain('Missing a node')
  expect(await rt.command(p, 'decide', 'frobnicate')).toContain('Usage: /decide')
  expect(eventFiles(engine)).toHaveLength(before + 1)
})

test('/decide: while the record is off, the verbs that need it say how to start', async () => {
  const { rt, p, engine } = await boot()
  expect(await rt.command(p, 'decide', 'status x adopted')).toContain('Run /decide start')
  expect(await rt.command(p, 'decide', 'pause')).toContain('Run /decide start')
  expect(await rt.command(p, 'decide', 'add Something')).toContain('Run /decide start')
  expect([...engine.disk.files.keys()]).toEqual([])
})

test('manual edits are allowed while recording is paused', async () => {
  const { rt, p, engine } = await on()
  await rt.command(p, 'decide', 'add Build version --id build-v22 --status proposed')
  await rt.command(p, 'decide', 'pause')
  expect(await rt.command(p, 'decide', 'status build-v22 adopted')).toBe('Updated build-v22: status Adopted')
  expect(lastEvent(engine)).toMatchObject({ actor: 'user' })
})

// ---------------------------------------------------------------- /tree

test('/tree opens the pane with the keyboard; a surface that places no panes gets the tree as text', async () => {
  const { rt, engine, p } = await on()
  await rt.command(p, 'decide', 'add Build version --id build-v22 --status adopted')
  expect(await rt.command(p, 'tree', '')).toBe('Opened the decision pane')
  expect(engine.opens.at(-1)).toMatchObject({ id: 'decision-tree', focus: true, columns: 72 })

  engine.placed = false
  const text = await rt.command(p, 'tree', '')
  expect(text).toContain('no room for the pane')
  expect(text).toContain('build-v22')
})

test('/tree on a project that is not recorded opens the pane, which explains how to start', async () => {
  const { rt, p, engine } = await boot()
  expect(await rt.command(p, 'tree', '')).toBe('Opened the decision pane')
  expect(engine.opens).toHaveLength(1)
})

// ---------------------------------------------------------------- import

test('/decide import: a JSON array of nodes, or a tree.json from another project', async () => {
  const { rt, engine, p } = await on()
  engine.put(
    `${ROOT}/old.json`,
    JSON.stringify([
      { id: 'root-one', title: 'Root one', parent: null, status: 'adopted', trunk: true },
      { id: 'child-one', title: 'Child one', parent: 'root-one', status: 'rejected', summary: 'did not help' },
      { title: '', status: 'adopted' },
    ]),
  )
  expect(await rt.command(p, 'decide', 'import old.json')).toBe('Imported 2 nodes (1 skipped)')
  const added = eventsOf(engine).filter(e => e.op === 'add')
  expect(added.map(e => e.actor)).toEqual(['import', 'import'])
  expect(engine.cells.model.nodes.map(n => n.id).sort()).toEqual(['child-one', 'root-one'])

  engine.put(`${ROOT}/other-tree.json`, JSON.stringify({ generatedAt: 'x', project: 'other', nodes: [{ id: 'third-node', title: 'Third', parent: 'root-one', status: 'planned' }] }))
  expect(await rt.command(p, 'decide', 'import other-tree.json')).toBe('Imported 1 nodes (0 skipped)')
  expect(engine.cells.model.nodes.some(n => n.id === 'third-node')).toBe(true)
})

test('/decide import: errors say what is wrong and write nothing', async () => {
  const { rt, engine, p } = await on()
  const before = eventFiles(engine).length
  expect(await rt.command(p, 'decide', 'import missing.json')).toContain('Cannot read missing.json')
  engine.put(`${ROOT}/bad.json`, '{ nope')
  expect(await rt.command(p, 'decide', 'import bad.json')).toContain('not a JSON array')
  engine.put(`${ROOT}/empty.json`, '[]')
  expect(await rt.command(p, 'decide', 'import empty.json')).toBe('No usable nodes in empty.json.')
  expect(await rt.command(p, 'decide', 'import')).toContain('Missing a file')
  expect(eventFiles(engine)).toHaveLength(before)
})

// ---------------------------------------------------------------- order and several sessions

test('events from consecutive operations keep their order in the file names even on a frozen clock', async () => {
  const { rt, engine, p } = await on()
  await rt.command(p, 'decide', 'add One --id node-one --status planned')
  await rt.command(p, 'decide', 'add Two --id node-two --status planned')
  await rt.command(p, 'decide', 'status node-one adopted')
  expect(eventsOf(engine).map(e => e.op + ':' + (e.id ?? ''))).toEqual(['start:', 'add:node-one', 'add:node-two', 'update:node-one'])
})

test('another session in the same project: its events appear after the next poll, and config.json appearing turns this one on', async () => {
  const shared = new FakeEngine()
  const a = await boot(shared, 'aaaaaa0000000000')
  expect(a.rt.mode).toBe('off')

  // another session (another process) starts recording on the same disk
  const other = new FakeEngine()
  const b = await boot(other, 'bbbbbb1111111111')
  other.disk.files.forEach((f, path) => shared.put(path, f.text))
  await b.rt.command(b.p, 'decide', 'start shared')
  for (const [path, f] of other.disk.files) shared.put(path, f.text)

  await shared.advance(5000)
  expect(a.rt.mode).toBe('recording')
  expect(shared.tools.map(t => t.name)).toContain('decision_record')
  expect(shared.cells.project.mode).toBe('recording')

  // a decision recorded elsewhere shows up in this session's pane state
  await b.rt.command(b.p, 'decide', 'add From elsewhere --id elsewhere --status planned')
  for (const [path, f] of other.disk.files) if (!shared.disk.files.has(path)) shared.put(path, f.text)
  await shared.advance(5000)
  expect(shared.cells.model.nodes.some(n => n.id === 'elsewhere')).toBe(true)
})

test('pausing in one session reaches the others at the next poll', async () => {
  const { rt, engine, p } = await on()
  await rt.command(p, 'decide', 'add One --id node-one --status planned')
  const cfg = JSON.parse(engine.disk.text(configPath()))
  engine.put(configPath(), JSON.stringify({ ...cfg, recording: false }, null, 2) + '\n')
  await engine.advance(5000)
  expect(rt.mode).toBe('paused')
  expect(engine.cells.project.mode).toBe('paused')
})

// ---------------------------------------------------------------- language

test('language: the prompt decides the language of the receipts, the pane and the title', async () => {
  const { rt, engine, p } = await on()
  expect(rt.lang).toBe('en')
  await rt.onPrompt(p, '把构建版本定为 v2.2，池的大小用绝对值')
  expect(rt.lang).toBe('zh')
  expect(engine.cells.lang).toBe('zh')
  expect(engine.store.get(`lang:${ROOT}`)).toBe('zh')
  expect(await rt.command(p, 'decide', 'add 构建版本 v2.2 --id build-v22 --status planned --trunk')).toBe('已记录 build-v22（根节点，计划）')
  const r = await rt.toolCall(p, 'decision_record', { title: '池的大小用绝对值', parent: 'build-v22', status: 'adopted' })
  expect('result' in r && r.result).toMatch(/^已记录 \S+（挂在 build-v22 下，采用）$/)
  // what was recorded stays as it was written
  expect(engine.cells.model.nodes.some(n => n.title === '池的大小用绝对值')).toBe(true)
  // the pane is told, and its tab is renamed
  expect(engine.opens.at(-1)?.title).toBe('决策')
})

test('language: slash commands do not change it, English prompts bring it back, a fixed setting wins', async () => {
  const { rt, engine, p } = await on()
  await rt.onPrompt(p, '你好，开始吧')
  expect(rt.lang).toBe('zh')
  await rt.onPrompt(p, '/decide status x adopted')
  expect(rt.lang).toBe('zh')
  await rt.onPrompt(p, 'Now please run the baseline again with two more seeds')
  expect(rt.lang).toBe('en')

  expect(await rt.command(p, 'decide', 'lang zh')).toBe('语言已设为 zh')
  expect(JSON.parse(engine.disk.text(configPath())).display.language).toBe('zh')
  await rt.onPrompt(p, 'Now English again, please')
  expect(rt.lang).toBe('zh')
  expect(await rt.command(p, 'decide', 'lang auto')).toContain('auto')
})

test('language: it is remembered for the project across sessions', async () => {
  const first = await boot()
  await first.rt.command(first.p, 'decide', 'start orders')
  await first.rt.onPrompt(first.p, '继续上次的工作')
  first.rt.stop()
  const again = new Runtime()
  await again.ensure(first.engine.port)
  expect(again.lang).toBe('zh')
})
