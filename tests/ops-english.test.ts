import { test, expect } from 'claude-code/testing'

import type { DtActor, DtLang } from '../types'
import { Journal } from '../lib/journal'
import { noteNode, recordNode, updateNode } from '../lib/ops'
import type { Ctx, Done } from '../lib/ops'
import { TmStore } from '../lib/tm'
import type { TmPair } from '../lib/tm'
import { MemDisk } from './mem'

const ROOT = '/work/proj'
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)

/** A context whose English versions are collected in `kept` (one entry per hand-over). */
function setup(options: { lang?: DtLang; actor?: DtActor; english?: Ctx['english'] | null } = {}) {
  const disk = new MemDisk()
  const kept: TmPair[][] = []
  let clock = T0
  const journal = new Journal(disk, ROOT, 'aaaaaa')
  const english: Ctx['english'] =
    options.english === undefined
      ? async pairs => {
          kept.push(pairs)
        }
      : (options.english ?? undefined)
  const ctx: Ctx = { journal, lang: options.lang ?? 'zh', actor: options.actor ?? 'model', now: () => (clock += 1000), ...(english !== undefined ? { english } : {}) }
  return { disk, journal, ctx, kept }
}

const ok = (d: Done): string => {
  if (!d.ok) throw new Error(`expected ok, got: ${d.error}`)
  return d.text
}
const err = (d: Done): string => {
  if (d.ok) throw new Error(`expected an error, got: ${d.text}`)
  return d.error
}
const eventFiles = (disk: MemDisk): string[] => [...disk.files.keys()].filter(p => p.includes('/events/')).sort()

test('en: a record in Chinese with its English version keeps the pairs, and the event holds no en', async () => {
  const { disk, journal, ctx, kept } = setup()
  ok(
    await recordNode(ctx, {
      id: 'pick-store',
      title: '本地存储用 SQLite',
      parent: null,
      status: 'adopted',
      summary: '单文件，够用',
      rationale: '不需要多机写入。\n读多写少。',
      evidence: [{ label: '读 1 万行', value: '38 ms', note: '冷启动', run: 'bench-1' }],
      en: {
        title: 'Use SQLite for local storage',
        summary: 'One file is enough',
        rationale: 'No multi-machine writes.\nMostly reads.',
        evidence: [{ label: 'Read 10k rows', value: '38 ms', note: 'cold start' }],
      },
    }),
  )
  expect(kept).toHaveLength(1)
  expect(kept[0]).toEqual([
    { from: '本地存储用 SQLite', to: 'Use SQLite for local storage' },
    { from: '单文件，够用', to: 'One file is enough' },
    { from: '不需要多机写入。\n读多写少。', to: 'No multi-machine writes.\nMostly reads.' },
    { from: '读 1 万行', to: 'Read 10k rows' },
    // ('38 ms' is not Chinese: nothing to pair)
    { from: '冷启动', to: 'cold start' },
  ])
  // the record is the Chinese one, and nothing of `en` is in the event file
  expect(journal.model().nodes[0]).toMatchObject({ title: '本地存储用 SQLite', summary: '单文件，够用' })
  for (const path of eventFiles(disk)) expect(disk.text(path)).not.toContain('SQLite for local')
  expect(eventFiles(disk).every(p => !disk.text(p).includes('"en"'))).toBe(true)
})

test('en: the pair is made with the text as it is stored, whatever spacing the call had', async () => {
  const { journal, ctx, kept } = setup()
  ok(await recordNode(ctx, { title: '  采用   SQLite\n本地  ', parent: null, status: 'adopted', en: { title: '  Adopt\tSQLite   locally ' } }))
  expect(journal.model().nodes[0]!.title).toBe('采用 SQLite 本地')
  expect(kept[0]).toEqual([{ from: '采用 SQLite 本地', to: 'Adopt SQLite locally' }])
})

test('en: text that is English needs no pair, and an English version of a field the call does not have is ignored', async () => {
  const { ctx, kept } = setup()
  ok(await recordNode(ctx, { title: 'Use SQLite', parent: null, status: 'adopted', summary: 'Plain English', en: { title: 'Use SQLite', summary: 'Plain English' } }))
  ok(await recordNode(ctx, { title: '只有标题', parent: null, status: 'adopted', en: { title: 'Title only', summary: 'a summary nobody wrote', rationale: 'nor a rationale' } }))
  expect(kept).toEqual([[{ from: '只有标题', to: 'Title only' }]])
})

test('en: a call without en keeps nothing and does not touch the memory', async () => {
  const { ctx, kept } = setup()
  ok(await recordNode(ctx, { title: '没有英文版', parent: null, status: 'adopted' }))
  expect(kept).toEqual([])
})

test('en: an English version with Chinese in it is refused, naming the field, and nothing is written', async () => {
  const { disk, ctx, kept } = setup()
  expect(err(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', en: { title: 'Title 标题' } }))).toBe('en.title must be the English version of the text, with no Chinese characters in it')
  expect(err(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', summary: '摘要', en: { title: 'Title', summary: '摘要' } }))).toBe(
    'en.summary must be the English version of the text, with no Chinese characters in it',
  )
  expect(err(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', evidence: [{ label: 'a' }, { label: '读' }], en: { evidence: [{}, { label: '读' }] } }))).toBe(
    'en.evidence[1].label must be the English version of the text, with no Chinese characters in it',
  )
  expect(eventFiles(disk)).toEqual([])
  expect(kept).toEqual([])
  // the person's own pane language does not change what the model is told
  const zh = setup({ lang: 'zh', actor: 'user' })
  expect(err(await recordNode(zh.ctx, { title: '标题', parent: null, status: 'adopted', en: { title: '标题' } }))).toBe('en.title 必须是这段文字的英文版，里面不能有汉字')
})

test('en: en must be an object (or a string, for a note), and says what it should look like', async () => {
  const { disk, ctx } = setup()
  for (const bad of ['Title', ['Title'], 3, true]) {
    const e = err(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', en: bad }))
    expect(e).toContain('en must be an object')
    expect(e).toContain('"title"')
  }
  expect(err(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', en: { evidence: 'one' } }))).toContain('en must be an object')
  expect(eventFiles(disk)).toEqual([])
  // null is the same as leaving it out
  ok(await recordNode(ctx, { title: '标题', parent: null, status: 'adopted', en: null }))
})

test('en: other problems of the call are told with it, and all of them at once', async () => {
  const { ctx } = setup()
  const e = err(await recordNode(ctx, { title: '', parent: null, status: 'adopted', en: { title: '汉字' } }))
  expect(e).toContain('title must be a non-empty string')
  expect(e).toContain('en.title must be the English version')
})

test('en: an update gives the English version of the text it sets, and of the one it leaves as it is', async () => {
  const { journal, ctx, kept } = setup()
  ok(await recordNode(ctx, { id: 'pick-store', title: '本地存储', parent: null, status: 'proposed', summary: '先试试', rationale: '还没定。' }))
  kept.length = 0

  // a new title with its English version
  ok(await updateNode(ctx, { id: 'pick-store', title: '本地存储用 SQLite', en: { title: 'Use SQLite for local storage' } }))
  expect(kept.pop()).toEqual([{ from: '本地存储用 SQLite', to: 'Use SQLite for local storage' }])

  // no change to the text at all: the English version is of the summary the node has
  const same = await updateNode(ctx, { id: 'pick-store', en: { summary: 'Try it first', rationale: 'Not decided yet.' } })
  expect(ok(same)).toBe('没有变化：pick-store 已经是这些值。')
  expect(kept.pop()).toEqual([
    { from: '先试试', to: 'Try it first' },
    { from: '还没定。', to: 'Not decided yet.' },
  ])
  expect(journal.model().nodes[0]).toMatchObject({ summary: '先试试', title: '本地存储用 SQLite' })

  // a summary that is cleared has no English version to keep
  ok(await updateNode(ctx, { id: 'pick-store', summary: null, en: { summary: 'ignored' } }))
  expect(kept.pop()).toBeUndefined()
})

test('en: evidence added by an update is paired by position, repeats and all', async () => {
  const { ctx, kept } = setup()
  ok(await recordNode(ctx, { id: 'pick-store', title: '选存储', parent: null, status: 'adopted' }))
  kept.length = 0
  ok(
    await updateNode(ctx, {
      id: 'pick-store',
      addEvidence: [{ label: '读 1 万行', value: '38 ms' }, { label: '写 1 万行', note: '批量' }],
      en: { addEvidence: [{ label: 'Read 10k rows' }, { label: 'Write 10k rows', note: 'in a batch' }] },
    }),
  )
  expect(kept.pop()).toEqual([
    { from: '读 1 万行', to: 'Read 10k rows' },
    { from: '写 1 万行', to: 'Write 10k rows' },
    { from: '批量', to: 'in a batch' },
  ])
  // the evidence list replaced as a whole
  ok(await updateNode(ctx, { id: 'pick-store', evidence: [{ label: '读 1 万行', value: '36 ms' }], en: { evidence: [{ label: 'Read 10k rows' }] } }))
  expect(kept.pop()).toEqual([{ from: '读 1 万行', to: 'Read 10k rows' }])
})

test('en: an update with Chinese in en is refused and writes nothing', async () => {
  const { disk, ctx, kept } = setup()
  ok(await recordNode(ctx, { id: 'pick-store', title: '选存储', parent: null, status: 'adopted' }))
  const files = eventFiles(disk)
  kept.length = 0
  expect(err(await updateNode(ctx, { id: 'pick-store', title: '选存储 v2', en: { title: '选存储 v2' } }))).toBe('en.title must be the English version of the text, with no Chinese characters in it')
  expect(eventFiles(disk)).toEqual(files)
  expect(kept).toEqual([])
})

test('en: a note can bring the English version of its text', async () => {
  const { journal, ctx, kept } = setup()
  ok(await recordNode(ctx, { id: 'pick-store', title: '选存储', parent: null, status: 'adopted' }))
  kept.length = 0
  ok(await noteNode(ctx, { id: 'pick-store', text: ' 下周再看 ', en: 'Look again next week' }))
  expect(journal.model().nodes[0]!.notes.map(n => n.text)).toEqual(['下周再看'])
  expect(kept.pop()).toEqual([{ from: '下周再看', to: 'Look again next week' }])

  // an English note needs none
  ok(await noteNode(ctx, { id: 'pick-store', text: 'Check the size', en: 'Check the size' }))
  expect(kept).toEqual([])

  // Chinese in it, or the wrong shape: refused, and the note is not written
  const before = journal.model().nodes[0]!.notes.length
  expect(err(await noteNode(ctx, { id: 'pick-store', text: '再看', en: '再看' }))).toBe('en must be the English version of the text, with no Chinese characters in it')
  expect(err(await noteNode(ctx, { id: 'pick-store', text: '再看', en: { text: 'x' } }))).toBe('en must be a string: the English version of text; leave it out when the text is English')
  await journal.sync()
  expect(journal.model().nodes[0]!.notes).toHaveLength(before)
})

test('en: a memory that cannot be written does not fail the call, and no memory at all is fine too', async () => {
  const broken = setup({
    english: async () => {
      throw new Error('disk full')
    },
  })
  expect(ok(await recordNode(broken.ctx, { title: '标题', parent: null, status: 'adopted', en: { title: 'Title' } }))).toContain('已记录')
  expect(broken.journal.model().nodes).toHaveLength(1)

  const none = setup({ english: null })
  ok(await recordNode(none.ctx, { title: '标题', parent: null, status: 'adopted', en: { title: 'Title' } }))
  expect(none.journal.model().nodes).toHaveLength(1)
})

test('en: handed to a translation memory, the pairs end up in files of the project and are read back', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'aaaaaa')
  const journal = new Journal(disk, ROOT, 'aaaaaa')
  let clock = T0
  const ctx: Ctx = {
    journal,
    lang: 'zh',
    actor: 'model',
    now: () => (clock += 1000),
    english: async pairs => {
      await store.append('en', pairs, { actor: 'model', via: 'tool' }, T0)
    },
  }
  ok(await recordNode(ctx, { title: '本地存储用 SQLite', parent: null, status: 'adopted', en: { title: 'Use SQLite for local storage' } }))
  const files = [...disk.files.keys()].filter(p => p.includes('/i18n/'))
  expect(files).toHaveLength(1)
  const other = new TmStore(disk, ROOT, 'bbbbbb')
  await other.sync()
  expect(other.tm().en['本地存储用 SQLite']).toBe('Use SQLite for local storage')
  // saying it again adds nothing
  ok(await recordNode(ctx, { title: '本地存储用 SQLite', parent: null, status: 'adopted', en: { title: 'Use SQLite for local storage' } }))
  expect([...disk.files.keys()].filter(p => p.includes('/i18n/'))).toHaveLength(1)
})
