// A line of the pane as data: a run of styled spans whose widths add up. The
// layout builds these, tests measure them, and the view turns each span into a
// `Text`. Nothing here knows about elements.

import { RULE } from './glyphs'
import { strWidth, truncate } from './width'

export type Span = {
  text: string
  /** A theme key (`success`, `error`, `inactive`, ...) or a raw color. */
  color?: string
  dim?: boolean
  bold?: boolean
  inverse?: boolean
}

export type Line = Span[]

export function sp(text: string, style: Omit<Span, 'text'> = {}): Span {
  return { text, ...style }
}

export function lineWidth(line: readonly Span[]): number {
  let w = 0
  for (const s of line) w += strWidth(s.text)
  return w
}

export function lineText(line: readonly Span[]): string {
  return line.map(s => s.text).join('')
}

/** `line` cut to at most `max` columns, ending in `…` when something was cut. */
export function truncateSpans(line: readonly Span[], max: number): Line {
  if (max <= 0) return []
  if (lineWidth(line) <= max) return [...line]
  const out: Line = []
  let used = 0
  const room = max - 1 // one column for the ellipsis
  let last: Span | undefined = line[0]
  for (const s of line) {
    const w = strWidth(s.text)
    if (used + w <= room) {
      out.push(s)
      used += w
      last = s
      continue
    }
    const part = truncate(s.text, room - used, '')
    if (part !== '') {
      out.push({ ...s, text: part })
      last = s
    }
    break
  }
  const { text: _text, ...style } = last ?? { text: '' }
  out.push({ ...style, text: '…' })
  return out
}

/**
 * `left` flush left and `right` flush right in exactly `width` columns; `left`
 * is cut (with an ellipsis) before `right` is touched. With nothing on the right
 * the line is not padded.
 */
export function fitSpans(left: readonly Span[], right: readonly Span[], width: number, gap = 1): Line {
  if (width <= 0) return []
  const rightW = lineWidth(right)
  if (rightW === 0) return truncateSpans(left, width)
  if (rightW >= width) return truncateSpans(right, width)
  const room = Math.max(0, width - rightW - gap)
  const l = truncateSpans(left, room)
  const pad = width - lineWidth(l) - rightW
  return [...l, { text: ' '.repeat(Math.max(0, pad)) }, ...right]
}

/** `line` padded with trailing spaces to `width` columns (cut first if wider). */
export function padSpans(line: readonly Span[], width: number): Line {
  const cut = truncateSpans(line, width)
  const gap = width - lineWidth(cut)
  return gap > 0 ? [...cut, { text: ' '.repeat(gap) }] : cut
}

/** A rule across `width` columns, with an optional label near its right end. */
export function ruleLine(width: number, ascii: boolean, label = ''): Line {
  if (width <= 0) return []
  const ch = ascii ? RULE.ascii : RULE.unicode
  const text = oneSpace(label)
  const labelW = strWidth(text)
  if (text === '' || labelW + 6 > width) return [{ text: ch.repeat(width), dim: true }]
  const tail = 2
  const head = width - labelW - 2 - tail
  return [
    { text: ch.repeat(head) + ' ', dim: true },
    { text, dim: true, bold: true },
    { text: ' ' + ch.repeat(tail), dim: true },
  ]
}

function oneSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Blank leading columns. */
export function indent(n: number): Span {
  return { text: ' '.repeat(Math.max(0, n)) }
}
