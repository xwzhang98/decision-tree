// The project's trees side by side: the facts the tabs and the overview are drawn from (one `DtTreeInfo` for
// each tree), the order the trees are listed in, and the graph of their steps over time.
//
// A tree opened from another begins as a copy of its events up to some point. What it records after that is
// its own. The overview draws only what each tree recorded itself, so no step is drawn twice, and joins the
// lane of a tree to the lane it came from, at the step it was opened at.
//
//   ●             Notes app: offline-first rewrite             main
//   ●───╮         Storage: SQLite with a write-ahead log       main
//   ┃   ●         Sync: the server owns the data               cloud-first
//   ●───╮ ┃       Sync: clients send operations                main
//   ┃   ┃ ●       CRDT text engine: merge by character         crdt-engine

import type { DecisionEvent, DtForkBase, DtGraphStep, DtModel, DtStatus, DtTreeInfo } from '../types'
import { MAIN, PENDING_STATUSES, parseTime } from './events'
import { buildIndex, stepNodes } from './tree'
import { numbered } from './versions'

/** The most steps of one tree the overview keeps (the newest ones): a tree of hundreds of steps is not a picture. */
export const MAX_OWN = 40
/** The most trees a pane lists. */
export const MAX_TREES = 40

/** Whether the node an event file added was recorded by the tree itself, and not copied in when the tree was opened. */
export function isOwn(fork: DtForkBase | null, addedBy: string): boolean {
  return fork === null || fork.at === null || addedBy > fork.at
}

/** Whether a step is work still ahead: the line that leads to it is dashed. */
export function isAhead(status: DtStatus): boolean {
  return (PENDING_STATUSES as readonly string[]).includes(status)
}

/** Everything the tabs and the overview say about one tree, worked out from its replayed model and its event files. */
export function treeInfoOf(name: string, model: DtModel, entries: readonly { name: string; event: DecisionEvent }[]): DtTreeInfo {
  const idx = buildIndex(model)
  const steps = stepNodes(idx)
  // the head is the newest step that is adopted, as in the rail
  const head = steps.reduce((at, n, k) => (n.status === 'adopted' ? k : at), -1)
  const own: DtGraphStep[] = []
  steps.forEach((n, k) => {
    if (!isOwn(model.fork, n.addedBy)) return
    own.push({ id: n.id, title: n.title, status: n.status, at: n.decidedAt ?? n.createdAt, by: n.addedBy, head: k === head })
  })
  const last = entries.length > 0 ? entries[entries.length - 1]!.event : null
  return {
    name,
    // what a tree is for: the title it was opened with; the first tree has none, and says what its oldest step says
    title: model.fork === null ? (steps[0]?.title ?? null) : (model.fork.title ?? null),
    fork: model.fork === null ? null : { tree: model.fork.tree, at: model.fork.at, count: model.fork.count },
    nodes: model.nodes.filter(n => n.retracted === undefined).length,
    steps: steps.length,
    events: numbered(entries).length,
    lastEventAt: model.lastEventAt,
    lastActor: last === null ? null : last.actor,
    own: own.slice(-MAX_OWN),
  }
}

// ---------------------------------------------------------------- the order

/** The tree a tree is drawn under: the one it was opened from when that is listed, else the first tree. */
function parentName(info: DtTreeInfo, byName: ReadonlyMap<string, DtTreeInfo>): string | null {
  if (info.name === MAIN) return null
  const base = info.fork?.tree
  if (base !== undefined && base !== info.name && byName.has(base)) return base
  return byName.has(MAIN) ? MAIN : null
}

/**
 * The order the trees are listed in, for the tabs, the lanes and the colours: the first tree, then what was
 * opened from it, the newest point of it first (the lane of a later fork sits next to the lane it left, so the
 * lines of the graph do not cross), each followed by the trees opened from it in the same way.
 */
export function orderTrees(infos: readonly DtTreeInfo[]): DtTreeInfo[] {
  const byName = new Map(infos.map(i => [i.name, i] as const))
  const kids = new Map<string | null, DtTreeInfo[]>()
  for (const info of infos) {
    const p = parentName(info, byName)
    const list = kids.get(p)
    if (list === undefined) kids.set(p, [info])
    else list.push(info)
  }
  const later = (a: DtTreeInfo, b: DtTreeInfo) => (b.fork?.count ?? 0) - (a.fork?.count ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  for (const list of kids.values()) list.sort(later)
  const out: DtTreeInfo[] = []
  const seen = new Set<string>()
  const walk = (info: DtTreeInfo): void => {
    if (seen.has(info.name)) return
    seen.add(info.name)
    out.push(info)
    for (const k of kids.get(info.name) ?? []) walk(k)
  }
  // the first tree leads; trees that name each other as their base (a corrupt record) are put at the end
  for (const root of kids.get(null) ?? []) walk(root)
  for (const info of [...infos].sort(later)) walk(info)
  return out
}

// ---------------------------------------------------------------- the graph

/** The step of a tree's base a tree's lane leaves from: the last step it was given, and the tree that recorded it. */
export type ForkPoint = { tree: string; step: string }

/**
 * Where the lane of `info` leaves another lane: the last step of the tree it was opened from, as that tree
 * was at the version it was opened at. When the base had recorded nothing of its own by then, what the tree
 * began with was its base's own copy, and the lane leaves from where that came from. Null when there is no such step.
 */
export function forkPoint(info: DtTreeInfo, byName: ReadonlyMap<string, DtTreeInfo>): ForkPoint | null {
  let fork = info.fork
  if (fork === null || fork.at === null) return null
  let limit: string = fork.at
  const seen = new Set<string>([info.name])
  while (fork !== null && !seen.has(fork.tree)) {
    seen.add(fork.tree)
    const base = byName.get(fork.tree)
    if (base === undefined) return null
    const mine = base.own.filter(s => s.by <= limit)
    if (mine.length > 0) return { tree: base.name, step: mine[mine.length - 1]!.id }
    // nothing recorded there itself yet: its steps up to the point it was opened at are another tree's
    if (base.fork === null || base.fork.at === null) return null
    if (base.fork.at < limit) limit = base.fork.at
    fork = base.fork
  }
  return null
}

export type GraphRow = {
  tree: string
  /** The column of the lane in the graph: 0 is the first tree's. */
  lane: number
  step: DtGraphStep
  /** The first and the last of the lane's own steps. */
  first: boolean
  last: boolean
  /** The step is work still ahead: the line that leads to it is dashed. */
  ahead: boolean
  /** The lanes that are joined to this one at this row: the trees opened from this step. */
  forks: number[]
}

export type Graph = {
  /** The trees that have a lane (they recorded a step of their own), in the order of the lanes. */
  lanes: string[]
  /** One row for each step, the oldest at the top. */
  rows: GraphRow[]
}

/**
 * The graph of the steps of every tree: a lane for each tree that recorded something of its own, a row for each
 * of those steps, in the order they were decided, and where each lane joins the one it came from. A step is not
 * placed before the step its tree was opened from, whatever date it was decided on.
 */
export function graphOf(infos: readonly DtTreeInfo[]): Graph {
  const ordered = orderTrees(infos)
  const byName = new Map(ordered.map(i => [i.name, i] as const))
  const trees = ordered.filter(i => i.own.length > 0)
  const laneOf = new Map(trees.map((i, k) => [i.name, k] as const))
  const depthOf = (info: DtTreeInfo): number => {
    let depth = 0
    let at: DtTreeInfo | undefined = info
    const seen = new Set<string>()
    while (at !== undefined && at.fork !== null && !seen.has(at.name)) {
      seen.add(at.name)
      depth += 1
      at = byName.get(at.fork.tree)
    }
    return depth
  }

  type Placed = { row: GraphRow; key: number; depth: number; order: number; at: number }
  const placed: Placed[] = []
  const keyOf = new Map<string, number>()
  const points = new Map<string, ForkPoint | null>()
  ordered.forEach((info, order) => {
    const lane = laneOf.get(info.name)
    if (lane === undefined) return
    const point = forkPoint(info, byName)
    points.set(info.name, point)
    // every step comes after the one its tree was opened from, and after the step before it
    let floor = point === null ? Number.NEGATIVE_INFINITY : (keyOf.get(`${point.tree}\u0000${point.step}`) ?? Number.NEGATIVE_INFINITY)
    info.own.forEach((step, at) => {
      floor = Math.max(floor, parseTime(step.at) ?? 0)
      keyOf.set(`${info.name}\u0000${step.id}`, floor)
      placed.push({
        row: { tree: info.name, lane, step, first: at === 0, last: at === info.own.length - 1, ahead: isAhead(step.status), forks: [] },
        key: floor,
        depth: depthOf(info),
        order,
        at,
      })
    })
  })
  placed.sort((a, b) => a.key - b.key || a.depth - b.depth || a.order - b.order || a.at - b.at)
  const rows = placed.map(p => p.row)
  for (const info of trees) {
    const point = points.get(info.name)
    if (point === null || point === undefined) continue
    const row = rows.find(r => r.tree === point.tree && r.step.id === point.step)
    if (row !== undefined) row.forks.push(laneOf.get(info.name)!)
  }
  for (const row of rows) row.forks.sort((a, b) => a - b)
  return { lanes: trees.map(i => i.name), rows }
}
