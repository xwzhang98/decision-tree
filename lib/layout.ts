// The pane as data: every line it shows, worked out before anything is drawn.
//
// Nothing here draws. `layoutPane` takes the replayed tree, the session's view state and the room (columns,
// rows) and returns the blocks to draw, top to bottom; the view turns each into elements. Because it is
// pure, tests can check that no line is wider than the pane and that the rows add up.
//
//   notes-app   main ●   crdt-engine   cloud-first                       EN 中     the strip
//   9 decisions   mainline 5 steps                   ● recording   updated 15:28     the state
//
//   ●  Storage: SQLite with a write-ahead log                          09-14       the rail: the
//   ┠─ ✗ Keep JSON files and add a lock file                                       mainline, and what was
//   ┃                                                                              tried at each step
//   ◉  Sync: clients send operations, the server decides      •        09-21
//
//   ╭─ Details ─────────────────────────────── ✓ adopted  model  09-21 ─╮         the node selected
//   │ Sync: clients send operations, the server decides                  │
//   ╰────────────────────────────────────────────────────────────────────╯
//   k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees              l: 中       the keys

import type { DtLang, DtModel, DtNow, DtProject, DtTm, DtTreeInfo, DtUi } from '../types'
import type { Part } from './bar'
import { partsWidth, textPart } from './bar'
import { capLines, detailBadge, detailContent, detailTitle } from './detail'
import { FRAME_COLUMNS, frameBottom, frameInner, frameRow, frameSides, frameTop } from './frame'
import { footerItems, packBar } from './foot'
import { MAIN } from './events'
import { laneColour } from './glyphs'
import { headerBar, originLine, stateLine } from './head'
import { t } from './i18n'
import { localizeModel, markOf } from './lang'
import { nowBlock, resizeNotice } from './now'
import { layoutOverview } from './overview'
import { layoutColors } from './picker'
import { baseName } from './project'
import { indentPlan, railLine, spacerLine } from './rail'
import { AIRY_DETAIL_ROWS, AIRY_MIN_ROWS, EDIT_ROWS, NEWTREE_ROWS, ORIGIN_MIN_ROWS, SPACER_MIN_ROWS, footerLines } from './room'
import { EDGE, GUTTER, QUIET, S, innerWidth, lead } from './style'
import type { Line } from './spans'
import { lineWidth, ruleLine, truncateSpans } from './spans'
import { buildIndex, effectiveSelection, rowIndex, stepNodes, visibleRows, windowRows } from './tree'
import type { Row } from './tree'
import { plain, strWidth, wrap } from './width'

export { EDGE, GUTTER, innerWidth }

export type PaneInput = {
  width: number
  /** Rows the pane may take. */
  rows: number
  lang: DtLang
  ascii: boolean
  nowMs: number
  project: DtProject
  /** The model of the tree shown (as recorded: the layout puts its texts into the pane's language). */
  model: DtModel
  ui: DtUi
  now: DtNow
  /** What the texts of the trees read like in the other language. */
  tm: DtTm
  /** Every tree of the project, for the tabs. */
  trees: readonly DtTreeInfo[]
  /** How many texts wait for their rendition. */
  translating: number
  /** Refresh interval of the status command, or null when none is configured. */
  statusInterval: number | null
  /** False on a surface with no text field (mobile). */
  canEdit: boolean
  /** True when the pane has `rows` rows to itself (docked): the keys then stay on the last ones. */
  pin?: boolean
  /** The colour scheme in use (an id of palettes.ts); the picker marks it. */
  scheme?: string
  /** The surface that draws the pane (`terminal`, `desktop`, ...): the terminal's own colours are a terminal's. */
  surface?: string
}

export type Block =
  | { kind: 'text'; line: Line }
  | { kind: 'rule'; line: Line }
  | { kind: 'row'; id: string; line: Line; selected: boolean }
  | { kind: 'page'; dir: 'up' | 'down'; line: Line; step: number }
  /** A row of buttons and words: the strip at the top, the keys at the bottom. */
  | { kind: 'bar'; parts: Part[] }
  /** The button that allows the status command, between the sides of the frame it sits in. */
  | { kind: 'allow'; label: string; argv: readonly string[]; left: Line; right: Line }
  | { kind: 'edit'; id: string; title: Line }
  /**
   * A line of the overview that stands for a tree, drawn as a button: a step of the graph (`step` names it), or one
   * of the lines of the tree's entry in the list (`part` 0 is its first line, 1 its second). `label` says what the
   * line says in words, without the frame, the graph and the mark of the highlight (for whatever reads the button out).
   */
  | { kind: 'tree'; tree: string; step: string | null; part: 0 | 1; line: Line; selected: boolean; label: string }
  /** The form for a new tree, under its title; the fields are drawn from `ui.newTree`. */
  | { kind: 'newtree'; title: Line }
  /** A line of the picker of colours, drawn as a button: the scheme it stands for, and what it says in words (`label`). */
  | { kind: 'scheme'; id: string; line: Line; selected: boolean; label: string }

export type PaneLayout = {
  blocks: Block[]
  /** The node the pane treats as selected, or null. */
  selected: string | null
  /** Ids of the rows drawn, in order. */
  drawn: string[]
  /** Rows (blocks) used. */
  height: number
  /** The overview: the tree it highlights; the picker: the scheme it highlights. */
  picked: string | null
  /** The overview: the trees its list draws; the picker: the schemes. */
  listed: string[]
}

/** The row that says which filter is on is drawn from this many rows up. */
const CHIP_MIN_ROWS = 6
/** The columns a button takes beside its label: `[ ` and ` ]`. */
const ALLOW_COLUMNS = 4
const MIN_TREE = 4
/** The most rows of the rail the details give way for; a rail shorter than the room it has needs no more. */
const RAIL_ROWS = 12
/** The fewest lines of details worth drawing while the rail is short of room. */
const DETAIL_MIN = 6

export { AIRY_DETAIL_ROWS, AIRY_MIN_ROWS, EDIT_ROWS, NEWTREE_ROWS, ORIGIN_MIN_ROWS, SPACER_MIN_ROWS }

export function filterLabel(filter: DtUi['filter'], lang: DtLang): string {
  switch (filter) {
    case 'all':
      return t(lang, 'filter.all')
    case 'pending':
      return t(lang, 'filter.pending')
    case 'clean':
      return t(lang, 'filter.clean')
    default:
      return ''
  }
}

function emptyText(project: DtProject, lang: DtLang): string {
  if (project.configError !== null) return t(lang, 'pane.empty.config', { error: project.configError })
  return t(lang, 'pane.empty')
}

/** The rail's lines: every row, with the line of spine between two steps when it is wanted. */
type Entry = { kind: 'row'; row: Row; at: number } | { kind: 'spacer'; ahead: boolean }

/** Works out every block of the pane, top to bottom, in `width` columns and `rows` rows. */
export function layoutPane(i: PaneInput): PaneLayout {
  if (i.ui.view === 'colors') return layoutColors(i)
  if (i.ui.view === 'trees' && i.project.mode !== 'off') return layoutOverview(i)
  const width = Math.max(16, Math.floor(i.width))
  const rows = Math.max(3, Math.floor(i.rows))
  const inner = innerWidth(width)
  const { lang, ascii, project, ui } = i
  const blocks: Block[] = []
  const text = (line: Line) => blocks.push({ kind: 'text', line: lead(line) })
  const blank = () => blocks.push({ kind: 'text', line: [] })
  const bar = (parts: readonly Part[]) => blocks.push({ kind: 'bar', parts: [textPart([S(' '.repeat(GUTTER))]), ...parts] })

  // the tree shown and the one recorded into; the texts in the pane's language
  const viewed = ui.tree ?? project.tree
  const readOnly = viewed !== project.tree
  const { model, loc } = localizeModel(i.model, i.tm, lang)
  const names = i.trees.map(x => x.name)
  const laneOf = (tree: string) => laneColour(Math.max(0, names.indexOf(tree)))
  const titleText = project.config?.title ?? (project.root !== '' ? baseName(project.root) : '')

  bar(
    headerBar({
      width: inner,
      lang,
      ascii,
      title: titleText,
      trees: project.mode === 'off' ? [] : names,
      viewed,
      recording: project.mode === 'off' ? null : project.tree,
      translating: i.translating,
    }),
  )

  // not recording here: say how to start
  if (project.mode === 'off') {
    blank()
    const message = wrap(emptyText(project, lang), inner).map((l): Line => [S(l, { dim: project.configError === null })])
    for (const l of capLines(message, Math.max(1, rows - 2))) text(l)
    return { blocks, selected: null, drawn: [], height: blocks.length, picked: null, listed: [] }
  }

  const idx = buildIndex(model)
  const allRows = visibleRows(idx, { ui, nowMs: i.nowMs })
  const sel = effectiveSelection(idx, allRows, ui.selected)
  const selIndex = rowIndex(allRows, sel)
  const selRow = selIndex >= 0 ? allRows[selIndex]! : null

  const state = stateLine({
    width: inner,
    lang,
    ascii,
    mode: project.mode,
    count: model.nodes.filter(n => n.retracted === undefined).length,
    steps: stepNodes(idx).length,
    lastEventAt: model.lastEventAt,
    readOnly,
    recording: project.tree,
  })

  // pieces whose height is known before the rail gets what is left
  const hasNow = i.statusInterval !== null
  const keys = footerItems({
    lang,
    ascii,
    canEdit: i.canEdit && !readOnly,
    filter: ui.filter,
    hasNow,
    showNow: ui.showNow,
    trees: i.trees.length,
    warnings: model.warningCount,
  })
  const footer = packBar(keys.items, keys.right, inner, footerLines(rows))

  const editing = ui.editing !== null && !readOnly && selRow !== null && ui.editing.id === selRow.node.id ? ui.editing : null
  const frameW = inner
  const bodyW = frameInner(frameW)

  const nowAll = hasNow && ui.showNow ? nowBlock({ now: i.now, intervalSec: i.statusInterval ?? 30, nowMs: i.nowMs, width: bodyW, ascii, lang }) : null

  // where this tree began: when it was opened from another and the pane is not cramped
  const forkTitle = model.fork?.title
  const forkMark = forkTitle !== undefined && plain(forkTitle) !== '' && loc.waiting(forkTitle) ? markOf(forkTitle) : null
  const origin = model.fork !== null && viewed !== MAIN && rows >= ORIGIN_MIN_ROWS ? originLine(model.fork, { width: inner, lang, ascii, laneOf, mark: forkMark }) : null
  // a row between the strip and the rail; it says which filter is on
  // (a pane too short for the row has the filter's key in bold in the keys, and that is all it says)
  const chip = ui.filter === 'default' || rows < CHIP_MIN_ROWS ? '' : filterLabel(ui.filter, lang)

  // the rail keeps a useful height (page marks included) before the details are cut to make room
  const want = Math.min(allRows.length, Math.min(RAIL_ROWS, Math.max(MIN_TREE, Math.floor(rows * 0.35))))
  const nowCap = Math.max(3, Math.floor(rows * 0.35))
  const detailCap = Math.max(3, Math.floor(rows * 0.45))

  /**
   * The vertical budget: what the status block, the details and the rail each get of the rows. `airy` puts a blank
   * row under the strip (the chip of a filter takes that row when one is on), `roomy` one before the details and
   * one before the keys.
   */
  const plan = (airy: boolean, roomy: boolean) => {
    const base = 1 /* the strip */ + 1 /* the state */ + (origin === null ? 0 : 1) + (airy ? 1 : 0) + (roomy ? 1 : 0) /* before the keys */ + footer.length
    // a command waiting for approval is never cut: the person reads all of it or is not asked. Nor is it asked
    // when the button does not fit between the sides of the frame.
    const asking = nowAll?.needsApproval === true
    let allow = asking && strWidth(t(lang, 'now.allow')) + ALLOW_COLUMNS + FRAME_COLUMNS <= frameW
    // set when the command waiting for approval could not be shown whole: one line says so instead
    let resizeNote = asking && !allow
    let nowLines = nowAll === null ? [] : resizeNote ? [resizeNotice(lang, bodyW)] : nowAll.needsApproval ? nowAll.lines : capLines(nowAll.lines, nowCap)
    let nowTitle = nowAll?.title ?? []
    let nowRight = resizeNote ? [] : (nowAll?.right ?? [])
    const nowCostOf = () => (nowLines.length > 0 ? 2 + nowLines.length + (allow ? 1 : 0) : 0)
    let nowCost = nowCostOf()

    // a frame (top and bottom) around the lines, and the blank row above it
    const framed = (lines: number) => (lines > 0 ? 2 + lines + (roomy ? 1 : 0) : 0)

    // the details: with blank rows around them and between their parts when the whole still fits with the rail at a useful height
    let detailAll: Line[] = []
    if (selRow !== null && editing === null) {
      const input = { node: selRow.node, idx, width: bodyW, lang, ascii, loc }
      if (rows >= AIRY_DETAIL_ROWS) {
        const spaced = detailContent({ ...input, roomy: true })
        if (spaced.length + 2 <= detailCap && rows - base - nowCostOf() - framed(spaced.length + 2) >= want) detailAll = [[], ...spaced, []]
      }
      if (detailAll.length === 0) detailAll = detailContent(input)
    }

    const hasDetail = selRow !== null && (editing !== null || detailAll.length > 0)
    let detailRows = editing !== null ? EDIT_ROWS : Math.min(detailAll.length, detailCap)
    // the edit form is a rule and its rows
    const detailCost = () => (hasDetail && detailRows > 0 ? (editing !== null ? 1 + detailRows : framed(detailRows)) : 0)

    let treeRows = rows - base - nowCost - detailCost()
    if (treeRows < want && hasDetail && editing === null && detailRows > DETAIL_MIN) {
      detailRows = Math.max(DETAIL_MIN, detailRows - (want - treeRows))
      treeRows = rows - base - nowCost - detailCost()
    }
    // short of room: the details give way to the command waiting for approval; if even then it does
    // not fit whole, the button is not offered and the pane says why
    if ((allow || resizeNote) && treeRows < MIN_TREE && hasDetail && editing === null) {
      detailRows = 0
      treeRows = rows - base - nowCost - detailCost()
    }
    if (allow && treeRows < MIN_TREE) {
      allow = false
      resizeNote = true
      nowLines = [resizeNotice(lang, bodyW)]
      nowTitle = nowAll?.title ?? []
      nowRight = []
      nowCost = nowCostOf()
      treeRows = rows - base - nowCost - detailCost()
    }
    // short of room: the "now" block goes first (the notice that a command is waiting for the person's OK
    // is the last thing to go: it stays while the rail keeps two rows), then the details shrink, then go
    if (treeRows < (resizeNote ? 2 : MIN_TREE) && nowCost > 0) {
      nowCost = 0
      nowLines = []
      allow = false
      treeRows = rows - base - detailCost()
    }
    if (treeRows < MIN_TREE && hasDetail && editing === null && detailRows > 2) {
      detailRows = Math.max(2, detailRows - (MIN_TREE - treeRows))
      treeRows = rows - base - nowCost - detailCost()
    }
    if (treeRows < MIN_TREE && hasDetail && editing === null && detailRows > 0) {
      detailRows = 0
      treeRows = rows - base - nowCost - detailCost()
    }
    if (treeRows < 1) treeRows = 1
    return { airy, roomy, nowLines, nowTitle, nowRight, nowCost, allow, resizeNote, detailAll, hasDetail, detailRows, treeRows }
  }

  // Blank rows are for looks: when they would cost the command waiting for approval its place, they go.
  let budget = plan(chip !== '' || rows >= AIRY_MIN_ROWS, rows >= AIRY_MIN_ROWS)
  if (budget.resizeNote && (budget.roomy || (budget.airy && chip === ''))) {
    const lean = plan(chip !== '', false)
    if (!lean.resizeNote) budget = lean
  }
  const { airy, roomy, nowLines, nowTitle, nowRight, nowCost, allow, detailAll, hasDetail, detailRows, treeRows } = budget

  // ---- under the strip
  text(state)
  if (origin !== null) text(origin)
  if (airy) {
    if (chip !== '') text(truncateSpans([S(chip, { color: 'suggestion' })], inner))
    else blank()
  }

  // ---- the status, in a frame
  if (nowCost > 0) {
    blocks.push({ kind: 'text', line: lead(frameTop(frameW, { title: nowTitle, right: nowRight, ascii })) })
    for (const l of nowLines) text(frameRow(l, frameW, ascii))
    if (allow && nowAll !== null) {
      const label = t(lang, 'now.allow')
      const sides = frameSides(frameW, strWidth(label) + ALLOW_COLUMNS, ascii)
      blocks.push({ kind: 'allow', label, argv: nowAll.argv, left: lead(sides.left), right: sides.right })
    }
    text(frameBottom(frameW, ascii))
  }

  // ---- the rail
  const drawn: string[] = []
  if (allRows.length === 0) {
    const message = model.nodes.length === 0 ? t(lang, 'pane.noNodes') : t(lang, 'pane.noMatch')
    for (const l of wrap(message, inner).slice(0, Math.max(1, treeRows))) text([S(l, QUIET)])
  } else {
    const plan = indentPlan(allRows, width)
    // a line of spine between the steps, when the whole rail still fits with them
    const spaced = rows >= SPACER_MIN_ROWS && allRows.length + allRows.filter((r, k) => k > 0 && r.rail.step).length <= treeRows
    const entries: Entry[] = []
    allRows.forEach((row, at) => {
      if (spaced && at > 0 && row.rail.step) entries.push({ kind: 'spacer', ahead: allRows[at - 1]!.rail.ahead })
      entries.push({ kind: 'row', row, at })
    })
    const selEntry = entries.findIndex(e => e.kind === 'row' && e.at === selIndex)
    const marks = treeRows >= 5 // page rows only when they leave a useful window
    let count = treeRows
    let win = windowRows(entries.length, selEntry, null, count)
    for (let pass = 0; marks && pass < 3; pass++) {
      const usable = treeRows - (win.above > 0 ? 1 : 0) - (win.below > 0 ? 1 : 0)
      if (usable === count) break
      count = Math.max(1, usable)
      win = windowRows(entries.length, selEntry, null, count)
    }
    const shown = entries.slice(win.start, win.end)
    // a line of spine at either end of the window leads nowhere
    while (shown.length > 0 && shown[0]!.kind === 'spacer') shown.shift()
    while (shown.length > 0 && shown[shown.length - 1]!.kind === 'spacer') shown.pop()
    const rowsAbove = entries.slice(0, win.start).filter(e => e.kind === 'row').length
    const rowsBelow = entries.slice(win.end).filter(e => e.kind === 'row').length
    const mark = (up: boolean) => (ascii ? (up ? '^' : 'v') : up ? '▲' : '▼')
    if (marks && rowsAbove > 0) {
      const message = t(lang, 'pane.above', { n: rowsAbove }).replace('▲', mark(true))
      blocks.push({ kind: 'page', dir: 'up', step: count, line: lead(truncateSpans([S(message, QUIET)], inner)) })
    }
    for (const e of shown) {
      if (e.kind === 'spacer') {
        blocks.push({ kind: 'text', line: spacerLine(e.ahead, { ascii }) })
        continue
      }
      const n = e.row.node
      const selected = e.at === selIndex
      drawn.push(n.id)
      const shownTitle = plain(n.title) || t(lang, 'r.untitled')
      const waiting = plain(n.title) !== '' && loc.waiting(n.title)
      blocks.push({
        kind: 'row',
        id: n.id,
        selected,
        line: railLine(e.row, { width, selected, ascii, lang, nowMs: i.nowMs, title: shownTitle, mark: waiting ? markOf(n.title) : null, step: plan.step }),
      })
    }
    if (marks && rowsBelow > 0) {
      const message = t(lang, 'pane.below', { n: rowsBelow }).replace('▼', mark(false))
      blocks.push({ kind: 'page', dir: 'down', step: count, line: lead(truncateSpans([S(message, QUIET)], inner)) })
    }
  }

  // ---- the details, in a frame (or the edit form)
  if (hasDetail && detailRows > 0 && selRow !== null) {
    if (editing !== null) {
      blocks.push({ kind: 'rule', line: lead(ruleLine(inner, ascii)) })
      const title = truncateSpans([S(t(lang, 'edit.title', { id: selRow.node.id }), { bold: true })], inner)
      blocks.push({ kind: 'edit', id: selRow.node.id, title: lead(title) })
    } else {
      if (roomy) blank()
      blocks.push({ kind: 'text', line: lead(frameTop(frameW, { title: detailTitle(lang), right: detailBadge(selRow.node, { lang, ascii }), ascii })) })
      for (const l of capLines(detailAll, detailRows)) text(frameRow(l, frameW, ascii))
      text(frameBottom(frameW, ascii))
    }
  }

  // ---- the keys, on the last rows when the pane is all the person's to use
  const heightOf = (bs: readonly Block[]) => bs.reduce((sum, b) => sum + (b.kind === 'edit' ? EDIT_ROWS : 1), 0)
  if (i.pin === true) for (let k = rows - heightOf(blocks) - footer.length; k > 0; k--) blank()
  else if (roomy) blank()
  for (const line of footer) bar(line)

  return { blocks, selected: sel, drawn, height: heightOf(blocks), picked: null, listed: [] }
}

/** The columns a block takes, for tests: the width of a line, or of what a control draws. */
export function blockWidth(b: Block): number {
  switch (b.kind) {
    case 'text':
    case 'rule':
    case 'row':
    case 'page':
      return lineWidth(b.line)
    case 'bar':
      return partsWidth(b.parts)
    case 'allow':
      return lineWidth(b.left) + strWidth(b.label) + ALLOW_COLUMNS + lineWidth(b.right)
    case 'edit':
    case 'newtree':
      return lineWidth(b.title)
    case 'tree':
    case 'scheme':
      return lineWidth(b.line)
  }
}

/** The lines of a layout as plain text (controls as the words they draw), for tests and for the text version of the tree. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case 'text':
    case 'rule':
    case 'row':
    case 'page':
      return b.line.map(s => s.text).join('')
    case 'bar':
      return b.parts.map(p => (p.kind === 'text' ? p.spans.map(s => s.text).join('') : (p.hotkey === null ? '' : `${p.hotkey}: `) + p.spans.map(s => s.text).join(''))).join('')
    case 'allow':
      return [...b.left, S(`[ ${b.label} ]`), ...b.right].map(s => s.text).join('')
    case 'edit':
    case 'newtree':
      return b.title.map(s => s.text).join('')
    case 'tree':
    case 'scheme':
      return b.line.map(s => s.text).join('')
  }
}

