// /decide init: the person asks for the first points of the tree to be found in the project itself.
// The mod starts the record when it is off and hands the model the job; what the model records is
// ordinary decision_record calls, so this file only follows the hand-over.

import { test, expect } from 'claude-code/testing'

import { INIT_MAX_NODES, initPrompt } from '../lib/init'
import { INIT_SEND_AFTER_MS, NOT_THE_PERSON, Runtime } from '../lib/runtime'
import { linesOf, mountPane } from './draw'
import { callTool, eventsOn, seed, slash, submit, submitFrom, world } from './engine'
import { FakeEngine, ROOT, configPath, eventsOf, settle } from './port'

async function boot(engine = new FakeEngine()) {
  const rt = new Runtime()
  await rt.ensure(engine.port)
  return { rt, engine, p: engine.port }
}

type Booted = Awaited<ReturnType<typeof boot>>

/** The wait before the mod hands the model the job (it cannot do so from inside the command). */
const FIRST = INIT_SEND_AFTER_MS[0]! + 10

/** `/decide init ...`, then that wait. */
async function init(b: Booted, args = ''): Promise<string> {
  const receipt = await b.rt.command(b.p, 'decide', args === '' ? 'init' : `init ${args}`)
  await b.engine.advance(FIRST)
  return receipt
}

const ASKED = 'Asked Claude to look through the project and record where it starts; the pane fills as it goes.'
const ASKED_ZH = '已请 Claude 浏览项目并记下起点；记录会陆续出现在 pane 里。'
const STARTED = (title: string) => `Started recording decisions for ${title} (data in .claude/decisions/)`
const FAILED = (why: string) => `Could not hand init to Claude (${why}). Ask it to look through the project and record its starting point.`

const resultOf = (r: unknown): string => String((r as { result?: unknown }).result ?? '')
const said = (r: unknown): string => String((r as { text?: unknown }).text ?? '')

// ---------------------------------------------------------------- the job

test('init prompt: the steps in order, the limits, and what the records are written in', () => {
  const text = initPrompt({ title: 'orders', write: 'en' })
  expect(text.startsWith('Set up the decision tree for this project, "orders" (the person ran /decide init).')).toBe(true)
  // (a prompt that begins with a slash is refused by the engine: it would run as a command the person typed)
  expect(text.startsWith('/')).toBe(false)

  // read the tree, look through the project, record the starting point, then the decisions, then say what came of it
  const steps = ['1. Call decision_tree.', '2. Look through the project', '3. Record the starting point with decision_record', '4. Then record the decisions', '5. Do not ask the person anything'].map(s => text.indexOf(s))
  expect(steps.every(k => k >= 0)).toBe(true)
  expect([...steps].sort((a, b) => a - b)).toEqual(steps)

  // the starting point is the first step of the mainline
  expect(text).toContain('parent null, kind "milestone", status "adopted", trunk true')
  // it reads the project and the record, and changes nothing else
  expect(text).toContain("Change no file, run none of the project's code, start no jobs, and skip secrets")
  expect(text).toContain(`at most ${INIT_MAX_NODES - 1}`)
  expect(text).toContain('Never invent a decision or a reason')
  expect(text).toContain('(retracted ones do not count)')

  expect(text.endsWith('in English; technical terms stay in English.')).toBe(true)
  expect(initPrompt({ title: 'orders', write: 'zh' }).endsWith('in Chinese; technical terms stay in English.')).toBe(true)
  expect(initPrompt({ title: 'orders', write: 'follow' }).endsWith('in the language the person writes in (English if you cannot tell); technical terms stay in English.')).toBe(true)
})

test('init prompt: the title is one line, whatever was typed', () => {
  expect(initPrompt({ title: 'orders\n  api', write: 'en' })).toContain('"orders api"')
  expect(initPrompt({ title: '订单系统', write: 'zh' })).toContain('"订单系统"')
})

// ---------------------------------------------------------------- the command

test('/decide init on a project that is off: starts the record, opens the pane without the keyboard, hands the model the job', async () => {
  const { rt, engine, p } = await boot()
  expect(await rt.command(p, 'decide', 'init Orders API')).toBe(`${STARTED('Orders API')} ${ASKED}`)
  // not from inside the command: the engine refuses a prompt submitted while the command that asks for it still runs
  expect(engine.promptCalls).toBe(0)
  await engine.advance(FIRST)

  expect(rt.mode).toBe('recording')
  expect(JSON.parse(engine.disk.text(configPath())).title).toBe('Orders API')
  expect(eventsOf(engine).map(e => [e.op, e.actor])).toEqual([['start', 'user']]) // the model writes the tree, not the mod
  expect(engine.tools.map(t => t.name)).toEqual(expect.arrayContaining(['decision_record', 'decision_tree']))
  // the person will be watching, perhaps typing: the pane does not take the keyboard
  expect(engine.opens).toHaveLength(1)
  expect(engine.opens[0]).toMatchObject({ id: 'decision-tree' })
  expect(engine.opens[0]?.focus).toBeUndefined()

  expect(engine.promptCalls).toBe(1)
  expect(engine.prompts).toEqual([{ text: initPrompt({ title: 'Orders API', write: 'follow' }), asUser: true }])
})

test('/decide init without a title uses the folder name, as start does', async () => {
  const b = await boot()
  expect(await init(b)).toBe(`${STARTED('proj')} ${ASKED}`)
  expect(JSON.parse(b.engine.disk.text(configPath())).title).toBe('proj')
  expect(b.engine.prompts[0]?.text).toContain('for this project, "proj" (')
})

test('/decide init on a project that is already on and empty: no second start, the pane is shown, the job is handed over', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  const files = [...b.engine.disk.files.keys()]
  b.engine.paneOpen = false
  expect(await init(b)).toBe(ASKED)
  expect([...b.engine.disk.files.keys()]).toEqual(files)
  expect(b.engine.paneOpen).toBe(true)
  expect(b.engine.opens.at(-1)?.focus).toBeUndefined()
  // the record's own title, not the folder's
  expect(b.engine.prompts).toEqual([{ text: initPrompt({ title: 'orders', write: 'follow' }), asUser: true }])
})

test('/decide init sets up an empty tree only: one with decisions says so and sends nothing; retracted ones do not count', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  await b.rt.command(b.p, 'decide', 'add First idea --id first --status proposed')
  await b.rt.command(b.p, 'decide', 'add Second idea --id second --status proposed')
  const files = b.engine.disk.files.size
  expect(await init(b)).toBe('This tree already has decisions (2), and init only sets up an empty one. /decide new <name> --empty opens an empty tree.')
  expect(b.engine.promptCalls).toBe(0)
  expect(b.engine.disk.files.size).toBe(files)

  await b.rt.command(b.p, 'decide', 'retract first a slip')
  await b.rt.command(b.p, 'decide', 'retract second a slip')
  expect(await init(b)).toBe(ASKED)
  expect(b.engine.prompts).toHaveLength(1)
})

test('/decide init after the model has recorded the starting point is refused: the job is not run twice', async () => {
  const b = await boot()
  await init(b)
  expect(b.engine.prompts).toHaveLength(1)
  // what the model does with the job
  const root = await b.rt.toolCall(b.p, 'decision_record', { title: 'Orders API: v1 in production', parent: null, status: 'adopted', kind: 'milestone', trunk: true, sources: ['README.md'] })
  expect(root).toEqual({ result: expect.stringContaining('root') })
  expect(await init(b)).toContain('This tree already has decisions (1)')
  expect(b.engine.prompts).toHaveLength(1)
})

test('/decide init while recording is paused: says so, writes nothing, sends nothing', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  await b.rt.command(b.p, 'decide', 'pause')
  const written = b.engine.disk.writes.length
  expect(await init(b)).toBe('Decision recording is paused, so init has nowhere to write. Run /decide resume first.')
  expect(b.engine.promptCalls).toBe(0)
  expect(b.engine.disk.writes).toHaveLength(written)
  expect(b.rt.mode).toBe('paused')

  await b.rt.command(b.p, 'decide', 'resume')
  expect(await init(b)).toBe(ASKED)
})

test('/decide init never writes over a config.json it cannot use', async () => {
  const e = new FakeEngine()
  e.put(configPath(), '{ not json')
  const b = await boot(e)
  expect(await init(b)).toContain('cannot be read')
  expect(b.engine.disk.text(configPath())).toBe('{ not json')
  expect(b.engine.promptCalls).toBe(0)
  expect(b.rt.mode).toBe('off')
})

test('/decide init in a tree opened with --empty fills that tree', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  await b.rt.command(b.p, 'decide', 'add First idea --id first --status proposed')
  expect(await init(b)).toContain('already has decisions')
  expect(await b.rt.command(b.p, 'decide', 'new side-b --empty')).toContain('side-b')
  expect(await init(b)).toBe(ASKED)
  expect(b.engine.prompts).toHaveLength(1)
})

// ---------------------------------------------------------------- language

test('/decide init: the receipt and the records follow the language of the person, or the one config.json fixes', async () => {
  // nothing said yet: the model goes by what it knows of the person
  const a = await boot()
  await init(a)
  expect(a.engine.prompts[0]?.text.endsWith('in the language the person writes in (English if you cannot tell); technical terms stay in English.')).toBe(true)

  // a person who writes Chinese
  const b = await boot()
  await b.rt.onPrompt(b.p, '这个项目的结构我想先理一下，帮我看看')
  expect(await init(b)).toBe(`已开始记录 proj 的决定（数据在 .claude/decisions/） ${ASKED_ZH}`)
  expect(b.engine.prompts[0]?.text.endsWith('in Chinese; technical terms stay in English.')).toBe(true)

  // display.language wins over what the person writes
  const c = await boot()
  await c.rt.command(c.p, 'decide', 'start orders')
  await c.rt.command(c.p, 'decide', 'lang en')
  await c.rt.onPrompt(c.p, '这个项目的结构我想先理一下，帮我看看')
  expect(await init(c)).toBe(ASKED)
  expect(c.engine.prompts[0]?.text.endsWith('in English; technical terms stay in English.')).toBe(true)
  await c.rt.command(c.p, 'decide', 'lang zh')
  expect(await init(c)).toBe(ASKED_ZH)
  expect(c.engine.prompts[1]?.text.endsWith('in Chinese; technical terms stay in English.')).toBe(true)
})

test('/decide init: the refusals are worded in the language of the person', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  await b.rt.command(b.p, 'decide', 'add 第一个想法 --id first --status proposed')
  await b.rt.onPrompt(b.p, '帮我把这个项目的起点找出来')
  expect(await init(b)).toBe('这棵 tree 已经有决定了（1 个），init 只用于空 tree。/decide new <name> --empty 可以新开一棵空 tree。')
  await b.rt.command(b.p, 'decide', 'pause')
  expect(await init(b)).toBe('决定记录已暂停，init 没有地方可写。先运行 /decide resume。')
})

test('language: only the person\'s own words are followed; what a notification, a schedule or another plugin sends is not', async () => {
  const b = await boot()
  await b.rt.command(b.p, 'decide', 'start orders')
  await b.rt.onPrompt(b.p, '这个项目的结构我想先理一下，帮我看看', 'composer')
  expect(b.rt.lang).toBe('zh')
  const english = 'Background task finished: the nightly build of the second package completed without errors'
  for (const origin of NOT_THE_PERSON) {
    await b.rt.onPrompt(b.p, english, origin)
    expect(b.rt.lang, origin).toBe('zh')
  }
  // the person, from the terminal, a phone, or an origin this mod has never heard of, is followed
  for (const origin of ['composer', 'bridge', 'sdk', 'channel', 'slack-ping', 'unclassified', 'some-new-kind']) {
    await b.rt.onPrompt(b.p, '这个项目的结构我想先理一下，帮我看看', 'composer')
    expect(b.rt.lang, origin).toBe('zh')
    await b.rt.onPrompt(b.p, 'Please go on and look at the second package now', origin)
    expect(b.rt.lang, origin).toBe('en')
  }
  // and with no origin at all, as before
  await b.rt.onPrompt(b.p, '这个项目的结构我想先理一下，帮我看看')
  expect(b.rt.lang).toBe('zh')
})

// ---------------------------------------------------------------- when the engine does not take the prompt

test('/decide init: a refused attempt is made again, and the person is told only when the last one fails', async () => {
  const a = await boot()
  a.engine.promptAnswer = new Error('no turn can start')
  expect(await a.rt.command(a.p, 'decide', 'init')).toBe(`${STARTED('proj')} ${ASKED}`)
  const total = INIT_SEND_AFTER_MS.reduce((sum, ms) => sum + ms, 0)
  await a.engine.advance(total - 100)
  expect(a.engine.promptCalls).toBe(INIT_SEND_AFTER_MS.length - 1)
  expect(a.engine.toasts).toEqual([])
  await a.engine.advance(200)
  expect(a.engine.promptCalls).toBe(INIT_SEND_AFTER_MS.length)
  expect(a.engine.toasts.map(t => t.text)).toEqual([FAILED('no turn can start')])
  expect(a.rt.mode).toBe('recording') // the record stays started: the person can ask Claude themselves
  await a.engine.advance(60_000)
  expect(a.engine.promptCalls).toBe(INIT_SEND_AFTER_MS.length)

  // the engine takes it the second time: one prompt, no toast
  const b = await boot()
  b.engine.promptAnswer = new Error('busy')
  await b.rt.command(b.p, 'decide', 'init')
  await b.engine.advance(FIRST)
  expect(b.engine.promptCalls).toBe(1)
  b.engine.promptAnswer = null
  await b.engine.advance(INIT_SEND_AFTER_MS[1]! + 10)
  await b.engine.advance(60_000)
  expect(b.engine.promptCalls).toBe(2)
  expect(b.engine.prompts).toHaveLength(1)
  expect(b.engine.toasts).toEqual([])

  // an engine whose call throws before it returns a promise at all is the same
  const c = await boot()
  let calls = 0
  c.engine.port.prompt.submit = () => {
    calls += 1
    throw new Error('prompts are not available here')
  }
  await c.rt.command(c.p, 'decide', 'init')
  await c.engine.advance(60_000)
  expect(calls).toBe(INIT_SEND_AFTER_MS.length)
  expect(c.engine.toasts.map(t => t.text)).toEqual([FAILED('prompts are not available here')])
})

test('/decide init: a prompt another plugin drops is told at once, and not asked again', async () => {
  const b = await boot()
  b.engine.promptAnswer = 'held back by another plugin'
  await init(b)
  expect(b.engine.toasts.map(t => t.text)).toEqual([FAILED('held back by another plugin')])
  await b.engine.advance(60_000)
  expect(b.engine.promptCalls).toBe(1)
})

test('/decide init does not wait for the turn the prompt starts: the call answers when that turn begins', async () => {
  const b = await boot()
  let begins = () => {}
  b.engine.port.prompt.submit = input => {
    b.engine.promptCalls += 1
    b.engine.prompts.push({ text: input.text, asUser: true })
    return new Promise(resolve => {
      begins = () => resolve({ text: input.text })
    })
  }
  await init(b)
  expect(b.engine.prompts).toHaveLength(1)
  // minutes pass before the session is idle; the mod has nothing more to do, and says nothing
  await b.engine.advance(120_000)
  begins()
  await settle()
  expect(b.engine.prompts).toHaveLength(1)
  expect(b.engine.toasts).toEqual([])
})

// ---------------------------------------------------------------- through the engine

test("/decide init through the engine: the job reaches it as a prompt of this plugin, in the person's words, with the tools it needs listed", async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(said(await slash($, 'decide', 'init'))).toBe(`${STARTED('proj')} ${ASKED}`)
  const own = () => w.prompts.filter(p => (p.origin as { kind?: string } | undefined)?.kind === 'plugin')
  expect(own()).toHaveLength(0) // the engine refuses a prompt from inside the command, so it is not made there
  expect(w.toasts).toEqual([])

  await w.clock.advance(300)
  expect(w.toasts).toEqual([])
  expect(own()).toHaveLength(1)
  expect(own()[0]?.origin).toEqual({ kind: 'plugin', name: 'decision-tree', asUser: true })
  expect(own()[0]?.text).toBe(initPrompt({ title: 'proj', write: 'follow' }))
  expect(w.tools.map(t => t.name)).toEqual(expect.arrayContaining(['decision_record', 'decision_tree']))
  expect(w.opens.at(-1)?.focus).toBeUndefined()

  // what the model then does with it
  expect(resultOf(await callTool($, 'decision_tree'))).toContain('The tree is empty')
  expect(resultOf(await callTool($, 'decision_record', { title: 'Orders API: v1 in production', parent: null, status: 'adopted', kind: 'milestone', trunk: true }))).toContain('root')
  expect(eventsOn(w).map(e => e.op)).toEqual(['start', 'add'])
})

test('/decide init through the engine: the English job the mod sends itself does not turn a Chinese pane English', async ($, on) => {
  const w = world(on)
  seed(w, []) // recording, nothing in the tree yet
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  await submit($, '这个方向不错，先把项目的现状理一下，然后开始吧')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('个决定')
  expect(w.store.get(`lang:${ROOT}`)).toBe('zh')

  expect(said(await slash($, 'decide', 'init'))).toBe(ASKED_ZH)
  await w.clock.advance(300)
  const own = w.prompts.filter(p => (p.origin as { kind?: string } | undefined)?.kind === 'plugin')
  expect(own).toHaveLength(1)
  expect(own[0]?.text.endsWith('in Chinese; technical terms stay in English.')).toBe(true)
  // (the engine does not hand a plugin's prompt to its own hooks, but the pane and the language are what they were)
  expect(linesOf(await ui.drawn()).join('\n')).toContain('个决定')
  expect(w.store.get(`lang:${ROOT}`)).toBe('zh')

  // while something the person types still does
  await submit($, 'Please go on and look at the second package now')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('decision')
})

test('language through the engine: a prompt from another plugin, a schedule or a notification does not turn a Chinese pane English', async ($, on) => {
  const w = world(on)
  seed(w, [])
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  const ui = await mountPane($, 'terminal', { columns: 80 })
  await submit($, '这个方向不错，先把项目的现状理一下，然后开始吧')
  expect(linesOf(await ui.drawn()).join('\n')).toContain('个决定')

  const english = 'Please run the nightly summary of the open pull requests and post it to the channel'
  await submitFrom($, english, { kind: 'plugin', name: 'some-other-plugin' })
  await submitFrom($, english, { kind: 'scheduled-trigger' })
  await submitFrom($, english, { kind: 'task-notification' })
  expect(linesOf(await ui.drawn()).join('\n')).toContain('个决定')
  expect(w.store.get(`lang:${ROOT}`)).toBe('zh')

  // what the person types does
  await submit($, english)
  expect(linesOf(await ui.drawn()).join('\n')).toContain('decision')
  expect(w.store.get(`lang:${ROOT}`)).toBe('en')
})
