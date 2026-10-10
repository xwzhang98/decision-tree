import { test, expect } from 'claude-code/testing'

import { firstWord, parseDecide, parseStatus, unquote } from '../lib/commands'
import { detectLanguage, eventsText, nodesText, statusLabel, t } from '../lib/i18n'
import { STATUSES } from '../lib/events'

test('commands: bare /decide edits, and the simple verbs parse', () => {
  expect(parseDecide('')).toEqual({ cmd: 'edit' })
  expect(parseDecide('  ')).toEqual({ cmd: 'edit' })
  expect(parseDecide('start orders-api-rewrite')).toEqual({ cmd: 'start', title: 'orders-api-rewrite' })
  expect(parseDecide('start')).toEqual({ cmd: 'start', title: '' })
  expect(parseDecide('start "my project"')).toEqual({ cmd: 'start', title: 'my project' })
  expect(parseDecide('pause')).toEqual({ cmd: 'pause' })
  expect(parseDecide('RESUME')).toEqual({ cmd: 'resume' })
  expect(parseDecide('help')).toEqual({ cmd: 'usage' })
  expect(parseDecide('frobnicate')).toEqual({ cmd: 'usage' })
})

test('commands: status takes an id or a title piece, and the status in either language', () => {
  expect(parseDecide('status v22-adopted adopted')).toEqual({ cmd: 'status', ref: 'v22-adopted', status: 'adopted' })
  expect(parseDecide('status 构建版本 采用')).toEqual({ cmd: 'status', ref: '构建版本', status: 'adopted' })
  // a status of two words ("In progress", "No diff") is read at the end, and what precedes it names the node
  expect(parseDecide('status pool size absolute in progress')).toEqual({ cmd: 'status', ref: 'pool size absolute', status: 'in-progress' })
  expect(parseDecide('status v22-adopted No diff')).toEqual({ cmd: 'status', ref: 'v22-adopted', status: 'no-diff' })
  expect(parseDecide('status "pool size absolute" In Progress')).toEqual({ cmd: 'status', ref: 'pool size absolute', status: 'in-progress' })
  expect(parseDecide('status 构建版本 in progress')).toEqual({ cmd: 'status', ref: '构建版本', status: 'in-progress' })
  expect(parseDecide('status 构建版本 v2.2 no diff')).toEqual({ cmd: 'status', ref: '构建版本 v2.2', status: 'no-diff' })
  expect(parseDecide('status 构建版本 进行中')).toEqual({ cmd: 'status', ref: '构建版本', status: 'in-progress' })
  // when the last two words are not a status, the last one is, and the rest is still the node
  expect(parseDecide('status 构建版本 v2.2 采用')).toEqual({ cmd: 'status', ref: '构建版本 v2.2', status: 'adopted' })
  expect(parseDecide('status pool size absolute in-progress')).toEqual({ cmd: 'status', ref: 'pool size absolute', status: 'in-progress' })
  expect(parseDecide('status "pool size absolute" in-progress')).toEqual({ cmd: 'status', ref: 'pool size absolute', status: 'in-progress' })
  expect(parseDecide('status pool size absolute rejected')).toEqual({ cmd: 'status', ref: 'pool size absolute', status: 'rejected' })
  expect(parseDecide('status x banana')).toEqual({ cmd: 'error', what: 'status', value: 'banana' })
  expect(parseDecide('status pool size banana split')).toEqual({ cmd: 'error', what: 'status', value: 'split' })
  expect(parseDecide('status')).toEqual({ cmd: 'error', what: 'missing', arg: 'node' })
  expect(parseDecide('status only-one')).toEqual({ cmd: 'error', what: 'missing', arg: 'status' })
  // names every object has are not statuses
  for (const word of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    expect(parseStatus(word)).toBeNull()
    expect(parseDecide(`status v22-adopted ${word}`)).toEqual({ cmd: 'error', what: 'status', value: word })
  }
})

test('commands: note and retract split the first word from the rest, quotes keep a phrase together', () => {
  expect(parseDecide('note v22-adopted two seeds agree')).toEqual({ cmd: 'note', ref: 'v22-adopted', text: 'two seeds agree' })
  expect(parseDecide('note "构建版本 v2.2" 两个 seed 方向一致')).toEqual({ cmd: 'note', ref: '构建版本 v2.2', text: '两个 seed 方向一致' })
  expect(parseDecide('note v22-adopted')).toEqual({ cmd: 'error', what: 'missing', arg: 'text' })
  expect(parseDecide('note')).toEqual({ cmd: 'error', what: 'missing', arg: 'node' })
  expect(parseDecide('retract v22-adopted wrong run')).toEqual({ cmd: 'retract', ref: 'v22-adopted', reason: 'wrong run' })
  expect(parseDecide('retract v22-adopted')).toEqual({ cmd: 'retract', ref: 'v22-adopted', reason: '' })
})

test('commands: add reads the title and the flags', () => {
  expect(parseDecide('add 3 proxies 换成一个 distributed cache --parent gateway --status planned')).toEqual({
    cmd: 'add',
    title: '3 proxies 换成一个 distributed cache',
    parent: 'gateway',
    status: 'planned',
    kind: 'decision',
    id: null,
    trunk: false,
  })
  expect(parseDecide('add "Run s1 next" --parent "构建版本" --status 进行中 --kind protocol --id run-s1 --trunk')).toEqual({
    cmd: 'add',
    title: 'Run s1 next',
    parent: '构建版本',
    status: 'in-progress',
    kind: 'protocol',
    id: 'run-s1',
    trunk: true,
  })
  expect(parseDecide('add Lone root')).toMatchObject({ cmd: 'add', title: 'Lone root', parent: null, status: 'planned' })
  expect(parseDecide('add Top --parent root')).toMatchObject({ parent: null })
  expect(parseDecide('add --parent x')).toEqual({ cmd: 'error', what: 'missing', arg: 'title' })
  expect(parseDecide('add T --status banana')).toEqual({ cmd: 'error', what: 'status', value: 'banana' })
})

test('commands: import, lang and autoopen', () => {
  expect(parseDecide('import seed/nodes.json')).toEqual({ cmd: 'import', file: 'seed/nodes.json' })
  expect(parseDecide('import "my seed.json"')).toEqual({ cmd: 'import', file: 'my seed.json' })
  expect(parseDecide('import')).toEqual({ cmd: 'error', what: 'missing', arg: 'file' })
  expect(parseDecide('lang zh')).toEqual({ cmd: 'lang', value: 'zh' })
  expect(parseDecide('lang klingon')).toEqual({ cmd: 'error', what: 'missing', arg: 'value' })
  expect(parseDecide('autoopen off')).toEqual({ cmd: 'autoopen', value: false })
  expect(parseDecide('autoopen on')).toEqual({ cmd: 'autoopen', value: true })
})

test('commands: helpers', () => {
  expect(unquote('"a b"')).toBe('a b')
  expect(unquote('“你好 吗”')).toBe('你好 吗')
  expect(unquote("'x'")).toBe('x')
  expect(unquote('"unbalanced')).toBe('"unbalanced')
  expect(firstWord('  one two  three ')).toEqual({ word: 'one', rest: 'two  three' })
  expect(firstWord('"a b" c')).toEqual({ word: 'a b', rest: 'c' })
  expect(firstWord('')).toEqual({ word: '', rest: '' })
  expect(parseStatus('In Progress')).toBe('in-progress')
  expect(parseStatus('no diff')).toBe('no-diff')
  expect(parseStatus('无差别')).toBe('no-diff')
  expect(parseStatus('暂缓')).toBe('deferred')
  expect(parseStatus('')).toBeNull()
})

test('language: Chinese characters make zh, a few English words make en, short noise changes nothing', () => {
  expect(detectLanguage('从现在开始记录决定')).toBe('zh')
  expect(detectLanguage('please look at the P99 结果')).toBe('zh')
  expect(detectLanguage('Please continue with the next run')).toBe('en')
  expect(detectLanguage('go ahead')).toBe('en')
  expect(detectLanguage('ok')).toBeNull()
  expect(detectLanguage('y')).toBeNull()
  expect(detectLanguage('1')).toBeNull()
  expect(detectLanguage('')).toBeNull()
})

test('i18n: every status has a label in both languages and placeholders are filled', () => {
  for (const s of STATUSES) {
    expect(statusLabel('en', s)).not.toBe('')
    expect(statusLabel('zh', s)).not.toBe('')
  }
  expect(statusLabel('zh', 'adopted')).toBe('采用')
  expect(statusLabel('en', 'in-progress')).toBe('In progress')
  expect(t('zh', 'pane.count.many', { n: 23 })).toBe('23 个决定')
  expect(t('en', 'pane.count.many', { n: 23 })).toBe('23 decisions')
  expect(t('en', 'pane.empty')).toBe(
    "No decisions are being recorded in this project yet. Say 'start recording decisions from now' in a prompt, or run /decide start.",
  )
  expect(t('zh', 'pane.empty')).toBe("这个项目还没有开始记录决定。在 prompt 里说'从现在开始记录决定'，或用 /decide start。")
  expect(t('en', 'r.recorded', { id: 'a', parent: 'b' })).toBe('Recorded a (under b, {status})')
})

test('commands: /decide tree lists, and its words open, switch and show the log', () => {
  // listing: `tree` alone, or with list / ls, in any case
  for (const text of ['tree', 'trees', 'tree list', 'tree ls', 'Trees LS', '  tree  ']) expect(parseDecide(text)).toEqual({ cmd: 'tree-list' })

  // opening: `new` on its own, or one of the words after `tree`
  const fresh = { cmd: 'tree-new', name: 'sql-v3', from: null, at: null, empty: false, title: null, stay: false }
  for (const text of ['new sql-v3', 'tree new sql-v3', 'tree create sql-v3', 'tree fork sql-v3', 'tree open sql-v3', 'tree 新建 sql-v3', 'tree 新开 sql-v3', 'trees NEW sql-v3']) {
    expect(parseDecide(text)).toEqual(fresh)
  }
  expect(parseDecide('new "sql v3"')).toEqual({ ...fresh, name: 'sql v3' })

  // switching: `use` and `switch` on their own, or one of the words after `tree`
  for (const text of ['use sql-v3', 'switch sql-v3', 'tree use sql-v3', 'tree switch sql-v3', 'tree checkout sql-v3', 'tree 切换 sql-v3']) {
    expect(parseDecide(text)).toEqual({ cmd: 'tree-use', name: 'sql-v3' })
  }
  expect(parseDecide('use "sql v3"')).toEqual({ cmd: 'tree-use', name: 'sql v3' })
  expect(parseDecide('tree use main')).toEqual({ cmd: 'tree-use', name: 'main' })

  // the log: as many lines as it shows by default, or the last N (anything that is not a count is not one)
  for (const text of ['log', 'tree log', 'tree history', 'tree 历史', 'log all', 'log -3']) expect(parseDecide(text)).toEqual({ cmd: 'tree-log', limit: null })
  expect(parseDecide('log 25')).toEqual({ cmd: 'tree-log', limit: 25 })
  expect(parseDecide('tree history 5')).toEqual({ cmd: 'tree-log', limit: 5 })
  expect(parseDecide('tree 历史 8')).toEqual({ cmd: 'tree-log', limit: 8 })
  expect(parseDecide('log 0')).toEqual({ cmd: 'tree-log', limit: 1 })

  // a tree needs a name to be opened or switched to
  for (const text of ['new', 'tree new', 'tree create', 'tree 新建', 'new --empty', 'tree new --at #3']) {
    expect(parseDecide(text)).toEqual({ cmd: 'error', what: 'missing', arg: 'name' })
  }
  for (const text of ['use', 'switch', 'tree use', 'tree switch', 'tree checkout', 'tree 切换']) {
    expect(parseDecide(text)).toEqual({ cmd: 'error', what: 'missing', arg: 'name' })
  }

  // any other word after `tree` is not a command
  expect(parseDecide('tree frobnicate')).toEqual({ cmd: 'usage' })
  expect(parseDecide('trees frobnicate sql-v3')).toEqual({ cmd: 'usage' })
})

test('commands: the version to open a tree from takes whatever way it is written, spaces and all', () => {
  const tree = (over: Record<string, unknown>) => ({ cmd: 'tree-new', name: 'sql-v3', from: null, at: null, empty: false, title: null, stay: false, ...over })
  const open = (flags: string) => parseDecide(`new sql-v3 ${flags}`)

  // --at and --version take everything up to the next --flag: a number, a node, a date with a time in it, Chinese, quotes
  expect(open('--at #3')).toEqual(tree({ at: '#3' }))
  expect(open('--at v22-adopted')).toEqual(tree({ at: 'v22-adopted' }))
  expect(open('--at 2026-10-08 17:44')).toEqual(tree({ at: '2026-10-08 17:44' }))
  expect(open('--version 2026-10-08 17:44')).toEqual(tree({ at: '2026-10-08 17:44' }))
  expect(open('--at 10月8日 17:44')).toEqual(tree({ at: '10月8日 17:44' }))
  expect(open('--at 构建版本 v2.2 重跑')).toEqual(tree({ at: '构建版本 v2.2 重跑' }))
  expect(open('--at "构建版本 v2.2"')).toEqual(tree({ at: '构建版本 v2.2' }))
  expect(open("--at '10-08 17:44'")).toEqual(tree({ at: '10-08 17:44' }))
  expect(open('--at “构建版本 v2.2”')).toEqual(tree({ at: '构建版本 v2.2' }))
  // --at wins when both are given; a flag with nothing after it says nothing
  expect(open('--version #2 --at #3')).toEqual(tree({ at: '#3' }))
  expect(open('--at')).toEqual(tree({}))
  expect(open('--at --stay')).toEqual(tree({ stay: true }))

  // --from and --title take the same way; the name is what comes before the first flag, spaces and all
  expect(open('--from main --at 2026-10-08 17:44 --title SQL 第三版，用 v2.2')).toEqual(
    tree({ from: 'main', at: '2026-10-08 17:44', title: 'SQL 第三版，用 v2.2' }),
  )
  expect(open('--title SQL -- second try')).toEqual(tree({ title: 'SQL -- second try' }))
  expect(parseDecide('new SQL v3 --at #3')).toEqual(tree({ name: 'SQL v3', at: '#3' }))
  expect(parseDecide('new 第三版 --title 第三版 --AT 17:44')).toEqual(tree({ name: '第三版', title: '第三版', at: '17:44' }))

  // --empty and --stay are yes-or-no: they take nothing after them, in any place
  expect(open('--empty')).toEqual(tree({ empty: true }))
  expect(open('--stay --empty')).toEqual(tree({ empty: true, stay: true }))
  expect(open('--empty --title A blank tree')).toEqual(tree({ empty: true, title: 'A blank tree' }))
  expect(open('--stay --at 2026-10-08 17:44')).toEqual(tree({ stay: true, at: '2026-10-08 17:44' }))
  expect(open('--at 10-08 17:44 --stay')).toEqual(tree({ at: '10-08 17:44', stay: true }))
})

test('i18n: counts say 1 node and 2 nodes, in both languages', () => {
  expect(nodesText('en', 0)).toBe('0 nodes')
  expect(nodesText('en', 1)).toBe('1 node')
  expect(nodesText('en', 2)).toBe('2 nodes')
  expect(nodesText('zh', 1)).toBe('1 个节点')
  expect(nodesText('zh', 2)).toBe('2 个节点')
  expect(eventsText('en', 1)).toBe('1 event')
  expect(eventsText('en', 6)).toBe('6 events')
  expect(eventsText('zh', 1)).toBe('1 个事件')
  expect(eventsText('zh', 6)).toBe('6 个事件')
  // side by side, as a tree is listed
  expect(t('en', 'tree.counts', { nodes: nodesText('en', 1), events: eventsText('en', 4) })).toBe('1 node, 4 events')
  expect(t('en', 'tree.counts', { nodes: nodesText('en', 2), events: eventsText('en', 1) })).toBe('2 nodes, 1 event')
  expect(t('zh', 'tree.counts', { nodes: nodesText('zh', 2), events: eventsText('zh', 1) })).toBe('2 个节点，1 个事件')
})
