import { test, expect } from 'claude-code/testing'

import { OFF_LINE } from '../lib/prompt'
import { Runtime } from '../lib/runtime'
import { FakeEngine, ROOT, configPath, eventFiles, eventsOf } from './port'

const EVENTS = `${ROOT}/.claude/decisions/events`

async function boot(engine = new FakeEngine(), session = 'abcdef0123456789') {
  engine.sessionId = session
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

/** A project that is recording, with one root decision (notes-app). */
async function started(title = 'orders') {
  const b = await boot()
  await b.rt.toolCall(b.p, 'decision_log_start', { title, rootTitle: 'notes app' })
  return b
}

const text = (a: { result: string } | { deny: string }): string => ('result' in a ? a.result : `DENY: ${a.deny}`)

/** What a gate script or another session leaves in events/: the `add` of one decision. */
function dropEvent(engine: FakeEngine, id: string): void {
  engine.put(
    `${EVENTS}/20261010T130000000Z_gate01_0001.json`,
    JSON.stringify({ v: 1, op: 'add', id, ts: '2026-10-10T13:00:00.000Z', session: 'gate01', actor: 'gate', node: { title: id, parent: null, status: 'adopted', kind: 'decision' } }),
  )
}

// ---------------------------------------------------------------- config.json

test('io: a config.json that cannot be read for a moment does not stop the recording', async () => {
  const { rt, engine, p } = await started()
  const files = eventFiles(engine).length

  // three polls in a row cannot read it: a read that failed says nothing about the file, so what was known stays
  engine.disk.failing.add(configPath())
  await engine.advance(15_000)
  expect(rt.mode).toBe('recording')
  expect(engine.cells.project).toMatchObject({ mode: 'recording', config: { title: 'orders' } })

  // the model goes on recording meanwhile
  const r = await rt.toolCall(p, 'decision_record', { id: 'during-gap', title: 'recorded during the gap', parent: 'notes-app', status: 'planned' })
  expect(text(r)).toBe('Recorded during-gap (under notes-app, planned)')
  expect(eventFiles(engine)).toHaveLength(files + 1)

  // somebody pauses the project meanwhile: it is taken in at the first poll that can read the file, not before
  const cfg = JSON.parse(engine.disk.text(configPath()))
  engine.put(configPath(), `${JSON.stringify({ ...cfg, recording: false }, null, 2)}\n`)
  await engine.advance(5000)
  expect(rt.mode).toBe('recording')
  engine.disk.failing.delete(configPath())
  await engine.advance(5000)
  expect(rt.mode).toBe('paused')
  expect(engine.cells.project.mode).toBe('paused')
})

test('io: config.json gone for one poll is not the end of recording; gone twice in a row is', async () => {
  const { rt, engine, p } = await started()
  const cfg = engine.disk.text(configPath())

  // a checkout is replacing it: the first poll that finds nothing changes nothing
  engine.disk.remove(configPath())
  await engine.advance(5000)
  expect(rt.mode).toBe('recording')
  expect(engine.cells.project.mode).toBe('recording')
  expect(text(await rt.toolCall(p, 'decision_note', { id: 'notes-app', text: 'written in the gap' }))).toBe('Noted on notes-app')

  // it is back, which starts the count over: one more miss later is again only one
  engine.put(configPath(), cfg)
  await engine.advance(5000)
  engine.disk.remove(configPath())
  await engine.advance(5000)
  expect(rt.mode).toBe('recording')

  // the next poll finds it gone as well, and now it is believed
  await engine.advance(5000)
  expect(rt.mode).toBe('off')
  expect(engine.cells.project).toMatchObject({ mode: 'off', config: null })
  expect(rt.section()?.text).toBe(OFF_LINE)
  const denied = await rt.toolCall(p, 'decision_record', { title: 'too late', parent: 'notes-app', status: 'planned' })
  expect(denied).toEqual({ deny: expect.stringContaining('decision_log_start') })

  // and when the file is back, so is the recording
  engine.put(configPath(), cfg)
  await engine.advance(5000)
  expect(rt.mode).toBe('recording')
  expect(text(await rt.toolCall(p, 'decision_note', { id: 'notes-app', text: 'and after it' }))).toBe('Noted on notes-app')
  expect(eventsOf(engine).filter(e => e.op === 'note').map(e => e.text)).toEqual(['written in the gap', 'and after it'])
})

test('io: pause, resume, lang and autoopen change the file as it is, so with a config.json that cannot be read they refuse and write nothing', async () => {
  const { rt, engine, p } = await started()
  const before = engine.disk.text(configPath())
  const writes = engine.disk.writes.length

  // what was remembered of the file is no basis for writing it again: somebody may have edited it since
  engine.disk.failing.add(configPath())
  const refused = `Cannot read config.json just now (EIO: cannot read ${configPath()}); nothing was changed. Try again.`
  for (const args of ['pause', 'resume', 'lang zh', 'lang en', 'autoopen off', 'autoopen on']) {
    expect(await rt.command(p, 'decide', args), args).toBe(refused)
  }
  expect(engine.disk.writes).toHaveLength(writes)
  expect(rt.mode).toBe('recording')

  // the person writes in Chinese: the refusal is in Chinese, and still writes nothing
  await rt.onPrompt(p, '现在再试一次')
  expect(rt.lang).toBe('zh')
  expect(await rt.command(p, 'decide', 'pause')).toBe(`现在读不了 config.json（EIO: cannot read ${configPath()}），什么都没改。请再试一次。`)
  expect(await rt.command(p, 'decide', 'autoopen off')).toBe(`现在读不了 config.json（EIO: cannot read ${configPath()}），什么都没改。请再试一次。`)
  expect(engine.disk.writes).toHaveLength(writes)

  // the disk answers: the file is as it was, and each command now changes its one key and no other
  engine.disk.failing.delete(configPath())
  expect(engine.disk.text(configPath())).toBe(before)
  const config = () => JSON.parse(engine.disk.text(configPath())) as { recording: boolean; display: { language: string; autoOpen: boolean } }
  expect(await rt.command(p, 'decide', 'pause')).toBe('决定记录已暂停')
  expect(config().recording).toBe(false)
  expect(rt.mode).toBe('paused')
  expect(await rt.command(p, 'decide', 'resume')).toBe('决定记录已恢复')
  expect(await rt.command(p, 'decide', 'autoopen off')).toBe('自动打开已设为 off')
  expect(await rt.command(p, 'decide', 'lang en')).toBe('Language set to en')
  expect(config()).toMatchObject({ recording: true, display: { language: 'en', autoOpen: false } })
  expect(rt.mode).toBe('recording')
})

// ---------------------------------------------------------------- events/

test('io: events that cannot be listed keep the pane as it was, say so once, and come back', async () => {
  const { rt, engine, p } = await started()
  const ids = () => engine.cells.model.nodes.map(n => n.id)
  expect(ids()).toEqual(['notes-app'])
  const toasts = () => engine.toasts.map(t => t.text)
  const told = toasts().length

  // the folder is there but the disk will not list it: that is not an empty folder
  engine.disk.listFailing.add(EVENTS)
  dropEvent(engine, 'late-one')
  await engine.advance(20_000)
  expect(ids()).toEqual(['notes-app'])
  expect(rt.mode).toBe('recording')
  expect(engine.cells.project.mode).toBe('recording')
  expect(toasts().slice(told)).toEqual([`Cannot read the decision record (EIO: cannot list ${EVENTS}); showing what was read last.`])
  // the model is shown what was read last, and the person is not told again
  expect(text(await rt.toolCall(p, 'decision_tree', {}))).toContain('notes-app')
  expect(toasts()).toHaveLength(told + 1)

  // the disk answers: the events that came meanwhile appear, and the person hears that it works again
  engine.disk.listFailing.delete(EVENTS)
  await engine.advance(5000)
  expect(ids()).toEqual(['notes-app', 'late-one'])
  expect(toasts().slice(told)).toEqual([`Cannot read the decision record (EIO: cannot list ${EVENTS}); showing what was read last.`, 'The decision record can be read again.'])

  // a second outage is a new one: it is said once more
  engine.disk.listFailing.add(EVENTS)
  await engine.advance(10_000)
  expect(toasts()).toHaveLength(told + 3)
  expect(ids()).toEqual(['notes-app', 'late-one'])
})

// ---------------------------------------------------------------- a disk that stalls

test('io: a disk call that never answers is given up on; the tool call is told, and everything behind it moves again', async () => {
  const { rt, engine, p } = await started()
  const files = eventFiles(engine).length

  // a stalled disk: listing events/ never comes back, and a second call waits its turn behind the first
  engine.disk.hanging.add(EVENTS)
  const stuck = rt.toolCall(p, 'decision_note', { id: 'notes-app', text: 'first' })
  const behind = rt.toolCall(p, 'decision_note', { id: 'notes-app', text: 'second' })
  await engine.advance(0)
  await engine.advance(29_000) // the polls that fall due meanwhile wait in the same line
  expect(eventFiles(engine)).toHaveLength(files)

  // the disk is back, but the call that was in it never will be: after 30 s it is given up on
  engine.disk.hanging.delete(EVENTS)
  await engine.advance(1000)
  expect(await stuck).toEqual({
    deny: 'decision-tree: no answer after 30 s (the disk or a command is not responding). The record may or may not have been changed; call decision_tree to check before trying again.',
  })

  // everything that was waiting runs now, in its turn
  expect(text(await behind)).toBe('Noted on notes-app')
  expect(eventsOf(engine).filter(e => e.op === 'note').map(e => e.text)).toEqual(['second'])
  dropEvent(engine, 'after-stall')
  await engine.advance(5000)
  expect(engine.cells.model.nodes.map(n => n.id)).toEqual(['notes-app', 'after-stall'])
  expect(text(await rt.toolCall(p, 'decision_note', { id: 'after-stall', text: 'third' }))).toBe('Noted on after-stall')
})

test('io: a command that fails inside the mod answers with a sentence, in the language of the pane', async () => {
  const { rt, engine, p } = await started()
  const files = eventFiles(engine).length

  // the folder is there but the disk will not list it: the command cannot do what it was asked
  engine.disk.listFailing.add(EVENTS)
  const en = `Something went wrong inside the decision-tree mod: EIO: cannot list ${EVENTS}`
  expect(await rt.command(p, 'decide', 'tree log')).toBe(en)
  expect(await rt.command(p, 'decide', 'tree')).toBe(en)

  // the person writes in Chinese: the same failure is said in Chinese
  await rt.onPrompt(p, '这个命令怎么没有反应')
  expect(rt.lang).toBe('zh')
  expect(await rt.command(p, 'decide', 'tree log')).toBe(`decision-tree mod 内部出错：EIO: cannot list ${EVENTS}`)

  // a call that stalls is given up on after 30 s, and its command answers the same way
  engine.disk.listFailing.delete(EVENTS)
  engine.disk.hanging.add(configPath())
  const pause = rt.command(p, 'decide', 'pause')
  await engine.advance(0)
  await engine.advance(30_000)
  expect(await pause).toBe('decision-tree mod 内部出错：no answer after 30 s (the disk or a command is not responding)')
  expect(rt.mode).toBe('recording')
  expect(eventFiles(engine)).toHaveLength(files)
})

// ---------------------------------------------------------------- start

test('start: a config.json that is there but cannot be read just now is never written over', async () => {
  const theirs = `${JSON.stringify({ v: 1, title: 'theirs', startedAt: '2026-10-01T09:00:00.000+00:00', recording: true, display: { asciiGlyphs: false, autoOpen: true, language: 'auto', translate: true }, futureKey: 'kept' }, null, 2)}\n`
  const e = new FakeEngine()
  e.put(configPath(), theirs)
  e.disk.failing.add(configPath())
  const { rt, engine, p } = await boot(e)
  expect(rt.mode).toBe('off') // nothing could be learnt from it yet

  // the model asks to start recording
  const refused = await rt.toolCall(p, 'decision_log_start', { title: 'mine', rootTitle: 'first' })
  expect(refused).toEqual({ deny: '.claude/decisions/config.json already exists (or could not be read just now), so nothing was changed. Try again in a moment.' })
  // and the person does
  expect(await rt.command(p, 'decide', 'start mine')).toBe('.claude/decisions/config.json already exists (or could not be read just now), so nothing was changed. Try again in a moment.')
  expect(rt.mode).toBe('off')
  expect(engine.disk.writes).toEqual([])
  expect(eventFiles(engine)).toEqual([])

  // the disk answers again: the file is theirs, byte for byte, and the project is on by what it says
  engine.disk.failing.delete(configPath())
  expect(engine.disk.text(configPath())).toBe(theirs)
  await engine.advance(5000)
  expect(rt.mode).toBe('recording')
  expect(engine.cells.project.config?.title).toBe('theirs')
  expect(engine.disk.text(configPath())).toBe(theirs)
  expect(engine.disk.writes).toEqual([])
})
