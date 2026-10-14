// The project's translation memory on disk: `.claude/decisions/i18n/*.json`.
//
// Same habits as the events: every file is written once and never changed, named by time, session and
// sequence, so sessions never conflict and git merges them for free. A file holds the pairs one job
// produced (the recording model's own English version of what it just recorded, or a batch from the
// translator): `from` is a text exactly as the events hold it, `to` what it reads like in `lang`.
// Files are read in name order and a later pair for the same text wins. The folder is the project's,
// not a tree's, so a tree opened from another shares it and needs nothing copied. Nothing here is read
// by version 0.3 of the mod, which is why none of it is in events/.

import type { DtActor, DtLang, DtTm } from '../types'
import { eventFileName, isEventFile, isoLocal, stampMs } from './events'
import { firstLine } from './journal'
import type { Io, IoEntry } from './journal'
import { sanitize } from './width'

export const TM_FOLDER = 'i18n'

export type TmPair = { from: string; to: string }
export type TmVia = 'tool' | 'translator'

/** The longest text kept (the replay's own limit for a field). */
export const MAX_TM_TEXT = 20000
/** Pairs in one file, and files read: bounds on what a runaway writer can make the pane carry. */
export const MAX_PAIRS_PER_FILE = 100
const MAX_FILES = 4000
const RETRIES = 3
const BATCH = 16

type Slot = { pairs: TmPair[] | null; lang: DtLang; size: number; mtimeMs: number; attempts: number; problem: string | null }

/** One file's text read as a batch of pairs; the problem when it cannot be used. */
export function parseBatch(text: string): { lang: DtLang; pairs: TmPair[] } | { problem: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { problem: 'not valid JSON' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'not a JSON object' }
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return { problem: `unknown version ${JSON.stringify(o.v)}` }
  if (o.lang !== 'en' && o.lang !== 'zh') return { problem: `unknown lang ${JSON.stringify(o.lang)}` }
  if (!Array.isArray(o.pairs)) return { problem: 'pairs is not a list' }
  const pairs: TmPair[] = []
  for (const item of o.pairs.slice(0, MAX_PAIRS_PER_FILE * 10)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const p = item as Record<string, unknown>
    if (typeof p.from !== 'string' || typeof p.to !== 'string') continue
    const to = sanitize(p.to).trim().slice(0, MAX_TM_TEXT)
    if (p.from === '' || p.from.length > MAX_TM_TEXT || to === '') continue
    pairs.push({ from: p.from, to })
  }
  return { lang: o.lang, pairs }
}

export class TmStore {
  /** `.claude/decisions/i18n`. */
  readonly dir: string
  private slots = new Map<string, Slot>()
  private seq = 0
  private memo: DtTm | null = null

  constructor(
    private readonly io: Io,
    readonly root: string,
    /** The 6-character id the files are stamped with. */
    public session: string,
  ) {
    this.dir = `${root.replace(/\/+$/, '')}/.claude/decisions/${TM_FOLDER}`
  }

  /**
   * Lists the folder and reads the files not seen yet (one that does not parse may be half written
   * by another session, so it is read again a few times). Resolves true when the memory changed.
   * A folder that is not there is an empty memory; one that cannot be read throws, and the store
   * keeps what it holds.
   */
  async sync(): Promise<boolean> {
    let listed: IoEntry[]
    try {
      listed = await this.io.list(this.dir)
    } catch (err) {
      if (await this.isMissing()) listed = []
      else throw err
    }
    const files = listed.filter(e => e.kind === 'file' && isEventFile(e.name)).sort((a, b) => (a.name < b.name ? -1 : 1))
    // (an empty listing over files that were all read before is believed only by the Journal, which has the events to lose; here a vanished memory is simply a smaller one)
    const wanted = files.slice(-MAX_FILES)
    const present = new Set(wanted.map(f => f.name))
    let changed = false
    for (const name of [...this.slots.keys()]) {
      if (!present.has(name)) {
        this.slots.delete(name)
        changed = true
      }
    }
    const todo = wanted.filter(f => {
      const slot = this.slots.get(f.name)
      if (slot === undefined) return true
      if (slot.pairs !== null) return false
      return slot.attempts < RETRIES || slot.size !== f.size || slot.mtimeMs !== f.mtimeMs
    })
    for (let i = 0; i < todo.length; i += BATCH) {
      const results = await Promise.all(todo.slice(i, i + BATCH).map(f => this.readOne(f)))
      if (results.some(Boolean)) changed = true
    }
    if (changed) this.memo = null
    return changed
  }

  private async isMissing(): Promise<boolean> {
    try {
      return !(await this.io.exists(this.dir))
    } catch {
      return false
    }
  }

  private async readOne(f: IoEntry): Promise<boolean> {
    const prev = this.slots.get(f.name)
    let slot: Slot
    try {
      const parsed = parseBatch(await this.io.read(`${this.dir}/${f.name}`))
      slot =
        'pairs' in parsed
          ? { pairs: parsed.pairs, lang: parsed.lang, size: f.size, mtimeMs: f.mtimeMs, attempts: (prev?.attempts ?? 0) + 1, problem: null }
          : { pairs: null, lang: 'en', size: f.size, mtimeMs: f.mtimeMs, attempts: (prev?.attempts ?? 0) + 1, problem: parsed.problem }
    } catch (err) {
      slot = { pairs: null, lang: 'en', size: f.size, mtimeMs: f.mtimeMs, attempts: (prev?.attempts ?? 0) + 1, problem: `unreadable: ${firstLine(err)}` }
    }
    this.slots.set(f.name, slot)
    return slot.pairs !== null
  }

  /** The files that could not be used, as `name: why` (for a warning). */
  problems(): string[] {
    const out: string[] = []
    for (const name of [...this.slots.keys()].sort()) {
      const s = this.slots.get(name)!
      if (s.pairs === null && s.problem !== null) out.push(`${name}: ${s.problem}`)
    }
    return out
  }

  /** The memory: every pair of every file, a later file's pair for the same text replacing an earlier one's. */
  tm(): DtTm {
    if (this.memo === null) {
      const en: [string, string][] = []
      const zh: [string, string][] = []
      for (const name of [...this.slots.keys()].sort()) {
        const s = this.slots.get(name)!
        if (s.pairs === null) continue
        const into = s.lang === 'en' ? en : zh
        for (const p of s.pairs) into.push([p.from, p.to])
      }
      // (fromEntries defines own properties, so even a text that reads "__proto__" is an entry like any other)
      this.memo = { en: Object.fromEntries(en), zh: Object.fromEntries(zh) }
    }
    return this.memo
  }

  /** The newest time stamp among the files held, or 0. */
  private newestMs(): number {
    let newest = 0
    for (const name of this.slots.keys()) {
      const ms = stampMs(name)
      if (ms !== null && ms > newest) newest = ms
    }
    return newest
  }

  /**
   * Writes the pairs that add something (a pair the memory holds already is skipped) as new files of at most
   * MAX_PAIRS_PER_FILE, and adds them to what the store holds. Resolves how many pairs were new.
   */
  async append(lang: DtLang, pairs: readonly TmPair[], by: { actor: DtActor; via: TmVia }, wallMs: number): Promise<number> {
    const known = this.tm()[lang]
    const fresh: TmPair[] = []
    const seen = new Set<string>()
    for (const p of pairs) {
      const to = sanitize(p.to).trim().slice(0, MAX_TM_TEXT)
      if (p.from === '' || p.from.length > MAX_TM_TEXT || to === '' || seen.has(p.from)) continue
      seen.add(p.from)
      if (Object.hasOwn(known, p.from) && known[p.from] === to) continue
      fresh.push({ from: p.from, to })
    }
    for (let i = 0; i < fresh.length; i += MAX_PAIRS_PER_FILE) {
      const chunk = fresh.slice(i, i + MAX_PAIRS_PER_FILE)
      const ms = Math.max(wallMs, this.newestMs() + 1)
      let name = eventFileName(ms, this.session, this.seq++)
      for (let tries = 0; tries < 100 && (await this.io.exists(`${this.dir}/${name}`)); tries++) name = eventFileName(ms, this.session, this.seq++)
      const body = { v: 1, ts: isoLocal(ms), session: this.session, actor: by.actor, via: by.via, lang, pairs: chunk }
      const text = `${JSON.stringify(body, null, 2)}\n`
      await this.io.write(`${this.dir}/${name}`, text)
      this.slots.set(name, { pairs: chunk, lang, size: text.length, mtimeMs: ms, attempts: 1, problem: null })
      this.memo = null
    }
    return fresh.length
  }
}
