// decision-tree: records a project's decisions as a tree and shows it in a pane.
//
// This file only wires the engine's events to the Runtime (lib/runtime.ts); the
// work is in lib/, which has the tests. Read README.md for what the mod does.
//
// The engine refuses a hooks module that hands `$` to a function of another file,
// so `portOf` (declared here, where the engine can follow `$` into it) spells out
// each engine call lib/ may make, and lib/ takes that object instead of `$`.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Port } from '../lib/port'
import { PANE_ID, Runtime } from '../lib/runtime'
import { EMPTY_MODEL, EMPTY_NOW, EMPTY_PROJECT, EMPTY_UI } from '../lib/state'
import { TOOL_PREFIX, shortName } from '../lib/tools'
import { drawPane, isNodeKey } from '../lib/view'

// The tools of this mod are told apart by their name prefix: the engine types a name list from the tools this mod had
// registered the last time it loaded (which depends on whether that project was recording), a pattern is not held to it.
// Which of our tools a call is for is checked at run time (`shortName`).
const TOOL_PATTERN = new RegExp(`^${TOOL_PREFIX}`)

// The values kept in `$.state` (the contract is types/index.d.ts). They are declared here
// because the engine lists what a module reads and writes from the atoms it can see.
const modelAtom = atom({ plugin: 'decision-tree', key: 'model' } as const, EMPTY_MODEL)
const projectAtom = atom({ plugin: 'decision-tree', key: 'project' } as const, EMPTY_PROJECT)
const uiAtom = atom({ plugin: 'decision-tree', key: 'ui' } as const, EMPTY_UI)
const langAtom = atom({ plugin: 'decision-tree', key: 'lang' } as const, 'en' as const)
const nowAtom = atom({ plugin: 'decision-tree', key: 'now' } as const, EMPTY_NOW)
const ownerAtom = atom({ plugin: 'decision-tree', key: 'owner' } as const, '')

function portOf($: EngineInterface): Port {
  return {
    session: { cwd: () => $.session.cwd(), id: () => $.session.id() },
    clock: { now: () => $.clock.now(), every: (ms, fn) => $.clock.every(ms, fn), after: (ms, fn) => $.clock.after(ms, fn) },
    store: { get: key => $.store.get(key), set: (key, value) => $.store.set(key, value) },
    fs: {
      read: path => $.fs.read(path),
      write: (path, text) => $.fs.write(path, text),
      list: path => $.fs.list(path),
      exists: path => $.fs.exists(path),
    },
    process: { run: (argv, options) => $.process.run(argv, options) },
    command: { register: spec => $.command.register(spec) },
    tool: { register: spec => $.tool.register(spec) },
    ui: {
      open: args => $.ui.open(args),
      panes: () => $.ui.panes(),
      focus: args => $.ui.focus(args),
      toast: (text, options) => $.ui.toast(text, options),
      invalidate: () => $.ui.invalidate('ui.render'),
    },
    state: {
      model: { read: () => read($, modelAtom), update: change => update($, modelAtom, change) },
      project: { read: () => read($, projectAtom), update: change => update($, projectAtom, change) },
      ui: { read: () => read($, uiAtom), update: change => update($, uiAtom, change) },
      lang: { read: () => read($, langAtom), update: change => update($, langAtom, change) },
      now: { read: () => read($, nowAtom), update: change => update($, nowAtom, change) },
      owner: { read: () => read($, ownerAtom), update: change => update($, ownerAtom, change) },
    },
  }
}

/** The arguments of a tool call: what the engine adds beside them is left out. */
function argsOf(e: Record<string, unknown>): Record<string, unknown> {
  const { tool: _tool, tool_use_id: _id, agentId: _agent, ...args } = e
  return args
}

export const register: Register = on => {
  const rt = new Runtime()

  // Everything starts here, awaited before the first prompt, so the tools are listed by turn one.
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tree', description: 'Open the decision tree pane', immediate: true })
    await $.command.register({
      name: 'decide',
      description: 'Record and edit decisions: start, pause, resume, status, note, add, retract, import, tree',
      argumentHint: '[start|pause|resume|status|note|add|retract|import|tree] ...',
      immediate: true,
    })
    try {
      await rt.ensure(portOf($))
    } catch (err) {
      $.ui.toast(`decision-tree: could not start (${err instanceof Error ? err.message : String(err)})`)
    }
    return next(e)
  })

  // A /clear and a resume start the session over inside this process: the poll goes on (the session's
  // `$.state` is empty then, and the Runtime puts it back); any other ending is the process going.
  on('session.end', ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') rt.stop()
    return next(e)
  })

  // ---- what the model calls
  on('tool.call', { tool: TOOL_PATTERN }, async ($, e) => {
    const name = shortName(e.tool)
    if (name === null) return { deny: `decision-tree: unknown tool ${e.tool}` }
    return rt.toolCall(portOf($), name, argsOf(e))
  }).catch(() => ({ deny: 'decision-tree: this call failed inside the mod and nothing was recorded. Tell the user.' }))

  // ---- what the person types
  on('command.run', { command: 'tree' }, async $ => ({ text: await rt.command(portOf($), 'tree', '') })).catch(() => ({ text: 'decision-tree: this command failed inside the mod.' }))
  on('command.run', { command: 'decide' }, async ($, e) => ({ text: await rt.command(portOf($), 'decide', e.args ?? '') })).catch(() => ({ text: 'decision-tree: this command failed inside the mod.' }))

  // ---- the system prompt, once per turn
  on('turn.start', async ($, e, next) => {
    await rt.onTurnStart(portOf($))
    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const section = rt.section()
    return section === null ? composed : { ...composed, sections: [...composed.sections, section] }
  })

  // the language the person writes in decides the language of the pane and the receipts
  on('prompt.submit', async ($, e, next) => {
    try {
      await rt.onPrompt(portOf($), e.text)
    } catch {
      // the language stays as it was
    }
    return next(e)
  })

  // ---- the pane
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e) => drawPane(portOf($), e, $.ui.resolve(e), rt))

  // the band is not ours; looking at it tells us whether the screen can dock a pane
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => {
    rt.seeViewport(e.viewport)
    return next(e)
  })

  // the selected node follows the keyboard's focus ring (Tab, arrows, a click)
  on('ui.focus', { requestId: PANE_ID }, async ($, e, next) => {
    if (e.component === 'Pane' && e.plugin === $.plugin.name && e.element !== undefined && isNodeKey(e.element)) {
      try {
        await rt.select(portOf($), e.element)
      } catch {
        // the ring still moves
      }
    }
    return next(e)
  })
}
