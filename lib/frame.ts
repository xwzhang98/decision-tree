// The frame a part of the pane sits in: a top border that carries a title on the left and a few words
// on the right, side borders around the content, a bottom border. Every line is exactly `width` columns.

import { FRAME, pick } from './glyphs'
import { QUIET, S } from './style'
import type { Line, Span } from './spans'
import { barLine, lineWidth, padSpans, truncateSpans } from './spans'

/** Columns the borders and the blank beside them take from the content of a framed row. */
export const FRAME_COLUMNS = 4

/** The columns of content a frame `width` wide holds. */
export function frameInner(width: number): number {
  return Math.max(1, width - FRAME_COLUMNS)
}

/**
 * `╭─ Details ────────────── ✓ adopted  model  10-01 ─╮`: the title (kept before anything else), the
 * right-hand words (given up when there is no room for them), and the border between.
 */
export function frameTop(width: number, o: { title: readonly Span[]; right?: readonly Span[]; ascii: boolean }): Line {
  const h = pick(FRAME.h, o.ascii)
  const corner = (c: string): Span => S(c, QUIET)
  const bar = (n: number): Span => S(h.repeat(Math.max(0, n)), QUIET)
  const title: Line = o.title.length === 0 ? [] : [S(' '), ...o.title, S(' ')]
  const right: Line = o.right === undefined || o.right.length === 0 ? [] : [S(' '), ...o.right, S(' ')]
  // corner, one dash, title, dashes, right, one dash, corner
  const fixed = 2 + 2
  const room = width - fixed
  let t = title
  let r = right
  if (lineWidth(t) + lineWidth(r) + 1 > room) r = []
  if (lineWidth(t) > room) t = truncateSpans(t, room)
  const fill = room - lineWidth(t) - lineWidth(r)
  return [corner(pick(FRAME.tl, o.ascii)), bar(1), ...t, bar(fill), ...r, bar(1), corner(pick(FRAME.tr, o.ascii))]
}

/** `│ content          │`, the content cut or padded to the width inside. */
export function frameRow(content: readonly Span[], width: number, ascii: boolean): Line {
  const v = S(pick(FRAME.v, ascii), QUIET)
  return [v, S(' '), ...padSpans(content, frameInner(width)), S(' '), v]
}

/** `│▌content░░░░░░░░░░░│`: a row of the frame with a band behind it and a bar in the first column inside, for the row picked in a list. */
export function frameBand(content: readonly Span[], width: number, ascii: boolean, o: { bg: string; bar: string; barColor: string }): Line {
  const v = S(pick(FRAME.v, ascii), QUIET)
  return [v, S(o.bar, { color: o.barColor, bg: o.bg }), ...barLine(padSpans(content, frameInner(width)), o.bg, frameInner(width)), S(' ', { bg: o.bg }), v]
}

/** `│                  │`. */
export function frameBlank(width: number, ascii: boolean): Line {
  return frameRow([], width, ascii)
}

/** The border at the bottom. */
export function frameBottom(width: number, ascii: boolean): Line {
  const h = pick(FRAME.h, ascii)
  return [S(pick(FRAME.bl, ascii), QUIET), S(h.repeat(Math.max(0, width - 2)), QUIET), S(pick(FRAME.br, ascii), QUIET)]
}

/** The two borders' columns on the left and the right of a row, for a part that draws its own content between them (a button). */
export function frameSides(width: number, contentWidth: number, ascii: boolean): { left: Line; right: Line } {
  const v = S(pick(FRAME.v, ascii), QUIET)
  const pad = Math.max(0, frameInner(width) - contentWidth)
  return { left: [v, S(' ')], right: [S(' '.repeat(pad + 1)), v] }
}
