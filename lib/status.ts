// The "now" block's data: what the project's status command prints, how it is
// checked, how old it is, and the person's approval to run it.

import type { DtLane, DtLaneState, DtNowData } from '../types'
import { firstLine } from './journal'
import { isAltered, isHidden, oneLine } from './width'

const LANE_STATES: readonly DtLaneState[] = ['running', 'queued', 'done', 'failed', 'idle']
const MAX_LANES = 20
const MAX_NEXT = 6
const MAX_WARNINGS = 6
const MAX_TEXT = 200
// how many entries are looked at before giving up: bounds the work on a runaway script
const MAX_SCAN = 200

function text(x: unknown): string {
  if (typeof x === 'string') return oneLine(x).slice(0, MAX_TEXT)
  if (typeof x === 'number' && Number.isFinite(x)) return String(x)
  return ''
}

function count(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

/** Reads the JSON a status command printed. Lenient about extras, strict about shape. */
export function parseStatusOutput(stdout: string): { data: DtNowData } | { error: string } {
  const trimmed = stdout.trim()
  if (trimmed === '') return { error: 'the command printed nothing' }
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    // a script that logs first and prints the JSON last is still readable
    const last = trimmed.split('\n').filter(l => l.trim() !== '').pop() ?? ''
    try {
      raw = JSON.parse(last)
    } catch {
      return { error: 'the output is not JSON' }
    }
  }
  if (!isRecord(raw)) return { error: 'the output is not a JSON object' }

  const lanes: DtLane[] = []
  if (raw.lanes !== undefined) {
    if (!Array.isArray(raw.lanes)) return { error: '"lanes" must be an array' }
    for (const item of raw.lanes.slice(0, MAX_SCAN)) {
      if (lanes.length >= MAX_LANES) break
      if (!isRecord(item)) continue
      const name = text(item.name)
      if (name === '') continue
      const state = LANE_STATES.includes(item.state as DtLaneState) ? (item.state as DtLaneState) : 'running'
      lanes.push({
        name,
        run: text(item.run),
        state,
        step: count(item.step),
        total: count(item.total),
        eta: text(item.eta),
        note: text(item.note),
      })
    }
  }

  const next: { text: string; eta: string }[] = []
  if (Array.isArray(raw.next)) {
    for (const item of raw.next.slice(0, MAX_SCAN)) {
      if (next.length >= MAX_NEXT) break
      if (typeof item === 'string') {
        const s = text(item)
        if (s !== '') next.push({ text: s, eta: '' })
      } else if (isRecord(item)) {
        const s = text(item.text)
        if (s !== '') next.push({ text: s, eta: text(item.eta) })
      }
    }
  }

  const warnings: string[] = []
  if (Array.isArray(raw.warnings)) {
    for (const item of raw.warnings.slice(0, MAX_SCAN)) {
      if (warnings.length >= MAX_WARNINGS) break
      const s = text(item)
      if (s !== '') warnings.push(s)
    }
  }

  return { data: { updatedAt: text(raw.updatedAt), lanes, next, warnings } }
}

/** A progress bar of `cells` cells: `████████░░`, or `########..` in ASCII mode. */
export function progressBar(step: number | null, total: number | null, ascii: boolean, cells = 10): string {
  const full = ascii ? '#' : '█'
  const empty = ascii ? '.' : '░'
  if (step === null || total === null || total <= 0) return empty.repeat(cells)
  const filled = Math.max(0, Math.min(cells, Math.floor((Math.min(step, total) / total) * cells)))
  return full.repeat(filled) + empty.repeat(cells - filled)
}

/** `1700/2000`, right-aligned to the width of the total. */
export function stepText(step: number | null, total: number | null): string {
  if (step === null && total === null) return ''
  const s = step === null ? '?' : String(step)
  const t = total === null ? '?' : String(total)
  return `${s.padStart(t.length)}/${t}`
}

/** Whole minutes between two times, never negative. */
export function minutesSince(nowMs: number, thenMs: number): number {
  return Math.max(0, Math.floor((nowMs - thenMs) / 60000))
}

/**
 * Whether data fetched at `fetchedAt` is stale: the last run failed, or it is
 * older than two refresh intervals.
 */
export function isStale(nowMs: number, fetchedAt: number | null, intervalSec: number, error: string | null): boolean {
  if (fetchedAt === null) return false
  if (error !== null) return true
  return nowMs - fetchedAt > intervalSec * 2000
}

/** A short stable hash (FNV-1a, 53 bits) written as hex. */
export function hash(s: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// A word the shell would read as itself. Not one that starts with `~` or `=` (a shell expands those, so a
// `~/x.sh` shown bare would read as another path than the one that runs), and not one that looks like
// `NAME=value` where the command name goes (a shell takes that for an assignment, not for the command).
const BARE_WORD = /^[A-Za-z0-9_@%+:,./-][A-Za-z0-9_@%+=:,./~-]*$/
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function showArg(arg: string, isCommand: boolean): string {
  if (arg !== '' && BARE_WORD.test(arg) && !(isCommand && ASSIGNMENT.test(arg))) return arg
  let out = ''
  for (const ch of arg) {
    const cp = ch.codePointAt(0)!
    if (isHidden(cp) || isAltered(cp)) out += `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`
    else out += ch === "'" ? "'\\''" : ch
  }
  return `'${out}'`
}

/**
 * A command line as a shell would read it, with nothing hidden: words that need it are quoted and
 * characters that draw as nothing, or that the pane would draw as something else, are spelled out
 * (`<U+200B>`). This is what the person is asked to allow.
 */
export function describeArgv(argv: readonly string[]): string {
  return argv.map((arg, i) => showArg(arg, i === 0)).join(' ')
}

/** Two command lines that are the same word for word. */
export function sameArgv(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i])
}

/** What the person's approval is stored against: the project and the exact command. */
export function approvalHash(root: string, argv: readonly string[]): string {
  return hash(`${root}\u0000${JSON.stringify(argv)}`)
}

export function storeKey(kind: 'approved' | 'lang' | 'filter', root: string): string {
  return `${kind}:${root}`
}

/** The first line of why a run failed. */
export function failureText(err: unknown, stderr = ''): string {
  const line = stderr.split('\n').find(l => l.trim() !== '')
  return line !== undefined ? line.trim().slice(0, 200) : firstLine(err)
}
