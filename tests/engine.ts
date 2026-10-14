// What the engine-level tests stand on: the host's side of every `$` call this
// mod makes, answered from memory by hooks of the test's `on` (they sit beneath
// the plugin, as the engine does). The mod itself is the real hooks module.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PaneOpenArgs, PromptOrigin, ToolSpec, CommandSpec, ProcessRunResult, ModelCompleteInput } from 'claude-code'

import { defaultConfig, serializeConfig, withStatus } from '../lib/config'
import { eventFileName, isoLocal } from '../lib/events'
import type { DecisionEvent, DtActor, DtDecidedBy, DtEvidence, DtKind, DtLang, DtStatus } from '../types'
import { MemDisk } from './mem'
import { CONFLICTS, MAIN_RAW, NOW, iso, noon } from './notes'
import { NO_MODEL, ROOT, T0 } from './port'
import type { ModelHandler } from './port'

export type World = {
  disk: MemDisk
  clock: ReturnType<typeof mock.clock>
  /** The mod's key-value store (`$.store`), kept between sessions. */
  store: Map<string, unknown>
  tools: ToolSpec[]
  commands: CommandSpec[]
  /** Every prompt that reached the bottom of the engine (the ones typed too), with where it came from. */
  prompts: { text: string; origin: unknown }[]
  opens: PaneOpenArgs[]
  toasts: string[]
  invalidations: number
  runs: (readonly string[])[]
  /** Answers any command that is not git's (the status command). */
  onRun: ((argv: readonly string[]) => Partial<ProcessRunResult>) | null
  gitTop: string | null
  /** The pane counts as open and shown once something opened it. */
  paneOpen: boolean
  placed: boolean
  /** Every request the mod made of the model (`$.model.complete`): the translator's. */
  modelCalls: ModelCompleteInput[]
  /** What the model answers; null: no model to be had (`NO_MODEL`). */
  onModel: ModelHandler | null
}

const run = (r: Partial<ProcessRunResult>): ProcessRunResult => ({ exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...r }) as ProcessRunResult

/** Registers the host's answers. Call before the first use of `$`. */
export function world(on: On, options: { cwd?: string; session?: string; now?: number } = {}): World {
  const w: World = {
    disk: new MemDisk(),
    clock: mock.clock(on, { now: options.now ?? T0 }),
    store: new Map(),
    tools: [],
    commands: [],
    prompts: [],
    opens: [],
    toasts: [],
    invalidations: 0,
    runs: [],
    onRun: null,
    gitTop: null,
    paneOpen: false,
    placed: true,
    modelCalls: [],
    onModel: null,
  }
  const cwd = options.cwd ?? ROOT

  // what the engine does beneath the mod's hooks, which call `next(e)` and need an answer
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_$, e) => {
    w.prompts.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('prompt.compose', () => ({ sections: [{ id: 'base', text: 'You are a coding assistant.', scope: 'shared' as const }] }))
  on('ui.focus', () => ({}))
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const, props: {}, children: [] }))

  on('store.get', (_$, e) => ({ value: w.store.get(e.key) }))
  on('store.set', (_$, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))

  on('session.cwd', () => ({ value: cwd }))
  on('session.root', () => ({ value: cwd }))
  on('session.id', () => ({ value: options.session ?? 'abcdef0123456789' }))

  on('fs.exists', async (_$, e) => ({ value: await w.disk.exists(e.path) }))
  on('fs.read', async (_$, e) => {
    try {
      return { value: await w.disk.read(e.path) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  })
  on('fs.write', async (_$, e) => {
    await w.disk.write(e.path, e.text)
    return { value: undefined }
  })
  on('fs.list', async (_$, e) => {
    try {
      const entries = await w.disk.list(e.path)
      return { value: entries.map(x => ({ name: x.name, kind: x.kind, size: x.size, mtimeMs: x.mtimeMs, isLink: false })) }
    } catch (err) {
      return { deny: err instanceof Error ? err.message : String(err) }
    }
  })

  on('model.complete', async (_$, e) => {
    w.modelCalls.push(e)
    return { value: w.onModel === null ? NO_MODEL : await w.onModel(e) }
  })

  on('process.run', (_$, e) => {
    const argv = e.argv
    w.runs.push(argv)
    if (argv[0] === 'git' && argv[1] === 'rev-parse') return { value: w.gitTop === null ? run({ exitCode: 128, stderr: 'fatal: not a git repository' }) : run({ stdout: `${w.gitTop}\n` }) }
    if (argv[0] === 'git' && argv[1] === 'check-ignore') return { value: run({ exitCode: 1 }) }
    if (w.onRun === null) return { deny: `no command is expected: ${argv.join(' ')}` }
    return { value: run(w.onRun(argv)) }
  })

  on('tool.register', (_$, e) => {
    const at = w.tools.findIndex(t => t.name === e.name)
    if (at >= 0) w.tools[at] = e
    else w.tools.push(e)
    return { value: { tool: `mcp__decision-tree__${e.name}` } as never }
  })
  on('command.register', (_$, e) => {
    const at = w.commands.findIndex(c => c.name === e.name)
    if (at >= 0) w.commands[at] = e
    else w.commands.push(e)
    return { value: { command: e.name } }
  })

  on('ui.open', (_$, e) => {
    w.opens.push(e)
    if (!w.placed) return { value: { isPlaced: false, reason: 'no surface places panes' } }
    w.paneOpen = true
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: w.paneOpen ? [{ id: 'decision-tree', title: 'Decisions', isShown: true, isFocused: false, isPlaced: w.placed }] : [],
  }))
  on('ui.toast', (_$, e) => {
    w.toasts.push((e as { text: string }).text)
    return { value: undefined }
  })
  on('ui.invalidate', () => {
    w.invalidations += 1
    return { value: undefined }
  })
  return w
}

// ---------------------------------------------------------------- a project on the disk

export type SeedNode = {
  id: string
  title: string
  parent?: string | null
  status?: DtStatus
  kind?: DtKind
  trunk?: boolean
  summary?: string
  rationale?: string
  evidence?: DtEvidence[]
  sources?: string[]
  tags?: string[]
  decidedBy?: DtDecidedBy
  decidedAt?: string
  /** When the node last changed (epoch ms): the time its `add` event says. Default: the second it was written. */
  at?: number
  /** Notes written under the node, each right after it. */
  notes?: { text: string; actor?: DtActor; at?: number }[]
}

export type SeedOptions = {
  root?: string
  title?: string
  /** When the first event happened; every next one is a second later. Default: a day before the clock. */
  at?: number
  session?: string
  statusArgv?: string[]
  recording?: boolean
  ascii?: boolean
  /** Whether the mod asks the model for the versions in the other language (`display.translate`). Off unless a test is about translating. */
  translate?: boolean
}

/**
 * Writes a recording project onto the world's disk the way earlier sessions would have left it:
 * config.json, one `start` event and one `add` event per node, in the order given.
 */
export function seed(w: World, nodes: readonly SeedNode[], options: SeedOptions = {}): void {
  const dir = `${options.root ?? ROOT}/.claude/decisions`
  const session = options.session ?? 'seed00'
  const base = options.at ?? T0 - 24 * 3600 * 1000

  let config = defaultConfig(options.title ?? 'notes-app', isoLocal(base))
  if (options.statusArgv !== undefined) config = withStatus(config, options.statusArgv)
  config = { ...config, recording: options.recording ?? true, display: { ...config.display, asciiGlyphs: options.ascii ?? false, translate: options.translate ?? false } }
  w.disk.put(`${dir}/config.json`, serializeConfig(config))

  // (the name of a file says where the event comes in the order; the event's own `ts` says when it happened)
  let seq = 0
  const put = (event: Omit<DecisionEvent, 'v' | 'ts' | 'session' | 'actor'> & { actor?: DtActor }, ts?: number) => {
    const ms = base + seq * 1000
    seq += 1
    const body: DecisionEvent = { v: 1, ts: isoLocal(ts ?? ms), session, ...event, actor: event.actor ?? 'model' }
    w.disk.put(`${dir}/events/${eventFileName(ms, session, seq)}`, JSON.stringify(body, null, 2))
  }

  put({ op: 'start' })
  for (const n of nodes) {
    put(
      {
        op: 'add',
        id: n.id,
        node: {
          title: n.title,
          parent: n.parent ?? null,
          status: n.status ?? 'adopted',
          kind: n.kind ?? 'decision',
          ...(n.trunk === true ? { trunk: true } : {}),
          ...(n.summary !== undefined ? { summary: n.summary } : {}),
          ...(n.rationale !== undefined ? { rationale: n.rationale } : {}),
          ...(n.evidence !== undefined ? { evidence: n.evidence } : {}),
          ...(n.sources !== undefined ? { sources: n.sources } : {}),
          ...(n.tags !== undefined ? { tags: n.tags } : {}),
          ...(n.decidedBy !== undefined ? { decidedBy: n.decidedBy } : {}),
          ...(n.decidedAt !== undefined ? { decidedAt: n.decidedAt } : {}),
        },
      },
      n.at,
    )
    for (const note of n.notes ?? []) put({ op: 'note', id: n.id, text: note.text, actor: note.actor ?? 'model' }, note.at)
  }
}

const HOUR = 3600 * 1000

/** The decisions of the notes-app sample (tests/notes.ts), as seed nodes in the language `lang`; the clock should read `NOW`. */
export function notesNodes(lang: DtLang = 'en'): SeedNode[] {
  return MAIN_RAW.map((r): SeedNode => {
    const [month, day] = r.date.split('-').map(Number) as [number, number]
    const node: SeedNode = {
      id: r.id,
      title: lang === 'en' ? r.en : r.zh,
      parent: r.parent,
      status: r.status,
      decidedBy: r.by,
      decidedAt: noon(month, day),
      at: NOW - r.ago * HOUR,
    }
    if (r.trunk) node.trunk = true
    if (r.id === 'n3') {
      const i = lang === 'en' ? 0 : 1
      const [month2, day2] = CONFLICTS.note.date.split('-').map(Number) as [number, number]
      node.summary = CONFLICTS.summary[i]
      node.rationale = CONFLICTS.rationale[i]
      node.evidence = CONFLICTS.evidence.map(e => ({ label: e.label[i], value: e.value[i], run: e.run }))
      node.sources = [...CONFLICTS.sources]
      node.notes = [{ text: CONFLICTS.note.text[i], actor: CONFLICTS.note.actor, at: Date.parse(noon(month2, day2)) }]
    }
    return node
  })
}

/** The notes-app sample on the disk, in `lang`. The world's clock has to be set to the sample's `NOW`: `world(on, { now: NOW })`. */
export function seedNotes(w: World, options: SeedOptions & { lang?: DtLang } = {}): void {
  seed(w, notesNodes(options.lang ?? 'en'), { at: NOW - 1000 * HOUR, ...options })
}

export { NOW, iso }

/** The event files on the world's disk, parsed, in file-name order. */
export function eventsOn(w: World, root = ROOT): Record<string, unknown>[] {
  const prefix = `${root}/.claude/decisions/events/`
  return [...w.disk.files.keys()]
    .filter(p => p.startsWith(prefix))
    .sort()
    .map(p => JSON.parse(w.disk.text(p)) as Record<string, unknown>)
}

/** Types `/name args` at the prompt, in a fullscreen terminal. */
export function slash($: Engine, name: string, args = '') {
  return $.command.run({ command: name, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })
}

let turns = 0

/** The model calls one of the mod's tools. */
export function callTool($: Engine, name: string, args: Record<string, unknown> = {}) {
  // (cast: the engine types `tool` from the tools registered when the mod last loaded, which varies)
  return $.tool.call({ tool: `mcp__decision-tree__${name}`, ...args } as never)
}

/** The engine composes the system prompt for a plain request. */
export function compose($: Engine) {
  return $.prompt.compose({ model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
}

/** The person presses Enter on a prompt. */
export function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

/** A prompt that does not come from the person's keyboard: another plugin's, a schedule's. */
export function submitFrom($: Engine, text: string, origin: PromptOrigin) {
  return $.prompt.submit({ text, wait: false, origin })
}

/** A new turn starts. */
export function startTurn($: Engine, text = '') {
  turns += 1
  return $.turn.start({ text, turnId: `turn-${turns}` })
}

/** The text of the section the mod adds to the system prompt, or null. */
export async function sectionOf($: Engine): Promise<{ id: string; text: string; scope: string } | null> {
  const composed = await compose($)
  const section = composed.sections.find(s => s.id === 'decision-tree:record')
  return section === undefined ? null : { id: section.id, text: section.text, scope: section.scope }
}
