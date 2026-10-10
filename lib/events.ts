// Event files: names, time formats, parsing and the small vocabularies the
// rest of the mod shares. Nothing here touches the file system.

import type { DecisionEvent, DtActor, DtDecidedBy, DtKind, DtStatus } from '../types'
import { isHidden } from './width'

export const STATUSES: readonly DtStatus[] = [
  'adopted',
  'rejected',
  'no-diff',
  'in-progress',
  'planned',
  'proposed',
  'withdrawn',
  'superseded',
  'deferred',
]
export const KINDS: readonly DtKind[] = ['decision', 'protocol', 'design', 'milestone']
export const ACTORS: readonly DtActor[] = ['user', 'model', 'gate', 'import']
export const DECIDERS: readonly DtDecidedBy[] = ['user', 'gate', 'model']
export const OPS = ['start', 'add', 'update', 'note', 'move', 'retract', 'fork'] as const

/** Statuses that mean "not decided yet": what the `p` filter shows. */
export const PENDING_STATUSES: readonly DtStatus[] = ['planned', 'proposed', 'in-progress']

export function isStatus(x: unknown): x is DtStatus {
  return typeof x === 'string' && (STATUSES as readonly string[]).includes(x)
}
export function isKind(x: unknown): x is DtKind {
  return typeof x === 'string' && (KINDS as readonly string[]).includes(x)
}
export function isActor(x: unknown): x is DtActor {
  return typeof x === 'string' && (ACTORS as readonly string[]).includes(x)
}
export function isDecider(x: unknown): x is DtDecidedBy {
  return typeof x === 'string' && (DECIDERS as readonly string[]).includes(x)
}

// ---------------------------------------------------------------- time

const p2 = (n: number) => String(n).padStart(2, '0')
const p3 = (n: number) => String(n).padStart(3, '0')

/** `YYYYMMDDTHHMMSSmmmZ` (UTC): the time part of an event file's name. */
export function utcStamp(ms: number): string {
  const d = new Date(ms)
  return (
    `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}` +
    `T${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}${p3(d.getUTCMilliseconds())}Z`
  )
}

/** Epoch ms of the UTC stamp at the front of an event file's name (`YYYYMMDDTHHMMSS[mmm]Z`), or null. */
export function stampMs(name: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})?Z/.exec(name)
  if (m === null) return null
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!, m[7] === undefined ? 0 : +m[7]!)
}

/** ISO 8601 with the local UTC offset, e.g. `2026-10-10T00:28:00.123-04:00`. */
export function isoLocal(ms: number): string {
  const d = new Date(ms)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
    `T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}` +
    `${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
  )
}

/** Epoch ms of an ISO-ish string, or null when it does not parse. */
export function parseTime(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || iso === '') return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/** Whether `s` is a date or date-time `Date.parse` understands and looks like ISO 8601. */
export function isIso(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(s) && parseTime(s) !== null
}

/** `MM-DD` in the viewer's local time; empty when `iso` does not parse. */
export function fmtDate(iso: string | null | undefined): string {
  // a bare date has no time to convert: Date.parse reads it as UTC midnight, which
  // would show the day before to anyone west of Greenwich
  if (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(5, 10)
  const ms = parseTime(iso)
  if (ms === null) return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(5, 10) : ''
  const d = new Date(ms)
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/** `HH:MM` in the viewer's local time; empty when `iso` does not parse. */
export function fmtClock(iso: string | null | undefined): string {
  const ms = parseTime(iso)
  if (ms === null) return ''
  const d = new Date(ms)
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

// ---------------------------------------------------------------- names

/** `events/<ts>_<session>_<seq>.json`: file-name order is event order. */
export function eventFileName(ms: number, session: string, seq: number): string {
  return `${utcStamp(ms)}_${session}_${String(seq).padStart(4, '0')}.json`
}

/** A file in events/ that is read as an event: any `.json` that is not hidden. */
export function isEventFile(name: string): boolean {
  return name.endsWith('.json') && !name.startsWith('.')
}

/** The 6-character session id: the host's session id cut down, else random. */
export function shortSession(raw: string | null | undefined, random: () => number = Math.random): string {
  const cleaned = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6)
  if (cleaned.length === 6) return cleaned
  let out = cleaned
  while (out.length < 6) out += Math.floor(random() * 36).toString(36)
  return out
}

// ---------------------------------------------------------------- trees

/** The tree every project has: `.claude/decisions/events/`. The others live in `.claude/decisions/trees/<name>/`. */
export const MAIN = 'main'

/** The name of a tree other than main: lower-case letters, digits and hyphens, 2 to 32 characters. */
export const TREE_NAME = /^[a-z0-9][a-z0-9-]{1,31}$/

/** A tree name as it appears in files (main, or a valid name). */
export function isTreeName(x: unknown): x is string {
  return typeof x === 'string' && (x === MAIN || TREE_NAME.test(x))
}

/**
 * A tree name from what the person typed: used as it is when it is one, else made into one
 * (`SQL v3` -> `sql-v3`) when only letters, digits and spaces or punctuation have to change. Text
 * with other scripts in it is not turned into something else behind the person's back.
 */
export function treeNameOf(raw: string): { name: string } | { error: 'empty' | 'main' | 'invalid' } {
  const text = raw.trim()
  if (text === '') return { error: 'empty' }
  const ascii = /^[\x20-\x7e]+$/.test(text)
  const name = TREE_NAME.test(text) ? text : ascii ? text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '') : ''
  if (name === MAIN) return { error: 'main' }
  return TREE_NAME.test(name) ? { name } : { error: 'invalid' }
}

// ---------------------------------------------------------------- ids

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,47}$/

/** The longest id an event file may bring (the ones this mod makes are at most 48). */
export const MAX_ID = 64

/**
 * Whether an id from an event file can be used. Scripts and other tools write ids too, so this is
 * wider than the pattern of the ids made here (underscores, capitals, dots are fine); what it keeps
 * out is what would break the places an id is shown, matched and keyed: spaces, control and
 * invisible characters, a leading `~` (the pane's own keys start with it) and anything over MAX_ID.
 */
export function isNodeId(x: unknown): x is string {
  if (typeof x !== 'string' || x.length === 0 || x.length > MAX_ID || x.startsWith('~')) return false
  for (const ch of x) {
    if (ch === ' ' || isHidden(ch.codePointAt(0)!)) return false
  }
  return true
}

/** A kebab-case slug from free text; empty when nothing usable is left (e.g. all CJK). */
export function slugify(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return ID_PATTERN.test(slug) ? slug : ''
}

/** `d-<base36 time>`: the id of a node nobody gave a slug. */
export function autoId(ms: number): string {
  return `d-${ms.toString(36)}`
}

/** `base`, or `base-2`, `base-3`, ... until `taken` says no. */
export function uniqueId(base: string, taken: (id: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`
    const cand = base.slice(0, 48 - suffix.length).replace(/-+$/g, '') + suffix
    if (!taken(cand)) return cand
  }
  return `${base.slice(0, 40)}-${Math.floor(Math.random() * 1e8).toString(36)}`
}

// ---------------------------------------------------------------- parsing

export type ParsedEvent = { event: DecisionEvent } | { problem: string }

/** Reads one event file's text. The op-specific fields are checked when it is replayed. */
export function parseEventText(text: string): ParsedEvent {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { problem: 'not valid JSON' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { problem: 'not a JSON object' }
  const o = raw as Record<string, unknown>
  if (o.v !== 1) return { problem: `unknown version ${JSON.stringify(o.v)}` }
  if (typeof o.op !== 'string' || !(OPS as readonly string[]).includes(o.op)) {
    return { problem: `unknown op ${JSON.stringify(o.op)}` }
  }
  if (typeof o.ts !== 'string' || o.ts === '') return { problem: 'missing ts' }
  if (!isActor(o.actor)) return { problem: `unknown actor ${JSON.stringify(o.actor)}` }
  return {
    event: {
      ...(o as Partial<DecisionEvent>),
      v: 1,
      op: o.op as DecisionEvent['op'],
      ts: o.ts,
      actor: o.actor,
      session: typeof o.session === 'string' ? o.session : 'external',
    },
  }
}
