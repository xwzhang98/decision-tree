import { test, expect } from 'claude-code/testing'

import { KIND_COLOUR, kindsOf, richSpans, runSpans, runsOf, wrapRuns } from '../lib/highlight'
import type { Kind } from '../lib/highlight'
import { wrap } from '../lib/width'

/** The words of `text` of one kind, in order. */
function words(text: string, kind: Kind, topic = false): string[] {
  return runsOf(text, topic)
    .filter(r => r.kind === kind)
    .map(r => r.text)
}

test('highlight: the part of a title before its first colon is its topic', () => {
  expect(words('Storage: use SQLite locally', 'topic', true)).toEqual(['Storage:'])
  expect(words('存储层：采用 sqlite', 'topic', true)).toEqual(['存储层：'])
  // only a title has one, and only a colon that ends a word
  expect(words('Storage: use it', 'topic')).toEqual([])
  expect(words('see http://x.test/a', 'topic', true)).toEqual([])
  expect(words('a very long first part that has no business being a topic here: x', 'topic', true)).toEqual([])
  expect(words('No colon at all', 'topic', true)).toEqual([])
  expect(words('"Quoted: stuff" first', 'topic', true)).toEqual([])
})

test('highlight: numbers keep their unit and leave versions and identifiers alone', () => {
  expect(words('rev2 gained 12% in 5 s, 1,200 rows, 3.5 MB, issue #9', 'num')).toEqual(['12%', '5 s', '1,200', '3.5 MB', '#9'])
  expect(words('run 3 rerun', 'num')).toEqual(['3'])
  expect(words('upgrade to v1.2 or abc123', 'num')).toEqual([])
  // a number right against Chinese text is still a number
  expect(words('耗时5秒，共12个', 'num')).toEqual(['5秒', '12'])
  expect(words('12 ms but 3 sessions', 'num')).toEqual(['12 ms', '3'])
})

test('highlight: dates and times', () => {
  expect(words('decided 10-12 at 09:30', 'date')).toEqual(['10-12', '09:30'])
  expect(words('3.14 and 1.30', 'date')).toEqual([])
  // a date is not also a number
  expect(words('10-12', 'num')).toEqual([])
})

test('highlight: technical words are ALLCAPS, snake_case or camelCase', () => {
  expect(words('SQLite and CRDT, proto_b, getUser and the API', 'term')).toEqual(['SQLite', 'CRDT', 'proto_b', 'getUser', 'API'])
  expect(words('plain words and Redis and Postgres', 'term')).toEqual([])
  expect(words('a_ b', 'term')).toEqual([])
})

test('highlight: quoted phrases, in any of the four quotes', () => {
  expect(words('say "hello there" or “你好” or 「引用」 or `code_x`', 'quote')).toEqual(['"hello there"', '“你好”', '「引用」', '`code_x`'])
  // the first kind to claim a stretch keeps it: nothing inside a quote is a number or a term
  const inside = runsOf('keep "3 retries of CRDT" here')
  expect(inside.map(r => r.kind)).toEqual([null, 'quote', null])
})

test('highlight: runs join back into the text, and equal neighbours are one run', () => {
  const text = 'Storage: 5 s of SQLite "at most" 10-12 — 😀 ok'
  const runs = runsOf(text, true)
  expect(runs.map(r => r.text).join('')).toBe(text)
  for (let i = 1; i < runs.length; i++) expect(runs[i]!.kind === runs[i - 1]!.kind).toBe(false)
  expect(kindsOf(text, true).length).toBe(text.length)
  expect(runsOf('')).toEqual([])
})

test('highlight: wrapRuns keeps a colour across a line break and agrees with wrap', () => {
  const text = 'Pick the "merge queue of the editor" for SQLite and 5,000 rows'
  for (const width of [10, 16, 24, 80]) {
    const lines = wrapRuns(text, width)
    expect(lines.map(runs => runs.map(r => r.text).join(''))).toEqual(wrap(text, width))
  }
  // the quote is cut by the break and green on both lines
  const cut = wrapRuns(text, 24)
  const quoted = cut.map(runs => runs.filter(r => r.kind === 'quote').map(r => r.text).join(''))
  expect(quoted.filter(q => q !== '').length).toBeGreaterThan(1)
  expect(quoted.join(' ').replace(/ +/g, ' ')).toContain('"merge queue')
  // a topic only colours the first line
  const topics = wrapRuns('Storage: use SQLite for the local files of the project', 20, true)
  expect(topics[0]![0]).toEqual({ text: 'Storage:', kind: 'topic' })
  expect(topics.slice(1).flat().some(r => r.kind === 'topic')).toBe(false)
})

test('highlight: wrapRuns copes with blank lines, indents and Chinese text', () => {
  expect(wrapRuns('a\n\nb', 10).map(l => l.map(r => r.text).join(''))).toEqual(['a', '', 'b'])
  const indented = wrapRuns('first\n  second 5 s', 20)
  expect(indented.map(l => l.map(r => r.text).join(''))).toEqual(['first', '  second 5 s'])
  expect(indented[1]!.some(r => r.kind === 'num' && r.text === '5 s')).toBe(true)
  const zh = wrapRuns('存储层采用 SQLite，超时 5 秒后重试，共 3 次', 14, false)
  expect(zh.map(l => l.map(r => r.text).join(''))).toEqual(wrap('存储层采用 SQLite，超时 5 秒后重试，共 3 次', 14))
  expect(zh.flat().filter(r => r.kind === 'term').map(r => r.text)).toEqual(['SQLite'])
})

test('highlight: spans take the colour of their kind on top of the style of the line', () => {
  const spans = runSpans(runsOf('Use SQLite for 5 s at 09:30'), { bold: true })
  expect(spans.map(s => s.text).join('')).toBe('Use SQLite for 5 s at 09:30')
  const by = (text: string) => spans.find(s => s.text === text)!
  expect(by('SQLite')).toEqual({ text: 'SQLite', bold: true, color: KIND_COLOUR.term })
  expect(by('5 s')).toEqual({ text: '5 s', bold: true, color: KIND_COLOUR.num })
  // a date is grey and dim whatever the line is
  expect(by('09:30')).toEqual({ text: '09:30', bold: true, color: 'inactive', dim: true })
  // plain words keep the style they came with, colour included
  const quiet = richSpans('plain SQLite', { color: 'inactive', dim: true })
  expect(quiet[0]).toEqual({ text: 'plain ', color: 'inactive', dim: true })
  expect(quiet[1]).toEqual({ text: 'SQLite', color: KIND_COLOUR.term, dim: true })
})

test('highlight: every kind has a colour and they are theme keys', () => {
  for (const kind of ['topic', 'num', 'term', 'quote', 'date'] as const) expect(KIND_COLOUR[kind]).toMatch(/^[a-zA-Z]+$/)
})
