import { test, expect } from 'claude-code/testing'

import { Runtime } from '../lib/runtime'
import { approvalHash, storeKey } from '../lib/status'
import { FakeEngine, ROOT, configPath, eventsOf } from './port'

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

/** A recording project with a trunk, two children and a pending leaf. */
async function tree() {
  const b = await boot()
  const { rt, p } = b
  await rt.command(p, 'decide', 'start orders')
  await rt.command(p, 'decide', 'add Merge rule v1.2 --id merge-rule --status adopted --trunk')
  await rt.command(p, 'decide', 'add Window size absolute --id window-abs --parent merge-rule --status adopted')
  await rt.command(p, 'decide', 'add Window size ratio --id window-ratio --parent merge-rule --status rejected')
  await rt.command(p, 'decide', 'add Run batch 1 --id run-s1 --parent window-abs --status planned')
  return b
}

const SAMPLE = JSON.stringify({
  updatedAt: '2026-10-10T08:00:00Z',
  lanes: [{ name: 'ALPHA', run: 'sync-bench s0', state: 'running', step: 1700, total: 2000, eta: '18:40' }],
  next: [{ text: 'check → restore-test s1', eta: '05:05' }],
  warnings: [],
})

// ---------------------------------------------------------------- selection and keys

test('select: choosing the node that is already selected writes nothing', async () => {
  const { rt, engine, p } = await tree()
  await rt.select(p, 'window-abs')
  const writes = engine.writes.length
  await rt.select(p, 'window-abs')
  expect(engine.writes).toHaveLength(writes)
  expect(engine.cells.ui.selected).toBe('window-abs')
})

test('press: the first press selects, the next on the same row opens or closes its children', async () => {
  const { rt, engine, p } = await tree()
  await rt.press(p, 'merge-rule')
  expect(engine.cells.ui.selected).toBe('merge-rule')
  const before = engine.cells.ui
  await rt.press(p, 'merge-rule')
  const afterOne = engine.cells.ui
  expect(afterOne.expanded.includes('merge-rule') !== before.expanded.includes('merge-rule') || afterOne.collapsed.includes('merge-rule') !== before.collapsed.includes('merge-rule')).toBe(true)
  await rt.press(p, 'merge-rule')
  expect(engine.cells.ui.expanded.includes('merge-rule')).toBe(before.expanded.includes('merge-rule'))
  // a leaf has nothing to open: selecting is all a press does
  await rt.press(p, 'run-s1')
  const ui = engine.cells.ui
  await rt.press(p, 'run-s1')
  expect(engine.cells.ui).toEqual(ui)
})

test('move: the selection steps through the visible rows and the focus ring follows', async () => {
  const { rt, engine, p } = await tree()
  await rt.reveal(p, 'merge-rule')
  await rt.move(p, 1)
  const first = engine.cells.ui.selected
  expect(first).not.toBe('merge-rule')
  expect(engine.focuses.at(-1)).toEqual({ requestId: 'decision-tree', key: first })
  await rt.move(p, -1)
  expect(engine.cells.ui.selected).toBe('merge-rule')
  // past either end it stays on the end
  await rt.move(p, -50)
  const top = engine.cells.ui.selected
  await rt.move(p, -1)
  expect(engine.cells.ui.selected).toBe(top)
  await rt.move(p, 500)
  const bottom = engine.cells.ui.selected
  await rt.move(p, 1)
  expect(engine.cells.ui.selected).toBe(bottom)
})

test('filters: p, h and a switch and switch back; s hides and shows the now block', async () => {
  const { rt, engine, p } = await tree()
  await rt.setFilter(p, 'pending')
  expect(engine.cells.ui.filter).toBe('pending')
  await rt.setFilter(p, 'pending')
  expect(engine.cells.ui.filter).toBe('default')
  await rt.setFilter(p, 'clean')
  await rt.setFilter(p, 'all')
  expect(engine.cells.ui.filter).toBe('all')
  expect(engine.cells.ui.showNow).toBe(true)
  await rt.toggleNow(p)
  expect(engine.cells.ui.showNow).toBe(false)
})

// ---------------------------------------------------------------- editing

test('edit: status and summary become one update event by the user, and the form closes', async () => {
  const { rt, engine, p } = await tree()
  await rt.select(p, 'run-s1')
  await rt.startEdit(p)
  expect(engine.cells.ui.editing).toEqual({ id: 'run-s1', status: 'planned', summary: '' })
  expect(engine.focuses.at(-1)).toEqual({ requestId: 'decision-tree', key: '~summary' })

  await rt.editStatus(p, 'in-progress')
  await rt.editSummary(p, 'running now')
  await rt.saveEdit(p)
  const e = eventsOf(engine).at(-1)
  expect(e).toMatchObject({ op: 'update', actor: 'user', id: 'run-s1', patch: { status: 'in-progress', summary: 'running now' } })
  expect(engine.cells.ui.editing).toBeNull()
  expect(engine.cells.model.nodes.find(n => n.id === 'run-s1')).toMatchObject({ status: 'in-progress', summary: 'running now' })
  expect(engine.toasts.at(-1)?.text).toBe('Saved run-s1')
})

test('edit: what the field was submitted with wins over the last change, and an unknown status is ignored', async () => {
  const { rt, engine, p } = await tree()
  await rt.startEdit(p, 'run-s1')
  await rt.editStatus(p, 'banana')
  expect(engine.cells.ui.editing?.status).toBe('planned')
  await rt.editSummary(p, 'half typed')
  await rt.saveEdit(p, { summary: 'typed to the end' })
  expect(eventsOf(engine).at(-1)).toMatchObject({ patch: { summary: 'typed to the end' } })
})

test('edit: saving nothing new says so and writes no event; cancelling writes none either', async () => {
  const { rt, engine, p } = await tree()
  const count = eventsOf(engine).length
  await rt.startEdit(p, 'run-s1')
  await rt.saveEdit(p)
  expect(engine.toasts.at(-1)?.text).toBe('Nothing changed')
  expect(eventsOf(engine)).toHaveLength(count)

  await rt.startEdit(p, 'run-s1')
  await rt.editSummary(p, 'abandoned')
  await rt.cancelEdit(p)
  expect(engine.cells.ui.editing).toBeNull()
  expect(eventsOf(engine)).toHaveLength(count)
  // the ring goes back to the row
  expect(engine.focuses.at(-1)).toEqual({ requestId: 'decision-tree', key: 'run-s1' })
})

test('edit: selecting another node closes a form left open; a retracted node cannot be edited', async () => {
  const { rt, engine, p } = await tree()
  await rt.startEdit(p, 'run-s1')
  await rt.select(p, 'window-abs')
  expect(engine.cells.ui.editing).toBeNull()
  await rt.command(p, 'decide', 'retract window-ratio wrong run')
  await rt.startEdit(p, 'window-ratio')
  expect(engine.cells.ui.editing).toBeNull()
})

test('bare /decide opens the pane with the keyboard and starts editing the selected node', async () => {
  const { rt, engine, p } = await tree()
  await rt.select(p, 'run-s1')
  const said = await rt.command(p, 'decide', '')
  expect(said).toBe('Editing run-s1 in the pane')
  expect(engine.opens.at(-1)).toMatchObject({ focus: true })
  expect(engine.cells.ui.editing?.id).toBe('run-s1')
})

test('a manual edit is a change event the next poll of another session sees', async () => {
  const { rt, engine, p } = await tree()
  await rt.startEdit(p, 'run-s1')
  await rt.editStatus(p, 'adopted')
  await rt.saveEdit(p)
  const other = new Runtime()
  const copy = new FakeEngine()
  for (const [path, f] of engine.disk.files) copy.put(path, f.text)
  copy.sessionId = 'ffffff9999999999'
  await other.ensure(copy.port)
  expect(copy.cells.model.nodes.find(n => n.id === 'run-s1')?.status).toBe('adopted')
})

// ---------------------------------------------------------------- the prompt, once per turn

test('prompt: the section holds still during a turn and catches up when the next one starts', async () => {
  const { rt, p } = await tree()
  await rt.onTurnStart(p)
  const first = rt.section()?.text ?? ''
  expect(first).toContain('merge-rule')
  await rt.toolCall(p, 'decision_record', { title: 'Brand new decision', parent: 'merge-rule', status: 'adopted' })
  expect(rt.section()?.text).toBe(first)
  await rt.onTurnStart(p)
  expect(rt.section()?.text).not.toBe(first)
  expect(rt.section()?.text).toContain('Brand new decision')
})

// ---------------------------------------------------------------- auto-open

test('auto-open: once, unasked, after the screen turns out to be fullscreen', async () => {
  const { rt, engine } = await tree()
  const opened = engine.opens.length
  await engine.advance(5000)
  expect(engine.opens).toHaveLength(opened) // the screen is not known to dock panes yet
  rt.seeViewport({ isFullscreen: true })
  await engine.advance(5000)
  expect(engine.opens).toHaveLength(opened + 1)
  expect(engine.opens.at(-1)?.focus).toBeUndefined()
  await engine.advance(30_000)
  expect(engine.opens).toHaveLength(opened + 1)
})

test('auto-open: not when display.autoOpen is false, and not while the project is off', async () => {
  const { rt, engine, p } = await tree()
  const opened = engine.opens.length
  expect(await rt.command(p, 'decide', 'autoopen off')).toBe('Auto-open set to off')
  expect(JSON.parse(engine.disk.text(configPath())).display.autoOpen).toBe(false)
  rt.seeViewport({ isFullscreen: true })
  await engine.advance(10_000)
  expect(engine.opens).toHaveLength(opened)

  const off = await boot()
  off.rt.seeViewport({ isFullscreen: true })
  await off.engine.advance(10_000)
  expect(off.engine.opens).toHaveLength(0)
})

// ---------------------------------------------------------------- a reload

test('reload: the newer object takes the poll over and the older one stops', async () => {
  const { rt, engine } = await tree()
  expect(engine.activeTimers).toBe(1)
  const newer = new Runtime()
  await newer.ensure(engine.port)
  expect(engine.activeTimers).toBe(2)
  await engine.advance(5000)
  expect(engine.activeTimers).toBe(1)
  expect(rt.ready).toBe(true)
})

// ---------------------------------------------------------------- the "now" block

async function withStatus(argv = ['bash', 'scripts/status.sh']) {
  const b = await boot()
  await b.rt.toolCall(b.p, 'decision_log_start', { title: 'orders', statusArgv: argv })
  return b
}

/** What the status command printed, for `engine.onRun` to answer with. */
const PRINTS_SAMPLE = { exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never

/** Another session, a git pull or a hand edit puts a different status command into config.json. */
function changeCommand(engine: FakeEngine, argv: string[]): void {
  const cfg = JSON.parse(engine.disk.text(configPath()))
  engine.put(configPath(), JSON.stringify({ ...cfg, status: { ...cfg.status, argv } }, null, 2))
}

test('status: a new command waits for the person; nothing runs until Allow is pressed', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => ({ exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  expect(engine.cells.now.approval).toBe('pending')
  expect(engine.cells.now.argv).toEqual(['bash', 'scripts/status.sh'])
  await engine.advance(120_000)
  expect(engine.runs.filter(r => r.argv[0] === 'bash')).toHaveLength(0)

  await rt.approveStatus(p, engine.cells.now.argv)
  expect(engine.store.get(storeKey('approved', ROOT))).toBe(approvalHash(ROOT, ['bash', 'scripts/status.sh']))
  expect(engine.cells.now.approval).toBe('approved')
  const ran = engine.runs.filter(r => r.argv[0] === 'bash')
  expect(ran).toHaveLength(1)
  expect(ran[0]?.init).toMatchObject({ cwd: ROOT, timeoutMs: 15_000 })
  expect(engine.cells.now.data?.lanes[0]).toMatchObject({ name: 'ALPHA', step: 1700, total: 2000 })
  expect(engine.cells.now.error).toBeNull()
  expect(engine.cells.now.fetchedAt).not.toBeNull()
})

test('status: refreshed every 30 seconds while the pane is shown, not otherwise', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => ({ exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await rt.approveStatus(p, engine.cells.now.argv)
  const runs = () => engine.runs.filter(r => r.argv[0] === 'bash').length
  expect(runs()).toBe(1)
  await engine.advance(20_000)
  expect(runs()).toBe(1)
  await engine.advance(15_000)
  expect(runs()).toBe(2)

  engine.shown = false
  await engine.advance(120_000)
  expect(runs()).toBe(2)
  engine.shown = true
  await engine.advance(5000)
  expect(runs()).toBe(3)
})

test('status: a failure keeps the last data and marks it; a timeout does the same; the next success clears it', async () => {
  const { rt, engine, p } = await withStatus()
  const ok = { exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } as never
  engine.onRun = () => ok
  await rt.approveStatus(p, engine.cells.now.argv)
  const good = engine.cells.now.data

  engine.onRun = () => ({ exitCode: 2, stdout: '', stderr: 'ssh: connect to host login failed\nmore', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await engine.advance(30_000)
  expect(engine.cells.now.data).toEqual(good)
  expect(engine.cells.now.error).toContain('ssh: connect to host login failed')
  expect(engine.cells.now.error).not.toContain('more')

  engine.onRun = () => {
    throw new Error('timed out after 15000 ms')
  }
  await engine.advance(30_000)
  expect(engine.cells.now.data).toEqual(good)
  expect(engine.cells.now.error).toContain('timed out')

  engine.onRun = () => ({ exitCode: 0, stdout: 'not json', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await engine.advance(30_000)
  expect(engine.cells.now.error).toContain('not JSON')

  engine.onRun = () => ok
  await engine.advance(30_000)
  expect(engine.cells.now.error).toBeNull()
})

test('status: a changed command needs the person again; no status block means nothing is run', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => ({ exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await rt.approveStatus(p, engine.cells.now.argv)
  const cfg = JSON.parse(engine.disk.text(configPath()))
  engine.put(configPath(), JSON.stringify({ ...cfg, status: { ...cfg.status, argv: ['bash', 'scripts/other.sh'] } }, null, 2))
  await engine.advance(5000)
  expect(engine.cells.now.approval).toBe('pending')
  expect(engine.cells.now.data).toBeNull()
  const calls = engine.runs.filter(r => r.argv[0] === 'bash').length
  await engine.advance(60_000)
  expect(engine.runs.filter(r => r.argv[0] === 'bash')).toHaveLength(calls)

  const plain = await boot()
  await plain.rt.toolCall(plain.p, 'decision_log_start', { title: 'plain' })
  await plain.engine.advance(60_000)
  expect(plain.engine.runs.filter(r => r.argv[0] === 'bash')).toHaveLength(0)
  expect(plain.engine.cells.now.approval).toBe('none')
})

test('status: a changed command is never run on the strength of the old approval, whichever way the change is first noticed', async () => {
  const OLD = ['bash', 'scripts/status.sh']
  const NEW = ['bash', 'scripts/other.sh']
  const events = `${ROOT}/.claude/decisions/events`
  for (const route of ['poll', 'tool', 'tree'] as const) {
    const { rt, engine, p } = await withStatus(OLD)
    engine.onRun = () => PRINTS_SAMPLE
    await rt.approveStatus(p, engine.cells.now.argv)
    const ran = (argv: string[]) => engine.runs.filter(r => r.argv[1] === argv[1]).length
    expect(ran(OLD)).toBe(1)

    changeCommand(engine, NEW)
    if (route === 'poll') {
      await engine.advance(5000)
    } else if (route === 'tool') {
      // a tool call that has to know what config.json says reads it
      expect(await rt.toolCall(p, 'decision_log_start', { title: 'orders' })).toEqual({ result: expect.stringContaining('already being recorded') })
    } else {
      // the poll has read the new config.json but waits on a slow disk before it brings the pane up to date; /tree asks for a run meanwhile
      engine.disk.hanging.add(events)
      await engine.advance(5000)
      expect(engine.cells.now.approval).toBe('approved') // the poll has not got as far as the pane yet
      await rt.command(p, 'tree', '')
      await engine.advance(0)
      expect(engine.cells.now).toMatchObject({ approval: 'pending', argv: NEW }) // /tree's run saw the difference and brought it up to date, instead of running
      engine.disk.hanging.delete(events)
      await engine.advance(10_000)
    }

    // the new command did not run, and the pane is back to waiting for the person
    expect(ran(NEW), route).toBe(0)
    expect(engine.cells.now, route).toMatchObject({ approval: 'pending', argv: NEW, data: null })
    await engine.advance(120_000)
    expect(ran(NEW), route).toBe(0)
    expect(engine.runs.filter(r => r.argv[0] === 'bash').every(r => r.argv[1] === OLD[1]), route).toBe(true)

    // it runs once the person has read it and pressed Allow
    await rt.approveStatus(p, engine.cells.now.argv)
    expect(engine.store.get(storeKey('approved', ROOT)), route).toBe(approvalHash(ROOT, NEW))
    expect(ran(NEW), route).toBe(1)
    expect(engine.cells.now.approval, route).toBe('approved')
  }
})

test('status: the answer of a command that config.json no longer holds is dropped, it does not hide the new command waiting for the person', async () => {
  const OLD = ['bash', 'scripts/status.sh']
  const NEW = ['bash', 'scripts/other.sh']
  const { rt, engine, p } = await withStatus(OLD)
  engine.onRun = () => PRINTS_SAMPLE
  await rt.approveStatus(p, engine.cells.now.argv)
  expect(engine.cells.now.data).not.toBeNull()
  const ran = (argv: string[]) => engine.runs.filter(r => r.argv[1] === argv[1]).length

  // the next run is under way: a command that takes a while
  let finish: (answer: unknown) => void = () => undefined
  engine.onRun = () => new Promise<never>(resolve => (finish = resolve as (answer: unknown) => void))
  await engine.advance(30_000)
  expect(ran(OLD)).toBe(2)

  // config.json moves on meanwhile, and something here (a tool call) notices: the pane waits for the person to read the new command
  changeCommand(engine, NEW)
  expect(await rt.toolCall(p, 'decision_log_start', { title: 'orders' })).toEqual({ result: expect.stringContaining('already being recorded') })
  expect(engine.cells.now).toMatchObject({ approval: 'pending', argv: NEW, data: null })

  // the old command answers: it says nothing about the new one, so the pane stays as it is
  finish(PRINTS_SAMPLE)
  await engine.advance(0)
  expect(engine.cells.now).toMatchObject({ approval: 'pending', argv: NEW, data: null, error: null })
  expect(engine.cells.now.fetchedAt).toBeNull()

  // and nothing runs until the person has read the new command and allowed it
  engine.onRun = () => PRINTS_SAMPLE
  await engine.advance(120_000)
  expect(ran(NEW)).toBe(0)
  expect(engine.cells.now).toMatchObject({ approval: 'pending', argv: NEW, data: null, error: null })
  await rt.approveStatus(p, engine.cells.now.argv)
  expect(ran(NEW)).toBe(1)
  expect(engine.cells.now).toMatchObject({ approval: 'approved', argv: NEW, error: null })
  expect(engine.cells.now.data?.lanes[0]?.name).toBe('ALPHA')
})

test('status: Allow approves the command the person read; if config.json moved on, nothing is allowed and they are told', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => PRINTS_SAMPLE
  const key = storeKey('approved', ROOT)
  const read = engine.cells.now.argv // what the pane showed when Allow was pressed
  expect(read).toEqual(['bash', 'scripts/status.sh'])
  const bash = () => engine.runs.filter(r => r.argv[0] === 'bash').length

  // config.json moved on before the press reached the mod
  changeCommand(engine, ['bash', 'scripts/other.sh'])
  await rt.approveStatus(p, read)
  expect(engine.store.has(key)).toBe(false)
  expect(bash()).toBe(0)
  expect(engine.toasts.at(-1)?.text).toBe('The status command in config.json changed. Look at the new one before allowing it.')
  // the pane shows the new command now, and waits
  expect(engine.cells.now).toMatchObject({ approval: 'pending', argv: ['bash', 'scripts/other.sh'] })

  // word for word: what is nearly the same is not
  const toasts = engine.toasts.length
  await rt.approveStatus(p, ['bash', 'scripts/other.sh '])
  await rt.approveStatus(p, ['bash'])
  expect(engine.store.has(key)).toBe(false)
  expect(bash()).toBe(0)
  expect(engine.toasts).toHaveLength(toasts + 2)

  // Allow under the command that is shown approves that one, and runs it at once
  await rt.approveStatus(p, engine.cells.now.argv)
  expect(engine.store.get(key)).toBe(approvalHash(ROOT, ['bash', 'scripts/other.sh']))
  expect(engine.cells.now.approval).toBe('approved')
  expect(engine.runs.filter(r => r.argv[0] === 'bash').map(r => r.argv[1])).toEqual(['scripts/other.sh'])
  expect(engine.toasts).toHaveLength(toasts + 2)

  // a late press from a pane that still showed the old command changes nothing, and the person is told in the language of the pane
  await rt.onPrompt(p, '为什么没有运行')
  await rt.approveStatus(p, ['bash', 'scripts/status.sh'])
  expect(engine.toasts.at(-1)?.text).toBe('config.json 里的 status 命令变了。请先看新的命令，再决定是否允许。')
  expect(engine.store.get(key)).toBe(approvalHash(ROOT, ['bash', 'scripts/other.sh']))
  expect(bash()).toBe(1)
})

test('status: before every run the shown command, the config and the stored OK have to agree', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => PRINTS_SAMPLE
  const key = storeKey('approved', ROOT)
  const bash = () => engine.runs.filter(r => r.argv[0] === 'bash').length
  await rt.approveStatus(p, engine.cells.now.argv)
  expect(bash()).toBe(1)

  // the three agree: a run that is asked for happens
  await rt.maybeRunStatus(p, true)
  expect(bash()).toBe(2)

  // the stored OK is for the same command in another project: the poll that is due runs nothing and the pane asks again
  expect(engine.cells.now.approval).toBe('approved')
  engine.store.set(key, approvalHash('/work/elsewhere', ['bash', 'scripts/status.sh']))
  await engine.advance(35_000)
  expect(bash()).toBe(2)
  expect(engine.cells.now.approval).toBe('pending')

  // the person allows it again: the three agree again
  await rt.approveStatus(p, engine.cells.now.argv)
  expect(engine.store.get(key)).toBe(approvalHash(ROOT, ['bash', 'scripts/status.sh']))
  expect(bash()).toBe(3)

  // the command in the shown state is not the one in config.json, not even by a space: nothing runs, the pane catches up
  engine.cells.now = { ...engine.cells.now, argv: ['bash', 'scripts/status.sh '] }
  await rt.maybeRunStatus(p, true)
  expect(bash()).toBe(3)
  expect(engine.cells.now).toMatchObject({ approval: 'approved', argv: ['bash', 'scripts/status.sh'], data: null })
  // and the next one that is asked for runs, with the command the person allowed
  await rt.maybeRunStatus(p, true)
  expect(bash()).toBe(4)
  expect(engine.runs.filter(r => r.argv[0] === 'bash').every(r => r.argv.join(' ') === 'bash scripts/status.sh')).toBe(true)
  expect(engine.cells.now.data?.lanes[0]?.name).toBe('ALPHA')
})

test('status: /tree runs it at once when it is approved', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => ({ exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await rt.approveStatus(p, engine.cells.now.argv)
  const runs = () => engine.runs.filter(r => r.argv[0] === 'bash').length
  const before = runs()
  await rt.command(p, 'tree', '')
  await engine.advance(0)
  expect(runs()).toBe(before + 1)
})

// ---------------------------------------------------------------- a /clear wipes the session's state

import { DEFAULT_SCHEME } from '../lib/palettes'
import { EMPTY_MODEL, EMPTY_NOW, EMPTY_PROJECT, EMPTY_TM, EMPTY_TREES, EMPTY_UI } from '../lib/state'

/** What the engine does to `$.state` when a /clear starts the session over: everything back to its first value. */
function wipe(engine: FakeEngine) {
  engine.cells = { model: EMPTY_MODEL, project: EMPTY_PROJECT, ui: EMPTY_UI, lang: 'en', now: EMPTY_NOW, tm: EMPTY_TM, trees: EMPTY_TREES, scheme: DEFAULT_SCHEME, translating: 0, owner: '' }
}

test('clear: the next poll writes the state again, and the poll goes on', async () => {
  const { engine } = await tree()
  const before = engine.cells
  expect(before.project.mode).toBe('recording')
  wipe(engine)
  expect(engine.cells.project.mode).toBe('off')

  await engine.advance(5000)
  expect(engine.cells.project).toMatchObject({ root: ROOT, mode: 'recording' })
  expect(engine.cells.model.nodes.map(n => n.id)).toEqual(before.model.nodes.map(n => n.id))
  expect(engine.cells.owner).not.toBe('')
  expect(engine.activeTimers).toBe(1)

  // and it is still polling: an event from outside shows up
  engine.put(
    `${ROOT}/.claude/decisions/events/20261010T130000000Z_gate01_0001.json`,
    JSON.stringify({ v: 1, op: 'add', id: 'late-one', ts: '2026-10-10T13:00:00.000Z', session: 'gate01', actor: 'gate', node: { title: 'late one', parent: null, status: 'adopted', kind: 'decision' } }),
  )
  await engine.advance(5000)
  expect(engine.cells.model.nodes.some(n => n.id === 'late-one')).toBe(true)
})

test('clear: the first thing that happens after it repairs the state at once, without waiting for the poll', async () => {
  const { rt, engine, p } = await tree()
  wipe(engine)
  await rt.onPrompt(p, 'a new conversation')
  expect(engine.cells.project.mode).toBe('recording')
  expect(engine.cells.model.nodes.length).toBeGreaterThan(0)

  wipe(engine)
  const said = await rt.command(p, 'decide', 'note merge-rule after the clear')
  expect(said).toBe('Noted on merge-rule')
  expect(engine.cells.project.mode).toBe('recording')

  wipe(engine)
  await rt.onTurnStart(p)
  expect(engine.cells.model.nodes.length).toBeGreaterThan(0)
})

test('clear: a drawing that finds the state empty asks for the repair, which runs when the drawing is over', async () => {
  const { rt, engine, p } = await tree()
  wipe(engine)
  rt.repairSoon(p)
  rt.repairSoon(p) // asking twice does not repair twice
  expect(engine.cells.project.mode).toBe('off') // not during the drawing
  await engine.advance(0)
  expect(engine.cells.project.mode).toBe('recording')
})

test('clear: what the person had approved stays approved, and the status command runs again at once', async () => {
  const { rt, engine, p } = await withStatus()
  engine.onRun = () => ({ exitCode: 0, stdout: SAMPLE, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) as never
  await rt.approveStatus(p, engine.cells.now.argv)
  const runs = () => engine.runs.filter(r => r.argv[0] === 'bash').length
  expect(runs()).toBe(1)
  wipe(engine)
  await engine.advance(5000)
  expect(engine.cells.now.approval).toBe('approved')
  expect(runs()).toBe(2)
  expect(engine.cells.now.data?.lanes[0]?.name).toBe('ALPHA')
})

test('clear: events after it carry the new conversation\'s session id', async () => {
  const { rt, engine, p } = await tree()
  engine.sessionId = '99aa11bb22cc33dd'
  wipe(engine)
  await engine.advance(5000)
  await rt.command(p, 'decide', 'note merge-rule written after the clear')
  expect(eventsOf(engine).at(-1)).toMatchObject({ op: 'note', session: '99aa11' })
})

test('reload: a newer object keeps the state and an older one does not take it back after a clear', async () => {
  const { rt, engine } = await tree()
  const newer = new Runtime()
  await newer.ensure(engine.port)
  const owner = engine.cells.owner
  await engine.advance(5000) // the older object sees the newer token and lets go
  expect(engine.cells.owner).toBe(owner)
  expect(engine.activeTimers).toBe(1)
  wipe(engine)
  await engine.advance(5000) // only the newer one is left to repair it
  expect(engine.cells.project.mode).toBe('recording')
  expect(engine.cells.owner).toBe(owner) // the newer object's token, not the older one's
  expect(rt.ready).toBe(true)
})
