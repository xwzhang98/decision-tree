// A small project to draw: the tree of the reference pane sketch (spec 9.2), plus helpers
// to build more. Times are fixed so dates and "48 hours" rules are repeatable.

import { defaultConfig } from '../lib/config'
import type { DtModel, DtNode, DtNow, DtNowData, DtProject, DtUi } from '../types'

/** 2026-10-10 05:00 UTC. */
export const NOW = Date.UTC(2026, 9, 10, 5, 0, 0)
export const DAY = 24 * 3600 * 1000
export const iso = (ms: number) => new Date(ms).toISOString()

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

const noon = (month: number, day: number) => iso(Date.UTC(2026, month - 1, day, 12, 0, 0))

/** The tree of spec 9.2, with real-looking evidence on one node. */
export function sampleNodes(): DtNode[] {
  return [
    node('design-v2', null, { title: 'design v2 定稿', trunk: true, decidedAt: noon(10, 8), decidedBy: 'user', kind: 'milestone' }),
    node('pooling-only-2', 'design-v2', { title: '连接只走池化（exp-2）', trunk: true, decidedAt: noon(10, 9), decidedBy: 'user' }),
    node('pool-32', 'pooling-only-2', { title: 'pool 数维持 32', status: 'no-diff', decidedAt: noon(10, 9), updatedAt: iso(NOW - 5 * DAY) }),
    node('v21-abs-size', 'pooling-only-2', {
      title: 'v2.1：池的大小用绝对值',
      status: 'rejected',
      decidedAt: noon(10, 9),
      decidedBy: 'gate',
      updatedAt: iso(NOW - 5 * DAY),
    }),
    node('v21-run-a', 'v21-abs-size', { title: 'seed 0 重跑', status: 'rejected', decidedAt: noon(10, 9), updatedAt: iso(NOW - 5 * DAY) }),
    node('v21-run-b', 'v21-abs-size', { title: 'seed 1 重跑', status: 'rejected', decidedAt: noon(10, 9), updatedAt: iso(NOW - 5 * DAY) }),
    node('dbpool-adopted', 'pooling-only-2', { title: '连接池采用', trunk: true, decidedAt: noon(10, 9), decidedBy: 'gate' }),
    node('v22-adopted', 'design-v2', {
      title: '构建版本定为 v2.2',
      trunk: true,
      decidedAt: noon(10, 9),
      decidedBy: 'user',
      summary: '池的大小、线程、队列全部用比例，加 GC 比例。',
      evidence: [
        { label: 'v22 s0 预热后', value: 'P99 suite 内 −12.6%', ci: '[−15.1, −10.4]', run: 'v22_s0' },
        { label: 'v22 s1 预热后', value: 'P99 suite 内 −13.5%', ci: '[−15.7, −11.5]', run: 'v22_s1' },
      ],
      sources: ['reports/design_v22_20261009/SPEC_V22.md'],
    }),
    node('deep-skip', 'v22-adopted', { title: 'deep_skip 撤回', status: 'withdrawn', decidedAt: noon(10, 9) }),
    node('gateway', 'design-v2', {
      title: '2 hops 简化为 gateway',
      status: 'in-progress',
      trunk: true,
      createdAt: iso(NOW - 3 * 3600 * 1000),
      updatedAt: iso(NOW - 1 * 3600 * 1000),
    }),
    node('proxies1', 'gateway', {
      title: '3 proxies 换成一个 distributed cache',
      status: 'planned',
      createdAt: iso(NOW - 2.5 * 3600 * 1000),
      updatedAt: iso(NOW - 2 * 3600 * 1000),
    }),
  ]
}

export function modelOf(nodes: DtNode[]): DtModel {
  return {
    isStarted: true,
    startedAt: iso(NOW - 31 * DAY),
    nodes,
    warnings: [],
    warningCount: 0,
    eventCount: nodes.length,
    lastEventAt: '2026-10-10T00:12:00-04:00',
    fork: null,
  }
}

export const UI0: DtUi = { selected: null, expanded: [], collapsed: [], filter: 'default', showNow: true, editing: null }

export function projectOf(over: Partial<DtProject> = {}): DtProject {
  return {
    root: '/work/orders-api-rewrite',
    mode: 'recording',
    config: { ...defaultConfig('orders-api-rewrite', iso(NOW - 31 * DAY)) },
    configError: null,
    tree: 'main',
    ...over,
  }
}

export const NOW_NONE: DtNow = { approval: 'none', argv: [], data: null, fetchedAt: null, error: null }

export const NOW_DATA: DtNowData = {
  updatedAt: '2026-10-10T00:20:00-04:00',
  lanes: [
    { name: 'ZETA', run: 'gateway s0', state: 'running', step: 3400, total: 4000, eta: '23:50', note: '预热中' },
    { name: 'BETA-0', run: 'ablate_wide s0', state: 'running', step: 420, total: 4000, eta: '09:10', note: '' },
    { name: 'BETA-1', run: 'ablate_deep s0', state: 'running', step: 120, total: 4000, eta: '09:35', note: '' },
  ],
  next: [{ text: '闸 → probe s1', eta: '06:15' }],
  warnings: ['GAMMA 空闲'],
}

export function nowApproved(over: Partial<DtNow> = {}): DtNow {
  return { approval: 'approved', argv: ['bash', 'scripts/decision_status.sh'], data: NOW_DATA, fetchedAt: NOW - 10_000, error: null, ...over }
}

export const NOW_PENDING: DtNow = { approval: 'pending', argv: ['bash', 'scripts/decision_status.sh'], data: null, fetchedAt: null, error: null }

/** `count` nodes in a chain of small branches, for windowing tests. */
export function bigTree(count: number): DtNode[] {
  const out: DtNode[] = [node('big-root', null, { title: 'root of many', trunk: true })]
  for (let k = 0; k < count; k++) {
    out.push(node(`big-${String(k).padStart(3, '0')}`, 'big-root', { title: `decision number ${k}`, status: k % 7 === 0 ? 'planned' : 'adopted' }))
  }
  return out
}
