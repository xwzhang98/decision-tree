// Replays event files, in file-name order, into the tree of decisions.
//
// The rules (spec 5.3): `add` of an existing id is ignored, `update` overwrites
// field by field, `addEvidence` / `addSources` append without duplicates, a
// `move` that would make a cycle is refused, `retract` marks a node instead of
// deleting it, and a file that cannot be read, or says something this version
// does not know, is skipped and counted as a warning. When two sessions change
// the same field, the event whose file name sorts last wins.

import type { DecisionEvent, DtActor, DtEvidence, DtFork, DtModel, DtNode } from '../types'
import { isDecider, isIso, isKind, isNodeId, isStatus, isTreeName, parseTime } from './events'
import { oneLine, sanitize, truncate } from './width'

export const MAX_WARNINGS = 50
const MAX_WARNING_TEXT = 200
const MAX_TEXT = 20000

export type ReplayEntry = {
  name: string
  /** The parsed event, or null when the file could not be used. */
  event: DecisionEvent | null
  /** Why not, when `event` is null. */
  problem?: string
}

function scalar(x: unknown): string {
  if (typeof x === 'string') return oneLine(x).slice(0, MAX_TEXT)
  if (typeof x === 'number' || typeof x === 'boolean') return String(x)
  return ''
}

function block(x: unknown): string {
  return typeof x === 'string' ? sanitize(x).trim().slice(0, MAX_TEXT) : ''
}

export function evidenceOf(x: unknown): DtEvidence | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null
  const o = x as Record<string, unknown>
  const label = scalar(o.label)
  if (label === '') return null
  const ev: DtEvidence = { label }
  for (const k of ['value', 'ci', 'run', 'note', 'source'] as const) {
    const v = scalar(o[k])
    if (v !== '') ev[k] = v
  }
  return ev
}

export function evidenceKey(e: DtEvidence): string {
  return JSON.stringify([e.label, e.value ?? '', e.ci ?? '', e.run ?? '', e.note ?? '', e.source ?? ''])
}

function appendEvidence(into: DtEvidence[], more: unknown): void {
  if (!Array.isArray(more)) return
  const seen = new Set(into.map(evidenceKey))
  for (const raw of more) {
    const ev = evidenceOf(raw)
    if (ev === null) continue
    const key = evidenceKey(ev)
    if (seen.has(key)) continue
    seen.add(key)
    into.push(ev)
  }
}

function stringList(x: unknown): string[] {
  if (!Array.isArray(x)) return []
  const out: string[] = []
  for (const item of x) {
    const s = scalar(item)
    if (s !== '' && !out.includes(s)) out.push(s)
  }
  return out
}

type Ctx = {
  nodes: Map<string, DtNode>
  warn: (msg: string) => void
}

/** Why `parent` cannot be `n`'s parent, or null when it can. */
function reparent(ctx: Ctx, n: DtNode, parent: string | null): string | null {
  if (parent === null) {
    n.parent = null
    return null
  }
  if (parent === n.id) return `${n.id} cannot be its own parent`
  if (!ctx.nodes.has(parent)) return `unknown parent ${parent}`
  const seen = new Set<string>()
  let cur: string | null = parent
  while (cur !== null && !seen.has(cur)) {
    if (cur === n.id) return `moving ${n.id} under ${parent} would make a cycle`
    seen.add(cur)
    cur = ctx.nodes.get(cur)?.parent ?? null
  }
  n.parent = parent
  return null
}

/** Applies the fields of an `update` patch (and the optional fields of an `add`) to `n`. */
function applyPatch(ctx: Ctx, n: DtNode, patch: Record<string, unknown>): void {
  const clear = (k: 'summary' | 'rationale' | 'decidedAt' | 'supersededBy' | 'decidedBy' | 'trunk' | 'evidence' | 'sources' | 'tags') => {
    delete n[k]
  }
  for (const key of Object.keys(patch)) {
    const v = patch[key]
    switch (key) {
      case 'title': {
        const t = scalar(v)
        if (t === '') ctx.warn(`${n.id}: empty title ignored`)
        else n.title = t
        break
      }
      case 'status':
        if (isStatus(v)) n.status = v
        else ctx.warn(`${n.id}: unknown status ${JSON.stringify(v)} ignored`)
        break
      case 'kind':
        if (isKind(v)) n.kind = v
        else ctx.warn(`${n.id}: unknown kind ${JSON.stringify(v)} ignored`)
        break
      case 'parent': {
        if (v !== null && typeof v !== 'string') {
          ctx.warn(`${n.id}: parent must be a string or null`)
          break
        }
        const problem = reparent(ctx, n, v === '' ? null : v)
        if (problem !== null) ctx.warn(problem)
        break
      }
      case 'trunk':
        if (v === true) n.trunk = true
        else if (v === false || v === null) clear('trunk')
        break
      case 'summary':
      case 'rationale': {
        const t = block(v)
        if (v === null || t === '') clear(key)
        else n[key] = t
        break
      }
      case 'decidedAt': {
        const t = scalar(v)
        if (v === null || t === '') clear('decidedAt')
        else if (isIso(t)) n.decidedAt = t
        else ctx.warn(`${n.id}: decidedAt ${JSON.stringify(t)} is not ISO 8601, ignored`)
        break
      }
      case 'supersededBy': {
        const t = scalar(v)
        if (v === null || t === '') clear('supersededBy')
        else n.supersededBy = t
        break
      }
      case 'decidedBy':
        if (v === null) clear('decidedBy')
        else if (isDecider(v)) n.decidedBy = v
        else ctx.warn(`${n.id}: unknown decidedBy ${JSON.stringify(v)} ignored`)
        break
      case 'evidence': {
        if (v === null) clear('evidence')
        else if (Array.isArray(v)) {
          const list: DtEvidence[] = []
          appendEvidence(list, v)
          if (list.length === 0) clear('evidence')
          else n.evidence = list
        }
        break
      }
      case 'sources':
      case 'tags': {
        if (v === null) clear(key)
        else if (Array.isArray(v)) {
          const list = stringList(v)
          if (list.length === 0) clear(key)
          else n[key] = list
        }
        break
      }
      case 'addEvidence': {
        const list = n.evidence ?? []
        appendEvidence(list, v)
        if (list.length > 0) n.evidence = list
        break
      }
      case 'addSources': {
        const list = n.sources ?? []
        for (const s of stringList(v)) if (!list.includes(s)) list.push(s)
        if (list.length > 0) n.sources = list
        break
      }
      default:
        break // unknown patch keys are ignored: newer writers may add fields
    }
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

/** Replays `entries`, which must already be sorted by file name. */
export function replay(entries: readonly ReplayEntry[]): DtModel {
  const nodes = new Map<string, DtNode>()
  const order: string[] = []
  const warnings: string[] = []
  let warningCount = 0
  let startedAt: string | null = null
  let lastMs: number | null = null
  let lastEventAt: string | null = null
  let eventCount = 0
  let fork: DtFork | null = null

  for (const entry of entries) {
    // what a warning says may come from a file somebody else wrote: it is shown as one short plain line
    const warn = (msg: string) => {
      warningCount++
      if (warnings.length < MAX_WARNINGS) warnings.push(truncate(oneLine(`${entry.name}: ${msg}`), MAX_WARNING_TEXT))
    }
    const ev = entry.event
    if (ev === null) {
      warn(entry.problem ?? 'unreadable')
      continue
    }
    eventCount++
    const ms = parseTime(ev.ts)
    if (ms !== null && (lastMs === null || ms >= lastMs)) {
      lastMs = ms
      lastEventAt = ev.ts
    }
    const ctx: Ctx = { nodes, warn }
    const actor: DtActor = ev.actor

    switch (ev.op) {
      case 'start':
        if (startedAt === null) startedAt = ev.ts
        break

      case 'fork': {
        // the first one counts: a tree is opened once, and the copies of events it began with never include another's
        if (fork !== null) break
        const b: unknown = ev.base
        const at = isRecord(b) ? b.at : undefined
        if (!isRecord(b) || !isTreeName(b.tree) || !(at === null || (typeof at === 'string' && at !== '')) || typeof b.count !== 'number' || !Number.isInteger(b.count) || b.count < 0) {
          warn('fork without a usable base')
          break
        }
        const title = Array.from(scalar(ev.text)).slice(0, 120).join('')
        fork = { tree: b.tree, at: at as string | null, count: b.count, ts: ev.ts, actor, ...(title !== '' ? { title } : {}) }
        break
      }

      case 'add': {
        const id = isNodeId(ev.id) ? ev.id : ''
        if (id === '') {
          warn(typeof ev.id === 'string' && ev.id !== '' ? `add with an id that cannot be used: ${JSON.stringify(ev.id)}` : 'add without an id')
          break
        }
        if (nodes.has(id)) {
          warn(`duplicate id ${id}, the later add is ignored`)
          break
        }
        if (!isRecord(ev.node)) {
          warn(`add ${id} without node fields`)
          break
        }
        const f = ev.node as Record<string, unknown>
        const title = scalar(f.title)
        if (title === '') {
          warn(`add ${id}: missing title`)
          break
        }
        if (!isStatus(f.status)) {
          warn(`add ${id}: unknown status ${JSON.stringify(f.status)}`)
          break
        }
        const node: DtNode = {
          id,
          title,
          parent: null,
          status: f.status,
          kind: isKind(f.kind) ? f.kind : 'decision',
          createdAt: ev.ts,
          createdBy: actor,
          updatedAt: ev.ts,
          notes: [],
          addedBy: entry.name,
        }
        if (typeof f.parent === 'string' && f.parent !== '') {
          if (f.parent === id) warn(`add ${id}: cannot be its own parent`)
          else node.parent = f.parent // may name a node that arrives later; resolved when drawn
        }
        const { title: _t, status: _s, kind: _k, parent: _p, ...rest } = f
        applyPatch(ctx, node, rest)
        nodes.set(id, node)
        order.push(id)
        break
      }

      case 'update': {
        const n = typeof ev.id === 'string' ? nodes.get(ev.id) : undefined
        if (n === undefined) {
          warn(`update of unknown id ${JSON.stringify(ev.id)}`)
          break
        }
        if (!isRecord(ev.patch)) {
          warn(`update ${n.id} without a patch`)
          break
        }
        applyPatch(ctx, n, ev.patch as Record<string, unknown>)
        n.updatedAt = ev.ts
        break
      }

      case 'note': {
        const n = typeof ev.id === 'string' ? nodes.get(ev.id) : undefined
        const text = block(ev.text)
        if (n === undefined) {
          warn(`note on unknown id ${JSON.stringify(ev.id)}`)
          break
        }
        if (text === '') {
          warn(`note on ${n.id} is empty`)
          break
        }
        n.notes.push({ ts: ev.ts, actor, text })
        n.updatedAt = ev.ts
        break
      }

      case 'move': {
        const n = typeof ev.id === 'string' ? nodes.get(ev.id) : undefined
        if (n === undefined) {
          warn(`move of unknown id ${JSON.stringify(ev.id)}`)
          break
        }
        if (ev.parent !== null && typeof ev.parent !== 'string') {
          warn(`move ${n.id}: parent must be a string or null`)
          break
        }
        const problem = reparent(ctx, n, ev.parent === '' ? null : (ev.parent ?? null))
        if (problem !== null) warn(problem)
        else n.updatedAt = ev.ts
        break
      }

      case 'retract': {
        const n = typeof ev.id === 'string' ? nodes.get(ev.id) : undefined
        if (n === undefined) {
          warn(`retract of unknown id ${JSON.stringify(ev.id)}`)
          break
        }
        if (n.retracted === undefined) {
          const reason = block(ev.reason)
          n.retracted = { ts: ev.ts, actor, ...(reason !== '' ? { reason } : {}) }
          n.updatedAt = ev.ts
        }
        break
      }

      default:
        warn(`unknown op ${JSON.stringify((ev as { op?: unknown }).op)}`)
    }
  }

  breakCycles(nodes, order, msg => {
    warningCount++
    if (warnings.length < MAX_WARNINGS) warnings.push(truncate(oneLine(msg), MAX_WARNING_TEXT))
  })

  return {
    isStarted: startedAt !== null,
    startedAt,
    nodes: order.map(id => nodes.get(id)!),
    warnings,
    warningCount,
    eventCount,
    lastEventAt,
    fork,
  }
}

/**
 * `add` may name a parent that has not been added yet, so two such adds can
 * point at each other. Cut every cycle at the node created last.
 */
function breakCycles(nodes: Map<string, DtNode>, order: readonly string[], warn: (msg: string) => void): void {
  const index = new Map(order.map((id, i) => [id, i] as const))
  for (const id of order) {
    const path: string[] = []
    const pos = new Map<string, number>()
    let cur: string | null = id
    while (cur !== null) {
      const at = pos.get(cur)
      if (at !== undefined) {
        const cycle = path.slice(at)
        const last = cycle.reduce((a, b) => (index.get(a)! > index.get(b)! ? a : b))
        nodes.get(last)!.parent = null
        warn(`parent cycle through ${cycle.join(' -> ')} cut at ${last}`)
        break
      }
      pos.set(cur, path.length)
      path.push(cur)
      const next: string | null = nodes.get(cur)?.parent ?? null
      cur = next !== null && nodes.has(next) ? next : null
    }
  }
}
