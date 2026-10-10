// What the mod does while a session runs: finds the project, keeps the record
// and the pane's state in step with the disk, serves the model's tools and the
// person's commands, and runs the status command.
//
// One Runtime per module load. Everything that must survive a hot reload lives in
// `$.state` and `$.store`; this object is rebuilt, and `start` reads it all again.
// Writes to the record are serialized by `exclusive`, so a tool call, a command
// and the 5-second poll never interleave.

import type { DtActor, DtConfig, DtFilter, DtLang, DtMode, DtNow, DtUi } from '../types'
import { parseConfig, setDisplay, setRecording } from './config'
import { parseDecide } from './commands'
import type { Parsed } from './commands'
import { MAIN, isStatus, shortSession } from './events'
import { detectLanguage, t } from './i18n'
import { initPrompt } from './init'
import type { InitWrite } from './init'
import type { Dollar } from './io'
import { engineIo, isIgnoredByGit, projectIo } from './io'
import { Journal, firstLine } from './journal'
import type { Ctx, Done } from './ops'
import type { NewTreeInput } from './ops'
import { addNode, importNodes, newTree, noteNode, recordNode, retractNode, startRecord, treeList, treeLog, updateNode, useTree } from './ops'
import { forkText } from './versions'
import { SECTION_ID, sectionText } from './prompt'
import { baseName, findRoot, resolveFrom } from './project'
import { EMPTY_NOW } from './state'
import { approvalHash, failureText, parseStatusOutput, sameArgv, storeKey } from './status'
import { SPECS, WRITE_TOOLS, treeReport } from './tools'
import type { ToolName } from './tools'
import { buildIndex, effectiveSelection, resolveRef, revealPath, rowIndex, visibleRows } from './tree'
import { oneLine } from './width'

export const PANE_ID = 'decision-tree'
/** How often the record and config.json are looked at again (spec 9.8). */
export const POLL_MS = 5000
/** The longest one operation on the record may take; a disk that does not answer must not hold up everything behind it. */
export const OP_TIMEOUT_MS = 30_000
/** Looking for new events is given less: when the disk does not answer, the last good model is shown instead. */
export const SYNC_TIMEOUT_MS = 10_000
/** Opening a tree copies every event file of the version it starts from: more than one read or write. */
export const TREE_TIMEOUT_MS = 120_000
const MAX_LISTED = 500
/**
 * How long after `/decide init` is done each attempt to hand the model its job is made, the first and then each retry
 * (the engine refuses the prompt while the command that asks for it is still running).
 */
export const INIT_SEND_AFTER_MS: readonly number[] = [250, 1000, 3000]
/** The origins of a prompt (`PromptOrigin['kind']`) that are a machine's or another party's words, not the person's own. */
export const NOT_THE_PERSON: ReadonlySet<string> = new Set([
  'plugin',
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
])
/** What the model is told when it calls a tool of a project that is not being recorded. */
const NOT_RECORDING = 'Decisions are not being recorded in this project. If the user wants that, call decision_log_start.'

type Loose = Record<string, unknown>
export type ToolAnswer = { result: string } | { deny: string }

/** What the tree commands and tools ask for, however they were asked. */
type TreeOp = { kind: 'list' } | { kind: 'log'; limit: number | null } | { kind: 'new'; input: NewTreeInput } | { kind: 'use'; name: string }

const answer = (r: Done): ToolAnswer => (r.ok ? { result: r.text } : { deny: r.error })

function add(list: readonly string[], id: string): string[] {
  return list.includes(id) ? [...list] : [...list, id].slice(-MAX_LISTED)
}

function drop(list: readonly string[], id: string): string[] {
  return list.filter(x => x !== id)
}

export class Runtime {
  ready = false
  private starting: Promise<void> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private journal: Journal | null = null
  private timer: { cancel: () => void } | null = null

  root = ''
  private session = ''
  mode: DtMode = 'off'
  private config: DtConfig | null = null
  private configText: string | null = null
  private configError: string | null = null
  /** The language the last prompt was written in (used while `display.language` is auto). */
  private auto: DtLang = 'en'
  lang: DtLang = 'en'

  private registered = new Set<ToolName>()
  private published: unknown = null
  private promptText = ''
  nowMs = 0

  private statusBusy = false
  private lastStatusAt = 0

  /** The engine as the last hook that called in gave it: the watchdog of `exclusive` needs a timer. */
  private port: Dollar | null = null
  private ticking = false
  /** Why the record could not be read, while it cannot (null when it can). */
  private readProblem: string | null = null
  /** The tree config.json names while this project has no such tree (yet); null when the journal is on the tree it names. */
  private treeProblem: string | null = null
  /** True while this object itself is moving the project to another tree: the person was just told, no toast. */
  private quietSwitch = false
  /** Reads of config.json in a row that found it gone although it had been there. */
  private absentReads = 0

  private isFullscreen = false
  private autoOpened = false
  private lastDraw = 0
  private lastTick = 0
  /** Names this object; a reload that built a newer one writes its own, and this one stops. */
  private readonly token = typeof crypto !== 'undefined' ? crypto.randomUUID() : String(Math.random()).slice(2)
  private reclaiming: Promise<void> | null = null
  private repairAt = false

  // ---------------------------------------------------------------- lifecycle

  /** Starts once; later calls wait for it. */
  async ensure($: Dollar): Promise<void> {
    this.port = $
    if (this.ready) {
      await this.holds($)
      return
    }
    if (this.starting === null) {
      this.starting = this.start($).finally(() => {
        this.starting = null
      })
    }
    await this.starting
  }

  private async start($: Dollar): Promise<void> {
    this.nowMs = await this.clock($)
    await $.state.owner.update(() => this.token)
    const cwd = await $.session.cwd()
    this.root = await findRoot(projectIo($), cwd)
    this.session = shortSession(await $.session.id().catch(() => ''))
    this.journal = new Journal(engineIo($), this.root, this.session)

    const stored = await $.store.get(`lang:${this.root}`).catch(() => undefined)
    if (stored === 'zh' || stored === 'en') this.auto = stored
    else this.auto = await $.state.lang.read()

    await this.readConfig()
    this.lang = this.effectiveLang()
    this.quietSwitch = true
    try {
      await this.selectTree($)
    } finally {
      this.quietSwitch = false
    }
    if (this.mode !== 'off') await this.syncJournal($)

    await this.registerTools($)
    await this.syncNow($)
    await this.publishAll($)
    this.refreshPrompt()
    this.timer = $.clock.every(POLL_MS, () => {
      void this.tick($)
    })
    this.ready = true
  }

  /** Stops the poll (a test, or a reload that rebuilt the object). */
  stop(): void {
    this.timer?.cancel()
    this.timer = null
  }

  /**
   * Whether this object still has the session's state, and puts the state back when a /clear or a
   * resume wiped it. A reload builds a newer object that writes its own token; the older one lets go.
   */
  async holds($: Dollar): Promise<boolean> {
    this.port = $
    const owner = await $.state.owner.read()
    if (owner !== '' && owner !== this.token) return false
    if (owner === this.token && (await $.state.project.read()).root !== '') return true
    await this.reclaim($)
    return true
  }

  /**
   * A /clear (or a resume) starts the session over inside this process: the values in `$.state` are
   * empty again while this object, its poll and the tools it registered live on. Everything it knows is
   * written again, so the pane does not go on saying "not recording" until some event happens to change it.
   */
  private reclaim($: Dollar): Promise<void> {
    if (this.reclaiming === null) {
      this.reclaiming = this.exclusive(async () => {
        await $.state.owner.update(() => this.token)
        this.published = null
        this.lastStatusAt = 0
        const id = await $.session.id().catch(() => '')
        if (this.journal !== null && id !== '') this.journal.session = shortSession(id)
        await this.readConfig()
        await this.applyMode($)
      }).finally(() => {
        this.reclaiming = null
      })
    }
    return this.reclaiming
  }

  /**
   * A drawing found the state wiped: repair it right after the drawing is over (a drawing may not
   * write), not at the next poll, so the pane does not stay empty for a few seconds after a /clear.
   */
  repairSoon($: Dollar): void {
    if (!this.ready || this.repairAt) return
    this.repairAt = true
    try {
      $.clock.after(0, () => {
        void this.holds($)
          .catch(() => undefined)
          .finally(() => {
            this.repairAt = false
          })
      })
    } catch {
      this.repairAt = false // the next poll repairs it
    }
  }

  /**
   * One item at a time through everything that writes or re-reads the record. An item that takes longer
   * than OP_TIMEOUT_MS is given up on (its caller is told, the line moves on), so one hung disk call
   * cannot hold every later tool call, command and poll for good.
   */
  exclusive<T>(fn: () => Promise<T>, ms: number = OP_TIMEOUT_MS): Promise<T> {
    const guarded = () => this.bounded(fn(), ms)
    const run = this.chain.then(guarded, guarded)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private bounded<T>(work: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T> {
    const port = this.port
    if (port === null) return work
    return new Promise<T>((resolve, reject) => {
      let settled = false
      let timer: { cancel: () => void } | null = null
      const finish = (then: () => void) => {
        if (settled) return
        settled = true
        timer?.cancel()
        then()
      }
      try {
        timer = port.clock.after(ms, () => finish(() => reject(new Error(`no answer after ${ms / 1000} s (the disk or a command is not responding)`))))
      } catch {
        // no timer to be had: wait for the work as long as it takes
      }
      work.then(
        v => finish(() => resolve(v)),
        e => finish(() => reject(e)),
      )
    })
  }

  /**
   * Reads the events not seen yet. A disk that does not answer leaves the last good model in place (the
   * person is told once); true when the model changed.
   */
  private async syncJournal($: Dollar): Promise<boolean> {
    try {
      const changed = await this.bounded(this.journal!.sync(), SYNC_TIMEOUT_MS)
      if (this.readProblem !== null) {
        this.readProblem = null
        $.ui.toast(t(this.lang, 'r.readBack'))
      }
      return changed
    } catch (err) {
      if (this.readProblem === null) $.ui.toast(t(this.lang, 'r.readFailed', { error: firstLine(err) }))
      this.readProblem = firstLine(err)
      return false
    }
  }

  private async clock($: Dollar): Promise<number> {
    try {
      const ms = await $.clock.now()
      if (Number.isFinite(ms)) {
        this.nowMs = ms
        return ms
      }
    } catch {
      // fall through to the process clock
    }
    this.nowMs = Date.now()
    return this.nowMs
  }

  /**
   * `now()` for one operation: every call a millisecond later than the last one this object
   * made (also across operations), so events keep their order in the file names.
   */
  private async ctx($: Dollar, actor: DtActor): Promise<Ctx> {
    const now = await this.clock($)
    return {
      journal: this.journal!,
      now: () => {
        this.lastTick = Math.max(now, this.lastTick + 1)
        return this.lastTick
      },
      lang: this.lang,
      actor,
    }
  }

  // ---------------------------------------------------------------- project, config, mode

  /**
   * Reads config.json; true when what it says changed since the last read. `poll` is for the poll alone:
   * a file that is not there counts as gone only when two polls in a row, a few seconds apart, find it
   * missing; a tool call or a command that looks in between (a git checkout may take a moment) does not
   * count as one of the two.
   */
  private async readConfig(poll = false): Promise<boolean> {
    const read = await this.journal!.readConfig()
    // a read that failed says nothing about the file: what was known stays
    if (read.kind === 'error') return false
    let text: string | null = null
    if (read.kind === 'text') {
      this.absentReads = 0
      text = read.text
    } else if (this.configText !== null && (!poll || ++this.absentReads < 2)) {
      // it was there and is not now: it may be mid-replacement (a checkout, an editor saving), so it has to be gone twice in a row
      return false
    }
    if (text === this.configText) return false
    this.configText = text
    if (text === null) {
      this.config = null
      this.configError = null
      this.mode = 'off'
    } else {
      const parsed = parseConfig(text)
      if ('error' in parsed) {
        this.config = null
        this.configError = parsed.error
        this.mode = 'off'
      } else {
        this.config = parsed.config
        this.configError = null
        this.mode = parsed.config.recording ? 'recording' : 'paused'
      }
    }
    return true
  }

  /**
   * Reads config.json and, when it changed, puts everything that follows from it in step (tools, state,
   * the "now" block, the prompt). Every place that reads the config to decide something goes through
   * here, so what the pane shows and what the mod does never come from two different configs.
   * Call inside `exclusive`.
   */
  private async refreshConfig($: Dollar, poll = false): Promise<boolean> {
    const changed = await this.readConfig(poll)
    if (changed) await this.applyMode($)
    return changed
  }

  private effectiveLang(): DtLang {
    const fixed = this.config?.display.language
    return fixed === 'zh' || fixed === 'en' ? fixed : this.auto
  }

  /** True when this project is not being recorded (read again after a wait, where the type system would still say otherwise). */
  private get isOff(): boolean {
    return this.mode === 'off'
  }

  get asciiGlyphs(): boolean {
    return this.config?.display.asciiGlyphs === true
  }

  get statusInterval(): number | null {
    return this.config?.status?.intervalSec ?? null
  }

  /** What follows a change of mode or config: tools, state, prompt. Call inside `exclusive`. */
  private async applyMode($: Dollar): Promise<void> {
    await this.registerTools($)
    await this.selectTree($)
    if (this.mode !== 'off') await this.syncJournal($)
    const lang = this.effectiveLang()
    const retitle = lang !== this.lang
    this.lang = lang
    await this.syncNow($)
    await this.publishAll($)
    this.refreshPrompt()
    if (retitle) await this.retitle($)
  }

  /**
   * Points the journal at the tree config.json names. A tree that is not in this folder (yet: its events
   * may still be on their way through git) leaves the journal where it is, and the poll looks again.
   * True when the journal was switched. Call inside `exclusive`.
   */
  private async selectTree($: Dollar): Promise<boolean> {
    const wanted = this.config?.tree ?? MAIN
    const here = this.journal!
    if (wanted === here.tree) {
      this.treeProblem = null
      return false
    }
    const candidate = here.sibling(wanted)
    if (wanted !== MAIN) {
      let complete = false
      try {
        await this.bounded(candidate.sync(), SYNC_TIMEOUT_MS)
        complete = candidate.model().fork !== null
      } catch {
        // a folder that cannot be read is not a tree that is not there; the poll looks again
      }
      if (!complete) {
        if (this.treeProblem !== wanted) {
          this.treeProblem = wanted
          $.ui.toast(t(this.lang, 'tree.fellBack', { name: wanted, current: here.tree }))
        }
        return false
      }
    }
    this.journal = candidate
    this.published = null
    this.treeProblem = null
    if (!this.quietSwitch) $.ui.toast(t(this.lang, 'tree.followed', { name: wanted }))
    return true
  }

  /** After this session changed config.json itself: take the change in without announcing it. Call inside `exclusive`. */
  private async followConfig($: Dollar): Promise<void> {
    this.quietSwitch = true
    try {
      if (await this.readConfig()) await this.applyMode($)
    } finally {
      this.quietSwitch = false
    }
  }

  private async publishAll($: Dollar): Promise<void> {
    const project = { root: this.root, mode: this.mode, config: this.config, configError: this.configError, tree: this.journal!.tree }
    await $.state.project.update(() => project)
    await $.state.lang.update(() => this.lang)
    await this.publish($)
  }

  /** Puts the journal's model into `$.state` when it changed. */
  private async publish($: Dollar): Promise<void> {
    const model = this.mode === 'off' ? undefined : this.journal!.model()
    const next = model ?? null
    if (next === this.published) return
    this.published = next
    if (model !== undefined) await $.state.model.update(() => model)
  }

  /** After a write: refresh the derived snapshot and the pane. Call inside `exclusive`. */
  private async afterWrite($: Dollar): Promise<void> {
    try {
      await this.journal!.writeTree(this.config?.title ?? baseName(this.root), this.nowMs)
    } catch {
      // tree.json is a convenience for other tools; the events are the record
    }
    await this.publish($)
  }

  /** The tools for the current mode: only `decision_log_start` while off, the rest once on. */
  private async registerTools($: Dollar): Promise<void> {
    const want: ToolName[] = this.mode === 'off' ? ['decision_log_start'] : [...WRITE_TOOLS]
    for (const name of want) {
      if (this.registered.has(name)) continue
      await $.tool.register(SPECS[name])
      this.registered.add(name)
    }
  }

  // ---------------------------------------------------------------- the poll

  async tick($: Dollar): Promise<void> {
    if (!this.ready || this.ticking) return // one round at a time: a slow disk must not pile rounds up
    this.ticking = true
    try {
      // a reload built a newer object: leave the poll to it
      if (!(await this.holds($))) {
        this.stop()
        return
      }
      await this.exclusive(async () => {
        await this.clock($)
        if (await this.refreshConfig($, true)) return
        // the events of the tree config.json names may have arrived (a git pull)
        if (this.treeProblem !== null && (await this.selectTree($))) await this.applyMode($)
        else if (this.mode !== 'off' && (await this.syncJournal($))) await this.publish($)
      })
      await this.maybeAutoOpen($)
      await this.maybeRunStatus($)
      await this.redrawClock($)
    } catch {
      // the next tick tries again
    } finally {
      this.ticking = false
    }
  }

  /** Ages ("updated 3 min ago", "stale 2 min") only change with the clock: draw the pane again every minute. */
  private async redrawClock($: Dollar): Promise<void> {
    if (this.mode === 'off' || this.nowMs - this.lastDraw < 60_000) return
    if (!(await this.isPaneShown($))) return
    this.lastDraw = this.nowMs
    $.ui.invalidate()
  }

  // ---------------------------------------------------------------- prompt and language

  private refreshPrompt(): void {
    const idx = this.mode === 'recording' && this.journal !== null ? buildIndex(this.journal.model()) : null
    this.promptText = sectionText(this.mode, idx, this.treeNote())
  }

  /** Which tree this is, for the model, when it is not the main one. */
  private treeNote(): { name: string; from: string } | null {
    const j = this.journal
    if (j === null || j.tree === MAIN) return null
    const fork = j.model().fork
    return { name: j.tree, from: fork === null ? '' : forkText('en', fork) }
  }

  /** The section to add to the system prompt, or null before the project is known. */
  section(): { id: string; text: string; scope: 'session' } | null {
    return this.ready ? { id: SECTION_ID, text: this.promptText, scope: 'session' } : null
  }

  /** A turn starts: pick up other sessions' decisions and freeze this turn's section. */
  async onTurnStart($: Dollar): Promise<void> {
    if (!this.ready) return
    try {
      await this.holds($)
      await this.exclusive(async () => {
        if (this.mode !== 'off') await this.syncJournal($)
        await this.publish($)
        this.refreshPrompt()
      })
    } catch {
      // keep the previous section
    }
  }

  /**
   * A prompt arrived: while the language is auto, follow the one the person writes in. `origin` is where the engine says
   * it came from; a notification, a schedule, another session or another plugin (this one's `/decide init` included) is
   * not the person's own words, and says nothing about their language.
   */
  async onPrompt($: Dollar, text: string, origin?: string): Promise<void> {
    if (!this.ready) return
    if (origin !== undefined && NOT_THE_PERSON.has(origin)) return
    await this.holds($)
    if (this.config?.display.language !== 'auto' && this.config !== null) return
    if (text.trimStart().startsWith('/')) return
    const found = detectLanguage(text)
    if (found === null || found === this.auto) return
    this.auto = found
    await $.store.set(`lang:${this.root}`, found).catch(() => undefined)
    const lang = this.effectiveLang()
    if (lang === this.lang) return
    this.lang = lang
    await $.state.lang.update(() => lang)
    await this.retitle($)
  }

  private async retitle($: Dollar): Promise<void> {
    try {
      const panes = await $.ui.panes()
      if (panes.some(p => p.id === PANE_ID)) await $.ui.open({ id: PANE_ID, title: t(this.lang, 'pane.tab'), columns: 72 })
    } catch {
      // a pane that cannot be retitled keeps its old name
    }
  }

  // ---------------------------------------------------------------- the pane opens

  async openPane($: Dollar, focus: boolean): Promise<boolean> {
    try {
      const res = await $.ui.open({ id: PANE_ID, title: t(this.lang, 'pane.tab'), columns: 72, rows: 24, ...(focus ? { focus: true as const } : {}) })
      return res.isPlaced
    } catch {
      return false
    }
  }

  /** The Pane/AbovePrompt hooks tell us what the surface looks like. */
  seeViewport(viewport: { isFullscreen?: boolean } | undefined): void {
    if (viewport?.isFullscreen === true) this.isFullscreen = true
  }

  /** Spec 9.1: when the project is on, the screen is fullscreen and autoOpen is true, open once, unasked. */
  private async maybeAutoOpen($: Dollar): Promise<void> {
    if (this.autoOpened || !this.isFullscreen || this.mode === 'off') return
    if (this.config?.display.autoOpen !== true) return
    this.autoOpened = true
    await this.openPane($, false)
  }

  private async isPaneShown($: Dollar): Promise<boolean> {
    try {
      return (await $.ui.panes()).some(p => p.id === PANE_ID && p.isShown && p.isPlaced)
    } catch {
      return false
    }
  }

  // ---------------------------------------------------------------- tools

  async toolCall($: Dollar, name: ToolName, args: Loose): Promise<ToolAnswer> {
    try {
      await this.ensure($)
      if (name === 'decision_log_start') return await this.startTool($, args)
      if (name === 'decision_tree') return await this.readTool($, args)
      if (name === 'decision_new_tree' || name === 'decision_use_tree') return await this.treeTool($, name, args)
      return await this.writeTool($, name, args)
    } catch (err) {
      return { deny: `decision-tree: ${firstLine(err)}. The record may or may not have been changed; call decision_tree to check before trying again.` }
    }
  }

  private async startTool($: Dollar, args: Loose): Promise<ToolAnswer> {
    const title = typeof args.title === 'string' ? oneLine(args.title) : ''
    if (title === '') return { deny: 'title is required: the name of the project' }
    const rootTitle = typeof args.rootTitle === 'string' ? args.rootTitle : undefined
    const argv = Array.isArray(args.statusArgv) ? args.statusArgv.filter((a): a is string => typeof a === 'string' && a !== '') : undefined

    return this.exclusive(async () => {
      await this.refreshConfig($)
      if (this.configError !== null) {
        return { deny: `.claude/decisions/config.json exists but cannot be used (${this.configError}). Ask the user to fix or delete it.` }
      }
      if (this.mode === 'recording') return { result: t(this.lang, 'r.alreadyOn') }
      if (this.mode === 'paused') return { result: t(this.lang, 'r.alreadyPaused') }
      const done = await this.begin($, 'model', title, rootTitle, argv)
      if (!done.ok) return { deny: done.error }
      return { result: done.text }
    })
  }

  /**
   * Creates the record and switches this session on. The pane takes the keyboard when the person asked for
   * the start (the default) and `focus` does not say otherwise. Call inside `exclusive`.
   */
  private async begin($: Dollar, actor: DtActor, title: string, rootTitle?: string, argv?: string[], focus: boolean = actor === 'user'): Promise<Done> {
    const ctx = await this.ctx($, actor)
    const done = await startRecord(ctx, { title, ...(rootTitle !== undefined ? { rootTitle } : {}), ...(argv !== undefined && argv.length > 0 ? { statusArgv: argv } : {}) })
    if (!done.ok) return done
    await this.readConfig()
    await this.applyMode($)
    await this.afterWrite($)
    await this.openPane($, focus)
    const note = (await isIgnoredByGit($, this.root)) ? ` ${t(this.lang, 'r.gitignore')}` : ''
    return { ok: true, text: done.text + note, ...(done.id !== undefined ? { id: done.id } : {}) }
  }

  private async readTool($: Dollar, args: Loose): Promise<ToolAnswer> {
    if (this.mode === 'off') return { deny: NOT_RECORDING }
    return this.exclusive(async () => {
      // the project may have been moved to another tree since the last poll: read the one it is on now
      await this.refreshConfig($)
      if (this.mode === 'off') return { deny: NOT_RECORDING }
      await this.syncJournal($)
      await this.publish($)
      if (args.trees === true) return answer(await treeList(await this.ctx($, 'model')))
      if (typeof args.log === 'number' && Number.isFinite(args.log)) return answer(await treeLog(await this.ctx($, 'model'), Math.floor(args.log)))
      const note = this.treeNote()
      const head = note === null ? '' : `Tree: ${note.name}${note.from === '' ? '' : ` (${note.from})`}. decision_tree with trees: true lists the project's trees.\n`
      return { result: head + treeReport(buildIndex(this.journal!.model()), args) }
    })
  }

  /** The tools that open a tree and switch to one: the model only does either when the user asked. */
  private async treeTool($: Dollar, name: 'decision_new_tree' | 'decision_use_tree', args: Loose): Promise<ToolAnswer> {
    if (this.mode === 'off') return { deny: NOT_RECORDING }
    if (this.mode === 'paused') return { result: t(this.lang, 'r.pausedBlock') }
    const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() !== '' ? x.trim() : undefined)
    const op: TreeOp =
      name === 'decision_use_tree'
        ? { kind: 'use', name: str(args.name) ?? '' }
        : {
            kind: 'new',
            input: {
              name: str(args.name) ?? '',
              ...(str(args.from) !== undefined ? { from: str(args.from)! } : {}),
              ...(str(args.at) !== undefined ? { at: str(args.at)! } : {}),
              ...(str(args.title) !== undefined ? { title: str(args.title)! } : {}),
              ...(args.empty === true ? { empty: true } : {}),
              ...(args.stay === true ? { stay: true } : {}),
            },
          }
    return this.exclusive(async () => {
      await this.refreshConfig($)
      return answer(await this.treeOp($, await this.ctx($, 'model'), op))
    }, TREE_TIMEOUT_MS)
  }

  /** The tree operations, the same for a command and a tool. Call inside `exclusive`. */
  private async treeOp($: Dollar, ctx: Ctx, op: TreeOp): Promise<Done> {
    await this.syncJournal($)
    switch (op.kind) {
      case 'list':
        return treeList(ctx)
      case 'log':
        return treeLog(ctx, op.limit)
      case 'use': {
        const done = await useTree(ctx, op.name)
        if (done.ok) await this.followConfig($)
        return done
      }
      case 'new': {
        const done = await newTree(ctx, op.input)
        if (done.ok) await this.followConfig($)
        return done
      }
    }
  }

  private async writeTool($: Dollar, name: ToolName, args: Loose): Promise<ToolAnswer> {
    if (this.mode === 'off') return { deny: NOT_RECORDING }
    if (this.mode === 'paused') return { result: t(this.lang, 'r.pausedBlock') }
    return this.exclusive(async () => {
      // what is recorded goes to the tree the project is on now (another session may have switched it
      // since the last poll), and not at all if it was paused or switched off meanwhile
      await this.refreshConfig($)
      if (this.mode === 'off') return { deny: NOT_RECORDING }
      if (this.mode === 'paused') return { result: t(this.lang, 'r.pausedBlock') }
      const ctx = await this.ctx($, 'model')
      const done = name === 'decision_record' ? await recordNode(ctx, args) : name === 'decision_update' ? await updateNode(ctx, args) : await noteNode(ctx, args)
      await this.afterWrite($)
      return answer(done)
    })
  }

  // ---------------------------------------------------------------- commands

  async command($: Dollar, name: string, args: string): Promise<string> {
    try {
      await this.ensure($)
      if (name === 'tree') return await this.treeCommand($)
      return await this.decideCommand($, parseDecide(args))
    } catch (err) {
      return t(this.lang, 'c.failed', { error: firstLine(err) })
    }
  }

  private async treeCommand($: Dollar): Promise<string> {
    const placed = await this.openPane($, true)
    if (!placed) return this.treeAsText($)
    void this.maybeRunStatus($, true).catch(() => undefined)
    return t(this.lang, 'r.openedPane')
  }

  /** A screen with no room for the pane gets the tree as text. */
  private async treeAsText($: Dollar): Promise<string> {
    const head = t(this.lang, 'r.noPane')
    if (this.mode === 'off') return `${head}\n${t(this.lang, 'pane.empty')}`
    const report = await this.exclusive(async () => {
      await this.syncJournal($)
      return treeReport(buildIndex(this.journal!.model()), {})
    })
    return `${head}\n${report}`
  }

  /** `/decide tree ...` (and its short forms): the person's own, so they work while recording is paused. */
  private async treeCommand2($: Dollar, op: TreeOp): Promise<string> {
    if (this.mode === 'off') return t(this.lang, 'c.notStarted')
    return this.exclusive(async () => {
      await this.refreshConfig($)
      if (this.mode === 'off') return t(this.lang, 'c.notStarted')
      const done = await this.treeOp($, await this.ctx($, 'user'), op)
      if (!done.ok) return done.error
      // opening or switching works while paused (it is the person's), but what comes next is not recorded
      const paused = this.mode === 'paused' && (op.kind === 'new' || op.kind === 'use')
      return paused ? `${done.text} ${t(this.lang, 'tree.pausedNote')}` : done.text
    }, TREE_TIMEOUT_MS)
  }

  /**
   * `/decide init`: the person wants the first points of the tree found for them. Recording is switched on
   * when it is off (the pane opens without taking the keyboard: the model is about to work), then the model
   * is handed the job of looking through the project. Only an empty tree is set up; two inits in a row are
   * caught by the job's own first step, which reads the tree before it records anything.
   */
  private async initCommand($: Dollar, title: string): Promise<string> {
    const plan = await this.exclusive(async (): Promise<{ text: string; ask?: string }> => {
      await this.refreshConfig($)
      if (this.configError !== null) return { text: t(this.lang, 'pane.empty.config', { error: this.configError }) }
      if (this.mode === 'paused') return { text: t(this.lang, 'c.initPaused') }
      let head = ''
      if (this.mode === 'off') {
        const done = await this.begin($, 'user', title !== '' ? title : baseName(this.root), undefined, undefined, false)
        if (!done.ok) return { text: done.error }
        head = done.text
      } else {
        await this.syncJournal($)
        const n = this.journal!.model().nodes.filter(node => node.retracted === undefined).length
        if (n > 0) return { text: t(this.lang, 'c.initNotEmpty', { n }) }
        // (a start opens the pane itself; here it may have been closed, and it is where the tree fills in)
        await this.openPane($, false)
      }
      const name = title !== '' ? title : (this.config?.title ?? baseName(this.root))
      return { text: head, ask: initPrompt({ title: name, write: this.initWrite() }) }
    })
    if (plan.ask === undefined) return plan.text
    this.sendInit($, plan.ask)
    const asked = t(this.lang, 'r.initAsked')
    return plan.text === '' ? asked : `${plan.text} ${asked}`
  }

  /** What init asks the records to be written in: the language config.json fixes, or the one the person has been writing in. */
  private initWrite(): InitWrite {
    const fixed = this.config?.display.language
    if (fixed === 'zh' || fixed === 'en') return fixed
    // (nothing says an English `auto` was ever seen: the person may not have typed a word yet, so the model goes by what it knows of them)
    return this.auto === 'zh' ? 'zh' : 'follow'
  }

  /**
   * Hands the model init's job as the person's own words. The prompt starts a turn of its own once the session
   * is idle, and the call answers when that turn starts, so nothing here waits for it. The engine refuses a
   * prompt submitted from inside the command that asks for it (the command holds the turn the prompt would wait
   * on), so the first attempt is made a moment after the command is done; a refusal is tried again later, and
   * told in a toast when the last attempt fails too, or when another plugin's hook drops the prompt.
   */
  private sendInit($: Dollar, text: string): void {
    const failed = (why: unknown): void => {
      try {
        $.ui.toast(t(this.lang, 'r.initFailed', { error: firstLine(why) }))
      } catch {
        // a toast that cannot be drawn changes nothing
      }
    }
    const later = (k: number): void => {
      try {
        $.clock.after(INIT_SEND_AFTER_MS[k]!, () => attempt(k))
      } catch (err) {
        failed(err)
      }
    }
    const again = (k: number, why: unknown): void => {
      if (k + 1 < INIT_SEND_AFTER_MS.length) later(k + 1)
      else failed(why)
    }
    const attempt = (k: number): void => {
      try {
        void $.prompt.submit({ text, asUser: true }).then(
          res => {
            if (res.drop !== undefined) failed(res.drop)
          },
          (why: unknown) => again(k, why),
        )
      } catch (err) {
        again(k, err)
      }
    }
    later(0)
  }

  private missing(what: 'status' | 'node' | 'text' | 'title' | 'file' | 'value' | 'name'): string {
    const label: Record<typeof what, [string, string]> = {
      name: ['a tree name', 'tree 名'],
      status: ['a status', '状态'],
      node: ['a node', '节点'],
      text: ['the text', '文字'],
      title: ['a title', '标题'],
      file: ['a file', '文件'],
      value: ['a value', '取值'],
    }
    const word = label[what][this.lang === 'zh' ? 1 : 0]
    return t(this.lang, 'c.missingArg', { what: this.lang === 'zh' && /^[A-Za-z]/.test(word) ? ` ${word}` : word, usage: t(this.lang, 'c.usage') })
  }

  private async decideCommand($: Dollar, cmd: Parsed): Promise<string> {
    switch (cmd.cmd) {
      case 'usage':
        return t(this.lang, 'c.usage')
      case 'error':
        if (cmd.what === 'missing') return this.missing(cmd.arg)
        return t(this.lang, 'c.unknownStatus', { status: cmd.value, list: STATUS_LIST })
      case 'start':
        return this.exclusive(async () => {
          await this.refreshConfig($)
          if (this.configError !== null) return t(this.lang, 'pane.empty.config', { error: this.configError })
          if (this.mode !== 'off') return t(this.lang, 'c.alreadyStarted', { title: this.config?.title ?? baseName(this.root) })
          const done = await this.begin($, 'user', cmd.title !== '' ? cmd.title : baseName(this.root))
          return done.ok ? done.text : done.error
        })
      case 'init':
        return this.initCommand($, cmd.title)
      case 'pause':
      case 'resume':
        return this.setRecording($, cmd.cmd === 'resume')
      case 'lang':
        return this.setDisplayKey($, { language: cmd.value }, () => t(this.lang, 'c.langSet', { lang: cmd.value }))
      case 'autoopen':
        return this.setDisplayKey($, { autoOpen: cmd.value }, () => t(this.lang, 'c.autoOpenSet', { value: cmd.value ? 'on' : 'off' }))
      case 'edit':
        return this.editCommand($)
      case 'tree-list':
        return this.treeCommand2($, { kind: 'list' })
      case 'tree-log':
        return this.treeCommand2($, { kind: 'log', limit: cmd.limit })
      case 'tree-use':
        return this.treeCommand2($, { kind: 'use', name: cmd.name })
      case 'tree-new':
        return this.treeCommand2($, {
          kind: 'new',
          input: {
            name: cmd.name,
            ...(cmd.from !== null ? { from: cmd.from } : {}),
            ...(cmd.at !== null ? { at: cmd.at } : {}),
            ...(cmd.title !== null ? { title: cmd.title } : {}),
            ...(cmd.empty ? { empty: true } : {}),
            ...(cmd.stay ? { stay: true } : {}),
          },
        })
      default:
        break
    }

    // the rest write to the record and need it on
    if (this.mode === 'off') return t(this.lang, 'c.notStarted')
    return this.exclusive(async () => {
      await this.refreshConfig($)
      if (this.mode === 'off') return t(this.lang, 'c.notStarted')
      await this.syncJournal($)
      const idx = buildIndex(this.journal!.model())
      const refOf = (ref: string): { id: string } | { error: string } => {
        const r = resolveRef(idx, ref)
        if ('node' in r) return { id: r.node.id }
        if (r.error === 'ambiguous') return { error: t(this.lang, 'c.ambiguousNode', { ref, ids: r.ids.join(', ') }) }
        return { error: t(this.lang, 'c.unknownNode', { ref }) }
      }

      let done: Done
      switch (cmd.cmd) {
        case 'status': {
          const r = refOf(cmd.ref)
          if ('error' in r) return r.error
          done = await updateNode(await this.ctx($, 'user'), { id: r.id, status: cmd.status })
          break
        }
        case 'note': {
          const r = refOf(cmd.ref)
          if ('error' in r) return r.error
          done = await noteNode(await this.ctx($, 'user'), { id: r.id, text: cmd.text })
          break
        }
        case 'retract': {
          const r = refOf(cmd.ref)
          if ('error' in r) return r.error
          done = await retractNode(await this.ctx($, 'user'), r.id, cmd.reason)
          break
        }
        case 'add': {
          let parent: string | null = null
          if (cmd.parent !== null) {
            const r = refOf(cmd.parent)
            if ('error' in r) return r.error
            parent = r.id
          }
          done = await addNode(await this.ctx($, 'user'), { title: cmd.title, parent, status: cmd.status, kind: cmd.kind, id: cmd.id, trunk: cmd.trunk })
          break
        }
        case 'import':
          done = await this.runImport($, cmd.file)
          break
        default:
          return t(this.lang, 'c.usage')
      }
      await this.afterWrite($)
      if (done.ok && done.id !== undefined) await this.reveal($, done.id)
      return done.ok ? done.text : done.error
    })
  }

  private async runImport($: Dollar, file: string): Promise<Done> {
    const path = resolveFrom(this.root, file)
    let text: string
    try {
      text = await $.fs.read(path)
    } catch (err) {
      return { ok: false, error: t(this.lang, 'c.importRead', { file, error: firstLine(err) }) }
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (err) {
      return { ok: false, error: t(this.lang, 'c.importBad', { error: firstLine(err) }) }
    }
    // a tree.json from another project is accepted as it stands
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as Loose).nodes)) raw = (raw as Loose).nodes
    const done = await importNodes(await this.ctx($, 'import'), raw)
    if (!done.ok && done.error === t(this.lang, 'c.importNone', { file: 'the file' })) return { ok: false, error: t(this.lang, 'c.importNone', { file }) }
    return done
  }

  private async setRecording($: Dollar, recording: boolean): Promise<string> {
    return this.exclusive(async () => {
      await this.refreshConfig($)
      if (this.mode === 'off') return t(this.lang, 'c.notStarted')
      // the file as it is now: what we remember of it may be older than an edit somebody just saved
      const current = await this.journal!.readConfig()
      if (current.kind === 'error') return t(this.lang, 'c.cannotRead', { error: current.error })
      if (current.kind === 'absent') return t(this.lang, 'c.notStarted')
      const text = setRecording(current.text, recording)
      if (text === null) return t(this.lang, 'c.cannotWrite', { error: 'config.json' })
      try {
        await this.journal!.writeConfigText(text)
      } catch (err) {
        return t(this.lang, 'c.cannotWrite', { error: firstLine(err) })
      }
      await this.readConfig()
      await this.applyMode($)
      return t(this.lang, recording ? 'r.resumed' : 'r.paused')
    })
  }

  /** Changes one `display` setting in config.json; `message` is worded after the change, in the language it leaves. */
  private async setDisplayKey($: Dollar, patch: Partial<DtConfig['display']>, message: () => string): Promise<string> {
    return this.exclusive(async () => {
      await this.refreshConfig($)
      if (this.mode === 'off' || this.configText === null) return t(this.lang, 'c.notStarted')
      const current = await this.journal!.readConfig()
      if (current.kind === 'error') return t(this.lang, 'c.cannotRead', { error: current.error })
      if (current.kind === 'absent') return t(this.lang, 'c.notStarted')
      const text = setDisplay(current.text, patch)
      if (text === null) return t(this.lang, 'c.cannotWrite', { error: 'config.json' })
      try {
        await this.journal!.writeConfigText(text)
      } catch (err) {
        return t(this.lang, 'c.cannotWrite', { error: firstLine(err) })
      }
      await this.readConfig()
      await this.applyMode($)
      return message()
    })
  }

  /** Bare `/decide`: open the pane with the keyboard and start editing the selected node. */
  private async editCommand($: Dollar): Promise<string> {
    await this.openPane($, true)
    if (this.mode === 'off') return t(this.lang, 'r.openedPane')
    const id = await this.selectedId($)
    if (id === null) return t(this.lang, 'c.selectFirst')
    await this.startEdit($, id)
    return t(this.lang, 'c.openedEdit', { id })
  }

  // ---------------------------------------------------------------- what the pane shows

  private async view($: Dollar) {
    const [model, ui, project] = await Promise.all([$.state.model.read(), $.state.ui.read(), $.state.project.read()])
    const idx = buildIndex(model)
    const ascii = project.config?.display.asciiGlyphs === true
    const rows = visibleRows(idx, { ui, nowMs: this.nowMs, ascii })
    return { model, ui, idx, rows, sel: effectiveSelection(idx, rows, ui.selected) }
  }

  async selectedId($: Dollar): Promise<string | null> {
    return (await this.view($)).sel
  }

  /** Selects a node and opens the way down to it. */
  async reveal($: Dollar, id: string): Promise<void> {
    const idx = buildIndex(this.journal!.model())
    const path = revealPath(idx, id)
    await $.state.ui.update(ui => ({
      ...ui,
      selected: id,
      expanded: path.reduce((acc, p) => add(acc, p), ui.expanded),
      collapsed: ui.collapsed.filter(c => !path.includes(c)),
      editing: ui.editing !== null && ui.editing.id === id ? ui.editing : null,
    }))
  }

  /** Selects a node (a form open on another node closes); nothing is written when it already is. */
  async select($: Dollar, id: string): Promise<void> {
    const current = await $.state.ui.read()
    if (current.selected === id && (current.editing === null || current.editing.id === id)) return
    await $.state.ui.update(ui => ({ ...ui, selected: id, editing: ui.editing !== null && ui.editing.id === id ? ui.editing : null }))
  }

  /** Puts the keyboard's focus ring on a control of the pane (a row, the summary field). */
  private async focusKey($: Dollar, key: string): Promise<void> {
    try {
      await $.ui.focus({ requestId: PANE_ID, key })
    } catch {
      // the ring stays where it was; the selection marker still moved
    }
  }

  /** A press on a row: select it; pressing the selected row again opens or closes its children. */
  async press($: Dollar, id: string): Promise<void> {
    await this.clock($)
    const v = await this.view($)
    if (v.sel !== id) {
      await this.select($, id)
      return
    }
    const row = v.rows.find(r => r.node.id === id)
    if (row === undefined || row.childCount === 0) return
    await $.state.ui.update(ui =>
      row.isExpanded
        ? { ...ui, collapsed: add(ui.collapsed, id), expanded: drop(ui.expanded, id) }
        : { ...ui, expanded: add(ui.expanded, id), collapsed: drop(ui.collapsed, id) },
    )
  }

  /** Moves the selection `delta` rows and keeps the focus ring on it. */
  async move($: Dollar, delta: number): Promise<void> {
    await this.clock($)
    const v = await this.view($)
    if (v.rows.length === 0) return
    const at = Math.max(0, rowIndex(v.rows, v.sel))
    const next = v.rows[Math.min(v.rows.length - 1, Math.max(0, at + delta))]!.node.id
    await this.select($, next)
    await this.focusKey($, next)
  }

  async setFilter($: Dollar, filter: DtFilter): Promise<void> {
    await $.state.ui.update(ui => ({ ...ui, filter: ui.filter === filter ? 'default' : filter }))
  }

  async toggleNow($: Dollar): Promise<void> {
    await $.state.ui.update(ui => ({ ...ui, showNow: !ui.showNow }))
  }

  // ---- editing

  async startEdit($: Dollar, id?: string): Promise<void> {
    const v = await this.view($)
    const target = id ?? v.sel
    const node = target === null ? undefined : v.idx.byId.get(target)
    if (node === undefined || node.retracted !== undefined) return
    const edit = { id: node.id, status: node.status, summary: node.summary ?? '' }
    await $.state.ui.update(ui => ({ ...ui, selected: node.id, editing: edit }))
    await this.focusKey($, '~summary')
  }

  async editStatus($: Dollar, status: string): Promise<void> {
    if (!isStatus(status)) return
    await $.state.ui.update(ui => (ui.editing === null ? ui : { ...ui, editing: { ...ui.editing, status } }))
  }

  async editSummary($: Dollar, summary: string): Promise<void> {
    await $.state.ui.update(ui => (ui.editing === null ? ui : { ...ui, editing: { ...ui.editing, summary } }))
  }

  async cancelEdit($: Dollar): Promise<void> {
    const ui: DtUi = await $.state.ui.read()
    if (ui.editing === null) return
    const id = ui.editing.id
    await $.state.ui.update(u => (u.editing === null ? u : { ...u, editing: null }))
    await this.focusKey($, id)
  }

  /**
   * Writes the form as an `update` event by the user, closes it, and says what happened.
   * `typed` is the text the field was submitted with, which may be newer than the state's copy.
   */
  async saveEdit($: Dollar, typed?: { summary: string }): Promise<void> {
    await this.ensure($)
    const ui: DtUi = await $.state.ui.read()
    if (ui.editing === null) return
    const edit = typed === undefined ? ui.editing : { ...ui.editing, summary: typed.summary }
    if (this.mode === 'off') {
      await this.cancelEdit($)
      return
    }
    const message = await this.exclusive(async () => {
      await this.syncJournal($)
      const before = this.journal!.model().eventCount
      const done = await updateNode(await this.ctx($, 'user'), { id: edit.id, status: edit.status, summary: edit.summary })
      await this.afterWrite($)
      if (!done.ok) return done.error
      return this.journal!.model().eventCount === before ? t(this.lang, 'edit.nothing') : t(this.lang, 'edit.saved', { id: edit.id })
    })
    await this.cancelEdit($)
    $.ui.toast(message)
  }

  async showWarnings($: Dollar): Promise<void> {
    const model = await $.state.model.read()
    if (model.warnings.length === 0) return
    $.ui.toast(model.warnings.slice(0, 3).join('\n'), { timeoutMs: 8000 })
  }

  // ---------------------------------------------------------------- the "now" block

  /** Brings `now` in line with the config: nothing, waiting for the person's OK, or approved. */
  private async syncNow($: Dollar): Promise<void> {
    const cfg = this.config?.status
    const prev = await $.state.now.read()
    if (cfg === undefined || this.mode === 'off') {
      if (prev.approval !== 'none') await $.state.now.update(() => EMPTY_NOW)
      return
    }
    const wanted = approvalHash(this.root, cfg.argv)
    const given = await $.store.get(storeKey('approved', this.root)).catch(() => undefined)
    const approval: DtNow['approval'] = given === wanted ? 'approved' : 'pending'
    const sameCommand = prev.argv.length === cfg.argv.length && prev.argv.every((a, i) => a === cfg.argv[i])
    if (approval === prev.approval && sameCommand) return
    await $.state.now.update(() => ({
      approval,
      argv: [...cfg.argv],
      // data from another command is not shown for this one
      data: sameCommand ? prev.data : null,
      fetchedAt: sameCommand ? prev.fetchedAt : null,
      error: sameCommand ? prev.error : null,
    }))
  }

  /**
   * The person pressed "Allow" under the command the pane showed (`seen`). It is remembered for this
   * project and exactly this command, and run. If config.json says something else by now, nothing is
   * allowed: what the person read is not what would run, so they get to read the new one first.
   */
  async approveStatus($: Dollar, seen: readonly string[]): Promise<void> {
    await this.ensure($)
    const allowed = await this.exclusive(async () => {
      await this.refreshConfig($)
      const cfg = this.config?.status
      if (cfg === undefined || this.mode === 'off' || !sameArgv(cfg.argv, seen)) return false
      await $.store.set(storeKey('approved', this.root), approvalHash(this.root, cfg.argv))
      await this.syncNow($)
      return true
    })
    if (!allowed) {
      $.ui.toast(t(this.lang, 'now.changed'))
      return
    }
    await this.maybeRunStatus($, true)
  }

  /**
   * Runs the status command when it is due, approved, and the pane is on screen. The command that
   * runs is the one the person allowed: the one the pane shows, the one config.json holds and the one
   * whose hash was stored when they pressed Allow have to be the same, word for word, right before it starts.
   */
  async maybeRunStatus($: Dollar, force = false): Promise<void> {
    if (!this.ready || this.mode === 'off' || this.statusBusy) return
    const cfg = this.config?.status
    if (cfg === undefined) return
    const argv = [...cfg.argv]
    const now = await this.clock($)
    if (!force && now - this.lastStatusAt < cfg.intervalSec * 1000) return
    if (!(await this.isPaneShown($))) return
    const state = await $.state.now.read()
    if (state.approval !== 'approved') return
    const given = await $.store.get(storeKey('approved', this.root)).catch(() => undefined)
    if (!sameArgv(state.argv, argv) || given !== approvalHash(this.root, argv)) {
      await this.syncNow($) // the pane catches up with the config; nothing runs
      return
    }
    // nothing below waits before the command starts, so this is the config it starts with
    if (this.statusBusy || this.isOff || !sameArgv(this.config?.status?.argv ?? [], argv)) return

    this.statusBusy = true
    this.lastStatusAt = now
    try {
      let next: DtNow
      try {
        const out = await $.process.run(argv, { cwd: this.root, timeoutMs: cfg.timeoutSec * 1000 })
        if (out.exitCode !== 0) {
          next = { ...state, error: failureText(new Error(`exit code ${out.exitCode}`), out.stderr) }
        } else {
          const parsed = parseStatusOutput(out.stdout)
          next = 'data' in parsed
            ? { approval: 'approved', argv, data: parsed.data, fetchedAt: await this.clock($), error: null }
            : { ...state, error: t(this.lang, 'now.unreadable', { error: parsed.error }) }
        }
      } catch (err) {
        next = { ...state, error: failureText(err) }
      }
      // the result belongs to the command that ran: if the config moved on meanwhile, `now` already
      // shows the new command waiting for the person, and an answer to the old one must not hide that
      if (sameArgv(this.config?.status?.argv ?? [], argv)) await $.state.now.update(() => next)
    } finally {
      this.statusBusy = false
    }
  }
}

const STATUS_LIST = ['adopted', 'rejected', 'no-diff', 'in-progress', 'planned', 'proposed', 'withdrawn', 'superseded', 'deferred'].join(', ')

