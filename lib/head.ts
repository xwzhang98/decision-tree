// The top of the pane: the strip (the project, one tab for each tree, the language switch), the line of
// state under it (how much there is, whether it is recording) and, for a tree that was opened from another,
// the line that says where it began.
//
//   notes-app   main ●   crdt-engine   cloud-first                        EN 中
//   9 decisions   mainline 5 steps                    ○ read only   recording in main   updated 15:28
//   ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge

import type { DtForkBase, DtLang, DtMode } from '../types'
import type { Part } from './bar'
import { buttonPart, partWidth, partsWidth, textPart } from './bar'
import { fmtClock } from './events'
import { MARKS, glyphOf, laneColour, pick } from './glyphs'
import { richSpans } from './highlight'
import { decisionsText, mainlineText, t, treesText } from './i18n'
import { QUIET, S } from './style'
import type { Line, Span } from './spans'
import { fitSpans, lineWidth, truncateSpans } from './spans'
import { whenOfName } from './versions'
import { plain, strWidth, truncate } from './width'

// ---------------------------------------------------------------- the strip

export type HeaderInput = {
  /** Columns the strip may use. */
  width: number
  lang: DtLang
  ascii: boolean
  /** The project's name. */
  title: string
  /** The trees of the project in the order they are listed; fewer than two draw no tabs. */
  trees: readonly string[]
  /** The tree the pane shows. */
  viewed: string
  /** The tree the project records into, when it records. */
  recording: string | null
  /** How many texts wait for their rendition in the other language. */
  translating: number
}

/** The columns the project's name keeps at the least, however narrow the pane. */
const MIN_NAME = 6
const TAB_GAP = 3
const MAIN_GAP = 2
/** The columns the viewed tab keeps when it is alone, before the count of translations next to the switch gives way. */
const ALONE_MIN = 8

/** `EN 中`: the language in use is bold and underlined, the other one quiet; each is a button. */
export function languageToggle(lang: DtLang): Part[] {
  const one = (code: DtLang, label: string): Part => {
    const on = lang === code
    return buttonPart(`~lang-${code}`, { do: 'lang', lang: code }, [S(label, on ? { color: 'text', bold: true, underline: true } : { color: 'inactive', dim: true })])
  }
  return [one('en', 'EN'), textPart([S('  ')]), one('zh', '中')]
}

function tabPart(name: string, o: { viewed: boolean; recording: boolean; ascii: boolean; cut: number }): Part {
  const label = o.cut > 0 ? truncate(name, o.cut) : name
  const spans: Span[] = [S(label, o.viewed ? { color: 'text', bold: true, underline: true } : { color: 'inactive', dim: true })]
  if (o.recording) spans.push(S(' '), S(pick(MARKS.dot, o.ascii), { color: 'success' }))
  return buttonPart(`~tab-${name}`, { do: 'tab', tree: name }, spans)
}

/**
 * The tabs that fit in `room` columns, as parts (buttons with a gap between): every tab when they fit,
 * else every tab with its name cut shorter, else the viewed one with as many of its neighbours as fit
 * and a `…` where the others are. Null when not even the viewed one fits in `aloneMin` columns.
 */
function tabs(h: HeaderInput, room: number, aloneMin: number): Part[] | null {
  const tab = (name: string, cut: number): Part => tabPart(name, { viewed: name === h.viewed, recording: name === h.recording, ascii: h.ascii, cut })
  const build = (cut: number): Part[] => h.trees.map(name => tab(name, cut))
  const widthOf = (parts: readonly Part[]) => partsWidth(parts) + TAB_GAP * Math.max(0, parts.length - 1)
  for (const cut of [0, 16, 12, 8]) {
    const all = build(cut)
    if (widthOf(all) <= room) return withGaps(all)
  }
  const all = build(12)
  const at = Math.max(0, h.trees.indexOf(h.viewed))
  const mark = 1 + TAB_GAP // a `…` and its gap
  const cost = (a: number, b: number) => widthOf(all.slice(a, b + 1)) + (a > 0 ? mark : 0) + (b < all.length - 1 ? mark : 0)
  if (cost(at, at) > room) {
    // not even the viewed tab with its neighbours' marks: it alone, cut to what is there
    const name = h.trees[at]!
    const cut = room - (name === h.recording ? 2 : 0)
    return cut >= aloneMin ? [tab(name, cut)] : null
  }
  let lo = at
  let hi = at
  // grow the window around the viewed tab, the newer side first
  for (;;) {
    if (hi + 1 < all.length && cost(lo, hi + 1) <= room) hi += 1
    else if (lo > 0 && cost(lo - 1, hi) <= room) lo -= 1
    else break
  }
  const parts = withGaps(all.slice(lo, hi + 1))
  const more = textPart([S('…', QUIET)])
  if (lo > 0) parts.unshift(more, textPart([S(' '.repeat(TAB_GAP))]))
  if (hi < all.length - 1) parts.push(textPart([S(' '.repeat(TAB_GAP))]), more)
  return parts
}

function withGaps(parts: readonly Part[]): Part[] {
  const out: Part[] = []
  parts.forEach((p, k) => {
    if (k > 0) out.push(textPart([S(' '.repeat(TAB_GAP))]))
    out.push(p)
  })
  return out
}

/**
 * The strip, `h.width` columns across: the name in bold, the tabs after it, and on the right the count of
 * texts being translated and the language switch. The name has the first claim on the room (cut to under
 * half of the strip); the tabs get what is left, then give up their length, then their neighbours of the
 * viewed one; the count of translations goes before the switch does.
 */
export function headerBar(h: HeaderInput): Part[] {
  const toggle = languageToggle(h.lang)
  const busy =
    h.translating > 0
      ? textPart([S(`${glyphOf('proposed', h.ascii)} ${t(h.lang, 'pane.translating', { n: h.translating })}`, { color: 'suggestion' })])
      : null
  const rights: Part[][] = busy === null ? [toggle] : [[busy, textPart([S('   ')]), ...toggle], toggle]
  const name = plain(h.title)
  const nameCap = Math.max(MIN_NAME, Math.floor(h.width * 0.45))
  const hasTabs = h.trees.length > 1

  for (const [k, right] of rights.entries()) {
    const rightW = partsWidth(right)
    const room = h.width - rightW - MAIN_GAP
    // the name in full or cut, then the tabs in what is left
    const shown = truncate(name, Math.min(nameCap, Math.max(0, room)))
    const nameW = name === '' ? 0 : strWidth(shown)
    if (name !== '' && nameW < Math.min(strWidth(name), MIN_NAME)) continue
    const left: Part[] = name === '' ? [] : [textPart([S(shown, { bold: true })])]
    if (hasTabs) {
      // (the count of translations is given up before the viewed tab is cut to a stump)
      const shownTabs = tabs(h, room - nameW - (nameW > 0 ? TAB_GAP : 0), k < rights.length - 1 ? ALONE_MIN : 3)
      if (shownTabs === null && k < rights.length - 1) continue
      if (shownTabs !== null) {
        if (nameW > 0) left.push(textPart([S(' '.repeat(TAB_GAP))]))
        left.push(...shownTabs)
      }
    }
    const pad = Math.max(MAIN_GAP, h.width - partsWidth(left) - rightW)
    return [...left, textPart([S(' '.repeat(pad))]), ...right]
  }
  // nothing else fits: the switch alone
  const bare = truncate(name, Math.max(0, h.width - partsWidth(toggle) - MAIN_GAP))
  const pad = Math.max(1, h.width - strWidth(bare) - partsWidth(toggle))
  return [...(bare === '' ? [] : [textPart([S(bare, { bold: true })])]), textPart([S(' '.repeat(pad))]), ...toggle]
}

// ---------------------------------------------------------------- the line of state

export type StateInput = {
  width: number
  lang: DtLang
  ascii: boolean
  mode: Exclude<DtMode, 'off'>
  /** Decisions that are not retracted, and the steps of the mainline. */
  count: number
  steps: number
  lastEventAt: string | null
  /** The pane shows a tree that is not the one recorded into. */
  readOnly: boolean
  /** The tree recorded into. */
  recording: string
}

/**
 * `9 decisions   mainline 5 steps          ● recording   updated 15:28`: what there is on the left, quiet; on the
 * right whether it is being recorded, which gives up the clock, then the tree it is recorded into, then its word.
 */
export function stateLine(s: StateInput): Line {
  const dot = pick(MARKS.dot, s.ascii)
  const ring = s.ascii ? 'o' : '○'
  const paused = s.mode === 'paused'
  const live = (word: string): Line => [S(dot, { color: paused ? 'warning' : 'success' }), S(' '), S(word, paused ? { color: 'warning' } : { color: 'success' })]
  const clock = fmtClock(s.lastEventAt)
  const updated: Line = clock === '' ? [] : [S('   ' + t(s.lang, 'pane.updated', { time: clock }), QUIET)]
  const state: Line = s.readOnly ? [S(ring, { color: 'inactive' }), S(' '), S(t(s.lang, 'pane.state.readOnly'), { color: 'inactive' })] : live(t(s.lang, paused ? 'pane.state.paused' : 'pane.state.recording'))
  const where: Line = s.readOnly
    ? paused
      ? [S('   '), ...live(t(s.lang, 'pane.state.paused'))]
      : [S('   ' + t(s.lang, 'pane.recordingIn', { tree: plain(s.recording) }), { color: 'success', dim: true })]
    : []
  const options: Line[] = []
  if (updated.length > 0) options.push([...state, ...where, ...updated])
  options.push([...state, ...where], state, [state[0]!])

  const full: Line = [S(decisionsText(s.lang, s.count), QUIET), S('   ', QUIET), S(mainlineText(s.lang, s.steps), QUIET)]
  const short: Line = [S(decisionsText(s.lang, s.count), QUIET)]
  for (const left of [full, short]) {
    for (const right of options) {
      if (lineWidth(left) + lineWidth(right) + MAIN_GAP <= s.width) return fitSpans(left, right, s.width, MAIN_GAP)
    }
  }
  return fitSpans(short, options[options.length - 1]!, s.width, MAIN_GAP)
}

/** The state line of the overview: how many trees there are, and whether the project is recording (and into which). */
export type OverviewStateInput = {
  width: number
  lang: DtLang
  ascii: boolean
  mode: Exclude<DtMode, 'off'>
  trees: number
  lastEventAt: string | null
  /** The tree recorded into. */
  recording: string
}

/** `3 trees          ● recording in main   updated 15:28`: the count on the left, the state on the right (the clock goes first when it is narrow). */
export function overviewStateLine(s: OverviewStateInput): Line {
  const dot = pick(MARKS.dot, s.ascii)
  const paused = s.mode === 'paused'
  const clock = fmtClock(s.lastEventAt)
  const head: Line = [S(dot, { color: paused ? 'warning' : 'success' }), S(' ')]
  const word = paused ? S(t(s.lang, 'pane.state.paused'), { color: 'warning' }) : S(t(s.lang, 'pane.recordingIn', { tree: plain(s.recording) }), { color: 'success' })
  const options: Line[] = []
  if (clock !== '') options.push([...head, word, S('   ' + t(s.lang, 'pane.updated', { time: clock }), QUIET)])
  options.push([...head, word])
  if (!paused) options.push([...head, S(t(s.lang, 'pane.state.recording'), { color: 'success' })])
  options.push([head[0]!])
  const left: Line = [S(treesText(s.lang, s.trees), QUIET)]
  for (const right of options) {
    if (lineWidth(left) + lineWidth(right) + MAIN_GAP <= s.width) return fitSpans(left, right, s.width, MAIN_GAP)
  }
  return fitSpans(left, options[options.length - 1]!, s.width, MAIN_GAP)
}

// ---------------------------------------------------------------- where a tree began

/**
 * `↳ main #5 (09-21)   CRDT text engine instead of paragraph merge`: the tree it was opened from, the version, the day
 * of it, and what the tree is for. `laneOf` gives the colour of a tree's lane; `mark` (`中` or `EN`) follows a title that
 * is still in the language it was written in because its rendition has not arrived.
 */
export function originLine(fork: DtForkBase & { title?: string }, o: { width: number; lang: DtLang; ascii: boolean; laneOf: (tree: string) => string; mark?: string | null }): Line {
  const line: Line = [S(o.ascii ? '>' : '↳', QUIET), S(' ')]
  if (fork.count === 0 || fork.at === null) {
    line.push(S(t(o.lang, 'tree.fromEmpty'), QUIET))
  } else {
    const day = whenOfName(fork.at).split(' ')[0] ?? ''
    line.push(S(plain(fork.tree), { color: o.laneOf(fork.tree) }), S(' '), S(`#${fork.count}`, { color: 'warning' }))
    if (day !== '') line.push(S(' '), S(`(${day})`, QUIET))
  }
  const title = fork.title === undefined ? '' : plain(fork.title)
  if (title !== '') {
    const mark = o.mark ?? null
    line.push(S('   '), ...(mark !== null ? [S(title, QUIET), S(' '), S(mark, QUIET)] : richSpans(title, { color: 'inactive', dim: true }, true)))
  }
  return truncateSpans(line, o.width)
}
