// How each status looks: a one-column glyph (ASCII fallback for terminals that
// draw the ambiguous-width ones in two columns) and a color from the theme.

import type { DtStatus } from '../types'

const GLYPHS: Record<DtStatus, readonly [unicode: string, ascii: string]> = {
  adopted: ['✓', '+'],
  rejected: ['✗', 'x'],
  'no-diff': ['=', '='],
  'in-progress': ['◐', '~'],
  planned: ['○', 'o'],
  proposed: ['◌', '?'],
  withdrawn: ['⊘', '/'],
  superseded: ['⊘', '/'],
  deferred: ['‖', '"'],
}

export function glyphOf(status: DtStatus, ascii: boolean): string {
  return GLYPHS[status][ascii ? 1 : 0]
}

export type Tone = { color: string; dim: boolean }

const TONES: Record<DtStatus, Tone> = {
  adopted: { color: 'success', dim: false },
  rejected: { color: 'error', dim: false },
  'no-diff': { color: 'inactive', dim: false },
  'in-progress': { color: 'suggestion', dim: false },
  planned: { color: 'suggestion', dim: false },
  proposed: { color: 'suggestion', dim: true },
  withdrawn: { color: 'inactive', dim: true },
  superseded: { color: 'inactive', dim: true },
  deferred: { color: 'inactive', dim: true },
}

export function toneOf(status: DtStatus): Tone {
  return TONES[status]
}

/** Statuses whose rows are drawn dim: the matter is over or parked. */
export function isQuiet(status: DtStatus): boolean {
  return status === 'withdrawn' || status === 'superseded' || status === 'deferred' || status === 'rejected'
}

export const RULE = { unicode: '─', ascii: '-' } as const

/** The rail: the mainline drawn as the spine of a graph, with what was tried hanging off it. */
export const RAIL = {
  /** A step of the mainline; the head is the newest one adopted, a hollow one is still ahead. */
  step: { unicode: '●', ascii: '*' },
  head: { unicode: '◉', ascii: '@' },
  ahead: { unicode: '○', ascii: 'o' },
  /** The spine between two steps, solid once it is done and dashed where it leads on to a step still ahead. */
  solid: { unicode: '┃', ascii: '|' },
  dashed: { unicode: '╏', ascii: ':' },
  /** Where a branch leaves the spine, and the last one (the spine ends there when the step is the last). */
  fork: { unicode: '┠', ascii: '|' },
  forkEnd: { unicode: '┖', ascii: '`' },
  /** A branch of a branch. */
  elbow: { unicode: '╰', ascii: '`' },
  dash: { unicode: '─', ascii: '-' },
  /** Changed in the last 24 hours. */
  recent: { unicode: '•', ascii: '*' },
} as const

/** The lines that join the lane of a tree to the lane it was opened from, in the overview's graph. */
export const GRAPH = {
  across: { unicode: '━', ascii: '-' },
  /** Where a joining line turns down into its lane. */
  corner: { unicode: '┓', ascii: '+' },
  /** Where two lanes were opened from one step, the nearer one turns down. */
  tee: { unicode: '┳', ascii: '+' },
  /** A joining line passing over a lane. */
  cross: { unicode: '╋', ascii: '+' },
} as const

/** The box the details (and the other framed parts) sit in. */
export const FRAME = {
  tl: { unicode: '╭', ascii: '+' },
  tr: { unicode: '╮', ascii: '+' },
  bl: { unicode: '╰', ascii: '+' },
  br: { unicode: '╯', ascii: '+' },
  h: { unicode: '─', ascii: '-' },
  v: { unicode: '│', ascii: '|' },
} as const

/** Pick the unicode or the ascii form of a glyph pair. */
export function pick(pair: { readonly unicode: string; readonly ascii: string }, ascii: boolean): string {
  return ascii ? pair.ascii : pair.unicode
}

/** One colour per tree, in the order the trees are listed (the first is the mainline's). Statuses keep red and green to themselves. */
export const LANE_COLOURS = ['merged', 'planMode', 'claude', 'ide', 'warning', 'success'] as const

export function laneColour(position: number): string {
  return LANE_COLOURS[((position % LANE_COLOURS.length) + LANE_COLOURS.length) % LANE_COLOURS.length]!
}
export const BAR = { unicode: '█', ascii: '#' } as const

/** What the first column of a row can hold: the selection's bar, the recording dot. */
export const MARKS = {
  bar: { unicode: '▌', ascii: '>' },
  dot: { unicode: '●', ascii: '*' },
} as const

/** The theme colors the pane's structure uses (statuses have their own, above). */
export const COLORS = {
  /** The mainline: its spine in the margin and its label. */
  mainline: 'merged',
  /** The selected row: the bar's mark and the background behind the row. */
  mark: 'suggestion',
  selected: 'subtle',
} as const
