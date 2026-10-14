// Small things every part of the pane's layout needs: building a span, the margins of the pane, and
// the colours of the structure that are not the colours of a status.

import type { DtLang } from '../types'
import type { Line, Span } from './spans'
import { indent } from './spans'

/** A span that carries only the style fields that are set. */
export function S(text: string, style: Omit<Span, 'text'> = {}): Span {
  const out: Span = { text }
  if (style.color !== undefined) out.color = style.color
  if (style.bg !== undefined) out.bg = style.bg
  if (style.dim === true) out.dim = true
  if (style.bold === true) out.bold = true
  if (style.underline === true) out.underline = true
  if (style.inverse === true) out.inverse = true
  if (style.fixed === true) out.fixed = true
  return out
}

/** Columns before the content: the mark column (the selection's bar) and a blank. */
export const GUTTER = 2
/** Blank columns kept free at the right edge. */
export const EDGE = 1

/** The columns the content may use in a pane `width` wide. */
export function innerWidth(width: number): number {
  return Math.max(8, width - GUTTER - EDGE)
}

/** A line of the content, set in from the pane's edge by the gutter. */
export function lead(line: Line): Line {
  return [indent(GUTTER), ...line]
}

export function nonEmpty(s: string | undefined | null): s is string {
  return typeof s === 'string' && s !== ''
}

export function paren(lang: DtLang, s: string): string {
  return lang === 'zh' ? `（${s}）` : ` (${s})`
}

/** The look of the thin lines the structure is drawn with (the stubs of the branches, the frames, the rules). */
export const QUIET = { color: 'inactive', dim: true } as const
