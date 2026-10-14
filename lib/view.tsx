// What the pane looks like: the layout's blocks turned into elements. All the measuring is in layout.ts;
// here every block becomes a row of Text and Button, every colour goes through the colour scheme, and
// every press is handed to the Runtime.
//
// Keys: a node's row is a Button keyed by the node's id; every other control has a key starting with
// `~`, which no id can (ids are lowercase letters, digits and hyphens).

import type { ElementTable, RenderElement, RenderInput } from 'claude-code'

import type { DtStatus } from '../types'
import type { Action, Part } from './bar'
import { CONTROL, NEW_KEYS, schemeKey, stepKey, treeKey } from './bar'
import { STATUSES } from './events'
import { glyphOf } from './glyphs'
import { statusLabel, t } from './i18n'
import type { Dollar } from './io'
import { layoutPane } from './layout'
import type { Block } from './layout'
import { GUTTER, QUIET, S } from './style'
import { effectiveScheme, paintFor, schemeOf } from './palettes'
import type { Runtime } from './runtime'
import { lineText } from './spans'
import type { Line, Span } from './spans'

export type PaneEvent = RenderInput<'Pane'>

export { CONTROL }

export function isNodeKey(key: string): boolean {
  return key !== '' && !key.startsWith(CONTROL)
}

/** Rows a pane docked beside the transcript may use at most; inline it stays small. */
const INLINE_ROWS = 16
const MIN_ROWS = 6

type Style = { color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; underline?: boolean; inverse?: boolean }

/** A press handler that never lets a failure escape into the engine. */
function run(fn: () => Promise<unknown>): () => void {
  return () => {
    void fn().catch(() => undefined)
  }
}

/**
 * Draws the pane. `els` is the element table the hook got from `$.ui.resolve(e)` (it cannot be
 * asked for here: `$` stays in register.tsx); `$` is the Port, whose state reads subscribe the drawing.
 */
export async function drawPane($: Dollar, e: PaneEvent, els: ElementTable, rt: Runtime): Promise<RenderElement> {
  rt.seeViewport(e.viewport)
  const { Box, Text, Button } = els
  // The table `$.ui.resolve` hands out is completed to every element name: where a surface draws
  // no field (the mobile app today) `Input` and `Select` are still there, drawing nothing. So the
  // surface decides whether the form can be used, and the table only gives the constructors.
  const hasFields = e.surface !== 'mobile' && 'Input' in els && 'Select' in els
  const Input = hasFields ? els.Input : null
  const Select = hasFields ? els.Select : null
  const canEdit = Input !== null && Select !== null

  const [model, ui, project, now, lang, tm, trees, schemeId, translating] = await Promise.all([
    $.state.model.read(),
    $.state.ui.read(),
    $.state.project.read(),
    $.state.now.read(),
    $.state.lang.read(),
    $.state.tm.read(),
    $.state.trees.read(),
    $.state.scheme.read(),
    $.state.translating.read(),
  ])
  const ascii = project.config?.display.asciiGlyphs === true
  if (project.root === '') rt.repairSoon($) // the session's state was wiped (a /clear): put it back once this drawing is over

  // the accent colours the layout names are the theme's; the scheme in use turns them into its own. While the picker
  // of colours is open the pane is drawn in the scheme highlighted there: moving the highlight tries a scheme on.
  const paint = paintFor(effectiveScheme(schemeOf(ui.view === 'colors' && ui.pick !== null ? ui.pick : schemeId), e.surface))

  const bodyRows = e.props.scroll.bodyRows
  const rows = Math.max(MIN_ROWS, e.props.placement === 'inline' ? Math.min(bodyRows, INLINE_ROWS) : bodyRows)
  const layout = layoutPane({
    width: e.props.bodyColumns,
    rows,
    lang,
    ascii,
    nowMs: rt.nowMs > 0 ? rt.nowMs : Date.now(),
    project,
    model,
    ui,
    now,
    tm,
    trees,
    translating,
    statusInterval: project.config?.status?.intervalSec ?? null,
    canEdit,
    pin: e.props.placement !== 'inline',
    scheme: schemeId,
    surface: e.surface,
  })

  // ---- pieces of a line

  const styleOf = (s: Span): Style => {
    const out: Style = {}
    const color = s.fixed === true ? s.color : paint(s.color)
    const bg = s.fixed === true ? s.bg : paint(s.bg)
    if (color !== undefined) out.color = color
    if (bg !== undefined) out.backgroundColor = bg
    if (s.dim === true) out.dimColor = true
    if (s.bold === true) out.bold = true
    if (s.underline === true) out.underline = true
    if (s.inverse === true) out.inverse = true
    return out
  }

  const piece = (s: Span) => {
    const style = styleOf(s)
    return Object.keys(style).length === 0 ? s.text : <Text {...style}>{s.text}</Text>
  }

  /** The pieces of a line that show something: a span of no columns (the indent of a root) draws nothing. */
  const pieces = (line: Line) => line.filter(s => s.text !== '').map(piece)

  const lineEl = (line: Line): RenderElement => {
    const kids = pieces(line)
    return <Text wrap="truncate-end">{kids.length === 0 ? ' ' : kids}</Text>
  }

  // ---- what a press asks for

  const actionOf = (a: Action): (() => Promise<unknown>) => {
    switch (a.do) {
      case 'move':
        return () => rt.move($, a.by)
      case 'filter':
        return () => rt.setFilter($, a.filter)
      case 'now':
        return () => rt.toggleNow($)
      case 'edit':
        return () => rt.startEdit($)
      case 'warnings':
        return () => rt.showWarnings($)
      case 'lang':
        return () => rt.setLang($, a.lang)
      case 'tab':
        return () => rt.showTree($, a.tree)
      case 'cycle':
        return () => rt.cycleTree($, a.by)
      case 'overview':
        return () => rt.openOverview($)
      case 'back':
        return () => rt.back($)
      case 'open':
        return () => rt.openPicked($)
      case 'record':
        return () => rt.recordPicked($)
      case 'new':
        return () => rt.openNewTree($)
      case 'colors':
        return () => rt.openColors($)
      case 'use':
        return () => rt.useHighlighted($)
      case 'reset':
        return () => rt.resetColors($)
    }
  }

  // ---- a row of buttons and words (the strip, the keys)

  const partEl = (p: Part): RenderElement | null => {
    if (p.kind === 'text') {
      const kids = pieces(p.spans)
      return kids.length === 0 ? null : <Text>{kids}</Text>
    }
    const kids = pieces(p.spans)
    return (
      <Button key={p.key} {...(p.hotkey !== null ? { hotkey: p.hotkey } : {})} plain {...(p.dim ? { dimColor: true } : {})} onPress={run(actionOf(p.action))}>
        {kids}
      </Button>
    )
  }

  const barEl = (parts: readonly Part[]): RenderElement => (
    <Box flexDirection="row">{parts.map(partEl).filter((x): x is RenderElement => x !== null)}</Box>
  )

  // ---- the edit form

  const editEl = (b: Extract<Block, { kind: 'edit' }>): RenderElement => {
    const edit = ui.editing
    if (edit === null || edit.id !== b.id) return lineEl(b.title)
    const cancel = (
      <Button key={CONTROL + 'cancel'} onPress={run(() => rt.cancelEdit($))}>
        {t(lang, 'edit.cancel')}
      </Button>
    )
    if (Input === null || Select === null) {
      return (
        <Box flexDirection="column">
          {lineEl(b.title)}
          <Box flexDirection="column" paddingLeft={GUTTER}>
            <Text dimColor wrap="truncate-end">
              {t(lang, 'edit.mobile')}
            </Text>
            {cancel}
          </Box>
        </Box>
      )
    }
    const options = STATUSES.map((s: DtStatus) => ({ value: s, label: `${glyphOf(s, ascii)} ${statusLabel(lang, s)}` }))
    return (
      <Box flexDirection="column">
        {lineEl(b.title)}
        <Box flexDirection="column" paddingLeft={GUTTER}>
          <Select
            key={CONTROL + 'status'}
            label={t(lang, 'edit.status')}
            options={options}
            value={edit.status}
            onSelect={value => {
              void rt.editStatus($, value).catch(() => undefined)
            }}
          />
          <Input
            key={CONTROL + 'summary'}
            label={t(lang, 'edit.summary')}
            placeholder={t(lang, 'edit.summaryHint')}
            value={edit.summary}
            autoFocus
            onInput={value => {
              void rt.editSummary($, value).catch(() => undefined)
            }}
            onSubmit={value => {
              void rt.saveEdit($, { summary: value }).catch(() => undefined)
            }}
          />
          <Box flexDirection="row">
            <Button key={CONTROL + 'save'} variant="primary" onPress={run(() => rt.saveEdit($))}>
              {t(lang, 'edit.save')}
            </Button>
            <Text>{'  '}</Text>
            {cancel}
          </Box>
        </Box>
      </Box>
    )
  }

  // ---- the form for a new tree

  const newTreeEl = (b: Extract<Block, { kind: 'newtree' }>): RenderElement => {
    const form = ui.newTree
    if (form === null) return lineEl(b.title)
    const cancel = (
      <Button key={NEW_KEYS.cancel} onPress={run(() => rt.cancelNewTree($))}>
        {t(lang, 'edit.cancel')}
      </Button>
    )
    if (Input === null) {
      return (
        <Box flexDirection="column">
          {lineEl(b.title)}
          <Box flexDirection="column" paddingLeft={GUTTER}>
            <Text dimColor wrap="truncate-end">
              {t(lang, 'trees.new.mobile')}
            </Text>
            {cancel}
          </Box>
        </Box>
      )
    }
    const field = (key: string, name: 'name' | 'at' | 'title', label: string, hint: string, autoFocus: boolean) => (
      <Input
        key={key}
        label={label}
        placeholder={hint}
        value={form[name]}
        {...(autoFocus ? { autoFocus: true as const } : {})}
        onInput={value => {
          void rt.newTreeField($, name, value).catch(() => undefined)
        }}
        onSubmit={value => {
          void rt.createTree($, { [name]: value }).catch(() => undefined)
        }}
      />
    )
    // what went wrong, else what the tree will be
    const note: Line = form.error !== null ? [S(form.error, { color: 'error' })] : [S(t(lang, 'trees.new.recording'), QUIET)]
    return (
      <Box flexDirection="column">
        {lineEl(b.title)}
        <Box flexDirection="column" paddingLeft={GUTTER}>
          {field(NEW_KEYS.name, 'name', t(lang, 'trees.new.name'), t(lang, 'trees.new.nameHint'), true)}
          {field(NEW_KEYS.at, 'at', t(lang, 'trees.new.at'), t(lang, 'trees.new.atHint'), false)}
          {field(NEW_KEYS.title, 'title', t(lang, 'trees.new.label'), t(lang, 'trees.new.labelHint'), false)}
          {lineEl(note)}
          <Box flexDirection="row">
            <Button key={NEW_KEYS.create} variant="primary" onPress={run(() => rt.createTree($))}>
              {t(lang, 'trees.new.create')}
            </Button>
            <Text>{'  '}</Text>
            {cancel}
          </Box>
        </Box>
      </Box>
    )
  }

  // ---- one block

  const blockEl = (b: Block): RenderElement => {
    switch (b.kind) {
      case 'text':
      case 'rule':
        return lineEl(b.line)
      case 'row':
        return (
          <Button key={b.id} label={lineText(b.line).trim()} plain onPress={run(() => rt.press($, b.id))}>
            {pieces(b.line)}
          </Button>
        )
      case 'page':
        return (
          <Button key={CONTROL + 'page-' + b.dir} plain dimColor onPress={run(() => rt.move($, b.dir === 'up' ? -b.step : b.step))}>
            {lineText(b.line)}
          </Button>
        )
      case 'bar':
        return barEl(b.parts)
      case 'allow':
        return (
          <Box flexDirection="row">
            <Text>{pieces(b.left)}</Text>
            <Button key={CONTROL + 'allow'} variant="primary" onPress={run(() => rt.approveStatus($, b.argv))}>
              {b.label}
            </Button>
            <Text>{pieces(b.right)}</Text>
          </Box>
        )
      case 'edit':
        return editEl(b)
      case 'tree':
        return (
          <Button key={b.step !== null ? stepKey(b.tree, b.step) : treeKey(b.tree, b.part)} label={b.label} plain onPress={run(() => rt.pressTree($, b.tree, b.step))}>
            {pieces(b.line)}
          </Button>
        )
      case 'newtree':
        return newTreeEl(b)
      case 'scheme':
        return (
          <Button key={schemeKey(b.id)} label={b.label} plain onPress={run(() => rt.pressScheme($, b.id))}>
            {pieces(b.line)}
          </Button>
        )
    }
  }

  return <Box flexDirection="column">{layout.blocks.map(blockEl)}</Box>
}
