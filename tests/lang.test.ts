import { test, expect } from 'claude-code/testing'

import type { DtModel, DtNode, DtTm } from '../types'
import { EMPTY_TM, isUsableRendition, localize, localizeModel, localizeNode, localizer, markOf, other, readsIn, renditionOf, renditionRules, scriptOf, textsOf, wantedRenditions, worthRendering } from '../lib/lang'
import { node } from './fixture'

const tm = (en: Record<string, string> = {}, zh: Record<string, string> = {}): DtTm => ({ en, zh })
const model = (nodes: DtNode[], fork: DtModel['fork'] = null): Pick<DtModel, 'nodes' | 'fork'> => ({ nodes, fork })

test('lang: Han characters make a text Chinese, anything else English', () => {
  expect(scriptOf('存储层采用')).toBe('zh')
  expect(scriptOf('run 3 重跑')).toBe('zh') // technical words in a Chinese sentence do not make it English
  expect(scriptOf('Use SQLite for local storage')).toBe('en')
  expect(scriptOf('')).toBe('en')
  expect(scriptOf('v1.2 → v1.3')).toBe('en')
  expect(other('zh')).toBe('en')
  expect(other('en')).toBe('zh')
})

test('lang: localize gives a text in the language asked for, its rendition, or failing that the text itself', () => {
  const memory = tm({ 存储层采用: 'Adopt the local store' }, { 'Adopt the local store': '采用 local store' })
  // already in the language: left alone, whatever the memory says
  expect(localize(memory, 'zh', '存储层采用')).toBe('存储层采用')
  expect(localize(memory, 'en', 'Adopt the local store')).toBe('Adopt the local store')
  // the other language: the rendition
  expect(localize(memory, 'en', '存储层采用')).toBe('Adopt the local store')
  expect(localize(memory, 'zh', 'Adopt the local store')).toBe('采用 local store')
  // none yet: the text as it is
  expect(localize(memory, 'en', '没有对照')).toBe('没有对照')
  expect(localize(EMPTY_TM, 'zh', 'no rendition yet')).toBe('no rendition yet')
  expect(localize(memory, 'en', '')).toBe('')
})

test('lang: a title that is the name of an Object property is not a translation', () => {
  expect(localize(EMPTY_TM, 'zh', 'constructor')).toBe('constructor')
  expect(localize(EMPTY_TM, 'zh', 'toString')).toBe('toString')
  expect(readsIn(EMPTY_TM, 'zh', 'hasOwnProperty')).toBe(false)
  expect(renditionOf(EMPTY_TM, 'zh', '__proto__')).toBeUndefined()
  // and one that is an own key is found like any other
  const own = JSON.parse('{"__proto__": "原型"}') as Record<string, string>
  expect(localize({ en: {}, zh: own }, 'zh', '__proto__')).toBe('原型')
})

test('lang: readsIn says whether a text can be read in a language as it is or through a rendition', () => {
  const memory = tm({ 存储层采用: 'Adopt the store' })
  expect(readsIn(memory, 'zh', '存储层采用')).toBe(true)
  expect(readsIn(memory, 'en', '存储层采用')).toBe(true)
  expect(readsIn(memory, 'en', '另一个决定')).toBe(false)
  expect(readsIn(memory, 'zh', 'Some English decision')).toBe(false)
  expect(readsIn(memory, 'en', 'Some English decision')).toBe(true)
})

test('lang: which texts are worth a rendition', () => {
  // into English: any Chinese text
  expect(worthRendering('采用', 'en')).toBe(true)
  expect(worthRendering('run 3 重跑', 'en')).toBe(true)
  expect(worthRendering('Already English', 'en')).toBe(false)
  // into Chinese: English text that holds words, not a lone name or a number
  expect(worthRendering('Use SQLite for local storage', 'zh')).toBe(true)
  expect(worthRendering('run 3 rerun', 'zh')).toBe(true)
  expect(worthRendering('replay', 'zh')).toBe(false)
  expect(worthRendering('v1.2', 'zh')).toBe(false)
  expect(worthRendering('12 → 14', 'zh')).toBe(false)
  expect(worthRendering('采用 SQLite', 'zh')).toBe(false)
})

test('lang: textsOf lists every piece of words a node holds, in the order the pane shows them', () => {
  const n = node('pick-db', null, {
    title: '用 SQLite 存本地数据',
    summary: '单文件，够用',
    rationale: '不需要多机写入。',
    evidence: [{ label: '读 1 万行', value: '38 ms', note: '冷启动' }, { label: 'write test' }],
    notes: [{ ts: '2026-10-10T00:00:00Z', actor: 'user', text: '下周再看' }],
    retracted: { ts: '2026-10-11T00:00:00Z', actor: 'user', reason: '记错了' },
  })
  expect(textsOf(n)).toEqual(['用 SQLite 存本地数据', '单文件，够用', '不需要多机写入。', '读 1 万行', '38 ms', '冷启动', 'write test', '下周再看', '记错了'])
  expect(textsOf(node('bare', null, { title: 'only a title' }))).toEqual(['only a title'])
})

test('lang: wantedRenditions asks for English first, newest nodes first, and skips what the memory has', () => {
  const nodes = [
    node('old-one', null, { title: '旧的决定', summary: '旧摘要' }),
    node('new-one', 'old-one', { title: '新的决定', summary: 'Already English summary' }),
    node('english', 'old-one', { title: 'An English decision' }),
    node('retracted', 'old-one', { title: '撤销了的', retracted: { ts: '2026-10-11T00:00:00Z', actor: 'user' } }),
  ]
  const none = wantedRenditions([model(nodes)], EMPTY_TM, { zh: false, limit: 50 })
  // newest first; nothing for English text, nothing for a retracted node
  expect(none).toEqual([
    { lang: 'en', text: '新的决定' },
    { lang: 'en', text: '旧的决定' },
    { lang: 'en', text: '旧摘要' },
  ])
  const some = wantedRenditions([model(nodes)], tm({ 新的决定: 'New decision' }), { zh: false, limit: 50 })
  expect(some.map(w => w.text)).toEqual(['旧的决定', '旧摘要'])
  // asking for Chinese too adds the English prose, after the English renditions
  const both = wantedRenditions([model(nodes)], EMPTY_TM, { zh: true, limit: 50 })
  expect(both.map(w => `${w.lang}:${w.text}`)).toEqual([
    'en:新的决定',
    'en:旧的决定',
    'en:旧摘要',
    'zh:An English decision',
    'zh:Already English summary',
  ])
  // a limit stops the list where it falls
  expect(wantedRenditions([model(nodes)], EMPTY_TM, { zh: true, limit: 2 }).map(w => w.text)).toEqual(['新的决定', '旧的决定'])
})

test('lang: the same text in two nodes is asked for once, and a tree label counts', () => {
  const a = node('aa-one', null, { title: '重跑' })
  const b = node('bb-two', 'aa-one', { title: '重跑' })
  const fork = { tree: 'main', at: null, count: 0, ts: '2026-10-10T00:00:00Z', actor: 'user' as const, title: '试一下 SQL 方案' }
  const w = wantedRenditions([model([a, b], fork)], EMPTY_TM, { zh: false, limit: 50 })
  expect(w).toEqual([
    { lang: 'en', text: '重跑' },
    { lang: 'en', text: '试一下 SQL 方案' },
  ])
})

test('lang: texts that were tried and would not translate can be left out of what is wanted, and the list fills up with the next ones', () => {
  const nodes = [node('aa-one', null, { title: '甲' }), node('bb-two', 'aa-one', { title: '乙' }), node('cc-three', 'bb-two', { title: '丙' })]
  const skip = (w: { lang: string; text: string }) => w.text === '丙'
  // (the newest node comes first; the skipped text takes no place in the limit)
  expect(wantedRenditions([model(nodes)], EMPTY_TM, { zh: false, limit: 2, skip }).map(w => w.text)).toEqual(['乙', '甲'])
  expect(wantedRenditions([model(nodes)], EMPTY_TM, { zh: false, limit: 5, skip: () => true })).toEqual([])
})

test('lang: a rendition must be in the right language, and a Chinese one may be the text unchanged', () => {
  expect(isUsableRendition('存储层采用', 'Adopt the local store', 'en')).toBe(true)
  expect(isUsableRendition('存储层采用', '存储层采用', 'en')).toBe(false) // still Chinese
  expect(isUsableRendition('存储层采用', '  ', 'en')).toBe(false)
  expect(isUsableRendition('Adopt the store', '采用 store', 'zh')).toBe(true)
  expect(isUsableRendition('sync workers', 'sync workers', 'zh')).toBe(true) // nothing to render
  expect(isUsableRendition('Adopt the store', 'Adopt the store now', 'zh')).toBe(false) // English passed off as Chinese
})

test('lang: the rules for a Chinese rendition keep the technical words and the everyday work words in English', () => {
  const zh = renditionRules('zh')
  for (const word of ['bug', 'doc', 'commit', 'SQLite', 'run', 'seed', 'baseline', 'retry', 'sync']) expect(zh).toContain(word)
  // every professional name and common work word, and the English one when in doubt: only the words that join them are Chinese
  expect(zh).toContain('professional name')
  expect(zh).toContain('When in doubt, keep the English word')
  expect(renditionRules('en')).toContain('English')
})

test('lang: the localizer gives each text in the pane\'s language and remembers which ones are still waiting', () => {
  const memory = tm({ 存储层采用: 'Adopt the local store' }, { 'Adopt the local store': '采用 local store' })
  const en = localizer(memory, 'en')
  expect(en.text('存储层采用')).toBe('Adopt the local store')
  expect(en.text('没有对照')).toBe('没有对照')
  expect(en.text('Already English')).toBe('Already English')
  expect(en.text('')).toBe('')
  // only a text that is still in the other language, and worth a rendition, is waiting
  expect(en.waiting('没有对照')).toBe(true)
  expect(en.waiting('Adopt the local store')).toBe(false)
  expect(en.waiting('Already English')).toBe(false)

  const zh = localizer(memory, 'zh')
  expect(zh.text('Adopt the local store')).toBe('采用 local store')
  expect(zh.text('Keep the old queue for now')).toBe('Keep the old queue for now')
  expect(zh.waiting('Keep the old queue for now')).toBe(true)
  // a name or a number reads the same in either language and never waits
  expect(zh.text('seed_3')).toBe('seed_3')
  expect(zh.text('2.4 s')).toBe('2.4 s')
  expect(zh.waiting('seed_3')).toBe(false)
  expect(zh.waiting('2.4 s')).toBe(false)
})

test('lang: markOf names the language a text was written in', () => {
  expect(markOf('存储层采用')).toBe('中')
  expect(markOf('run 3 重跑')).toBe('中')
  expect(markOf('Adopt the store')).toBe('EN')
  expect(markOf('')).toBe('EN')
})

test('lang: a node is localized in every text it holds and in nothing else', () => {
  const n = node('pick-db', 'root', {
    title: '用 SQLite 存本地数据',
    summary: '单文件，够用',
    rationale: '不需要多机写入。',
    evidence: [{ label: '读 1 万行', value: '很快', ci: '[30, 40]', run: 'bench_a', note: '冷启动', source: 'docs/bench.md' }, { label: 'write test', value: '38 ms' }],
    notes: [{ ts: '2026-10-10T00:00:00Z', actor: 'user', text: '下周再看' }],
    retracted: { ts: '2026-10-11T00:00:00Z', actor: 'user', reason: '记错了' },
    tags: ['storage'],
    sources: ['docs/adr/0001.md'],
  })
  const memory = tm({
    '用 SQLite 存本地数据': 'Use SQLite for local data',
    '单文件，够用': 'One file is enough',
    '不需要多机写入。': 'No multi-machine writes.',
    '读 1 万行': 'Read 10,000 rows',
    很快: 'fast',
    冷启动: 'cold start',
    下周再看: 'Look again next week',
    记错了: 'Misremembered',
  })
  const out = localizeNode(n, localizer(memory, 'en'))
  expect(out.title).toBe('Use SQLite for local data')
  expect(out.summary).toBe('One file is enough')
  expect(out.rationale).toBe('No multi-machine writes.')
  expect(out.evidence).toEqual([
    { label: 'Read 10,000 rows', value: 'fast', ci: '[30, 40]', run: 'bench_a', note: 'cold start', source: 'docs/bench.md' },
    { label: 'write test', value: '38 ms' },
  ])
  expect(out.notes).toEqual([{ ts: '2026-10-10T00:00:00Z', actor: 'user', text: 'Look again next week' }])
  expect(out.retracted).toEqual({ ts: '2026-10-11T00:00:00Z', actor: 'user', reason: 'Misremembered' })
  // ids, status, tags, sources and the rest are as recorded; the node given is not changed
  expect({ ...out, title: n.title, summary: n.summary, rationale: n.rationale, evidence: n.evidence, notes: n.notes, retracted: n.retracted }).toEqual(n)
  expect(n.title).toBe('用 SQLite 存本地数据')
  // a node with only a title stays that way
  const bare = node('bare', null, { title: '只有标题' })
  expect(localizeNode(bare, localizer(memory, 'en'))).toEqual(bare)
})

test('lang: a model is localized with its fork title, and says which texts are still waiting', () => {
  const nodes = [node('a', null, { title: '存储层采用' }), node('b', 'a', { title: '没有对照' })]
  const fork = { tree: 'main', at: null, count: 0, ts: '2026-10-10T00:00:00Z', actor: 'user' as const, title: '换一个方案' }
  const full: DtModel = { isStarted: true, startedAt: null, nodes, warnings: [], warningCount: 0, eventCount: 2, lastEventAt: null, fork }
  const { model: out, loc } = localizeModel(full, tm({ 存储层采用: 'Adopt the store', 换一个方案: 'Try another way' }), 'en')
  expect(out.nodes.map(n => n.title)).toEqual(['Adopt the store', '没有对照'])
  expect(out.fork?.title).toBe('Try another way')
  expect(loc.waiting('没有对照')).toBe(true)
  expect(loc.waiting('Adopt the store')).toBe(false)
  // a model with no fork is returned with none
  expect(localizeModel({ ...full, fork: null }, EMPTY_TM, 'zh').model.fork).toBe(null)
})
