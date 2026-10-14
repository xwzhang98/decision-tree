// A row of the pane that holds buttons: the strip at the top (the tabs, the language switch) and the keys
// at the bottom. The layout decides what is on a row and how wide it is; the view turns each part into
// a `Text` or a `Button`, and a press becomes an `Action` for the Runtime.

import type { DtFilter, DtLang } from '../types'
import type { Line } from './spans'
import { lineWidth } from './spans'
import { strWidth } from './width'

/** Control keys start with this; a node's key is its id, which no id can start with (ids are lowercase letters, digits and hyphens). */
export const CONTROL = '~'

/** A line of the list of trees in the overview is a button with this key and the tree's name (`~tree:cloud-first`; a second line adds `:2`). */
export const TREE_KEY = `${CONTROL}tree:`
/** A step of the overview's graph: this key, the tree's name, a colon and the step's id (`~step:cloud-first:c2`). */
export const STEP_KEY = `${CONTROL}step:`

/** A line of the picker of colours is a button with this key and the id of the scheme (`~scheme:nord`). */
export const SCHEME_KEY = `${CONTROL}scheme:`

export function schemeKey(id: string): string {
  return `${SCHEME_KEY}${id}`
}

/** The scheme a control of the picker stands for; null for any other key. */
export function schemeOfKey(key: string): string | null {
  return key.startsWith(SCHEME_KEY) && key.length > SCHEME_KEY.length ? key.slice(SCHEME_KEY.length) : null
}

/** The controls of the form for a new tree. */
export const NEW_KEYS = {
  name: `${CONTROL}new-name`,
  at: `${CONTROL}new-at`,
  title: `${CONTROL}new-title`,
  create: `${CONTROL}new-create`,
  cancel: `${CONTROL}new-cancel`,
} as const

export function treeKey(tree: string, part: 0 | 1 = 0): string {
  return part === 0 ? `${TREE_KEY}${tree}` : `${TREE_KEY}${tree}:2`
}

export function stepKey(tree: string, id: string): string {
  return `${STEP_KEY}${tree}:${id}`
}

/** The tree (and the step, for a point of the graph) a control of the overview stands for; null for any other key. */
export function treeOfKey(key: string): { tree: string; step: string | null } | null {
  if (key.startsWith(TREE_KEY)) {
    const rest = key.slice(TREE_KEY.length).replace(/:2$/, '')
    return rest === '' ? null : { tree: rest, step: null }
  }
  if (key.startsWith(STEP_KEY)) {
    const rest = key.slice(STEP_KEY.length)
    const at = rest.indexOf(':')
    // (a tree's name has no colon in it, nor has a step's id)
    return at <= 0 || at === rest.length - 1 ? null : { tree: rest.slice(0, at), step: rest.slice(at + 1) }
  }
  return null
}

/** What a press on a control asks of the Runtime. */
export type Action =
  | { do: 'move'; by: number }
  | { do: 'filter'; filter: Exclude<DtFilter, 'default'> }
  | { do: 'now' }
  | { do: 'edit' }
  | { do: 'warnings' }
  | { do: 'lang'; lang: DtLang }
  /** A tab of the strip: look at that tree. */
  | { do: 'tab'; tree: string }
  /** The next or the previous tree. */
  | { do: 'cycle'; by: 1 | -1 }
  /** The overview of the trees, and back from it (or from the picker). */
  | { do: 'overview' }
  | { do: 'back' }
  /** The colour picker. */
  | { do: 'colors' }
  /** In the overview: look at the highlighted tree, record into it, open the form for a new one. */
  | { do: 'open' }
  | { do: 'record' }
  | { do: 'new' }
  /** In the picker: use the highlighted scheme, or go back to the default one. */
  | { do: 'use' }
  | { do: 'reset' }

export type Part =
  | { kind: 'text'; spans: Line }
  | {
      kind: 'button'
      /** The control's address; it starts with `~` so that no node's id can be it. */
      key: string
      /** The key that presses it while the pane has the focus (one digit or lowercase letter). */
      hotkey: string | null
      action: Action
      /** What is drawn on it. With a hotkey the engine draws `key: ` before it. */
      spans: Line
      /** Drawn quiet until the pointer or the focus is on it. */
      dim: boolean
    }

export function textPart(spans: Line): Part {
  return { kind: 'text', spans }
}

export function buttonPart(key: string, action: Action, spans: Line, o: { hotkey?: string; dim?: boolean } = {}): Part {
  return { kind: 'button', key, hotkey: o.hotkey ?? null, action, spans, dim: o.dim === true }
}

/** The columns a part takes: a plain button with a hotkey is drawn `key: label`. */
export function partWidth(p: Part): number {
  if (p.kind === 'text') return lineWidth(p.spans)
  return (p.hotkey === null ? 0 : strWidth(p.hotkey) + 2) + lineWidth(p.spans)
}

export function partsWidth(parts: readonly Part[]): number {
  return parts.reduce((sum, p) => sum + partWidth(p), 0)
}

/** The words a part says, for tests and for the name of a control: its label, hotkey first. */
export function partText(p: Part): string {
  const label = p.spans.map(s => s.text).join('')
  if (p.kind === 'text') return label
  return p.hotkey === null ? label : `${p.hotkey}: ${label}`
}
