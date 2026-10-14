// A made-up project to draw: the decisions of an offline-first notes app, in English and in Chinese, with a
// second tree opened from the first. Every layout and pane test that wants a realistic tree uses this one.
//
// The main tree has six steps on its mainline, branches that were tried, and work still ahead:
//
//   ● Notes app: offline-first rewrite              ┠─ ‖ Desktop client        ┠─ ✓ Release bar
//   ● Storage: SQLite with a write-ahead log        ┠─ ✗ Keep JSON files and add a lock file
//   ● Sync: clients send operations ...             ┠─ ✗ CRDT text engine      ┠─ ⊘ Compress operations
//   ● Conflicts: merge by paragraph ...             ┠─ = ┠─ ✓ ┠─ ◐ (and ◌ under it)
//   ◉ Offline queue: at most 5,000 operations
//   ○ Beta to 500 testers once the soak test passes ┠─ ○ Soak test ┖─ ◌ Staged rollout

import { defaultConfig } from '../lib/config'
import { eventFileName } from '../lib/events'
import type { DtEvidence, DtFork, DtGraphStep, DtLang, DtModel, DtNode, DtNow, DtNowData, DtProject, DtStatus, DtTm, DtTreeInfo } from '../types'

/** 2026-10-13 15:28 UTC. */
export const NOW = Date.UTC(2026, 9, 13, 15, 28, 0)
const HOUR = 3600 * 1000
export const iso = (ms: number) => new Date(ms).toISOString()

/** Noon UTC of a day of 2026, so the date reads the same in any time zone. */
export const noon = (month: number, day: number) => iso(Date.UTC(2026, month - 1, day, 12, 0, 0))

type Raw = {
  id: string
  parent: string | null
  trunk: boolean
  status: DtStatus
  /** `MM-DD`. */
  date: string
  by: 'user' | 'model'
  /** Hours since the node last changed. */
  ago: number
  en: string
  zh: string
}

const raw = (id: string, parent: string | null, trunk: boolean, status: DtStatus, date: string, by: 'user' | 'model', ago: number, en: string, zh: string): Raw => ({
  id,
  parent,
  trunk,
  status,
  date,
  by,
  ago,
  en,
  zh,
})

export const MAIN_RAW: Raw[] = [
  raw('n0', null, true, 'adopted', '09-02', 'user', 900, 'Notes app: offline-first rewrite for the spring release', '笔记 app：为春季版本做离线优先的重写'),
  raw('n12', 'n0', false, 'deferred', '10-08', 'user', 120, 'Desktop client: after the spring release', '桌面客户端：春季版本之后再做'),
  raw('n13', 'n0', false, 'adopted', '10-13', 'user', 3, 'Release bar: crash-free sessions above 99.5%', '发布门槛：无崩溃会话占比高于 99.5%'),
  raw('n1', 'n0', true, 'adopted', '09-14', 'user', 700, 'Storage: SQLite with a write-ahead log, no more JSON files', '存储：SQLite 加预写日志，不再用 JSON 文件'),
  raw('n14', 'n1', false, 'rejected', '09-14', 'user', 700, 'Keep JSON files and add a lock file', '继续用 JSON 文件，加一个锁文件'),
  raw('n2', 'n1', true, 'adopted', '09-21', 'user', 500, 'Sync: clients send operations, the server decides their order', '同步：客户端发操作，由服务器决定顺序'),
  raw('n4', 'n2', false, 'rejected', '09-21', 'user', 500, 'CRDT text engine: too heavy for older phones', 'CRDT 文本引擎：旧手机上太重'),
  raw('n11', 'n2', false, 'withdrawn', '09-26', 'model', 380, 'Compress operations before sending', '发送前压缩操作'),
  raw('n3', 'n2', true, 'adopted', '10-01', 'model', 6, 'Conflicts: merge by paragraph, last edit wins for titles', '冲突：按段落合并，标题以最后一次编辑为准'),
  raw('n5', 'n3', false, 'no-diff', '10-02', 'model', 250, 'Merge window of 5 s instead of 10 s', '合并窗口用 5 秒，不用 10 秒'),
  raw('n6', 'n3', false, 'adopted', '10-03', 'user', 230, 'Show a banner when a note was merged', '笔记被合并时给出提示条'),
  raw('n7', 'n3', false, 'in-progress', '10-05', 'model', 8, 'Replay 200 recorded edit sessions through the merge', '把录下的 200 次编辑会话回放给合并逻辑'),
  raw('n15', 'n7', false, 'proposed', '10-06', 'model', 170, 'Title conflicts: show both versions and let the person pick', '标题冲突：两个版本都显示，让用户自己选'),
  raw('n16', 'n3', true, 'adopted', '10-06', 'user', 170, 'Offline queue: at most 5,000 operations per note', '离线队列：每条笔记最多 5,000 个操作'),
  raw('n8', 'n16', true, 'planned', '10-06', 'model', 170, 'Beta to 500 testers once the soak test passes', '浸泡测试通过后，向 500 名测试者开放 beta'),
  raw('n9', 'n8', false, 'planned', '10-06', 'model', 170, 'Soak test: three older phones, one week offline', '浸泡测试：三台旧手机，离线一周'),
  raw('n10', 'n8', false, 'proposed', '10-06', 'model', 170, 'Staged rollout: 5% first, then a quarter, then everyone', '分阶段发布：先 5%，再四分之一，最后全部'),
]

/** A second tree, opened from the first at its Sync step: the first four decisions are copies, the rest are its own. */
export const CRDT_RAW: Raw[] = [
  raw('n0', null, true, 'adopted', '09-02', 'user', 900, 'Notes app: offline-first rewrite for the spring release', '笔记 app：为春季版本做离线优先的重写'),
  raw('n1', 'n0', true, 'adopted', '09-14', 'user', 700, 'Storage: SQLite with a write-ahead log, no more JSON files', '存储：SQLite 加预写日志，不再用 JSON 文件'),
  raw('n14', 'n1', false, 'rejected', '09-14', 'user', 700, 'Keep JSON files and add a lock file', '继续用 JSON 文件，加一个锁文件'),
  raw('n2', 'n1', true, 'adopted', '09-21', 'user', 500, 'Sync: clients send operations, the server decides their order', '同步：客户端发操作，由服务器决定顺序'),
  raw('x1', 'n2', true, 'adopted', '09-28', 'user', 400, 'CRDT text engine: merge by character, no conflict screen', 'CRDT 文本引擎：按字符合并，不再有冲突界面'),
  raw('x2', 'x1', false, 'adopted', '10-03', 'model', 230, 'Tombstones: compact once a week', '墓碑记录：每周压缩一次'),
  raw('x3', 'x1', false, 'in-progress', '10-07', 'model', 5, 'Prototype on three older phones', '在三台旧手机上做原型'),
  raw('x5', 'x3', false, 'proposed', '10-07', 'model', 5, 'Fallback: paragraph merge for notes over 50 KB', '备选：超过 50 KB 的笔记退回按段落合并'),
  raw('x4', 'x1', true, 'planned', '10-07', 'user', 120, 'Keep it only if cold start stays under 2 s', '冷启动不超过 2 秒才保留'),
]

type Detail = {
  summary: [string, string]
  rationale: [string, string]
  evidence: { label: [string, string]; value: [string, string]; run: string }[]
  sources: string[]
  note: { date: string; actor: 'user' | 'model'; text: [string, string] }
}

/** What the Conflicts step of the main tree has to say for itself. */
export const CONFLICTS: Detail = {
  summary: [
    'Body text merges by paragraph; titles and tags take the last edit. Replaying 200 recorded edit sessions left 3 conflicts, all in titles.',
    '正文按段落合并，标题和标签以最后一次编辑为准；回放 200 次真实编辑会话后只剩 3 处冲突，都在标题上。',
  ],
  rationale: [
    'A paragraph is the smallest unit people think of as "the thing I changed", so merging by it surprises them least. The CRDT prototype made cold start 0.5 s slower, more on phones three years old, and it only pays off when several people edit one paragraph at once, which this release does not allow.',
    '段落是用户理解"我改了哪里"的最小单位，按它合并最不让人意外。CRDT 原型的冷启动慢 0.5 秒，在三年前的手机上更明显，而收益只在多人同时编辑同一段时才有，这个版本没有这个场景。',
  ],
  evidence: [
    { label: ['Paragraph merge (200 sessions)', '按段落合并（200 次会话）'], value: ['3 left, all in titles', '剩 3 处，都在标题'], run: 'replay_a' },
    { label: ['CRDT prototype', 'CRDT 原型'], value: ['cold start 2.4 s vs 1.9 s', '冷启动 2.4 秒，对比 1.9 秒'], run: 'proto_b' },
  ],
  sources: ['docs/adr/0004-sync.md', 'docs/design/merge-rules.md', 'reports/merge_replay_20261001/RESULTS.md'],
  note: { date: '10-04', actor: 'user', text: ['Fine for now; revisit if titles start to conflict more often.', '先这样；如果标题冲突变多再回来看。'] },
}

/** What the prototype step of the crdt-engine tree says. */
export const PROTOTYPE: Detail = {
  summary: [
    'The prototype runs on three phones that are three years old: cold start takes 2.4 s with the CRDT engine against 1.9 s with paragraph merge.',
    '原型在三台三年前的旧手机上跑：CRDT 引擎冷启动 2.4 秒，按段落合并是 1.9 秒。',
  ],
  rationale: [
    'Merging by character removes the conflict screen, but it only pays off if cold start stays inside the 2 s budget on older phones, and the first numbers say it does not yet. Compacting tombstones weekly is already in; trimming the index that loads at start is next.',
    '按字符合并可以去掉冲突界面，但前提是旧手机的冷启动不超过 2 秒预算，目前的数字还没达标。每周压缩墓碑记录已经做了，下一步是精简启动时加载的索引。',
  ],
  evidence: [
    { label: ['Cold start, CRDT engine', 'CRDT 引擎冷启动'], value: ['2.4 s on 3 phones', '3 台手机 2.4 秒'], run: 'proto_c' },
    { label: ['Cold start, paragraph merge', '按段落合并冷启动'], value: ['1.9 s', '1.9 秒'], run: 'proto_b' },
  ],
  sources: ['docs/design/crdt-prototype.md', 'reports/crdt_cold_start_20261007/RESULTS.md'],
  note: { date: '10-07', actor: 'model', text: ['Trimming the index is the next experiment.', '下一个实验是精简索引。'] },
}

const at = (lang: DtLang) => (lang === 'en' ? 0 : 1)

function nodeOf(r: Raw, lang: DtLang, detail: Detail | null): DtNode {
  const [month, day] = r.date.split('-').map(Number) as [number, number]
  const decided = noon(month, day)
  const updated = iso(NOW - r.ago * HOUR)
  const n: DtNode = {
    id: r.id,
    title: lang === 'en' ? r.en : r.zh,
    parent: r.parent,
    status: r.status,
    kind: 'decision',
    createdAt: decided,
    createdBy: r.by,
    updatedAt: updated,
    notes: [],
    addedBy: `${r.id}.json`,
    decidedAt: decided,
    decidedBy: r.by,
  }
  if (r.trunk) n.trunk = true
  if (detail !== null) {
    const i = at(lang)
    n.summary = detail.summary[i]
    n.rationale = detail.rationale[i]
    n.evidence = detail.evidence.map((e): DtEvidence => ({ label: e.label[i], value: e.value[i], run: e.run }))
    n.sources = [...detail.sources]
    const [month2, day2] = detail.note.date.split('-').map(Number) as [number, number]
    n.notes = [{ ts: noon(month2, day2), actor: detail.note.actor, text: detail.note.text[i] }]
  }
  return n
}

function modelOf(nodes: DtNode[], over: Partial<DtModel> = {}): DtModel {
  return {
    isStarted: true,
    startedAt: noon(9, 1),
    nodes,
    warnings: [],
    warningCount: 0,
    eventCount: nodes.length,
    lastEventAt: iso(NOW),
    fork: null,
    ...over,
  }
}

/** The main tree, its texts in one language. */
export function notesModel(lang: DtLang = 'en'): DtModel {
  return modelOf(MAIN_RAW.map(r => nodeOf(r, lang, r.id === 'n3' ? CONFLICTS : null)))
}

/** Where the crdt-engine tree began: the fifth event of main (Sync), on 09-21. */
export const CRDT_FORK = (lang: DtLang = 'en'): DtFork => ({
  tree: 'main',
  at: eventFileName(Date.UTC(2026, 8, 21, 12, 0, 0), 'abcdef', 5),
  count: 5,
  ts: noon(10, 7),
  actor: 'user',
  title: lang === 'en' ? 'CRDT text engine instead of paragraph merge' : '用 CRDT 文本引擎代替按段落合并',
})

/** The crdt-engine tree, its texts in one language. */
export function crdtModel(lang: DtLang = 'en'): DtModel {
  return modelOf(CRDT_RAW.map(r => nodeOf(r, lang, r.id === 'x3' ? PROTOTYPE : null)), { fork: CRDT_FORK(lang), eventCount: 14 })
}

/** The translation memory of a tree written in `written`: what each of its texts reads like in the other language. */
export function notesTm(written: DtLang, trees: ('main' | 'crdt')[] = ['main']): DtTm {
  const tm: DtTm = { en: {}, zh: {} }
  const from = at(written)
  const to = 1 - from
  const into = written === 'zh' ? tm.en : tm.zh
  const pair = (a: [string, string]) => {
    into[a[from]!] = a[to]!
  }
  for (const which of trees) {
    for (const r of which === 'main' ? MAIN_RAW : CRDT_RAW) pair([r.en, r.zh])
  }
  for (const o of CLOUD_OWN) pair([o.en, o.zh])
  pair([CRDT_FORK('en').title!, CRDT_FORK('zh').title!])
  pair(CLOUD_TITLE)
  for (const d of [CONFLICTS, PROTOTYPE]) {
    pair(d.summary)
    pair(d.rationale)
    pair(d.note.text)
    for (const e of d.evidence) {
      pair(e.label)
      pair(e.value)
    }
  }
  return tm
}

/** The step of a tree, as the overview draws it: the day it was decided on and the event file that recorded it. */
type Own = { id: string; status: DtStatus; decided: [month: number, day: number]; recorded: [month: number, day: number, seq: number]; head: boolean; en: string; zh: string }

/** What the first tree recorded itself: all of its steps. */
const MAIN_OWN: Own[] = [
  { id: 'n0', status: 'adopted', decided: [9, 2], recorded: [9, 2, 2], head: false, en: MAIN_RAW[0]!.en, zh: MAIN_RAW[0]!.zh },
  { id: 'n1', status: 'adopted', decided: [9, 14], recorded: [9, 14, 3], head: false, en: MAIN_RAW[3]!.en, zh: MAIN_RAW[3]!.zh },
  { id: 'n2', status: 'adopted', decided: [9, 21], recorded: [9, 21, 5], head: false, en: MAIN_RAW[5]!.en, zh: MAIN_RAW[5]!.zh },
  { id: 'n3', status: 'adopted', decided: [10, 1], recorded: [10, 1, 8], head: false, en: MAIN_RAW[8]!.en, zh: MAIN_RAW[8]!.zh },
  { id: 'n16', status: 'adopted', decided: [10, 6], recorded: [10, 6, 14], head: true, en: MAIN_RAW[13]!.en, zh: MAIN_RAW[13]!.zh },
  { id: 'n8', status: 'planned', decided: [10, 6], recorded: [10, 6, 15], head: false, en: MAIN_RAW[14]!.en, zh: MAIN_RAW[14]!.zh },
]

/** What the crdt-engine tree recorded itself, after it was opened. */
const CRDT_OWN: Own[] = [
  { id: 'x1', status: 'adopted', decided: [9, 28], recorded: [10, 7, 1], head: true, en: CRDT_RAW[4]!.en, zh: CRDT_RAW[4]!.zh },
  { id: 'x4', status: 'planned', decided: [10, 7], recorded: [10, 7, 6], head: false, en: CRDT_RAW[8]!.en, zh: CRDT_RAW[8]!.zh },
]

/** What the cloud-first tree recorded itself. */
const CLOUD_OWN: Own[] = [
  {
    id: 'c1',
    status: 'adopted',
    decided: [9, 16],
    recorded: [9, 16, 1],
    head: false,
    en: 'Sync: the server owns the data, phones keep a cache',
    zh: '同步：数据归服务器，手机只留缓存',
  },
  {
    id: 'c2',
    status: 'adopted',
    decided: [9, 22],
    recorded: [9, 22, 2],
    head: true,
    en: 'Offline editing comes later; a read-only cache until then',
    zh: '离线编辑以后再做；在那之前缓存只读',
  },
]

const stepsOf = (own: Own[], lang: DtLang): DtGraphStep[] =>
  own.map(o => ({
    id: o.id,
    title: lang === 'en' ? o.en : o.zh,
    status: o.status,
    at: noon(...o.decided),
    by: eventFileName(Date.UTC(2026, o.recorded[0] - 1, o.recorded[1], 12), 'abcdef', o.recorded[2]),
    head: o.head,
  }))

const CLOUD_TITLE: [string, string] = ['Server-first sync, offline later', '服务器优先的同步，离线以后再做']

/** Where the cloud-first tree began: the third event of main (Storage), on 09-14. */
export const CLOUD_FORK = (lang: DtLang = 'en'): DtFork => ({
  tree: 'main',
  at: eventFileName(Date.UTC(2026, 8, 14, 12), 'abcdef', 3),
  count: 3,
  ts: noon(9, 15),
  actor: 'user',
  title: CLOUD_TITLE[at(lang)],
})

/** The three trees of the sample, in the order the tabs list them, its texts in one language. */
export function treesOf(lang: DtLang = 'en'): DtTreeInfo[] {
  const fork = CRDT_FORK(lang)
  const cloud = CLOUD_FORK(lang)
  return [
    { name: 'main', title: lang === 'en' ? MAIN_RAW[0]!.en : MAIN_RAW[0]!.zh, fork: null, nodes: 17, steps: 6, events: 17, lastEventAt: iso(NOW), lastActor: 'model', own: stepsOf(MAIN_OWN, lang) },
    {
      name: 'crdt-engine',
      title: fork.title ?? null,
      fork: { tree: fork.tree, at: fork.at, count: fork.count },
      nodes: 9,
      steps: 5,
      events: 14,
      lastEventAt: iso(NOW - 5 * 60_000),
      lastActor: 'model',
      own: stepsOf(CRDT_OWN, lang),
    },
    {
      name: 'cloud-first',
      title: cloud.title ?? null,
      fork: { tree: cloud.tree, at: cloud.at, count: cloud.count },
      nodes: 6,
      steps: 4,
      events: 11,
      lastEventAt: noon(9, 22),
      lastActor: 'user',
      own: stepsOf(CLOUD_OWN, lang),
    },
  ]
}

export const TREES: DtTreeInfo[] = treesOf('en')

/**
 * A project with a lot of trees, for the lists that have to be windowed: the sample's first tree and `count - 1` more,
 * opened from its Storage step or its Sync step, each with a step or three of its own (one of them with none yet) and
 * names of every length a tree may have.
 */
export function manyTrees(count: number, lang: DtLang = 'en'): DtTreeInfo[] {
  const main = treesOf(lang)[0]!
  const out: DtTreeInfo[] = [main]
  const ideas: [string, string][] = [
    ['shorter timeouts', '更短的超时'],
    ['a smaller cache', '更小的缓存'],
    ['batch the writes', '把写入攒成批'],
  ]
  for (let k = 1; k < count; k++) {
    // (names of every length a tree may have: the longest is 32 characters)
    const name = k % 5 === 0 ? `long-experiment-name-number-${String(k).padStart(4, '0')}` : `try-${String(k).padStart(2, '0')}`
    const fork = k % 2 === 0 ? CRDT_FORK(lang) : CLOUD_FORK(lang)
    const idea = ideas[k % ideas.length]![lang === 'en' ? 0 : 1]
    const own: DtGraphStep[] =
      k === 3
        ? []
        : Array.from({ length: (k % 3) + 1 }, (_, j) => ({
            id: `s${j + 1}`,
            title: lang === 'en' ? `Variant ${k}, step ${j + 1}: ${idea}` : `变体 ${k}，第 ${j + 1} 步：${idea}`,
            status: j === 0 ? ('adopted' as const) : ('planned' as const),
            at: noon(10, 1 + ((k * 3 + j) % 27)),
            by: eventFileName(Date.UTC(2026, 9, 14 + (k % 10), 12), 'abcdef', 100 + k * 10 + j),
            head: j === 0,
          }))
    out.push({
      name,
      title: lang === 'en' ? `Variant ${k}: ${idea}` : `变体 ${k}：${idea}`,
      fork: { tree: fork.tree, at: fork.at, count: fork.count },
      nodes: 6 + own.length * 2,
      steps: 4 + own.length,
      events: 8 + own.length * 2,
      lastEventAt: iso(NOW - k * 7 * HOUR),
      lastActor: k % 2 === 0 ? 'model' : 'user',
      own,
    })
  }
  return out
}

export function projectOf(over: Partial<DtProject> = {}): DtProject {
  return {
    root: '/work/notes-app',
    mode: 'recording',
    config: { ...defaultConfig('notes-app', noon(9, 1)) },
    configError: null,
    tree: 'main',
    ...over,
  }
}

export const NOW_NONE: DtNow = { approval: 'none', argv: [], data: null, fetchedAt: null, error: null }

export const NOW_DATA: DtNowData = {
  updatedAt: iso(NOW - 60_000),
  lanes: [
    { name: 'ALPHA', run: 'sync-bench s0', state: 'running', step: 1700, total: 2000, eta: '18:40', note: 'warming up' },
    { name: 'BRAVO', run: 'merge-eval s1', state: 'running', step: 210, total: 2000, eta: '07:25', note: '' },
    { name: 'CHARLIE', run: 'queue-soak s0', state: 'idle', step: null, total: null, eta: '', note: '' },
  ],
  next: [{ text: 'restore-test s1', eta: '05:05' }],
  warnings: ['CHARLIE is idle'],
}

export function nowApproved(over: Partial<DtNow> = {}): DtNow {
  return { approval: 'approved', argv: ['bash', 'scripts/status.sh'], data: NOW_DATA, fetchedAt: NOW - 10_000, error: null, ...over }
}

export const NOW_PENDING: DtNow = { approval: 'pending', argv: ['bash', 'scripts/status.sh'], data: null, fetchedAt: null, error: null }
