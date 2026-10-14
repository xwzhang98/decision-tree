import { test, expect } from 'claude-code/testing'

import { MAX_PAIRS_PER_FILE, TmStore, parseBatch } from '../lib/tm'
import { MemDisk } from './mem'

const ROOT = '/work/proj'
const DIR = `${ROOT}/.claude/decisions/i18n`
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)

const files = (disk: MemDisk) => [...disk.files.keys()].filter(p => p.startsWith(`${DIR}/`)).sort()

test('tm: a folder that is not there is an empty memory', async () => {
  const store = new TmStore(new MemDisk(), ROOT, 'abc123')
  expect(await store.sync()).toBe(false)
  expect(store.tm()).toEqual({ en: {}, zh: {} })
})

test('tm: append writes one file per job, named like an event, and the memory has the pairs at once', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  const n = await store.append('en', [{ from: '存储层采用', to: 'Adopt the local store' }], { actor: 'model', via: 'tool' }, T0)
  expect(n).toBe(1)
  expect(files(disk)).toEqual([`${DIR}/20261010T120000000Z_abc123_0000.json`])
  const body = JSON.parse(disk.text(files(disk)[0]!))
  expect(body).toMatchObject({ v: 1, session: 'abc123', actor: 'model', via: 'tool', lang: 'en', pairs: [{ from: '存储层采用', to: 'Adopt the local store' }] })
  expect(Date.parse(body.ts)).toBe(T0)
  expect(store.tm().en['存储层采用']).toBe('Adopt the local store')
})

test('tm: another session reads the files and both end up with the same memory', async () => {
  const disk = new MemDisk()
  const a = new TmStore(disk, ROOT, 'aaaaaa')
  const b = new TmStore(disk, ROOT, 'bbbbbb')
  await a.append('en', [{ from: '一', to: 'one' }], { actor: 'model', via: 'translator' }, T0)
  await b.append('zh', [{ from: 'Two words', to: '两个 words' }], { actor: 'model', via: 'translator' }, T0)
  expect(await a.sync()).toBe(true)
  expect(await b.sync()).toBe(true)
  expect(a.tm()).toEqual(b.tm())
  expect(a.tm()).toEqual({ en: { 一: 'one' }, zh: { 'Two words': '两个 words' } })
  // nothing new: no change, and no file is read again
  const reads = disk.reads.length
  expect(await a.sync()).toBe(false)
  expect(disk.reads.length).toBe(reads)
})

test('tm: a later file wins for the same text, whichever session wrote it', async () => {
  const disk = new MemDisk()
  const a = new TmStore(disk, ROOT, 'aaaaaa')
  const b = new TmStore(disk, ROOT, 'bbbbbb')
  await a.append('en', [{ from: '采用', to: 'Adopted' }], { actor: 'model', via: 'translator' }, T0)
  await b.sync()
  await b.append('en', [{ from: '采用', to: 'Accepted' }], { actor: 'user', via: 'tool' }, T0 + 1000)
  await a.sync()
  expect(a.tm().en['采用']).toBe('Accepted')
  expect(b.tm().en['采用']).toBe('Accepted')
})

test('tm: a pair the memory has already is not written again, and a repeat within a call counts once', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  const by = { actor: 'model', via: 'translator' } as const
  expect(await store.append('en', [{ from: '甲', to: 'A' }, { from: '甲', to: 'A again' }, { from: '乙', to: 'B' }], by, T0)).toBe(2)
  expect(await store.append('en', [{ from: '甲', to: 'A' }], by, T0 + 10)).toBe(0)
  expect(files(disk).length).toBe(1)
  // a different rendition of a known text is new
  expect(await store.append('en', [{ from: '甲', to: 'Alpha' }], by, T0 + 20)).toBe(1)
  expect(store.tm().en['甲']).toBe('Alpha')
})

test('tm: empty and oversized pairs are dropped, control characters are stripped from what is stored', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  const by = { actor: 'model', via: 'tool' } as const
  const n = await store.append('en', [{ from: '', to: 'x' }, { from: '空', to: '   ' }, { from: 'x'.repeat(20001), to: 'y' }, { from: '好', to: 'fine\u001b[31m' }], by, T0)
  expect(n).toBe(1)
  expect(store.tm().en['好']).toBe('fine[31m')
})

test('tm: many pairs are split over files of at most MAX_PAIRS_PER_FILE', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  const pairs = Array.from({ length: MAX_PAIRS_PER_FILE * 2 + 5 }, (_, k) => ({ from: `文本${k}`, to: `text ${k}` }))
  expect(await store.append('en', pairs, { actor: 'model', via: 'translator' }, T0)).toBe(pairs.length)
  expect(files(disk).length).toBe(3)
  const fresh = new TmStore(disk, ROOT, 'other1')
  await fresh.sync()
  expect(Object.keys(fresh.tm().en).length).toBe(pairs.length)
})

test('tm: files that do not make sense are left out and reported, the rest still count', async () => {
  const disk = new MemDisk()
  disk.put(`${DIR}/20261010T120000000Z_aaaaaa_0000.json`, '{not json')
  disk.put(`${DIR}/20261010T120000001Z_aaaaaa_0001.json`, JSON.stringify({ v: 2, lang: 'en', pairs: [] }))
  disk.put(`${DIR}/20261010T120000002Z_aaaaaa_0002.json`, JSON.stringify({ v: 1, lang: 'fr', pairs: [] }))
  disk.put(`${DIR}/20261010T120000003Z_aaaaaa_0003.json`, JSON.stringify({ v: 1, lang: 'en', pairs: [{ from: '好', to: 'good' }, { from: 3, to: 'x' }, 'junk', { from: '坏' }] }))
  disk.put(`${DIR}/.hidden.json`, JSON.stringify({ v: 1, lang: 'en', pairs: [{ from: '藏', to: 'hidden' }] }))
  disk.put(`${DIR}/notes.txt`, 'not a batch')
  const store = new TmStore(disk, ROOT, 'bbbbbb')
  await store.sync()
  expect(store.tm()).toEqual({ en: { 好: 'good' }, zh: {} })
  expect(store.problems().map(p => p.split(': ')[1])).toEqual(['not valid JSON', 'unknown version 2', 'unknown lang "fr"'])
})

test('tm: a half written file is read again a few times and counted once it is whole', async () => {
  const disk = new MemDisk()
  const path = `${DIR}/20261010T120000000Z_aaaaaa_0000.json`
  disk.put(path, '{"v": 1, "lang": "en", "pa')
  const store = new TmStore(disk, ROOT, 'bbbbbb')
  await store.sync()
  expect(store.tm().en).toEqual({})
  disk.put(path, JSON.stringify({ v: 1, lang: 'en', pairs: [{ from: '好', to: 'good' }] }))
  expect(await store.sync()).toBe(true)
  expect(store.tm().en['好']).toBe('good')
})

test('tm: a folder that cannot be read is an error, and the store keeps what it holds', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  await store.append('en', [{ from: '好', to: 'good' }], { actor: 'model', via: 'tool' }, T0)
  disk.listFailing.add(DIR)
  let failed = false
  try {
    await store.sync()
  } catch {
    failed = true
  }
  expect(failed).toBe(true)
  expect(store.tm().en['好']).toBe('good')
})

test('tm: a new file never sorts before one already held, even on a clock that runs behind', async () => {
  const disk = new MemDisk()
  const store = new TmStore(disk, ROOT, 'abc123')
  const by = { actor: 'model', via: 'tool' } as const
  await store.append('en', [{ from: '一', to: 'one' }], by, T0 + 60_000)
  await store.append('en', [{ from: '二', to: 'two' }], by, T0) // the clock went back
  const names = files(disk).map(p => p.slice(DIR.length + 1))
  expect([...names].sort()).toEqual(names)
  expect(names[1]! > names[0]!).toBe(true)
})

test('tm: parseBatch reads what append writes', () => {
  expect(parseBatch(JSON.stringify({ v: 1, lang: 'zh', pairs: [{ from: 'Use it', to: '用它' }] }))).toEqual({ lang: 'zh', pairs: [{ from: 'Use it', to: '用它' }] })
  expect('problem' in parseBatch('[]')).toBe(true)
  expect('problem' in parseBatch('null')).toBe(true)
})
