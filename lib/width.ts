// Display width of text in a terminal cell grid.
//
// CJK and fullwidth characters take two columns, combining marks none, and
// East Asian *ambiguous* characters (box drawing, ◐ ○ ⊘, …) take one: the
// assumption Claude Code's own layout makes, and Ghostty's. Everything that
// truncates, pads or wraps text in this mod goes through here; `drawable` / `plain`
// cut text down to what terminals with different width models count the same.

type Range = readonly [number, number]

// East Asian Wide / Fullwidth, plus emoji presentation.
const WIDE: readonly Range[] = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f320],
  [0x1f32d, 0x1f335],
  [0x1f337, 0x1f37c],
  [0x1f37e, 0x1f393],
  [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3],
  [0x1f3e0, 0x1f3f0],
  [0x1f3f4, 0x1f3f4],
  [0x1f3f8, 0x1f43e],
  [0x1f440, 0x1f440],
  [0x1f442, 0x1f4fc],
  [0x1f4ff, 0x1f53d],
  [0x1f54b, 0x1f54e],
  [0x1f550, 0x1f567],
  [0x1f57a, 0x1f57a],
  [0x1f595, 0x1f596],
  [0x1f5a4, 0x1f5a4],
  [0x1f5fb, 0x1f64f],
  [0x1f680, 0x1f6c5],
  [0x1f6cc, 0x1f6cc],
  [0x1f6d0, 0x1f6d2],
  [0x1f6d5, 0x1f6d7],
  [0x1f6dc, 0x1f6df],
  [0x1f6eb, 0x1f6ec],
  [0x1f6f4, 0x1f6fc],
  [0x1f7e0, 0x1f7eb],
  [0x1f90c, 0x1f93a],
  [0x1f93c, 0x1f945],
  [0x1f947, 0x1f9ff],
  [0x1fa70, 0x1faff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
]

// Combining marks and format characters: no cell of their own.
const ZERO: readonly Range[] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a],
  [0x0e47, 0x0e4e],
  [0x1160, 0x11ff],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff],
  [0xe0100, 0xe01ef],
]

function inRanges(cp: number, ranges: readonly Range[]): boolean {
  let lo = 0
  let hi = ranges.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = ranges[mid]!
    if (cp < r[0]) hi = mid - 1
    else if (cp > r[1]) lo = mid + 1
    else return true
  }
  return false
}

/** Columns one code point takes: 0, 1 or 2. */
export function charWidth(cp: number): 0 | 1 | 2 {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (cp < 0x300) return 1
  if (inRanges(cp, ZERO)) return 0
  if (inRanges(cp, WIDE)) return 2
  return 1
}

/** Columns a string takes. */
export function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch.codePointAt(0)!)
  return w
}

/**
 * Makes text safe to draw: no control characters (a stray escape sequence in a
 * stored title must not reach the terminal), no characters that reorder the text
 * around them (bidi overrides, line and paragraph separators), tabs as two spaces,
 * no carriage returns. Newlines stay; callers that want one line use `oneLine`.
 */
export function sanitize(s: string): string {
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    if (ch === '\n') out += ch
    else if (ch === '\t') out += '  '
    else if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) continue
    else if (cp === 0x2028 || cp === 0x2029 || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) continue
    // Half of a surrogate pair (a string cut in the middle of an emoji): a terminal would show U+FFFD.
    else if (cp >= 0xd800 && cp <= 0xdfff) continue
    else out += ch
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Text every terminal counts the same
// ---------------------------------------------------------------------------------------------
//
// Terminals and width tables disagree about a handful of things: whether an emoji followed by a
// variation selector, a zero-width joiner or a skin-tone modifier is one group of cells or several,
// how wide a flag is, and how wide an emoji is that the table is too old to know. Ghostty clusters
// graphemes by default (`grapheme-width-method = unicode`) and carries current Unicode data;
// Claude Code counts with a table of its own; tmux counts yet another way. When two of them count
// one line differently, a line that is one cell too long wraps at the edge of the screen and
// shears everything under it. So the pane does not draw such text: `drawable` turns it into text
// whose width is the same under every one of those models. The stored text is never changed.

// Emoji added in Unicode 12 or later (the last range takes in all of the Symbols and Pictographs Extended-A
// block, which began in Unicode 12). A width table older than the terminal's counts them as one cell, the
// terminal as two.
const NEWER_EMOJI: readonly Range[] = [
  [0x1f6d6, 0x1f6df],
  [0x1f6fb, 0x1f6fc],
  [0x1f7f0, 0x1f7f0],
  [0x1f90c, 0x1f90c],
  [0x1f972, 0x1f972],
  [0x1f977, 0x1f979],
  [0x1f9cc, 0x1f9cc],
  [0x1fa70, 0x1faff],
]

/** Draws nothing and has no width of its own, but changes how a terminal groups what is around it. */
function isInvisible(cp: number): boolean {
  return (
    cp === 0xad || // soft hyphen
    cp === 0x34f || // combining grapheme joiner
    cp === 0x61c || // Arabic letter mark
    (cp >= 0x180b && cp <= 0x180f) || // Mongolian variation selectors
    (cp >= 0x200b && cp <= 0x200f) || // zero-width space, joiners, direction marks
    (cp >= 0x2060 && cp <= 0x2064) || // word joiner, invisible operators
    (cp >= 0x206a && cp <= 0x206f) ||
    cp === 0x20e3 || // combining enclosing keycap
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors (text / emoji presentation)
    cp === 0xfeff ||
    (cp >= 0xfff9 && cp <= 0xfffb) ||
    (cp >= 0x1f3fb && cp <= 0x1f3ff) || // skin-tone modifiers
    (cp >= 0xe0000 && cp <= 0xe0fff) // tags (flag subdivisions), ideographic variation selectors
  )
}

/** What one code point is drawn as: itself, a stand-in, or nothing. */
function drawn(cp: number, ch: string): string {
  if (cp < 0x80) return ch
  if (cp >= 0xd800 && cp <= 0xdfff) return ''
  if (isInvisible(cp)) return ''
  // A flag is two regional indicators; without the pairing they are the letters of its country code.
  if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return String.fromCharCode(0x41 + cp - 0x1f1e6)
  if (inRanges(cp, NEWER_EMOJI)) return '?'
  return ch
}

/** Whether `drawable` would change or drop this code point (a command line shown for approval spells these out). */
export function isAltered(cp: number): boolean {
  return drawn(cp, String.fromCodePoint(cp)) !== String.fromCodePoint(cp)
}

/**
 * `s` as the pane draws it: variation selectors, joiners, skin-tone modifiers, keycap and tag
 * characters are dropped (❤️ → ❤, 👨‍👩‍👧 → 👨👩👧, 👍🏽 → 👍, 1️⃣ → 1), flags become their country code
 * (🇨🇳 → CN) and emoji newer than Unicode 12 become `?`. What is left is the same width counted
 * code point by code point, grapheme by grapheme, or by any width table that knows the base
 * characters.
 */
export function drawable(s: string): string {
  let out = ''
  for (const ch of s) out += drawn(ch.codePointAt(0)!, ch)
  return out
}

/** `oneLine(drawable(s))`: a stored string, ready to be laid out on one line. */
export function plain(s: string): string {
  return oneLine(drawable(s))
}

/**
 * Whether a code point draws as nothing, or as something other than itself (control, format and
 * separator characters, fillers, private use): a command line shown for approval spells these out.
 */
export function isHidden(cp: number): boolean {
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0xa0) ||
    cp === 0xad ||
    cp === 0x34f ||
    cp === 0x61c ||
    cp === 0x115f ||
    cp === 0x1160 ||
    cp === 0x1680 ||
    cp === 0x17b4 ||
    cp === 0x17b5 ||
    (cp >= 0x180b && cp <= 0x180f) ||
    (cp >= 0x2000 && cp <= 0x200f) ||
    (cp >= 0x2028 && cp <= 0x202f) ||
    (cp >= 0x205f && cp <= 0x206f) ||
    cp === 0x2800 ||
    cp === 0x3000 ||
    cp === 0x3164 ||
    (cp >= 0xd800 && cp <= 0xf8ff) ||
    (cp >= 0xfdd0 && cp <= 0xfdef) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    cp === 0xfeff ||
    cp === 0xffa0 ||
    (cp >= 0xfff0 && cp <= 0xffff) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3) ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0xe0000 && cp <= 0xe0fff) ||
    cp >= 0xf0000
  )
}

/** `sanitize`, with every run of whitespace (newlines too) folded to one space. */
export function oneLine(s: string): string {
  return sanitize(s).replace(/\s+/g, ' ').trim()
}

/** Cuts `s` to at most `max` columns, ending in `ell` when something was cut. */
export function truncate(s: string, max: number, ell = '…'): string {
  if (max <= 0) return ''
  if (strWidth(s) <= max) return s
  const ellW = strWidth(ell)
  if (max <= ellW) return ell === '' ? '' : truncateHard(ell, max)
  return truncateHard(s, max - ellW) + ell
}

/** The longest prefix of `s` that fits in `max` columns. */
function truncateHard(s: string, max: number): string {
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = charWidth(ch.codePointAt(0)!)
    if (w + cw > max) break
    out += ch
    w += cw
  }
  return out
}

export function padEnd(s: string, width: number): string {
  const gap = width - strWidth(s)
  return gap > 0 ? s + ' '.repeat(gap) : s
}

export function padStart(s: string, width: number): string {
  const gap = width - strWidth(s)
  return gap > 0 ? ' '.repeat(gap) + s : s
}

/**
 * `left` flush left, `right` flush right, exactly `width` columns. `left` is cut
 * (with an ellipsis) before `right` is touched; if `right` alone does not fit it
 * is cut instead.
 */
export function fit(left: string, right: string, width: number, gap = 1): string {
  if (width <= 0) return ''
  const rightW = strWidth(right)
  if (rightW >= width) return truncate(right, width)
  const room = width - rightW - (right === '' ? 0 : gap)
  const l = truncate(left, Math.max(0, room))
  return l + ' '.repeat(Math.max(0, width - strWidth(l) - rightW)) + right
}

type Token = { text: string; width: number; isSpace: boolean }

function tokenize(line: string): Token[] {
  const tokens: Token[] = []
  let word = ''
  let wordW = 0
  let spaces = ''
  const flushWord = () => {
    if (word !== '') tokens.push({ text: word, width: wordW, isSpace: false })
    word = ''
    wordW = 0
  }
  const flushSpaces = () => {
    if (spaces !== '') tokens.push({ text: spaces, width: spaces.length, isSpace: true })
    spaces = ''
  }
  for (const ch of line) {
    const cw = charWidth(ch.codePointAt(0)!)
    if (ch === ' ') {
      flushWord()
      spaces += ch
    } else if (cw === 2) {
      // Every wide character is its own break opportunity.
      flushSpaces()
      flushWord()
      tokens.push({ text: ch, width: 2, isSpace: false })
    } else if (cw === 0 && word === '' && tokens.length > 0 && !tokens[tokens.length - 1]!.isSpace) {
      // A combining mark right after a wide character belongs to it.
      const last = tokens[tokens.length - 1]!
      last.text += ch
    } else {
      flushSpaces()
      word += ch
      wordW += cw
    }
  }
  flushWord()
  flushSpaces()
  return tokens
}

function wrapLine(line: string, width: number): string[] {
  if (line === '') return ['']
  const out: string[] = []
  let cur = ''
  let curW = 0
  const push = () => {
    out.push(cur.replace(/ +$/, ''))
    cur = ''
    curW = 0
  }
  for (const tok of tokenize(line)) {
    if (tok.isSpace) {
      // Spaces never start a wrapped line, and never push one over the edge.
      if (curW === 0 && out.length > 0) continue
      if (curW + tok.width > width) {
        push()
        continue
      }
      cur += tok.text
      curW += tok.width
      continue
    }
    if (tok.width > width) {
      // A word wider than the line: break it by characters.
      for (const ch of tok.text) {
        const cw = charWidth(ch.codePointAt(0)!)
        if (curW + cw > width && curW > 0) push()
        cur += ch
        curW += cw
      }
      continue
    }
    if (curW + tok.width > width) push()
    cur += tok.text
    curW += tok.width
  }
  if (cur !== '' || out.length === 0) push()
  return out
}

/**
 * Wraps `s` to at most `width` columns per line: at spaces between words, and
 * between any two CJK characters. Newlines in `s` start new lines. The lines are what
 * `drawable(s)` is made of, because that is what gets drawn.
 */
export function wrap(s: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  for (const line of sanitize(drawable(s)).split('\n')) lines.push(...wrapLine(line, w))
  return lines
}
