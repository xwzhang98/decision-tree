// A node for the unit tests of the tree and the rail to build trees from: every field has a value, and the time
// of each node is fixed, so that the order of nodes does not change from one run to the next.

import type { DtNode } from '../types'

/** 2026-10-10 05:00 UTC. */
const NOW = Date.UTC(2026, 9, 10, 5, 0, 0)
const DAY = 24 * 3600 * 1000
const iso = (ms: number) => new Date(ms).toISOString()

let counter = 0

export function node(id: string, parent: string | null, over: Partial<DtNode> = {}): DtNode {
  counter += 1
  const at = over.decidedAt ?? iso(NOW - 30 * DAY + counter * 1000)
  return {
    id,
    title: `title ${id}`,
    parent,
    status: 'adopted',
    kind: 'decision',
    createdAt: at,
    createdBy: 'model',
    updatedAt: at,
    notes: [],
    addedBy: `${id}.json`,
    ...over,
  }
}
