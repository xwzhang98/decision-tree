// The on-disk journal of one tree of a project: `.claude/decisions/events/*.json` for the main tree,
// `.claude/decisions/trees/<name>/events/*.json` for the others.
//
// Events are immutable files, written once and never changed, so sessions
// never conflict. A Journal keeps what it has read in memory, reads only file
// names it has not seen, and replays them (sorted by name) into the model.
// All file access goes through `Io`, so tests run it on an in-memory disk.

import type { DecisionEvent, DtActor, DtForkBase, DtModel } from '../types'
import { MAIN, TREE_NAME, eventFileName, isEventFile, isoLocal, parseEventText, stampMs } from './events'
import { replay } from './replay'
import type { ReplayEntry } from './replay'

export type IoEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }

export type Io = {
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<IoEntry[]>
  exists: (path: string) => Promise<boolean>
}

/** A draft of an event: everything but what the journal stamps on it. */
export type EventDraft = {
  op: DecisionEvent['op']
  actor: DtActor
  id?: string
  node?: DecisionEvent['node']
  patch?: DecisionEvent['patch']
  text?: string
  parent?: string | null
  reason?: string
  base?: DtForkBase
}

type Slot = { entry: ReplayEntry; size: number; mtimeMs: number; attempts: number }

/** What reading config.json found: the text, nothing there, or a read that failed (which says nothing about the file). */
export type ConfigRead = { kind: 'text'; text: string } | { kind: 'absent' } | { kind: 'error'; error: string }

/** How many times an unreadable file is read again before it is left alone. */
const RETRIES = 3
const BATCH = 16
/** Event files copied at once when a tree is opened from another. */
const COPY_BATCH = 8
/** An event file stamped further ahead than this is not another clock running fast but a stray; it does not hold new events back. */
const SKEW_LIMIT_MS = 24 * 3600 * 1000

export class Journal {
  /** `.claude/decisions`: config.json, and the main tree's own files, live here. */
  readonly projectDir: string
  /** This tree's folder: `projectDir` for the main tree, `projectDir/trees/<name>` for any other. */
  readonly dir: string
  readonly eventsDir: string
  readonly configPath: string
  readonly treePath: string
  private slots = new Map<string, Slot>()
  private seq = 0
  private memo: DtModel | null = null
  /** Reads in a row that found events/ empty although events had been read before. */
  private emptyReads = 0

  constructor(
    private readonly io: Io,
    readonly root: string,
    /** The 6-character id events are stamped with; a /clear makes a new conversation, which may take a new one. */
    public session: string,
    /** Which tree of the project this reads and writes. */
    readonly tree: string = MAIN,
  ) {
    this.projectDir = `${root.replace(/\/+$/, '')}/.claude/decisions`
    this.dir = tree === MAIN ? this.projectDir : `${this.projectDir}/trees/${tree}`
    this.eventsDir = `${this.dir}/events`
    this.configPath = `${this.projectDir}/config.json`
    this.treePath = `${this.dir}/tree.json`
  }

  /** A journal over another tree of the same project, on the same disk and with the same session id. */
  sibling(tree: string): Journal {
    return new Journal(this.io, this.root, this.session, tree)
  }

  /**
   * Lists events/ and reads the files not seen yet. A file that does not parse
   * may be half written by another session, so it is read again a few times
   * (and whenever its size changes) before it is left as a warning.
   * Resolves true when what the journal holds changed.
   *
   * A folder that cannot be read is not an empty folder: the error is thrown and the journal keeps
   * what it holds. Events that were all there and are all gone at once (a checkout, an unmounted
   * disk) are believed on the second look, one poll later, not the first.
   */
  async sync(): Promise<boolean> {
    let listed: IoEntry[]
    try {
      listed = await this.io.list(this.eventsDir)
    } catch (err) {
      // no events/ folder is an answer (nothing recorded yet); one that could not be read is not
      if (await this.folderIsMissing()) listed = []
      else throw err
    }
    const files = listed.filter(e => e.kind === 'file' && isEventFile(e.name))
    if (files.length === 0 && this.slots.size > 0) {
      this.emptyReads += 1
      if (this.emptyReads < 2) return false
    } else {
      this.emptyReads = 0
    }
    const present = new Set(files.map(f => f.name))
    let changed = false

    for (const name of [...this.slots.keys()]) {
      if (!present.has(name)) {
        this.slots.delete(name)
        changed = true
      }
    }

    const todo = files.filter(f => {
      const slot = this.slots.get(f.name)
      if (slot === undefined) return true
      if (slot.entry.event !== null) return false
      return slot.attempts < RETRIES || slot.size !== f.size || slot.mtimeMs !== f.mtimeMs
    })

    for (let i = 0; i < todo.length; i += BATCH) {
      const results = await Promise.all(todo.slice(i, i + BATCH).map(f => this.readOne(f)))
      if (results.some(Boolean)) changed = true
    }

    if (changed) this.memo = null
    return changed
  }

  private async folderIsMissing(): Promise<boolean> {
    try {
      return !(await this.io.exists(this.eventsDir))
    } catch {
      return false
    }
  }

  private async readOne(f: IoEntry): Promise<boolean> {
    const prev = this.slots.get(f.name)
    let entry: ReplayEntry
    try {
      const parsed = parseEventText(await this.io.read(`${this.eventsDir}/${f.name}`))
      entry = 'event' in parsed ? { name: f.name, event: parsed.event } : { name: f.name, event: null, problem: parsed.problem }
    } catch (err) {
      entry = { name: f.name, event: null, problem: `unreadable: ${firstLine(err)}` }
    }
    this.slots.set(f.name, { entry, size: f.size, mtimeMs: f.mtimeMs, attempts: (prev?.attempts ?? 0) + 1 })
    if (prev === undefined) return true
    return prev.entry.event === null ? entry.event !== null || entry.problem !== prev.entry.problem : false
  }

  /** The event files that were read and make sense, in file-name order (a file that does not parse is left out). */
  entries(): { name: string; event: DecisionEvent }[] {
    const out: { name: string; event: DecisionEvent }[] = []
    for (const name of [...this.slots.keys()].sort()) {
      const event = this.slots.get(name)!.entry.event
      if (event !== null) out.push({ name, event })
    }
    return out
  }

  /** The names of every file in events/ that was listed, readable or not, in file-name order. */
  fileNames(): string[] {
    return [...this.slots.keys()].sort()
  }

  /** The trees under trees/ (the main tree is not among them): folders whose name can be a tree's. */
  async listTrees(): Promise<string[]> {
    const dir = `${this.projectDir}/trees`
    let listed: IoEntry[]
    try {
      listed = await this.io.list(dir)
    } catch (err) {
      if (await this.io.exists(dir).catch(() => true)) throw err
      return []
    }
    return listed
      .filter(e => e.kind === 'dir' && e.name !== MAIN && TREE_NAME.test(e.name))
      .map(e => e.name)
      .sort()
  }

  /**
   * Copies event files, byte for byte and under the same names, into another tree's events/. The same
   * names keep the events in the same order there, and make a second attempt harmless.
   */
  async copyTo(target: Journal, names: readonly string[]): Promise<void> {
    for (let i = 0; i < names.length; i += COPY_BATCH) {
      await Promise.all(
        names.slice(i, i + COPY_BATCH).map(async name => {
          const text = await this.io.read(`${this.eventsDir}/${name}`)
          await target.io.write(`${target.eventsDir}/${name}`, text)
        }),
      )
    }
  }

  /** The replayed model, rebuilt only when something changed. */
  model(): DtModel {
    if (this.memo === null) {
      const names = [...this.slots.keys()].sort()
      this.memo = replay(names.map(n => this.slots.get(n)!.entry))
    }
    return this.memo
  }

  /** The newest time stamp among the event files held (within a day of `nowMs`), or 0. */
  private newestMs(nowMs: number): number {
    let newest = 0
    for (const name of this.slots.keys()) {
      const ms = stampMs(name)
      if (ms !== null && ms > newest && ms <= nowMs + SKEW_LIMIT_MS) newest = ms
    }
    return newest
  }

  /**
   * Writes one event as a new file and adds it to what the journal holds. Resolves the file's name.
   *
   * File-name order is event order, so an event written after others were read must sort after them
   * even when this clock runs behind the one that stamped them (another machine, a copied tree): its
   * time is never earlier than the newest event held, plus a millisecond.
   */
  async append(draft: EventDraft, wallMs: number): Promise<string> {
    const nowMs = Math.max(wallMs, this.newestMs(wallMs) + 1)
    const event: DecisionEvent = {
      v: 1,
      op: draft.op,
      ...(draft.id !== undefined ? { id: draft.id } : {}),
      ts: isoLocal(nowMs),
      session: this.session,
      actor: draft.actor,
      ...(draft.node !== undefined ? { node: draft.node } : {}),
      ...(draft.patch !== undefined ? { patch: draft.patch } : {}),
      ...(draft.text !== undefined ? { text: draft.text } : {}),
      ...(draft.parent !== undefined ? { parent: draft.parent } : {}),
      ...(draft.reason !== undefined ? { reason: draft.reason } : {}),
      ...(draft.base !== undefined ? { base: draft.base } : {}),
    }
    let name = eventFileName(nowMs, this.session, this.seq++)
    for (let tries = 0; tries < 100 && (await this.io.exists(`${this.eventsDir}/${name}`)); tries++) {
      name = eventFileName(nowMs, this.session, this.seq++)
    }
    const text = `${JSON.stringify(event, null, 2)}\n`
    await this.io.write(`${this.eventsDir}/${name}`, text)
    this.slots.set(name, { entry: { name, event }, size: text.length, mtimeMs: nowMs, attempts: 1 })
    this.memo = null
    return name
  }

  /** The derived snapshot for external tools; never read back as data. */
  async writeTree(project: string, nowMs: number): Promise<void> {
    const model = this.model()
    const snapshot = {
      generatedAt: isoLocal(nowMs),
      project,
      tree: this.tree,
      ...(model.fork !== null ? { fork: model.fork } : {}),
      nodes: model.nodes,
      warnings: model.warnings,
    }
    await this.io.write(this.treePath, `${JSON.stringify(snapshot, null, 2)}\n`)
  }

  /** config.json: its text, "nothing there", or "could not be read" (which is not "nothing there"). */
  async readConfig(): Promise<ConfigRead> {
    try {
      if (!(await this.io.exists(this.configPath))) return { kind: 'absent' }
      return { kind: 'text', text: await this.io.read(this.configPath) }
    } catch (err) {
      return { kind: 'error', error: firstLine(err) }
    }
  }

  async writeConfigText(text: string): Promise<void> {
    await this.io.write(this.configPath, text)
  }
}

export function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.split('\n')[0]!.slice(0, 200)
}
