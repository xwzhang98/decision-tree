// Versions of a tree: the points in its history a new tree can be opened from.
//
// A tree's history is its event files in file-name order, and a version is a prefix of that list:
// "the first N events". The person names one in whatever way is at hand:
//
//   (nothing), current, now, 当前    everything recorded so far
//   #17                              the first 17 events (`/decide tree log` numbers them)
//   2026-10-08 17:44, 10-08, 17:44   the tree as it was by then (end of the minute / day given), local time
//   10月8日 17:44                    the same, written the way it is said
//   20261008T214400Z                 the tree as of that moment in an event file's name (UTC)
//   merge-adopted, 合并规则            the tree as it was when that node was recorded (its id, or a piece of its title)
//   node:current                     the same, for a node whose id looks like one of the above
//
// Nothing here touches the disk.

import type { DecisionEvent, DtForkBase, DtLang } from '../types'
import { fmtClock, fmtDate, isoLocal, parseTime, stampMs } from './events'
import { t } from './i18n'
import { resolveRef } from './tree'
import type { TreeIndex } from './tree'
import { oneLine, truncate } from './width'

/** An event that counts toward a version number: one that was read, and is not the `fork` marker. */
export type Entry = { name: string; event: DecisionEvent }

/** The events that are numbered, in order. */
export function numbered(entries: readonly Entry[]): Entry[] {
  return entries.filter(e => e.event.op !== 'fork')
}

export type Point = {
  /** How many events the version holds (its number, `#count`). */
  count: number
  /** Name of the last of them. */
  at: string
  /** When that event was recorded, `MM-DD HH:MM` local. */
  when: string
}

export type VersionError =
  | { error: 'empty' }
  | { error: 'number'; n: number; max: number }
  | { error: 'before'; first: string }
  | { error: 'ambiguous'; ref: string; ids: string[] }
  | { error: 'unknown'; spec: string }

export type Resolved = ({ ok: true } & Point) | ({ ok: false } & VersionError)

const CURRENT = new Set(['current', 'now', 'head', 'latest', 'tip', 'last', '当前', '最新', '现在', '当前版本', '最新版本'])

/** `MM-DD HH:MM` (local) of an event, from its own time stamp. */
export function whenOf(event: DecisionEvent): string {
  const day = fmtDate(event.ts)
  const clock = fmtClock(event.ts)
  return day === '' ? '' : clock === '' ? day : `${day} ${clock}`
}

/** `MM-DD HH:MM` (local) from the stamp in an event file's name; empty when it has none. */
export function whenOfName(name: string): string {
  const ms = stampMs(name)
  if (ms === null) return ''
  const ts = isoLocal(ms)
  return `${fmtDate(ts)} ${fmtClock(ts)}`
}

/** Where a tree began, in words: `from main at #17 (10-08 17:44)` or `started empty`. */
export function forkText(lang: DtLang, base: DtForkBase): string {
  if (base.count === 0 || base.at === null) return t(lang, 'tree.fromEmpty')
  return t(lang, 'tree.from', { base: base.tree, n: base.count, when: whenOfName(base.at) })
}

const point = (list: readonly Entry[], count: number): Resolved => {
  const e = list[count - 1]!
  return { ok: true, count, at: e.name, when: whenOf(e.event) }
}

// ---------------------------------------------------------------- time

export { stampMs }

const DATE_TIME =
  /^(?:(\d{4})\s*[-/年]\s*)?(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*[日号]?(?:[ T]+(\d{1,2})\s*[:：点时]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?\s*分?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i
const CLOCK_ONLY = /^(\d{1,2})\s*[:：]\s*(\d{2})(?:\s*[:：]\s*(\d{2}))?$/

/**
 * The last moment a date or time covers, as epoch ms: the end of the day, minute or second the
 * person wrote. A time with no zone is the machine's local time; with no year, this year (last
 * year when that would be in the future); a bare clock time is today (yesterday when that would be
 * in the future). Null when the text is not a date or time.
 */
export function parseWhen(text: string, nowMs: number): number | null {
  const now = new Date(nowMs)
  const spec = text.trim()
  let year: number | null = null
  let month: number
  let day: number
  let hour = 0
  let minute = 0
  let second = 0
  let precision: 'day' | 'minute' | 'second' = 'day'
  let zone: string | undefined
  let clockOnly = false

  const dt = DATE_TIME.exec(spec)
  if (dt !== null) {
    year = dt[1] === undefined ? null : +dt[1]
    month = +dt[2]!
    day = +dt[3]!
    if (dt[4] !== undefined) {
      hour = +dt[4]
      minute = +dt[5]!
      precision = 'minute'
      if (dt[6] !== undefined) {
        second = +dt[6]
        precision = 'second'
      }
    }
    zone = dt[7]
  } else {
    const co = CLOCK_ONLY.exec(spec)
    if (co === null) return null
    clockOnly = true
    month = now.getMonth() + 1
    day = now.getDate()
    hour = +co[1]!
    minute = +co[2]!
    precision = 'minute'
    if (co[3] !== undefined) {
      second = +co[3]
      precision = 'second'
    }
  }
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null

  const start = (y: number): number | null => {
    if (zone !== undefined) {
      const z = zone.toUpperCase()
      const sign = z.startsWith('-') ? -1 : 1
      const offset = z === 'Z' ? 0 : sign * (+z.slice(1, 3) * 60 + +z.slice(-2))
      const ms = Date.UTC(y, month - 1, day, hour, minute, second) - offset * 60_000
      const check = new Date(Date.UTC(y, month - 1, day))
      return check.getUTCMonth() === month - 1 && check.getUTCDate() === day ? ms : null
    }
    const d = new Date(y, month - 1, day, hour, minute, second)
    return d.getMonth() === month - 1 && d.getDate() === day ? d.getTime() : null
  }

  const span = precision === 'day' ? 86_400_000 : precision === 'minute' ? 60_000 : 1_000
  let from = start(year ?? now.getFullYear())
  if (from === null) return null
  if (year === null && from > nowMs) {
    // "12-25" in October is last Christmas, "17:44" at nine in the morning is yesterday's
    if (clockOnly) from -= 86_400_000
    else {
      const earlier = start(now.getFullYear() - 1)
      if (earlier !== null) from = earlier
    }
  }
  return from + span - 1
}

// ---------------------------------------------------------------- the version

/**
 * Which version `spec` names in `list` (the numbered events of one tree). `idx` is that tree's nodes,
 * for a spec that names one.
 */
export function resolveVersion(spec: string, list: readonly Entry[], idx: TreeIndex, nowMs: number): Resolved {
  const n = list.length
  if (n === 0) return { ok: false, error: 'empty' }

  let text = oneLine(spec)
  if (text.startsWith('@')) text = text.slice(1).trim()
  if (text === '' || CURRENT.has(text.toLowerCase())) return point(list, n)

  // a node, when the person says so
  const forced = /^(?:node|节点)\s*[:：]\s*(.+)$/i.exec(text)
  if (forced !== null) return atNode(forced[1]!.trim(), list, idx)

  const num = /^#\s*(\d+)$/.exec(text)
  if (num !== null) {
    const k = +num[1]!
    return k >= 1 && k <= n ? point(list, k) : { ok: false, error: 'number', n: k, max: n }
  }

  // the stamp at the front of an event file's name, or all of the name
  if (/^\d{8}T[\w.]*$/.test(text)) {
    const key = text.replace(/\.json$/i, '')
    let count = 0
    list.forEach((e, i) => {
      if (e.name.slice(0, key.length) <= key) count = i + 1
    })
    return count === 0 ? { ok: false, error: 'before', first: list[0]!.name.slice(0, 15) } : point(list, count)
  }

  const end = parseWhen(text, nowMs)
  if (end !== null) {
    let count = 0
    list.forEach((e, i) => {
      const ms = stampMs(e.name) ?? parseTime(e.event.ts) ?? Number.POSITIVE_INFINITY
      if (ms <= end) count = i + 1
    })
    return count === 0 ? { ok: false, error: 'before', first: whenOf(list[0]!.event) } : point(list, count)
  }

  const node = atNode(text, list, idx)
  return node.ok || node.error === 'ambiguous' ? node : { ok: false, error: 'unknown', spec: truncate(text, 60) }
}

function atNode(ref: string, list: readonly Entry[], idx: TreeIndex): Resolved {
  const r = resolveRef(idx, ref)
  if (!('node' in r)) return r.error === 'ambiguous' ? { ok: false, error: 'ambiguous', ref, ids: r.ids } : { ok: false, error: 'unknown', spec: truncate(ref, 60) }
  const at = list.findIndex(e => e.name === r.node.addedBy)
  return at < 0 ? { ok: false, error: 'unknown', spec: truncate(ref, 60) } : point(list, at + 1)
}

// ---------------------------------------------------------------- the log

const PATCH_KEYS = ['status', 'title', 'summary', 'rationale', 'parent', 'supersededBy', 'trunk', 'kind']

/** What one event did, in a few words: `add notes-app "notes app 立项"`, `update merge status adopted`. */
export function describeEvent(ev: DecisionEvent): string {
  const id = typeof ev.id === 'string' ? ev.id : ''
  switch (ev.op) {
    case 'start':
      return 'start'
    case 'add': {
      const title = typeof ev.node?.title === 'string' ? truncate(oneLine(ev.node.title), 40) : ''
      return title === '' ? `add ${id}` : `add ${id} "${title}"`
    }
    case 'update': {
      const patch = (ev.patch ?? {}) as Record<string, unknown>
      const status = typeof patch.status === 'string' ? ` status ${patch.status}` : ''
      if (status !== '') return `update ${id}${status}`
      const keys = Object.keys(patch).filter(k => patch[k] !== undefined)
      const named = keys.filter(k => PATCH_KEYS.includes(k)).concat(keys.filter(k => !PATCH_KEYS.includes(k)))
      return `update ${id} ${named.slice(0, 3).join(', ')}`.trimEnd()
    }
    case 'note':
      return `note ${id}`
    case 'move':
      return `move ${id} → ${typeof ev.parent === 'string' && ev.parent !== '' ? ev.parent : 'root'}`
    case 'retract':
      return `retract ${id}`
    case 'fork':
      return 'fork'
    default:
      return String((ev as { op?: unknown }).op ?? '?')
  }
}
