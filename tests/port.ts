// An engine in memory: the Port the Runtime runs on in tests. Files live in a
// MemDisk, time moves only when a test moves it, and every registration, pane
// call and toast is recorded so a test can say what the mod asked for.

import type { CommandSpec, FsEntry, ModelCompleteRequest, ModelCompleteResult, PaneOpenArgs, ProcessRunInit, ProcessRunResult, ToolSpec, UiPane } from 'claude-code'

import type { DtLang, DtModel, DtNow, DtProject, DtTm, DtTreeInfo, DtUi } from '../types'
import type { Cell, Port } from '../lib/port'
import { DEFAULT_SCHEME } from '../lib/palettes'
import { EMPTY_MODEL, EMPTY_NOW, EMPTY_PROJECT, EMPTY_TM, EMPTY_TREES, EMPTY_UI } from '../lib/state'
import { MemDisk } from './mem'

export const ROOT = '/work/proj'
export const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)

type Timer = { ms: number; fn: () => void; cancelled: boolean; due: number }

export type RunHandler = (argv: readonly string[], init?: ProcessRunInit) => ProcessRunResult | Promise<ProcessRunResult>

/** What a call to the model answers when no test said otherwise: no model to be had (the translator backs off). */
export const NO_MODEL: ModelCompleteResult = {
  isAnswered: false,
  reason: 'api-error',
  status: null,
  error: 'unknown',
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}

export type ModelHandler = (request: ModelCompleteRequest) => ModelCompleteResult | Promise<ModelCompleteResult>

function result(exitCode: number, stdout = '', stderr = ''): ProcessRunResult {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } as ProcessRunResult
}

export class FakeEngine {
  readonly disk = new MemDisk()
  readonly store = new Map<string, unknown>()
  cwd = ROOT
  sessionId = 'abcdef0123456789'
  nowMs = T0

  // ---- registrations and ui
  readonly tools: ToolSpec[] = []
  readonly commands: CommandSpec[] = []
  /** The prompts the engine took from the mod (`$.prompt.submit`). */
  readonly prompts: { text: string; asUser?: true }[] = []
  /** How many times the mod called `$.prompt.submit`, the refused calls included. */
  promptCalls = 0
  /** What `$.prompt.submit` answers: a string drops the prompt (`{ drop }`), an Error rejects the call, null takes it. */
  promptAnswer: string | Error | null = null
  readonly opens: PaneOpenArgs[] = []
  readonly toasts: { text: string; timeoutMs?: number }[] = []
  readonly focuses: { requestId: string; key: string }[] = []
  invalidations = 0
  /** What `$.ui.open` answers: false is a surface that places no panes. */
  placed = true
  /** Whether the pane counts as shown once opened. */
  shown = true
  paneOpen = false

  // ---- the model (what the translator asks for)
  /** Every request the mod made to `$.model.complete`, in order. */
  readonly modelCalls: ModelCompleteRequest[] = []
  /** What `$.model.complete` answers; null is no model at all (`NO_MODEL`). */
  onModel: ModelHandler | null = null

  // ---- processes
  readonly runs: { argv: readonly string[]; init?: ProcessRunInit }[] = []
  /** `git rev-parse --show-toplevel` answers this; null is "not a repository". */
  gitTop: string | null = null
  /** `git check-ignore` says the record would be ignored. */
  gitIgnored = false
  /** Any other command (the status command). */
  onRun: RunHandler | null = null

  // ---- state cells
  cells: { model: DtModel; project: DtProject; ui: DtUi; lang: DtLang; now: DtNow; tm: DtTm; trees: DtTreeInfo[]; scheme: string; translating: number; owner: string } = {
    model: EMPTY_MODEL,
    project: EMPTY_PROJECT,
    ui: EMPTY_UI,
    lang: 'en',
    now: EMPTY_NOW,
    tm: EMPTY_TM,
    trees: EMPTY_TREES,
    scheme: DEFAULT_SCHEME,
    translating: 0,
    owner: '',
  }
  /** Every write to a cell, in order (to count redraws). */
  readonly writes: string[] = []

  private timers: Timer[] = []
  readonly port: Port

  constructor() {
    this.port = this.build()
  }

  // ---------------------------------------------------------------- time

  /** Moves the clock and runs every timer that falls due, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.nowMs + ms
    for (;;) {
      const next = this.timers.filter(t => !t.cancelled && t.due <= end).sort((a, b) => a.due - b.due)[0]
      if (next === undefined) break
      this.nowMs = next.due
      next.due += next.ms
      next.fn()
      // let what the callback started run to its end
      await settle(500)
    }
    this.nowMs = end
    await settle(500)
  }

  get activeTimers(): number {
    return this.timers.filter(t => !t.cancelled).length
  }

  // ---------------------------------------------------------------- the world outside

  /** A file appearing from outside (another session, git pull, a hand edit). */
  put(path: string, text: string): void {
    this.disk.put(path, text)
  }

  get panes(): UiPane[] {
    return this.paneOpen ? [{ id: 'decision-tree', title: this.opens.at(-1)?.title ?? 'decision-tree', isShown: this.shown, isFocused: false, isPlaced: this.placed }] : []
  }

  // ---------------------------------------------------------------- the Port

  private cell<K extends keyof FakeEngine['cells']>(key: K): Cell<FakeEngine['cells'][K]> {
    return {
      read: async () => this.cells[key],
      update: async change => {
        const next = change(this.cells[key])
        this.cells[key] = next
        this.writes.push(key)
        return next
      },
    }
  }

  private build(): Port {
    const self = this
    return {
      session: {
        cwd: async () => self.cwd,
        id: async () => self.sessionId,
      },
      clock: {
        now: async () => self.nowMs,
        every: (ms, fn) => {
          const t: Timer = { ms, fn, cancelled: false, due: self.nowMs + ms }
          self.timers.push(t)
          return {
            cancel: () => {
              t.cancelled = true
            },
          }
        },
        after: (ms, fn) => {
          // once: a timer that cancels itself the first time it runs
          const t: Timer = { ms, fn: () => {}, cancelled: false, due: self.nowMs + ms }
          t.fn = () => {
            t.cancelled = true
            fn()
          }
          self.timers.push(t)
          return {
            cancel: () => {
              t.cancelled = true
            },
          }
        },
      },
      store: {
        get: async key => self.store.get(key),
        set: async (key, value) => {
          self.store.set(key, value)
        },
      },
      fs: {
        read: path => self.disk.read(path),
        write: (path, text) => self.disk.write(path, text),
        exists: path => self.disk.exists(path),
        list: async path => {
          const entries = await self.disk.list(path ?? '.')
          return entries.map((e): FsEntry => ({ name: e.name, kind: e.kind, size: e.size, mtimeMs: e.mtimeMs, isLink: false }))
        },
      },
      process: {
        run: async (argv, init) => {
          self.runs.push({ argv, ...(init !== undefined ? { init } : {}) })
          if (argv[0] === 'git' && argv[1] === 'rev-parse') return self.gitTop === null ? result(128, '', 'fatal: not a git repository') : result(0, `${self.gitTop}\n`)
          if (argv[0] === 'git' && argv[1] === 'check-ignore') return result(self.gitIgnored ? 0 : 1)
          if (self.onRun === null) throw new Error(`no handler for ${argv.join(' ')}`)
          return self.onRun(argv, init)
        },
      },
      command: {
        register: async spec => {
          const at = self.commands.findIndex(c => c.name === spec.name)
          if (at >= 0) self.commands[at] = spec
          else self.commands.push(spec)
          return { command: spec.name }
        },
      },
      prompt: {
        submit: async input => {
          self.promptCalls += 1
          if (self.promptAnswer instanceof Error) throw self.promptAnswer
          if (typeof self.promptAnswer === 'string') return { drop: self.promptAnswer }
          self.prompts.push({ text: input.text, ...(input.asUser === true ? { asUser: true as const } : {}) })
          return { text: input.text }
        },
      },
      model: {
        complete: async request => {
          self.modelCalls.push(request)
          return self.onModel === null ? NO_MODEL : self.onModel(request)
        },
      },
      tool: {
        register: async spec => {
          const at = self.tools.findIndex(t => t.name === spec.name)
          if (at >= 0) self.tools[at] = spec
          else self.tools.push(spec)
          return { tool: `mcp__decision-tree__${spec.name}` } as never
        },
      },
      ui: {
        open: async args => {
          self.opens.push(args)
          if (!self.placed) return { isPlaced: false, reason: 'no surface places panes' }
          self.paneOpen = true
          return { isPlaced: true }
        },
        panes: async () => self.panes,
        focus: async args => {
          self.focuses.push(args)
          return {}
        },
        toast: (text, options) => {
          self.toasts.push({ text, ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}) })
        },
        invalidate: () => {
          self.invalidations += 1
        },
      },
      state: {
        model: this.cell('model'),
        project: this.cell('project'),
        ui: this.cell('ui'),
        lang: this.cell('lang'),
        now: this.cell('now'),
        tm: this.cell('tm'),
        trees: this.cell('trees'),
        scheme: this.cell('scheme'),
        translating: this.cell('translating'),
        owner: this.cell('owner'),
      },
    }
  }
}

/** Lets promises that are ready run. */
export async function settle(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

/** The paths of the event files on the fake disk, sorted. */
export function eventFiles(engine: FakeEngine, root = ROOT): string[] {
  return [...engine.disk.files.keys()].filter(p => p.startsWith(`${root}/.claude/decisions/events/`)).sort()
}

/** The parsed events, in file-name order. */
export function eventsOf(engine: FakeEngine, root = ROOT): Record<string, unknown>[] {
  return eventFiles(engine, root).map(p => JSON.parse(engine.disk.text(p)) as Record<string, unknown>)
}

export function configPath(root = ROOT): string {
  return `${root}/.claude/decisions/config.json`
}
