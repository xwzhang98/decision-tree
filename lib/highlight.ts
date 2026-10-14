// Syntax colour for the words of a decision, the way code is coloured: a few kinds of token, each one a theme key.
//
// The same kind of word always gets the same colour and nothing else is coloured, so the colours say something:
//   topic   the part of a title before its first colon        blue (the file names of the sources too)
//   num     a number with its unit: 99.5%, 5 s, 5,000, #9     yellow
//   term    a technical word: SQLite, CRDT, proto_b           cyan
//   quote   a quoted phrase                                   green
//   date    a date or a time                                  grey
// Everything is a theme key (never a hex); a colour scheme (palettes.ts) may recolour the keys when they are drawn.

import type { Span } from './spans'
import { drawable, sanitize, wrap } from './width'

export type Kind = 'topic' | 'num' | 'term' | 'quote' | 'date'

/** A stretch of text of one kind (null: plain). */
export type Run = { text: string; kind: Kind | null }

export const KIND_COLOUR: Readonly<Record<Kind, string>> = {
  topic: 'ide',
  num: 'warning',
  term: 'planMode',
  quote: 'success',
  date: 'inactive',
}

/** Who wrote a thing: the model in the colour of Claude, the person in plain text. */
export const ACTOR_COLOUR = { model: 'claude', user: 'text', gate: 'warning', import: 'inactive' } as const

// The text before the first colon of a title: short, with no quote in it, the colon followed by a space (or a full-width one).
const TOPIC = /^[^:：\n"“「`]{1,30}(?::(?=\s)|：)/u
const QUOTE = /"[^"\n]{1,80}"|“[^”\n]{1,80}”|「[^」\n]{1,80}」|`[^`\n]{1,80}`/gu
const DATE = /(?<![\d.])\d{2}-\d{2}(?!\d)|(?<![\d.])\d{1,2}:\d{2}(?!\d)/gu
// A number not inside a word or a version (v1.2, abc123), with the unit it carries.
const NUM = /(?<![\w.])#?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:\s?(?:%|KB|MB|GB|ms|秒|s(?![A-Za-z])))?/gu
// ALLCAPS, snake_case and camelCase words.
const TERM = /(?<![A-Za-z0-9_])(?:[A-Z]{2,}[A-Za-z0-9]*|[A-Za-z]+_[A-Za-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*)(?![A-Za-z0-9_])/gu

/** The kind of every UTF-16 unit of `text` (null: plain). The kinds are tried in order and the first to claim a stretch keeps it. */
export function kindsOf(text: string, topic = false): (Kind | null)[] {
  const kinds: (Kind | null)[] = new Array<Kind | null>(text.length).fill(null)
  const mark = (start: number, end: number, kind: Kind) => {
    for (let i = start; i < end; i++) if (kinds[i] !== null) return
    for (let i = start; i < end; i++) kinds[i] = kind
  }
  if (topic) {
    const m = TOPIC.exec(text)
    if (m !== null) mark(0, m[0].length, 'topic')
  }
  const rules: [RegExp, Kind][] = [
    [QUOTE, 'quote'],
    [DATE, 'date'],
    [NUM, 'num'],
    [TERM, 'term'],
  ]
  for (const [rx, kind] of rules) {
    for (const m of text.matchAll(rx)) mark(m.index, m.index + m[0].length, kind)
  }
  return kinds
}

function group(text: string, kinds: readonly (Kind | null)[]): Run[] {
  const runs: Run[] = []
  for (let i = 0; i < text.length; i++) {
    const kind = kinds[i] ?? null
    const last = runs[runs.length - 1]
    if (last !== undefined && last.kind === kind) last.text += text[i]!
    else runs.push({ text: text[i]!, kind })
  }
  return runs
}

/** `text` as runs of one kind each; `topic` colours the part before the first colon (for a title). */
export function runsOf(text: string, topic = false): Run[] {
  return group(text, kindsOf(text, topic))
}

/**
 * `wrap(text, width)` with each line as runs: a phrase cut by a line break keeps its colour on both lines.
 * (The kinds are found in the text as it is drawn, which is what `wrap` cuts up.)
 */
export function wrapRuns(text: string, width: number, topic = false): Run[][] {
  const base = sanitize(drawable(text))
  const kinds = kindsOf(base, topic)
  const out: Run[][] = []
  let pos = 0
  for (const line of wrap(text, width)) {
    if (line === '') {
      out.push([])
      continue
    }
    const at = base.indexOf(line, pos)
    if (at < 0 || base.slice(pos, at).trim() !== '') {
      // The wrap changed the text between the lines: colour this one on its own.
      out.push(runsOf(line))
      continue
    }
    out.push(group(line, kinds.slice(at, at + line.length)))
    pos = at + line.length
  }
  return out
}

/** The spans for some runs: `base` is the style of the plain ones, and the others add their colour to it (a date is always dim). */
export function runSpans(runs: readonly Run[], base: Omit<Span, 'text'> = {}): Span[] {
  return runs.map(({ text, kind }) => {
    if (kind === null) return { text, ...base }
    if (kind === 'date') return { text, ...base, color: KIND_COLOUR.date, dim: true }
    return { text, ...base, color: KIND_COLOUR[kind] }
  })
}

/** `text` as spans, coloured by kind. */
export function richSpans(text: string, base: Omit<Span, 'text'> = {}, topic = false): Span[] {
  return runSpans(runsOf(text, topic), base)
}
