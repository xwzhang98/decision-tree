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

export type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }

const isEl = (x: unknown): x is El => x !== null && typeof x === 'object'

/** Everything an element shows, joined. A button with a hotkey is drawn by the engine as `key: label`, and so it reads here. */
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
    case 'Button': {
      const label = kids.length === 0 && typeof props.label === 'string' ? props.label : kids.map(textOf).join('')
      return props.plain === true && typeof props.hotkey === 'string' ? `${props.hotkey}: ${label}` : label
    }
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

/** The blocks of the pane, top to bottom: the children of its column. */
export function blocksOf(tree: unknown): unknown[] {
  return isEl(tree) ? (tree.children ?? []) : []
}

/** The element drawn under `key`, wherever it sits. */
export function elementOf(tree: unknown, key: string): El | undefined {
  let found: El | undefined
  const walk = (x: unknown) => {
    if (found !== undefined || !isEl(x)) return
    if (x.props?.key === key) {
      found = x
      return
    }
    for (const c of x.children ?? []) walk(c)
  }
  walk(tree)
  return found
}

/** One piece of a drawn line: its text and the style of the `Text` it sits in (a bare string has none). */
export type Run = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean }

/** The pieces an element is made of, in order. */
export function runsOf(x: unknown): Run[] {
  if (!isEl(x)) return []
  return (x.children ?? []).map((c): Run => {
    const run: Run = { text: textOf(c) }
    if (!isEl(c)) return run
    const p = c.props ?? {}
    if (typeof p.color === 'string') run.color = p.color
    if (typeof p.backgroundColor === 'string') run.backgroundColor = p.backgroundColor
    if (p.dimColor === true) run.dimColor = true
    if (p.bold === true) run.bold = true
    return run
  })
}

/** The keys of the node rows (everything but the mod's own `~` controls). */
export function rowKeys(tree: unknown): string[] {
  return keysOf(tree, 'Button').filter(k => !k.startsWith('~'))
}

/** `count` decisions under one root, for a tree longer than any pane. */
export function manyNodes(count: number): SeedNode[] {
  const out: SeedNode[] = [{ id: 'big-root', title: 'root of many', trunk: true }]
  for (let k = 0; k < count; k++) {
    out.push({ id: `big-${String(k).padStart(3, '0')}`, title: `decision number ${k}`, parent: 'big-root', status: k % 7 === 0 ? 'planned' : 'adopted' })
  }
  return out
}
