// What the pane-level tests share: mounting the Pane through the engine's test kit
// and reading the drawn tree back as lines of text and lists of keys.

import type { RenderSurface } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { SeedNode } from './engine'

/** Surfaces whose element table has Input and Select. */
export const EDITABLE = ['terminal', 'desktop', 'vscode'] as const
export const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

export type PaneOptions = {
  columns?: number
  rows?: number
  placement?: 'dock' | 'inline'
  offset?: number
  requestId?: string
}

/** Mounts the decision-tree Pane as a surface docking it beside the transcript would. */
export function mountPane<P extends RenderSurface>($: Engine, surface: P, o: PaneOptions = {}) {
  return $.ui.mount({
    plugin: 'decision-tree',
    surface,
    component: 'Pane',
    requestId: o.requestId ?? 'decision-tree',
    props: {
      title: 'Decisions',
      isFocused: true,
      bodyColumns: o.columns ?? 70,
      placement: o.placement ?? 'dock',
      scroll: { offset: o.offset ?? 0, bodyRows: o.rows ?? 40 },
      view: {},
    },
    viewport: { columns: 160, rows: 44, isFullscreen: true },
  })
}

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const isEl = (x: unknown): x is El => x !== null && typeof x === 'object'

/** Everything an element shows, joined. */
export function textOf(x: unknown): string {
  if (typeof x === 'string') return x
  if (!isEl(x)) return ''
  const props = x.props ?? {}
  const kids = x.children ?? []
  switch (x.type) {
    case 'Input': {
      const value = typeof props.value === 'string' ? props.value : ''
      const hint = typeof props.placeholder === 'string' ? props.placeholder : ''
      return `${typeof props.label === 'string' ? props.label : ''}${value !== '' ? value : hint}`
    }
    case 'Select': {
      const options = Array.isArray(props.options) ? (props.options as { value: string; label: string }[]) : []
      const chosen = options.find(o => o.value === props.value)
      return `${typeof props.label === 'string' ? props.label : ''}${chosen?.label ?? ''}`
    }
    case 'Button':
      return kids.length === 0 && typeof props.label === 'string' ? props.label : kids.map(textOf).join('')
    default:
      return kids.map(textOf).join('')
  }
}

/** One string per line of the pane: the children of its column, the form's column opened up. */
export function linesOf(tree: unknown): string[] {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!isEl(x)) {
      out.push(textOf(x))
      return
    }
    if (x.type === 'Box' && (x.props?.flexDirection ?? 'column') === 'column') {
      for (const c of x.children ?? []) walk(c)
      return
    }
    out.push(textOf(x))
  }
  walk(tree)
  return out
}

/** The keys of every element in the drawing that has one, document order. */
export function keysOf(tree: unknown, type?: string): string[] {
  const out: string[] = []
  const walk = (x: unknown) => {
    if (!isEl(x)) return
    const key = x.props?.key
    if ((type === undefined || x.type === type) && typeof key === 'string') out.push(key)
    for (const c of x.children ?? []) walk(c)
  }
  walk(tree)
  return out
}

/** The keys of the node rows (everything but the mod's own `~` controls). */
export function rowKeys(tree: unknown): string[] {
  return keysOf(tree, 'Button').filter(k => !k.startsWith('~'))
}

/** The tree of the reference sketch (spec 9.2): trunk, rejected branches, open work. */
export const SKETCH: SeedNode[] = [
  { id: 'design-v2', title: 'design v2 定稿', trunk: true, kind: 'milestone', decidedBy: 'user', decidedAt: '2026-10-08T12:00:00Z' },
  { id: 'pooling-only-2', title: '连接只走池化（exp-2）', parent: 'design-v2', trunk: true, decidedBy: 'user', decidedAt: '2026-10-09T12:00:00Z' },
  { id: 'pool-32', title: 'pool 数维持 32', parent: 'pooling-only-2', status: 'no-diff', decidedAt: '2026-10-09T12:00:00Z' },
  { id: 'v21-abs-size', title: 'v2.1：池的大小用绝对值', parent: 'pooling-only-2', status: 'rejected', decidedBy: 'gate', decidedAt: '2026-10-09T12:00:00Z' },
  { id: 'v21-run-a', title: 'seed 0 重跑', parent: 'v21-abs-size', status: 'rejected' },
  { id: 'dbpool-adopted', title: '连接池采用', parent: 'pooling-only-2', trunk: true, decidedBy: 'gate', decidedAt: '2026-10-09T12:00:00Z' },
  {
    id: 'v22-adopted',
    title: '构建版本定为 v2.2',
    parent: 'design-v2',
    trunk: true,
    decidedBy: 'user',
    summary: '池的大小、线程、队列全部用比例，加 GC 比例。',
    evidence: [{ label: 'v22 s0 预热后', value: 'P99 suite 内 −12.6%', ci: '[−15.1, −10.4]', run: 'v22_s0' }],
    sources: ['reports/design_v22_20261009/SPEC_V22.md'],
  },
  { id: 'deep-skip', title: 'deep_skip 撤回', parent: 'v22-adopted', status: 'withdrawn' },
  { id: 'gateway', title: '2 hops 简化为 gateway', parent: 'design-v2', status: 'in-progress', trunk: true },
  { id: 'proxies1', title: '3 proxies 换成一个 distributed cache', parent: 'gateway', status: 'planned' },
]

/** `count` decisions under one root, for a tree longer than any pane. */
export function manyNodes(count: number): SeedNode[] {
  const out: SeedNode[] = [{ id: 'big-root', title: 'root of many', trunk: true }]
  for (let k = 0; k < count; k++) {
    out.push({ id: `big-${String(k).padStart(3, '0')}`, title: `decision number ${k}`, parent: 'big-root', status: k % 7 === 0 ? 'planned' : 'adopted' })
  }
  return out
}
