import { expect, test } from 'claude-code/testing'

import { AIRY_DETAIL_ROWS, AIRY_MIN_ROWS, EDGE, EDIT_ROWS, ORIGIN_MIN_ROWS, SPACER_MIN_ROWS, blockWidth, filterLabel, layoutPane } from '../lib/layout'
import type { Block, PaneInput, PaneLayout } from '../lib/layout'
import { lineText } from '../lib/spans'
import { drawable, strWidth } from '../lib/width'
import type { DtLang, DtNode } from '../types'
import { NOW, NOW_PENDING, TREES, noon, notesModel, notesTm, nowApproved, projectOf } from './notes'
import { SCENES, allowOf, check, input, rowsOf, textOf, ui } from './panes'

/** The pane drawn, and checked as every pane is. */
const draw = (over: Partial<PaneInput> = {}, label = 'pane'): PaneLayout => {
  const i = input(over)
  const layout = layoutPane(i)
  check(layout, i, label)
  return layout
}

/** The number in a mark of the rail that says how many rows are out of sight (`▲ 4 more above`); 0 when there is no mark. */
const pageCount = (layout: PaneLayout, dir: 'up' | 'down'): number => {
  const b = layout.blocks.find((x): x is Extract<Block, { kind: 'page' }> => x.kind === 'page' && x.dir === dir)
  return b === undefined ? 0 : Number(/\d+/.exec(lineText(b.line))![0])
}

const kinds = (layout: PaneLayout) => layout.blocks.map(b => b.kind)

// ---------------------------------------------------------------- whole panes

test('pane: 100 columns by 48 rows — the strip, the state, the rail with its spine, the details in a frame, the keys', () => {
  const layout = draw()
  expect(textOf(layoutPane(SCENES.main()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                                             EN  中',
    '  17 decisions   mainline 6 steps                                       ● recording   updated HH:MM',
    '',
    '  ●  Notes app: offline-first rewrite for the spring release                                09-02',
    '  ┠─ ‖ Desktop client: after the spring release',
    '  ┠─ ✓ Release bar: crash-free sessions above 99.5%                                               •',
    '  ┃',
    '  ●  Storage: SQLite with a write-ahead log, no more JSON files                             09-14',
    '  ┠─ ✗ Keep JSON files and add a lock file',
    '  ┃',
    '  ●  Sync: clients send operations, the server decides their order                          09-21',
    '  ┠─ ✗ CRDT text engine: too heavy for older phones',
    '  ┠─ ⊘ Compress operations before sending',
    '  ┃',
    '▌ ●  Conflicts: merge by paragraph, last edit wins for titles                               10-01 •',
    '  ┠─ = Merge window of 5 s instead of 10 s',
    '  ┠─ ✓ Show a banner when a note was merged',
    '  ┠─ ◐ Replay 200 recorded edit sessions through the merge                                        •',
    '  ┃  ╰─ ◌ Title conflicts: show both versions and let the person pick',
    '  ┃',
    '  ◉  Offline queue: at most 5,000 operations per note                                       10-06',
    '  ╏',
    '  ○  Beta to 500 testers once the soak test passes                                          10-06',
    '  ┠─ ○ Soak test: three older phones, one week offline',
    '  ┖─ ◌ Staged rollout: 5% first, then a quarter, then everyone',
    '',
    '  ╭─ Details ──────────────────────────────────────────────────────────  ✓ adopted  model  10-01 ─╮',
    '  │                                                                                               │',
    '  │ Conflicts: merge by paragraph, last edit wins for titles                                      │',
    '  │                                                                                               │',
    '  │ Body text merges by paragraph; titles and tags take the last edit. Replaying 200 recorded     │',
    '  │ edit sessions left 3 conflicts, all in titles.                                                │',
    '  │                                                                                               │',
    '  │ Rationale  A paragraph is the smallest unit people think of as "the thing I changed", so      │',
    '  │            merging by it surprises them least. The CRDT prototype made cold start 0.5 s       │',
    '  │            slower, more on phones three years old, and it only pays off when several people   │',
    '  │            edit one paragraph at once, which this release does not allow.                     │',
    '  │ Evidence   Paragraph merge (200 sessions)  3 left, all in titles  replay_a                    │',
    '  │            CRDT prototype                  cold start 2.4 s vs 1.9 s  proto_b                 │',
    '  │ Sources    docs/adr/0004-sync.md                                                              │',
    '  │            docs/design/merge-rules.md                                                         │',
    '  │            reports/merge_replay_20261001/RESULTS.md                                           │',
    '  │ Notes      10-04 user  Fine for now; revisit if titles start to conflict more often.          │',
    '  │                                                                                               │',
    '  ╰───────────────────────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree  c: colors               l: 中',
    '  h: hide rejected  a: all',
  ])
  // the strip first and the keys last, each a bar of buttons; the rail is a run of rows with the spine between
  expect(kinds(layout).slice(0, 2)).toEqual(['bar', 'text'])
  expect(kinds(layout).slice(-2)).toEqual(['bar', 'bar'])
  expect(rowsOf(layout).map(r => r.id)).toEqual(['n0', 'n12', 'n13', 'n1', 'n14', 'n2', 'n4', 'n11', 'n3', 'n5', 'n6', 'n7', 'n15', 'n16', 'n8', 'n9', 'n10'])
  expect(layout.drawn).toEqual(rowsOf(layout).map(r => r.id))
  expect(layout.selected).toBe('n3')
  expect(layout.height).toBe(48)
})

test('pane: the selected row is a bar the width of the pane; the others stop short of its edge', () => {
  const layout = draw()
  const rows = rowsOf(layout)
  const selected = rows.filter(r => r.selected)
  expect(selected.map(r => r.id)).toEqual(['n3'])
  expect(blockWidth(selected[0]!)).toBe(100)
  expect(selected[0]!.line.every(s => s.bg !== undefined)).toBe(true)
  for (const r of rows.filter(x => !x.selected)) {
    expect(blockWidth(r)).toBeLessThanOrEqual(100 - EDGE)
    expect(r.line.some(s => s.bg !== undefined)).toBe(false)
  }
})

test('pane: a status block comes under the state; the keys offer it with s', () => {
  const layout = draw(SCENES.now())
  expect(textOf(layoutPane(SCENES.now()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                 EN  中',
    '  17 decisions   mainline 6 steps           ● recording   updated HH:MM',
    '',
    '  ╭─ Now ─────────────────────────────────────────────────────────────╮',
    '  │ ALPHA    sync-bench s0  ████████░░  1700/2000  ~18:40  warming up │',
    '  │ BRAVO    merge-eval s1  █░░░░░░░░░   210/2000  ~07:25             │',
    '  │ CHARLIE  queue-soak s0  idle                                      │',
    '  │ Next  restore-test s1 (~05:05)                                    │',
    '  │ ! CHARLIE is idle                                                 │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '  ▲ 4 more above',
    '  ┠─ ✗ Keep JSON files and add a lock file',
    '  ●  Sync: clients send operations, the server decides their …  09-21',
    '  ┠─ ✗ CRDT text engine: too heavy for older phones',
    '  ┠─ ⊘ Compress operations before sending',
    '▌ ●  Conflicts: merge by paragraph, last edit wins for titles   10-01 •',
    '  ┠─ = Merge window of 5 s instead of 10 s',
    '  ┠─ ✓ Show a banner when a note was merged',
    '  ┠─ ◐ Replay 200 recorded edit sessions through the merge            •',
    '  ┃  ╰─ ◌ Title conflicts: show both versions and let the person pi…',
    '  ▼ 4 more below',
    '',
    '  ╭─ Details ──────────────────────────────  ✓ adopted  model  10-01 ─╮',
    '  │ Conflicts: merge by paragraph, last edit wins for titles          │',
    '  │ Body text merges by paragraph; titles and tags take the last      │',
    '  │ edit. Replaying 200 recorded edit sessions left 3 conflicts, all  │',
    '  │ in titles.                                                        │',
    '  │ Rationale  A paragraph is the smallest unit people think of as    │',
    '  │            "the thing I changed", so merging by it surprises them │',
    '  │ …                                                                 │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees            l: 中',
    '  o: next tree  c: colors  h: hide rejected  a: all  s: now',
  ])
  expect(layout.height).toBe(34)
  // without a status command there is no block and no key for it
  expect(textOf(draw({ ...SCENES.now(), statusInterval: null })).join('\n')).not.toContain('Now')
  expect(textOf(draw({ ...SCENES.now(), statusInterval: null })).join('\n')).not.toContain('s: now')
  // switched off by the person: no block, the key is still there to bring it back
  const hidden = textOf(draw({ ...SCENES.now(), ui: ui({ showNow: false }) })).join('\n')
  expect(hidden).not.toContain('╭─ Now')
  expect(hidden).toContain('s: now')
})

test('pane: a status command waiting for the person\'s OK is spelled out whole and has its button', () => {
  const layout = draw(SCENES.pending())
  expect(textOf(layoutPane(SCENES.pending()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                 EN  中',
    '  17 decisions   mainline 6 steps           ● recording   updated HH:MM',
    '',
    '  ╭─ Now ─────────────────────────────────────────────────────────────╮',
    '  │ The status command wants to run in this project:                  │',
    '  │   bash scripts/status.sh                                          │',
    '  │ It runs on your machine, in the project folder, every 30 s while  │',
    '  │ this pane is open.                                                │',
    '  │ [ Allow ]                                                         │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '  ▲ 5 more above',
    '  ●  Sync: clients send operations, the server decides their …  09-21',
    '  ┠─ ✗ CRDT text engine: too heavy for older phones',
    '  ┠─ ⊘ Compress operations before sending',
    '▌ ●  Conflicts: merge by paragraph, last edit wins for titles   10-01 •',
    '  ┠─ = Merge window of 5 s instead of 10 s',
    '  ┠─ ✓ Show a banner when a note was merged',
    '  ▼ 6 more below',
    '',
    '  ╭─ Details ──────────────────────────────  ✓ adopted  model  10-01 ─╮',
    '  │ Conflicts: merge by paragraph, last edit wins for titles          │',
    '  │ Body text merges by paragraph; titles and tags take the last      │',
    '  │ edit. Replaying 200 recorded edit sessions left 3 conflicts, all  │',
    '  │ in titles.                                                        │',
    '  │ Rationale  A paragraph is the smallest unit people think of as    │',
    '  │ …                                                                 │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees            l: 中',
    '  o: next tree  c: colors  h: hide rejected  a: all  s: now',
  ])
  const allow = allowOf(layout)!
  expect(allow.label).toBe('Allow')
  expect(allow.argv).toEqual(['bash', 'scripts/status.sh'])
  expect(layout.height).toBe(30)
})

test('pane: a tree looked at that is not the one recorded into is read only, and says where it began', () => {
  const layout = draw(SCENES.crdt())
  expect(textOf(layoutPane(SCENES.crdt()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                         EN  中',
    '  9 decisions   mainline 5 steps                ○ read only   recording in main',
    '  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge',
    '',
    '  ●  Notes app: offline-first rewrite for the spring release            09-02',
    '  ┃',
    '  ●  Storage: SQLite with a write-ahead log, no more JSON files         09-14',
    '  ┠─ ✗ Keep JSON files and add a lock file',
    '  ┃',
    '  ●  Sync: clients send operations, the server decides their order      09-21',
    '  ┃',
    '  ◉  CRDT text engine: merge by character, no conflict screen           09-28',
    '  ┠─ ✓ Tombstones: compact once a week',
    '▌ ┠─ ◐ Prototype on three older phones                                        •',
    '  ┃  ╰─ ◌ Fallback: paragraph merge for notes over 50 KB                      •',
    '  ╏',
    '  ○  Keep it only if cold start stays under 2 s                         10-07',
    '',
    '  ╭─ Details ──────────────────────────────────  ◐ in progress  model  10-07 ─╮',
    '  │ Prototype on three older phones                                           │',
    '  │ The prototype runs on three phones that are three years old: cold start   │',
    '  │ takes 2.4 s with the CRDT engine against 1.9 s with paragraph merge.      │',
    '  │ Rationale  Merging by character removes the conflict screen, but it only  │',
    '  │            pays off if cold start stays inside the 2 s budget on older    │',
    '  │            phones, and the first numbers say it does not yet. Compacting  │',
    '  │            tombstones weekly is already in; trimming the index that loads │',
    '  │            at start is next.                                              │',
    '  │ Evidence   Cold start, CRDT engine      2.4 s on 3 phones  proto_c        │',
    '  │            Cold start, paragraph merge  1.9 s  proto_b                    │',
    '  │ Sources    docs/design/crdt-prototype.md                                  │',
    '  │            reports/crdt_cold_start_20261007/RESULTS.md                    │',
    '  │ Notes      10-07 model  Trimming the index is the next experiment.        │',
    '  ╰───────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  p: pending  t: trees  o: next tree  c: colors    l: 中',
    '  h: hide rejected  a: all',
  ])
  // no edit key, though the pane could edit
  expect(textOf(layout).join('\n')).not.toContain('e: edit')
  expect(textOf(draw({ ...SCENES.crdt(), ui: ui({ tree: null, selected: 'x3' }), model: notesModel('en') })).join('\n')).toContain('e: edit')
  // a form open on a node of a tree that is only looked at is not drawn
  const editing = draw({ ...SCENES.crdt(), ui: ui({ tree: 'crdt-engine', selected: 'x3', editing: { id: 'x3', status: 'adopted', summary: '' } }) })
  expect(kinds(editing)).not.toContain('edit')
  expect(textOf(editing).join('\n')).toContain('╭─ Details')
})

test('pane: a filter says so under the state, and the rail holds only what it lets through', () => {
  const layout = draw(SCENES.pendingOnly())
  expect(textOf(layoutPane(SCENES.pendingOnly()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                             EN  中',
    '  17 decisions   mainline 6 steps                       ● recording   updated HH:MM',
    '  pending only',
    '  ●  Notes app: offline-first rewrite for the spring release                09-02',
    '  ●  Storage: SQLite with a write-ahead log, no more JSON files             09-14',
    '  ●  Sync: clients send operations, the server decides their order          09-21',
    '  ●  Conflicts: merge by paragraph, last edit wins for titles               10-01 •',
    '  ┠─ ◐ Replay 200 recorded edit sessions through the merge                        •',
    '  ┃  ╰─ ◌ Title conflicts: show both versions and let the person pick',
    '  ◉  Offline queue: at most 5,000 operations per note                       10-06',
    '▌ ○  Beta to 500 testers once the soak test passes                          10-06',
    '  ┠─ ○ Soak test: three older phones, one week offline',
    '  ┖─ ◌ Staged rollout: 5% first, then a quarter, then everyone',
    '',
    '  ╭─ Details ──────────────────────────────────────────  ○ planned  model  10-06 ─╮',
    '  │                                                                               │',
    '  │ Beta to 500 testers once the soak test passes                                 │',
    '  │                                                                               │',
    '  ╰───────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree          l: 中',
    '  c: colors  h: hide rejected  a: all',
  ])
  expect(layout.selected).toBe('n8')
  expect(filterLabel('default', 'en')).toBe('')
  expect(filterLabel('pending', 'en')).toBe('pending only')
  expect(filterLabel('clean', 'en')).toBe('rejected hidden')
  expect(filterLabel('all', 'en')).toBe('showing everything')
  expect(filterLabel('pending', 'zh')).toBe('只看 pending')
  // the chip is there on a small pane too, in the place of the blank row
  const small = textOf(draw({ rows: 12, ui: ui({ filter: 'pending', selected: 'n8' }) }, 'small'))
  expect(small[2]).toBe('  pending only')
  // and nothing left to show says so
  const none = draw({ model: { ...notesModel('en'), nodes: notesModel('en').nodes.filter(n => n.status === 'adopted') }, ui: ui({ filter: 'pending', selected: null }) })
  expect(textOf(none).slice(2, 4)).toEqual(['  pending only', '  Nothing matches this filter. Press a to show everything.'])
  expect(none.drawn).toEqual([])
  expect(none.selected).toBe(null)
})

test('pane: in Chinese the words of the chrome are Chinese and the terms of the trade stay English', () => {
  const layout = draw(SCENES.zh())
  expect(textOf(layoutPane(SCENES.zh()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                 EN  中',
    '  17 个决定   mainline 6 steps                    ● 记录中   HH:MM 更新',
    '',
    '  ▲ 上面还有 4 行',
    '  ┠─ ✗ 继续用 JSON 文件，加一个锁文件',
    '  ●  同步：客户端发操作，由服务器决定顺序                       09-21',
    '  ┠─ ✗ CRDT 文本引擎：旧手机上太重',
    '  ┠─ ⊘ 发送前压缩操作',
    '▌ ●  冲突：按段落合并，标题以最后一次编辑为准                   10-01 •',
    '  ┠─ = 合并窗口用 5 秒，不用 10 秒',
    '  ┠─ ✓ 笔记被合并时给出提示条',
    '  ┠─ ◐ 把录下的 200 次编辑会话回放给合并逻辑                          •',
    '  ▼ 下面还有 5 行',
    '',
    '  ╭─ Details ──────────────────────────────  ✓ adopted  model  10-01 ─╮',
    '  │ 冲突：按段落合并，标题以最后一次编辑为准                          │',
    '  │ 正文按段落合并，标题和标签以最后一次编辑为准；回放 200 次真实编辑 │',
    '  │ 会话后只剩 3 处冲突，都在标题上。                                 │',
    '  │ Rationale  段落是用户理解"我改了哪里"的最小单位，按它合并最不让人 │',
    '  │            意外。CRDT 原型的冷启动慢 0.5 秒，在三年前的手机上更明 │',
    '  │            显，而收益只在多人同时编辑同一段时才有，这个版本没有这 │',
    '  │            个场景。                                               │',
    '  │ Evidence   按段落合并（200 次会话）  剩 3 处，都在标题  replay_a  │',
    '  │            CRDT 原型                 冷启动 2.4 秒，对比 1.9 秒   │',
    '  │ Sources    docs/adr/0004-sync.md                                  │',
    '  │ …                                                                 │',
    '  ╰───────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: 展开  e: 编辑  p: pending  t: 总览               l: EN',
    '  o: 下个 tree  c: 配色  h: 隐藏 rejected  a: 全部',
  ])
  expect(layout.height).toBe(30)
})

test('pane: in ASCII every glyph of the structure is plain, down to the arrows of the keys', () => {
  const layout = draw(SCENES.ascii())
  expect(textOf(layoutPane(SCENES.ascii()))).toEqual([
    '  notes-app   main *   crdt-en…   cloud-f…       EN  中',
    '  17 decisions   mainline 6 steps           * recording',
    '',
    '  ^ 5 more above',
    '  *  Sync: clients send operations, the serve…  09-21',
    '  |- x CRDT text engine: too heavy for older phones',
    '  |- / Compress operations before sending',
    '> *  Conflicts: merge by paragraph, last edit…  10-01 *',
    '  |- = Merge window of 5 s instead of 10 s',
    '  |- + Show a banner when a note was merged',
    '  v 6 more below',
    '',
    '  +- Details --------------  + adopted  model  10-01 -+',
    '  | Conflicts: merge by paragraph, last edit wins for |',
    '  | titles                                            |',
    '  | Body text merges by paragraph; titles and tags    |',
    '  | take the last edit. Replaying 200 recorded edit   |',
    '  | sessions left 3 conflicts, all in titles.         |',
    '  | …                                                 |',
    '  +---------------------------------------------------+',
    '',
    '  k: up  j: down  Enter: expand  e: edit          l: 中',
    '  p: pending  t: trees  o: next tree  c: colors',
    '  h: hide rejected  a: all',
  ])
  const t = textOf(layout).join('\n')
  for (const glyph of ['●', '┠', '┃', '╭', '│', '▲', '▼', '✓', '✗', '⏎', '↑', '↓']) expect(t).not.toContain(glyph)
})

test('pane: texts still in the language they were written in are marked, and the strip counts what waits for its rendition', () => {
  const layout = draw(SCENES.waiting())
  expect(textOf(layoutPane(SCENES.waiting()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first          ◌ translating 14   EN  中',
    '  17 decisions   mainline 6 steps                       ● recording   updated HH:MM',
    '',
    '  ▲ 5 more above',
    '  ●  同步：客户端发操作，由服务器决定顺序 中                                09-21',
    '  ┠─ ✗ CRDT 文本引擎：旧手机上太重 中',
    '  ┠─ ⊘ 发送前压缩操作 中',
    '▌ ●  冲突：按段落合并，标题以最后一次编辑为准 中                            10-01 •',
    '  ┠─ = 合并窗口用 5 秒，不用 10 秒 中',
    '  ┠─ ✓ 笔记被合并时给出提示条 中',
    '  ┠─ ◐ 把录下的 200 次编辑会话回放给合并逻辑 中                                   •',
    '  ▼ 5 more below',
    '',
    '  ╭─ Details ──────────────────────────────────────────  ✓ adopted  model  10-01 ─╮',
    '  │ 冲突：按段落合并，标题以最后一次编辑为准 中                                   │',
    '  │ 正文按段落合并，标题和标签以最后一次编辑为准；回放 200 次真实编辑会话后只剩 3 │',
    '  │ 处冲突，都在标题上。                                                          │',
    '  │ Rationale  段落是用户理解"我改了哪里"的最小单位，按它合并最不让人意外。CRDT   │',
    '  │            原型的冷启动慢 0.5 秒，在三年前的手机上更明显，而收益只在多人同时  │',
    '  │            编辑同一段时才有，这个版本没有这个场景。                           │',
    '  │ Evidence   按段落合并（200 次会话）  剩 3 处，都在标题  replay_a              │',
    '  │ …                                                                             │',
    '  ╰───────────────────────────────────────────────────────────────────────────────╯',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree          l: 中',
    '  c: colors  h: hide rejected  a: all',
  ])
  const rows = rowsOf(layout)
  expect(rows.length).toBeGreaterThan(3)
  expect(rows.every(r => lineText(r.line).includes(' 中'))).toBe(true)
  // the renditions, once they are in the memory, take the marks away
  const done = draw({ ...SCENES.waiting(), tm: notesTm('zh'), translating: 0 })
  expect(textOf(done).join('\n')).not.toContain('中 ')
  expect(rowsOf(done).some(r => lineText(r.line).includes('中'))).toBe(false)
  expect(textOf(done).join('\n')).toContain('Conflicts: merge by paragraph, last edit wins for titles')
  // (the switches in the strip and in the keys name the other language in its own script)
  expect(/\p{Script=Han}/u.test(textOf(done).slice(1, -2).join('\n'))).toBe(false)
  // text that is English in an English pane is not waiting for anything
  expect(rowsOf(draw({ tm: { en: {}, zh: {} } })).some(r => lineText(r.line).includes(' EN'))).toBe(false)
})

test('pane: the form for editing replaces the details and takes four rows', () => {
  const layout = draw(SCENES.editing())
  expect(textOf(layoutPane(SCENES.editing()))).toEqual([
    '  notes-app   main ●   crdt-engine   cloud-first                             EN  中',
    '  17 decisions   mainline 6 steps                       ● recording   updated HH:MM',
    '',
    '  ▲ 2 more above',
    '  ┠─ ✓ Release bar: crash-free sessions above 99.5%                               •',
    '  ●  Storage: SQLite with a write-ahead log, no more JSON files             09-14',
    '  ┠─ ✗ Keep JSON files and add a lock file',
    '  ●  Sync: clients send operations, the server decides their order          09-21',
    '  ┠─ ✗ CRDT text engine: too heavy for older phones',
    '  ┠─ ⊘ Compress operations before sending',
    '▌ ●  Conflicts: merge by paragraph, last edit wins for titles               10-01 •',
    '  ┠─ = Merge window of 5 s instead of 10 s',
    '  ┠─ ✓ Show a banner when a note was merged',
    '  ┠─ ◐ Replay 200 recorded edit sessions through the merge                        •',
    '  ┃  ╰─ ◌ Title conflicts: show both versions and let the person pick',
    '  ◉  Offline queue: at most 5,000 operations per note                       10-06',
    '  ○  Beta to 500 testers once the soak test passes                          10-06',
    '  ▼ 2 more below',
    '  ─────────────────────────────────────────────────────────────────────────────────',
    '  Edit n3',
    '',
    '  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree          l: 中',
    '  c: colors  h: hide rejected  a: all',
  ])
  expect(EDIT_ROWS).toBe(4)
  const at = kinds(layout).indexOf('edit')
  expect(at).toBeGreaterThan(0)
  expect(kinds(layout)[at - 1]).toBe('rule')
  const edit = layout.blocks[at] as Extract<Block, { kind: 'edit' }>
  expect(edit.id).toBe('n3')
  expect(lineText(edit.title)).toBe('  Edit n3')
  expect(layout.height).toBe(layout.blocks.length + EDIT_ROWS - 1)
  expect(layout.height).toBeLessThanOrEqual(26)
  expect(textOf(layout).join('\n')).not.toContain('╭─ Details')
  // a form for another node than the selected one is not drawn
  expect(kinds(draw({ ...SCENES.editing(), ui: ui({ editing: { id: 'n5', status: 'adopted', summary: '' } }) }))).not.toContain('edit')
})

// ---------------------------------------------------------------- when the project does not record

test('pane: a project that does not record says how to start; one whose record cannot be read says why', () => {
  const off = draw({ project: projectOf({ mode: 'off', config: null }), rows: 16, width: 72 })
  expect(textOf(off)).toEqual([
    '  notes-app                                                      EN  中',
    '',
    '  No decisions are being recorded in this project yet. Run /decide init',
    '  to have Claude find the starting point, /decide start for an empty',
    "  tree, or say 'start recording decisions from now' in a prompt.",
  ])
  expect(off.drawn).toEqual([])
  expect(textOf(draw({ project: projectOf({ mode: 'off', config: null }), rows: 16, width: 72, lang: 'zh' })).slice(2)).toEqual([
    '  这个项目还没有开始记录决定。运行 /decide init 让 Claude 自己找出起',
    "  点，/decide start 从空树开始，或在 prompt 里说'从现在开始记录决定'。",
  ])
  const broken = draw({ project: projectOf({ mode: 'off', config: null, configError: 'config.json: unexpected token at line 3' }), rows: 16, width: 72 })
  expect(textOf(broken).slice(2)).toEqual(['  The decision record in this project cannot be read: config.json:', '  unexpected token at line 3'])
  // no room for the whole message: it is cut and says so
  const cramped = textOf(draw({ project: projectOf({ mode: 'off', config: null }), rows: 4, width: 72 }))
  expect(cramped).toHaveLength(4)
  expect(cramped[3]).toBe('  …')
})

test('pane: paused still shows the tree, and says so; an empty tree says there is nothing yet', () => {
  expect(textOf(draw({ project: projectOf({ mode: 'paused' }), width: 72 }))[1]).toMatch(/● paused {3}updated HH:MM$/)
  const empty = draw({ model: { ...notesModel('en'), nodes: [] }, rows: 16, width: 72 })
  expect(textOf(empty).slice(0, 3)).toEqual(['  notes-app   main ●   crdt-engine   cloud-first                 EN  中', '  0 decisions   mainline 0 steps            ● recording   updated HH:MM', '  No decisions recorded yet.'])
  expect(empty.drawn).toEqual([])
  expect(empty.selected).toBe(null)
})

test('pane: a selection that is not there falls back to the first row; no selection at all too', () => {
  for (const selected of ['zzz', null]) {
    const layout = draw({ ui: ui({ selected }), rows: 20 })
    expect(layout.selected).toBe('n0')
    expect(rowsOf(layout).find(r => r.selected)!.id).toBe('n0')
    expect(textOf(layout).join('\n')).toContain('Notes app: offline-first rewrite for the spring release')
  }
  // a row hidden by the filter is no selection either
  const hidden = draw({ ui: ui({ selected: 'n14', filter: 'clean' }) })
  expect(hidden.selected).not.toBe('n14')
  expect(hidden.drawn).not.toContain('n14')
})

// ---------------------------------------------------------------- the room

test('pane: the rail scrolls to keep the selection in view, and says how many rows are out of sight on each side', () => {
  for (let rows = 12; rows <= 44; rows++) {
    for (const selected of ['n0', 'n3', 'n16', 'n10']) {
      const layout = draw({ rows, ui: ui({ selected }) }, `${rows} ${selected}`)
      expect(layout.drawn).toContain(selected)
      // every one of the 17 rows is above, drawn or below (a rail of fewer than five lines has no marks)
      if (layout.blocks.some(b => b.kind === 'page') || layout.drawn.length === 17) {
        expect(pageCount(layout, 'up') + layout.drawn.length + pageCount(layout, 'down'), `${rows} ${selected}`).toBe(17)
      }
    }
  }
  // the selection at an end: nothing above it, or nothing below
  expect(pageCount(draw({ rows: 20, ui: ui({ selected: 'n0' }) }), 'up')).toBe(0)
  expect(pageCount(draw({ rows: 20, ui: ui({ selected: 'n10' }) }), 'down')).toBe(0)
  expect(pageCount(draw({ rows: 20, ui: ui({ selected: 'n10' }) }), 'up')).toBeGreaterThan(0)
  // a click on a mark pages by what the window holds
  const marked = draw({ rows: 20 })
  const page = marked.blocks.find((b): b is Extract<Block, { kind: 'page' }> => b.kind === 'page')!
  expect(page.step).toBeGreaterThanOrEqual(1)
  expect(page.step).toBeLessThanOrEqual(marked.drawn.length + 4)
})

test('pane: blank rows set the parts apart from 20 rows up; below that every row goes to the content', () => {
  expect(AIRY_MIN_ROWS).toBe(20)
  const at = (rows: number) => textOf(draw({ rows }, `${rows}`))
  // a blank row between the state and the rail, and another before the keys
  expect(at(19)[2]).not.toBe('')
  expect(at(20)[2]).toBe('')
  const before = (rows: number) => {
    const t = at(rows)
    return t[t.length - 3]
  }
  expect(before(19)).not.toBe('')
  expect(before(20)).toBe('')
  // the details have a blank row above their frame only when the pane is airy
  expect(at(19).filter(l => l === '')).toHaveLength(0)
  expect(at(20).filter(l => l === '').length).toBeGreaterThanOrEqual(3)
})

test('pane: the details get blank rows inside their frame from 26 rows up, when the node is short enough to show whole', () => {
  expect(AIRY_DETAIL_ROWS).toBe(26)
  const inside = (rows: number, selected: string) => {
    const t = textOf(draw({ rows, ui: ui({ selected }) }, `${rows} ${selected}`))
    const top = t.findIndex(l => l.startsWith('  ╭─ Details'))
    const bottom = t.findIndex(l => l.startsWith('  ╰'))
    return t.slice(top + 1, bottom)
  }
  // a node with only a title: that, or that between two blank rows
  expect(inside(25, 'n12')).toHaveLength(1)
  expect(inside(25, 'n12')[0]).toMatch(/^ {2}│ Desktop client: after the spring release +│$/)
  const roomy = inside(26, 'n12')
  expect(roomy).toHaveLength(3)
  expect(roomy[0]!.replace(/[│ ]/g, '')).toBe('')
  expect(roomy[2]!.replace(/[│ ]/g, '')).toBe('')
  // a node with a great deal to say keeps the rows for its text: no blank rows until the whole of it fits
  expect(inside(30, 'n3').some(l => l.replace(/[│ ]/g, '') === '')).toBe(false)
  expect(inside(48, 'n3').filter(l => l.replace(/[│ ]/g, '') === '').length).toBeGreaterThanOrEqual(2)
})

test('pane: a blank line of spine between the steps from 24 rows up, when the whole rail still fits with them', () => {
  expect(SPACER_MIN_ROWS).toBe(24)
  const spine = (rows: number, over: Partial<PaneInput> = {}) => textOf(draw({ ...over, rows }, `${rows}`)).filter(l => /^ {2}[┃╏]$/.test(l))
  const crdt = SCENES.crdt()
  expect(spine(23, crdt)).toHaveLength(0)
  expect(spine(36, crdt).length).toBeGreaterThanOrEqual(3)
  // the rail is too long for them: none
  expect(spine(24, { ui: ui({ selected: 'n3' }) })).toHaveLength(0)
  // and the spine breaks (╏) where the steps ahead begin
  expect(spine(36, crdt).some(l => l.includes('╏'))).toBe(true)
})

test('pane: the line that says where a tree began is drawn from 16 rows up', () => {
  expect(ORIGIN_MIN_ROWS).toBe(16)
  const origin = (rows: number) => textOf(draw({ ...SCENES.crdt(), rows }, `${rows}`)).filter(l => l.startsWith('  ↳ '))
  expect(origin(15)).toEqual([])
  expect(origin(16)).toEqual(['  ↳ main #5 (09-21)   CRDT text engine instead of paragraph merge'])
  // the main tree began nowhere
  expect(textOf(draw({ rows: 30 })).some(l => l.includes('↳'))).toBe(false)
})

test('pane: the rail keeps a useful height before the details are cut, and the details keep six lines before the rail is cut', () => {
  for (const width of [60, 80, 100]) {
    for (let rows = 24; rows <= 60; rows++) {
      const layout = draw({ width, rows, statusInterval: 30, now: nowApproved() }, `${width}x${rows}`)
      const t = textOf(layout)
      const top = t.findIndex(l => l.startsWith('  ╭─ Details'))
      const bottom = t.findIndex((l, k) => k > top && l.startsWith('  ╰'))
      // everything between the rail's first row and the details' frame is the rail (page marks included)
      const first = layout.blocks.findIndex(b => b.kind === 'row' || b.kind === 'page')
      const railRows = top - first - (rows >= AIRY_MIN_ROWS ? 1 : 0)
      const want = Math.min(17, Math.min(12, Math.max(4, Math.floor(rows * 0.35))))
      // when the details could give lines away, the rail has what it wants
      const lines = bottom - top - 1
      if (lines > 6) expect(railRows, `${width}x${rows}`).toBeGreaterThanOrEqual(want)
      expect(lines, `${width}x${rows}`).toBeGreaterThanOrEqual(Math.min(6, lines))
    }
  }
})

test('pane: the status block takes at most a third of the rows; what does not fit ends in an ellipsis', () => {
  const many = {
    ...nowApproved().data!,
    lanes: Array.from({ length: 20 }, (_, k) => ({ name: `LANE${k}`, run: `job-${k}`, state: 'running' as const, step: k * 100, total: 2000, eta: '', note: '' })),
    next: [],
    warnings: [],
  }
  const frame = (t: string[]) => {
    const top = t.findIndex(l => l.includes('╭─ Now'))
    const bottom = t.findIndex((l, k) => k > top && l.startsWith('  ╰'))
    return t.slice(top + 1, bottom)
  }
  const cut = frame(textOf(draw({ rows: 40, statusInterval: 30, now: nowApproved({ data: many }) })))
  expect(cut).toHaveLength(Math.floor(40 * 0.35))
  expect(cut[cut.length - 1]).toMatch(/^ {2}│ … +│$/)
  expect(cut[cut.length - 2]).toContain('LANE12')
  // few lanes: all of them, no ellipsis
  const few = frame(textOf(draw({ rows: 40, statusInterval: 30, now: nowApproved() })))
  expect(few).toHaveLength(5)
  expect(few.join('\n')).not.toContain('…')
})

test('pane: docked panes keep the keys on the last rows; the others end where the content ends', () => {
  const pinned = draw({ ...SCENES.pendingOnly(), rows: 40, pin: true })
  const t = textOf(pinned)
  expect(pinned.height).toBe(40)
  expect(t.slice(-2)).toEqual(['  k: ↑  j: ↓  ⏎: expand  e: edit  p: pending  t: trees  o: next tree          l: 中', '  c: colors  h: hide rejected  a: all'])
  expect(kinds(pinned).slice(-2)).toEqual(['bar', 'bar'])
  // the rows left over are blank ones before the keys
  expect(t.slice(-6, -2).every(l => l === '')).toBe(true)
  const loose = draw({ ...SCENES.pendingOnly(), rows: 40 })
  expect(loose.height).toBeLessThan(40)
  expect(textOf(loose).slice(0, loose.height - 3)).toEqual(t.slice(0, loose.height - 3))
})

test('pane: a surface with no text field has no edit key; a pane narrower than 16 columns is drawn 16 wide', () => {
  expect(textOf(draw({ canEdit: false })).join('\n')).not.toContain('e: edit')
  expect(textOf(draw({ canEdit: true })).join('\n')).toContain('e: edit')
  for (const width of [0, 5, 15]) {
    const layout = draw({ width, rows: 20 })
    expect(Math.max(...layout.blocks.map(blockWidth))).toBeLessThanOrEqual(16)
  }
  expect(draw({ rows: 0 }).height).toBeLessThanOrEqual(4)
})

// ---------------------------------------------------------------- what is drawn is drawable

test('pane: titles, summaries and sources full of emoji sequences are drawn without joiners, selectors or flags', () => {
  const HEART = '❤️'
  const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'
  const CHINA = '\u{1F1E8}\u{1F1F3}'
  const MESSY = `${HEART} ${FAMILY} ${CHINA}`
  const TIDY = '❤ \u{1F468}\u{1F469}\u{1F467} CN'
  expect(drawable(MESSY)).toBe(TIDY)
  const model = notesModel('en')
  const messy: DtNode[] = model.nodes.map(n => (n.id === 'n3' ? { ...n, title: `Title ${MESSY}`, summary: `Summary ${MESSY}` } : n.id === 'n5' ? { ...n, title: `Kid ${MESSY}` } : n))
  const UNDRAWN = /[\p{Join_Control}\p{Variation_Selector}\p{Me}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0000}-\u{E0FFF}]/u
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (const width of [20, 28, 40, 68, 100]) {
      for (const selected of ['n3', 'n5']) {
        const layout = draw({ lang, width, rows: 40, model: { ...model, nodes: messy }, ui: ui({ selected }) }, `${lang}/${width}/${selected}`)
        for (const line of textOf(layout)) {
          expect(UNDRAWN.test(line), `${lang}/${width}/${selected}: ${JSON.stringify(line)}`).toBe(false)
          expect(strWidth(line)).toBeLessThanOrEqual(Math.max(16, width))
        }
      }
    }
  }
  const t = textOf(draw({ rows: 40, model: { ...model, nodes: messy } }))
  expect(t.some(l => l.includes(`Conflicts`))).toBe(false)
  expect(t.some(l => l.includes(`Title ${TIDY}`))).toBe(true)
  expect(t.some(l => l.includes(`Kid ${TIDY}`))).toBe(true)
})

test('pane: a title that is only invisible characters draws as untitled', () => {
  // a zero-width space, a joiner, an emoji selector, a word joiner, a byte order mark, a soft hyphen,
  // a skin tone, a tag letter, and half of a surrogate pair
  const invisible = String.fromCodePoint(0x200b, 0x200d, 0xfe0f, 0x2060, 0xfeff, 0xad, 0x1f3fd, 0xe0067, 0xd83d)
  expect(drawable(invisible)).toBe('')
  const model = notesModel('en')
  const nodes = model.nodes.map(n => (n.id === 'n3' ? { ...n, title: invisible } : n.id === 'n5' ? { ...n, title: ' \n\t ' } : n.id === 'n6' ? { ...n, title: `a${invisible}b` } : n))
  for (const [lang, untitled] of [
    ['zh', '（无标题）'],
    ['en', '(untitled)'],
  ] as const) {
    const layout = draw({ lang, model: { ...model, nodes }, rows: 48 })
    const t = textOf(layout)
    // two rows and the details, none of them empty; the third title is what is left of it
    expect(t.filter(x => x.includes(untitled) && x.includes('┠─') && !x.includes('│'))).toHaveLength(1)
    expect(t.some(x => x.startsWith(`▌ ●  ${untitled}`))).toBe(true)
    expect(t.some(x => x.includes('┠─ ✓ ab'))).toBe(true)
    expect(t.some(x => x.startsWith('  │ ' + untitled))).toBe(true)
  }
})
