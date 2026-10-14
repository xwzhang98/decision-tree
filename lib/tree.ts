// The tree as the pane draws it: an index over the replayed nodes, the filters,
// the default expansion, the flattened rows, the window over them, and node lookup.

import type { DtFilter, DtModel, DtNode, DtStatus, DtUi } from '../types'
import { PENDING_STATUSES, parseTime } from './events'

export type TreeIndex = {
  nodes: readonly DtNode[]
  byId: ReadonlyMap<string, DtNode>
  /** Effective parent of every node: a parent that does not exist counts as the root. */
  parentOf: ReadonlyMap<string, string | null>
  /** Children by effective parent (`null`: the roots), oldest decision first. */
  children: ReadonlyMap<string | null, readonly DtNode[]>
  /** Position in the order the nodes were created. */
  order: ReadonlyMap<string, number>
}

/** When the decision took effect, else when it was recorded (ms; 0 when neither parses). */
export function sortTime(n: DtNode): number {
  return parseTime(n.decidedAt) ?? parseTime(n.createdAt) ?? 0
}

export function buildIndex(model: Pick<DtModel, 'nodes'>): TreeIndex {
  const byId = new Map<string, DtNode>()
  const order = new Map<string, number>()
  model.nodes.forEach((n, i) => {
    byId.set(n.id, n)
    order.set(n.id, i)
  })
  const parentOf = new Map<string, string | null>()
  const kids = new Map<string | null, DtNode[]>()
  for (const n of model.nodes) {
    const p = n.parent !== null && byId.has(n.parent) && n.parent !== n.id ? n.parent : null
    parentOf.set(n.id, p)
    const list = kids.get(p)
    if (list === undefined) kids.set(p, [n])
    else list.push(n)
  }
  for (const list of kids.values()) {
    list.sort((a, b) => sortTime(a) - sortTime(b) || order.get(a.id)! - order.get(b.id)!)
  }
  return { nodes: model.nodes, byId, parentOf, children: kids, order }
}

export function isPending(n: DtNode): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(n.status)
}

/** The ids from the root down to the node's parent. */
export function ancestorIds(idx: TreeIndex, id: string): string[] {
  const out: string[] = []
  const seen = new Set<string>([id])
  let cur = idx.parentOf.get(id) ?? null
  while (cur !== null && !seen.has(cur)) {
    out.unshift(cur)
    seen.add(cur)
    cur = idx.parentOf.get(cur) ?? null
  }
  return out
}

/** Nodes whose `supersededBy` names `id`. */
export function supersededNodes(idx: TreeIndex, id: string): DtNode[] {
  return idx.nodes.filter(n => n.supersededBy === id && n.id !== id)
}

/** The mainline: `trunk` nodes, in the order they were decided. */
export function trunkNodes(idx: TreeIndex): DtNode[] {
  return idx.nodes
    .filter(n => n.trunk === true && n.retracted === undefined)
    .sort((a, b) => sortTime(a) - sortTime(b) || idx.order.get(a.id)! - idx.order.get(b.id)!)
}

/** The nodes touched most recently, newest first. */
export function recentNodes(idx: TreeIndex, count: number): DtNode[] {
  return idx.nodes
    .filter(n => n.retracted === undefined)
    .sort((a, b) => (parseTime(b.updatedAt) ?? 0) - (parseTime(a.updatedAt) ?? 0) || idx.order.get(b.id)! - idx.order.get(a.id)!)
    .slice(0, count)
}

// ---------------------------------------------------------------- lookup

export type Resolved = { node: DtNode } | { error: 'none' } | { error: 'ambiguous'; ids: string[] }

/** A node by id, or by a piece of its title that matches exactly one node. */
export function resolveRef(idx: TreeIndex, ref: string): Resolved {
  const wanted = ref.trim()
  if (wanted === '') return { error: 'none' }
  const exact = idx.byId.get(wanted)
  if (exact !== undefined) return { node: exact }
  const lower = wanted.toLowerCase()
  const byId = idx.nodes.filter(n => n.id.toLowerCase() === lower)
  if (byId.length === 1) return { node: byId[0]! }
  const live = idx.nodes.filter(n => n.retracted === undefined)
  const sameTitle = live.filter(n => n.title.toLowerCase() === lower)
  if (sameTitle.length === 1) return { node: sameTitle[0]! }
  if (sameTitle.length > 1) return { error: 'ambiguous', ids: sameTitle.slice(0, 6).map(n => n.id) }
  const part = live.filter(n => n.title.toLowerCase().includes(lower) || n.id.toLowerCase().includes(lower))
  if (part.length === 1) return { node: part[0]! }
  if (part.length > 1) return { error: 'ambiguous', ids: part.slice(0, 6).map(n => n.id) }
  return { error: 'none' }
}

// ---------------------------------------------------------------- rows

/** What the rail needs to know about a row to draw its part of the line. */
export type RailMark = {
  /** The row is a step of the mainline (its dot sits on the rail), not a branch hanging from one. */
  step: boolean
  /** The step is the newest one adopted: the head of the rail. */
  head: boolean
  /** The rail below leads to a step that is not done yet. */
  ahead: boolean
  /** The step is the last one: the rail ends with it. */
  end: boolean
  /** A branch that is the last to hang directly from its step. */
  lastBranch: boolean
  /** More rows of the same step's branches follow this one. */
  more: boolean
}

export type Row = {
  node: DtNode
  /** 0 for a step of the mainline; for a branch, how far below its step it hangs (1 and up). */
  depth: number
  /** The step (its index among the steps drawn) the row belongs to. */
  step: number
  /** Children that pass the filter and hang from this row (the steps that follow a step are not among them). */
  childCount: number
  /** Rows not drawn because this node is collapsed. */
  hiddenKids: number
  isExpanded: boolean
  rail: RailMark
}

export type RowOptions = {
  ui: Pick<DtUi, 'expanded' | 'collapsed' | 'filter'>
  nowMs: number
}

const RECENT_MS = 48 * 3600 * 1000

function matches(n: DtNode, filter: DtFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'pending':
      return n.retracted === undefined && isPending(n)
    case 'clean':
      return n.retracted === undefined && n.status !== 'rejected' && n.status !== 'withdrawn'
    default:
      return n.retracted === undefined
  }
}

/** Whether the node is drawn: it matches the filter, or something under it does. */
function visibleSet(idx: TreeIndex, filter: DtFilter): Set<string> {
  const show = new Set<string>()
  for (const n of idx.nodes) {
    if (!matches(n, filter)) continue
    show.add(n.id)
    for (const a of ancestorIds(idx, n.id)) show.add(a)
  }
  return show
}

/** Default expansion: the mainline, pending work, and branches changed in the last 48 hours. */
function defaultExpanded(idx: TreeIndex, show: ReadonlySet<string>, nowMs: number): Set<string> {
  const open = new Set<string>()
  for (const n of idx.nodes) {
    if (!show.has(n.id)) continue
    if (n.trunk === true) open.add(n.id)
    const recent = nowMs - (parseTime(n.updatedAt) ?? 0) <= RECENT_MS
    if (isPending(n) || recent) {
      // the node is open, and so is the way down to it
      open.add(n.id)
      for (const a of ancestorIds(idx, n.id)) open.add(a)
    }
  }
  return open
}

/** What the rail leads towards: a step of the mainline that is not done yet. */
const AHEAD: readonly DtStatus[] = ['planned', 'in-progress', 'proposed']

const byTime = (idx: TreeIndex) => (a: DtNode, b: DtNode) => sortTime(a) - sortTime(b) || idx.order.get(a.id)! - idx.order.get(b.id)!

/** Whether the node is a step of the mainline: marked as trunk, or a root (every tree starts somewhere). */
function isStepNode(idx: TreeIndex, n: DtNode): boolean {
  return n.trunk === true || idx.parentOf.get(n.id) === null
}

/**
 * The steps of the mainline: the trunk nodes and the roots, in the order they were decided. A tree with
 * nothing marked as trunk has its roots for steps, and everything else hangs from them.
 */
export function stepNodes(idx: TreeIndex, include: (n: DtNode) => boolean = n => n.retracted === undefined): DtNode[] {
  return idx.nodes.filter(n => include(n) && isStepNode(idx, n)).sort(byTime(idx))
}

/**
 * Flattens the tree into the rows of the rail, in order: a step of the mainline, the branches that hang
 * from it (what was tried there, in the order it was decided), then the next step. A branch hangs from
 * the nearest step above it in the tree.
 */
export function visibleRows(idx: TreeIndex, opts: RowOptions): Row[] {
  const { filter } = opts.ui
  const show = visibleSet(idx, filter)
  const forceOpen = filter === 'all' || filter === 'pending'
  const open = defaultExpanded(idx, show, opts.nowMs)
  const userOpen = new Set(opts.ui.expanded)
  const userShut = new Set(opts.ui.collapsed)

  const steps = stepNodes(idx, n => show.has(n.id))
  const stepIds = new Set(steps.map(n => n.id))
  const head = steps.reduce((at, n, k) => (n.status === 'adopted' ? k : at), -1)

  const isOpen = (id: string): boolean => {
    if (forceOpen) return true
    if (userShut.has(id)) return false
    if (userOpen.has(id)) return true
    return open.has(id) || stepIds.has(id)
  }
  /** The nodes hanging directly from a node: they pass the filter and are not steps themselves. */
  const hanging = (id: string): DtNode[] => (idx.children.get(id) ?? []).filter(k => show.has(k.id) && !stepIds.has(k.id))
  const folded = (id: string): number => hanging(id).reduce((sum, k) => sum + 1 + folded(k.id), 0)

  const rows: Row[] = []
  steps.forEach((node, k) => {
    const sub = hanging(node.id)
    const expanded = sub.length > 0 && isOpen(node.id)
    const next = steps[k + 1]
    rows.push({
      node,
      depth: 0,
      step: k,
      childCount: sub.length,
      hiddenKids: sub.length > 0 && !expanded ? folded(node.id) : 0,
      isExpanded: expanded,
      rail: { step: true, head: k === head, ahead: next !== undefined && AHEAD.includes(next.status), end: next === undefined, lastBranch: false, more: false },
    })
    if (!expanded) return
    const first = rows.length
    const walk = (parent: string, depth: number): void => {
      for (const child of hanging(parent)) {
        const below = hanging(child.id)
        const opened = below.length > 0 && isOpen(child.id)
        rows.push({
          node: child,
          depth,
          step: k,
          childCount: below.length,
          hiddenKids: below.length > 0 && !opened ? folded(child.id) : 0,
          isExpanded: opened,
          rail: { step: false, head: false, ahead: next !== undefined && AHEAD.includes(next.status), end: next === undefined, lastBranch: false, more: false },
        })
        if (opened) walk(child.id, depth + 1)
      }
    }
    walk(node.id, 1)
    // which branch is the last of its step, and which rows have more after them
    let lastDirect = -1
    for (let i = first; i < rows.length; i++) if (rows[i]!.depth === 1) lastDirect = i
    for (let i = first; i < rows.length; i++) {
      const mark = rows[i]!.rail
      mark.lastBranch = i === lastDirect
      mark.more = i < rows.length - 1
    }
  })
  return rows
}

export function rowIndex(rows: readonly Row[], id: string | null): number {
  if (id === null) return -1
  return rows.findIndex(r => r.node.id === id)
}

/**
 * The row that counts as selected: the chosen node when it is drawn, else the
 * nearest drawn ancestor, else the first row (null with no rows).
 */
export function effectiveSelection(idx: TreeIndex, rows: readonly Row[], selected: string | null): string | null {
  if (rows.length === 0) return null
  if (selected !== null) {
    if (rowIndex(rows, selected) >= 0) return selected
    if (idx.byId.has(selected)) {
      const up = ancestorIds(idx, selected).reverse()
      for (const a of up) if (rowIndex(rows, a) >= 0) return a
    }
  }
  return rows[0]!.node.id
}

export type Window = { start: number; end: number; above: number; below: number }

/**
 * Which rows to draw: `count` of them, the selection always among them.
 * `top` pins the first row (after the person scrolled); null follows the selection.
 */
export function windowRows(total: number, selIndex: number, top: number | null, count: number): Window {
  const size = Math.max(1, Math.min(count, total))
  const maxStart = Math.max(0, total - size)
  let start: number
  if (top !== null) start = Math.min(Math.max(0, top), maxStart)
  else start = Math.min(Math.max(0, selIndex - Math.floor(size / 2)), maxStart)
  if (selIndex >= 0 && top === null) {
    if (selIndex < start) start = selIndex
    if (selIndex >= start + size) start = selIndex - size + 1
  }
  const end = Math.min(total, start + size)
  return { start, end, above: start, below: total - end }
}

/** The ids that must be expanded for `id` to be drawn (used when a command selects a node). */
export function revealPath(idx: TreeIndex, id: string): string[] {
  return ancestorIds(idx, id)
}
