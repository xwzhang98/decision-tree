// What the pane looks like: the layout's blocks turned into elements. All the
// measuring is in layout.ts; here every block becomes a row of Text and Button,
// and every press is handed to the Runtime.
//
// Keys: a node's row is a Button keyed by the node's id; every other control
// has a key starting with `~`, which no id can (ids are lowercase letters,
// digits and hyphens).

import type { ElementTable, RenderElement, RenderInput } from 'claude-code'

import type { DtStatus } from '../types'
import { STATUSES } from './events'
import { glyphOf } from './glyphs'
import { statusLabel, t } from './i18n'
import type { Dollar } from './io'
import { GUTTER, layoutPane } from './layout'
import type { Block, FooterAction, FooterItem, FooterLine } from './layout'
import type { Runtime } from './runtime'
import { lineText } from './spans'
import type { Line, Span } from './spans'

export type PaneEvent = RenderInput<'Pane'>

/** Control keys start with this; a node's key is its id. */
export const CONTROL = '~'

export function isNodeKey(key: string): boolean {
  return key !== '' && !key.startsWith(CONTROL)
}

/** Rows a pane docked beside the transcript may use at most; inline it stays small. */
const INLINE_ROWS = 16
const MIN_ROWS = 6

type Style = { color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; inverse?: boolean }

function styleOf(s: Span): Style {
  const out: Style = {}
  if (s.color !== undefined) out.color = s.color
  if (s.bg !== undefined) out.backgroundColor = s.bg
  if (s.dim === true) out.dimColor = true
  if (s.bold === true) out.bold = true
  if (s.inverse === true) out.inverse = true
  return out
}

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

  const [model, ui, project, now, lang] = await Promise.all([
    $.state.model.read(),
    $.state.ui.read(),
    $.state.project.read(),
    $.state.now.read(),
    $.state.lang.read(),
  ])
  const ascii = project.config?.display.asciiGlyphs === true
  if (project.root === '') rt.repairSoon($) // the session's state was wiped (a /clear): put it back once this drawing is over

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
    statusInterval: project.config?.status?.intervalSec ?? null,
    canEdit,
    pin: e.props.placement !== 'inline',
  })

  // ---- pieces of a line

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

  // ---- the footer

  const actions: Record<FooterAction, () => Promise<unknown>> = {
    up: () => rt.move($, -1),
    down: () => rt.move($, 1),
    all: () => rt.setFilter($, 'all'),
    pending: () => rt.setFilter($, 'pending'),
    clean: () => rt.setFilter($, 'clean'),
    now: () => rt.toggleNow($),
    edit: () => rt.startEdit($),
  }

  const itemEl = (item: FooterItem): RenderElement => {
    switch (item.kind) {
      case 'text':
        return <Text dimColor>{item.text}</Text>
      case 'key':
        return (
          <Button key={CONTROL + item.action} hotkey={item.hotkey} plain onPress={run(actions[item.action])}>
            {item.active ? <Text bold>{item.label}</Text> : item.label}
          </Button>
        )
      case 'warn':
        return (
          <Button key={CONTROL + 'warnings'} plain dimColor={item.count === 0} onPress={run(() => rt.showWarnings($))}>
            {item.count > 0 ? <Text color="warning">{item.text}</Text> : item.text}
          </Button>
        )
    }
  }

  const footerEl = (line: FooterLine): RenderElement => {
    const parts: RenderElement[] = [<Text>{' '.repeat(GUTTER)}</Text>]
    line.items.forEach((item, k) => {
      if (k > 0) parts.push(<Text>{'  '}</Text>)
      parts.push(itemEl(item))
    })
    if (line.warn !== null) {
      parts.push(<Text>{' '.repeat(line.pad)}</Text>)
      parts.push(itemEl(line.warn))
    }
    return <Box flexDirection="row">{parts}</Box>
  }

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
      case 'allow':
        return (
          <Box paddingLeft={GUTTER}>
            <Button key={CONTROL + 'allow'} variant="primary" onPress={run(() => rt.approveStatus($, b.argv))}>
              {b.label}
            </Button>
          </Box>
        )
      case 'edit':
        return editEl(b)
      case 'footer':
        return footerEl(b.line)
    }
  }

  return <Box flexDirection="column">{layout.blocks.map(blockEl)}</Box>
}
