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
export const BAR = { unicode: '█', ascii: '#' } as const
export const MAINLINE_SEP = { unicode: ' › ', ascii: ' > ' } as const

/** What the first column of a row can hold: the mainline's spine, the selection's bar, the recording dot. */
export const MARKS = {
  spine: { unicode: '▎', ascii: '|' },
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
