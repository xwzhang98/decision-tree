// Parsing of `/decide ...`: pure text in, a plain description of what was asked out.
// Running it (writing events, opening the pane) is the runtime's job.

import type { DtKind, DtStatus } from '../types'
import { isKind, isStatus } from './events'

export type Parsed =
  | { cmd: 'edit' }
  | { cmd: 'start'; title: string }
  | { cmd: 'init'; title: string }
  | { cmd: 'pause' }
  | { cmd: 'resume' }
  | { cmd: 'status'; ref: string; status: DtStatus }
  | { cmd: 'note'; ref: string; text: string }
  | { cmd: 'add'; title: string; parent: string | null; status: DtStatus; kind: DtKind; id: string | null; trunk: boolean }
  | { cmd: 'retract'; ref: string; reason: string }
  | { cmd: 'import'; file: string }
  | { cmd: 'lang'; value: 'zh' | 'en' | 'auto' }
  | { cmd: 'autoopen'; value: boolean }
  | { cmd: 'tree-list' }
  | { cmd: 'tree-new'; name: string; from: string | null; at: string | null; empty: boolean; title: string | null; stay: boolean }
  | { cmd: 'tree-use'; name: string }
  | { cmd: 'tree-log'; limit: number | null }
  | { cmd: 'usage' }
  | { cmd: 'error'; what: 'missing'; arg: 'status' | 'node' | 'text' | 'title' | 'file' | 'value' | 'name' }
  | { cmd: 'error'; what: 'status'; value: string }

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」' }

/** Strips one pair of matching quotes around `s`. */
export function unquote(s: string): string {
  const t = s.trim()
  if (t.length >= 2) {
    const close = QUOTES[t[0]!]
    if (close !== undefined && t[t.length - 1] === close) return t.slice(1, -1).trim()
  }
  return t
}

/** The first word of `s` (a quoted phrase counts as one word) and what follows it. */
export function firstWord(s: string): { word: string; rest: string } {
  const t = s.trimStart()
  if (t === '') return { word: '', rest: '' }
  const close = QUOTES[t[0]!]
  if (close !== undefined) {
    const end = t.indexOf(close, 1)
    if (end > 0) return { word: t.slice(1, end).trim(), rest: t.slice(end + 1).trim() }
  }
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t)
  return { word: m?.[1] ?? '', rest: (m?.[2] ?? '').trim() }
}

const STATUS_WORDS: Record<string, DtStatus> = {
  采用: 'adopted',
  通过: 'adopted',
  否决: 'rejected',
  拒绝: 'rejected',
  无差别: 'no-diff',
  进行中: 'in-progress',
  计划: 'planned',
  计划中: 'planned',
  提议: 'proposed',
  撤回: 'withdrawn',
  被取代: 'superseded',
  取代: 'superseded',
  暂缓: 'deferred',
}

/** A status by id, English label or Chinese label. */
export function parseStatus(raw: string): DtStatus | null {
  const s = unquote(raw)
  if (s === '') return null
  const key = s.toLowerCase().replace(/[\s_]+/g, '-')
  if (isStatus(key)) return key
  if (key === 'nodiff') return 'no-diff'
  if (key === 'inprogress' || key === 'doing' || key === 'wip') return 'in-progress'
  if (key === 'accepted' || key === 'accept' || key === 'done') return 'adopted'
  // (own keys only: "constructor" or "toString" are not statuses)
  return Object.hasOwn(STATUS_WORDS, s) ? STATUS_WORDS[s]! : null
}

type FlagKinds = {
  /** Flags whose value runs to the next flag, spaces and all (`--at 2026-10-08 17:44`). */
  multi?: readonly string[]
  /** Flags that take no value (`--empty`). */
  bool?: readonly string[]
}

/** Splits `--flag value` pairs off the end of a line. A flag takes one word unless `kinds` says otherwise. */
function takeFlags(text: string, kinds: FlagKinds = {}): { head: string; flags: Map<string, string | true> } {
  const flags = new Map<string, string | true>()
  const at = text.search(/(^|\s)--[a-z]/i)
  if (at < 0) return { head: text.trim(), flags }
  const head = text.slice(0, at).trim()
  let rest = text.slice(at).trim()
  while (rest !== '') {
    const m = /^--([a-z][a-z-]*)\s*([\s\S]*)$/i.exec(rest)
    if (m === null) break
    const name = m[1]!.toLowerCase()
    const after = m[2]!
    if (kinds.bool?.includes(name) === true || after === '' || after.startsWith('--')) {
      flags.set(name, true)
      rest = after.trim()
      continue
    }
    if (kinds.multi?.includes(name) === true) {
      const cut = after.search(/\s--[a-z]/i)
      flags.set(name, unquote(cut < 0 ? after : after.slice(0, cut)))
      rest = cut < 0 ? '' : after.slice(cut).trim()
      continue
    }
    const { word, rest: remaining } = firstWord(after)
    flags.set(name, word)
    rest = remaining
  }
  return { head, flags }
}

const text = (v: string | true | undefined): string | null => (typeof v === 'string' && v !== '' ? v : null)

function parseTreeNew(rest: string): Parsed {
  const { head, flags } = takeFlags(rest, { multi: ['at', 'version', 'from', 'title'], bool: ['empty', 'stay'] })
  const name = unquote(head)
  if (name === '') return { cmd: 'error', what: 'missing', arg: 'name' }
  return {
    cmd: 'tree-new',
    name,
    from: text(flags.get('from')),
    at: text(flags.get('at')) ?? text(flags.get('version')),
    empty: flags.get('empty') === true,
    title: text(flags.get('title')),
    stay: flags.get('stay') === true,
  }
}

function parseTree(rest: string): Parsed {
  const { word, rest: more } = firstWord(rest)
  switch (word.toLowerCase()) {
    case '':
    case 'list':
    case 'ls':
      return { cmd: 'tree-list' }
    case 'new':
    case 'create':
    case 'fork':
    case 'open':
    case '新建':
    case '新开':
      return parseTreeNew(more)
    case 'use':
    case 'switch':
    case 'checkout':
    case '切换':
      return more === '' ? { cmd: 'error', what: 'missing', arg: 'name' } : { cmd: 'tree-use', name: unquote(more) }
    case 'log':
    case 'history':
    case '历史':
      return { cmd: 'tree-log', limit: /^\d+$/.test(more) ? Math.max(1, Number(more)) : null }
    default:
      return { cmd: 'usage' }
  }
}

/** Parses what follows `/decide`. */
export function parseDecide(args: string): Parsed {
  const text = args.trim()
  if (text === '') return { cmd: 'edit' }
  const { word, rest } = firstWord(text)
  const sub = word.toLowerCase()

  switch (sub) {
    case 'help':
    case '?':
      return { cmd: 'usage' }

    case 'start':
      return { cmd: 'start', title: unquote(rest) }

    case 'init':
    case 'initialize':
    case '初始化':
      return { cmd: 'init', title: unquote(rest) }

    case 'pause':
      return { cmd: 'pause' }

    case 'resume':
      return { cmd: 'resume' }

    case 'status': {
      if (rest === '') return { cmd: 'error', what: 'missing', arg: 'node' }
      // the status is at the end, and whatever precedes it names the node; two words first ("In progress", "No diff")
      const two = /^([\s\S]*?\S)\s+(\S+\s+\S+)$/.exec(rest)
      if (two !== null) {
        const status = parseStatus(two[2]!)
        if (status !== null) return { cmd: 'status', ref: unquote(two[1]!), status }
      }
      const m = /^([\s\S]*?)\s+(\S+)$/.exec(rest)
      if (m === null) return { cmd: 'error', what: 'missing', arg: 'status' }
      const status = parseStatus(m[2]!)
      if (status === null) return { cmd: 'error', what: 'status', value: m[2]! }
      return { cmd: 'status', ref: unquote(m[1]!), status }
    }

    case 'note': {
      const { word: ref, rest: note } = firstWord(rest)
      if (ref === '') return { cmd: 'error', what: 'missing', arg: 'node' }
      if (note === '') return { cmd: 'error', what: 'missing', arg: 'text' }
      return { cmd: 'note', ref, text: note }
    }

    case 'add': {
      const { head, flags } = takeFlags(rest)
      const title = unquote(head)
      if (title === '') return { cmd: 'error', what: 'missing', arg: 'title' }
      const statusRaw = flags.get('status')
      let status: DtStatus = 'planned'
      if (typeof statusRaw === 'string') {
        const parsed = parseStatus(statusRaw)
        if (parsed === null) return { cmd: 'error', what: 'status', value: statusRaw }
        status = parsed
      }
      const kindRaw = flags.get('kind')
      const kind: DtKind = typeof kindRaw === 'string' && isKind(kindRaw) ? kindRaw : 'decision'
      const parentRaw = flags.get('parent')
      const parent = typeof parentRaw === 'string' && parentRaw !== '' && parentRaw !== 'null' && parentRaw !== 'root' ? parentRaw : null
      const idRaw = flags.get('id')
      return { cmd: 'add', title, parent, status, kind, id: typeof idRaw === 'string' ? idRaw : null, trunk: flags.get('trunk') === true }
    }

    case 'retract': {
      const { word: ref, rest: reason } = firstWord(rest)
      if (ref === '') return { cmd: 'error', what: 'missing', arg: 'node' }
      return { cmd: 'retract', ref, reason }
    }

    case 'import':
      return rest === '' ? { cmd: 'error', what: 'missing', arg: 'file' } : { cmd: 'import', file: unquote(rest) }

    case 'lang': {
      const v = rest.toLowerCase()
      if (v === 'zh' || v === 'en' || v === 'auto') return { cmd: 'lang', value: v }
      return { cmd: 'error', what: 'missing', arg: 'value' }
    }

    case 'tree':
    case 'trees':
      return parseTree(rest)

    // the short forms
    case 'new':
      return parseTreeNew(rest)

    case 'use':
    case 'switch':
      return rest === '' ? { cmd: 'error', what: 'missing', arg: 'name' } : { cmd: 'tree-use', name: unquote(rest) }

    case 'log':
      return { cmd: 'tree-log', limit: /^\d+$/.test(rest) ? Math.max(1, Number(rest)) : null }

    case 'autoopen': {
      const v = rest.toLowerCase()
      if (v === 'on' || v === 'true' || v === 'yes') return { cmd: 'autoopen', value: true }
      if (v === 'off' || v === 'false' || v === 'no') return { cmd: 'autoopen', value: false }
      return { cmd: 'error', what: 'missing', arg: 'value' }
    }

    default:
      return { cmd: 'usage' }
  }
}
