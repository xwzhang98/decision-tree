import { test, expect } from 'claude-code/testing'

import type { DtNode } from '../types'
import { TREE_NAME } from '../lib/events'
import { MAX_SECTION, OFF_LINE, PAUSED_LINE, RECENT_IN_PROMPT, sectionText, type TreeNote } from '../lib/prompt'
import { buildIndex } from '../lib/tree'
import { strWidth } from '../lib/width'

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0)

function node(i: number, over: Partial<DtNode> = {}): DtNode {
  const at = new Date(NOW - (100 - i) * 60_000).toISOString()
  return {
    id: `node-${String(i).padStart(3, '0')}`,
    title: `决定 ${i}：把合并规则定为 v1.${i}，批的大小用比例`,
    parent: null,
    status: 'adopted',
    kind: 'decision',
    createdAt: at,
    createdBy: 'model',
    updatedAt: at,
    notes: [],
    addedBy: `${i}.json`,
    ...over,
  }
}

/** The `id · status · title` lines of a section: the recent nodes, newest first. */
const recentOf = (text: string): string[] => text.split('\n').filter(l => /^\S+ · [a-z-]+ · /.test(l))
const idsOf = (lines: string[]): string[] => lines.map(l => l.split(' · ')[0]!)
/** The widest title among such lines, in columns. */
const widestTitle = (lines: string[]): number => Math.max(...lines.map(l => strWidth(l.split(' · ').slice(2).join(' · '))))

test('prompt: off is one line, paused is one line', () => {
  expect(sectionText('off', null)).toBe(OFF_LINE)
  expect(OFF_LINE.split('\n')).toHaveLength(1)
  expect(OFF_LINE).toContain('decision_log_start')
  expect(OFF_LINE).toContain('从现在开始记录决定')
  expect(sectionText('paused', buildIndex({ nodes: [node(1)] }))).toBe(PAUSED_LINE)
  expect(PAUSED_LINE.split('\n')).toHaveLength(1)
})

test('prompt: on carries the rules, the mainline and the last ten nodes, and fits the limit', () => {
  const nodes: DtNode[] = []
  for (let i = 1; i <= 40; i++) nodes.push(node(i, { trunk: i % 5 === 0 }))
  const text = sectionText('recording', buildIndex({ nodes }))
  expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
  expect(text).toContain('decision_record')
  expect(text).toContain('decision_tree')
  expect(text).toContain('evidence.run')
  expect(text).toContain('superseded')
  // the language rule in a line: the user's language, professional names and common work words in English, and `en` for the rest
  expect(text).toContain('professional names and common work words')
  expect(text).toContain('also needs en')
  expect(text).toContain('Mainline: ')
  expect(text).toContain('node-040 · adopted')
  expect(text).not.toContain('node-001 ·')
  expect(text).toContain('node-040')
  // mainline entries are id and title
  expect(text).toMatch(/node-035 "决定 35/)
})

test('prompt: ten recent nodes with long titles and long ids still fit, the titles giving way first', () => {
  // fourteen nodes, every other one on the mainline; titles far longer than the section can show,
  // and ids from 8 characters up to the 48 that the mod itself makes
  const slug = 'sync-ram-queue-sizes-timer-all-by-fraction-'
  const idOf = (i: number, length: number) => slug.repeat(2).slice(0, length - 5) + String(i).padStart(5, '0')
  const sectionFor = (idLength: number): string => {
    const nodes: DtNode[] = []
    for (let i = 1; i <= 14; i++) {
      const title = `决定 ${i}：把合并规则定为 v1.${i}，批的大小、重试、队列全部用比例并加上缓存区比例`
      nodes.push(node(i, { id: idOf(i, idLength), title, trunk: i % 2 === 0 }))
    }
    return sectionText('recording', buildIndex({ nodes }))
  }

  const titleWidths: number[] = []
  const mainlineLengths: number[] = []
  for (const idLength of [8, 20, 24, 32, 40, 48]) {
    const text = sectionFor(idLength)
    expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
    // all ten recent nodes, the newest first, each with its whole id; the ones before them are not listed
    const recent = recentOf(text)
    expect(idsOf(recent)).toEqual(Array.from({ length: RECENT_IN_PROMPT }, (_, k) => idOf(14 - k, idLength)))
    expect(text).not.toContain(idOf(3, idLength))
    expect(text).not.toContain(idOf(1, idLength))
    titleWidths.push(widestTitle(recent))
    mainlineLengths.push(text.split('\n').find(l => l.startsWith('Mainline: '))!.split(' > ').length)
  }
  // what gives way as the ids grow is the title, from 36 columns down to 10, and the mainline gets shorter with it
  expect(titleWidths).toEqual([36, 30, 24, 18, 14, 10])
  expect(mainlineLengths).toEqual([7, 6, 5, 4, 3, 2])

  // the longest ids, in full: whole ids, a title cut to the number and a mark, a mainline of two
  const id = (i: number) => idOf(i, 48)
  expect(sectionFor(48).split('\n').slice(4)).toEqual([
    `Mainline: ${id(12)} "决定 12：…" > ${id(14)} "决定 14：…"`,
    'Recent (id · status · title):',
    ...Array.from({ length: RECENT_IN_PROMPT }, (_, k) => `${id(14 - k)} · adopted · 决定 ${14 - k}：…`),
  ])
})

test('prompt: with short titles the last ten nodes all fit', () => {
  const nodes: DtNode[] = []
  for (let i = 1; i <= 12; i++) nodes.push(node(i, { title: `step ${i}` }))
  const text = sectionText('recording', buildIndex({ nodes }))
  const lines = text.split('\n').filter(l => /^node-\d+ · /.test(l))
  expect(lines).toHaveLength(10)
  expect(lines[0]).toBe('node-012 · adopted · step 12')
  expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
})

test('prompt: an empty record says where to start', () => {
  const text = sectionText('recording', buildIndex({ nodes: [] }))
  expect(text).toContain('Nothing is recorded yet')
  expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
})

test('prompt: retracted nodes are not offered as parents', () => {
  const nodes = [node(1), node(2, { retracted: { ts: new Date(NOW).toISOString(), actor: 'user' } })]
  const text = sectionText('recording', buildIndex({ nodes }))
  expect(text).toContain('node-001')
  expect(text).not.toContain('node-002')
})

// ---------------------------------------------------------------- a tree other than main

const TREE_LINE_END = '. What you record goes into it, and the list below is its.'

test('prompt: a tree other than main is named, with where it began, and the section still fits', () => {
  const nodes: DtNode[] = []
  for (let i = 1; i <= 40; i++) nodes.push(node(i, { trunk: i % 5 === 0 }))
  const idx = buildIndex({ nodes })
  const note: TreeNote = { name: 'side-b', from: 'from main at #17 (10-08 17:44)' }
  const text = sectionText('recording', idx, note)
  const lines = text.split('\n')
  const without = sectionText('recording', idx)

  // one line, after the four lines of rules and before the tree it speaks of
  expect(lines[4]).toBe('Current tree: side-b (from main at #17 (10-08 17:44)). What you record goes into it, and the list below is its.')
  expect(lines[5]!.startsWith('Mainline: ')).toBe(true)
  expect(lines.filter(l => l.startsWith('Current tree: '))).toHaveLength(1)
  expect(lines.slice(0, 4)).toEqual(without.split('\n').slice(0, 4))

  // the section still fits and still lists the ten newest; the room for the line came out of the titles
  expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
  expect(idsOf(recentOf(text))).toEqual(Array.from({ length: RECENT_IN_PROMPT }, (_, k) => `node-${String(40 - k).padStart(3, '0')}`))
  expect(without.length).toBeLessThanOrEqual(MAX_SECTION)
  expect(widestTitle(recentOf(text))).toBeLessThan(widestTitle(recentOf(without)))

  // the main tree is not named: no line, and null is the same as nothing
  expect(without).not.toContain('Current tree')
  expect(sectionText('recording', idx, null)).toBe(without)
})

test('prompt: an empty tree and a tree of unknown origin are named too', () => {
  // a tree that began empty: named, and then only the first decision is left to say
  const began: TreeNote = { name: 'scratch', from: 'started empty' }
  const empty = sectionText('recording', buildIndex({ nodes: [] }), began)
  expect(empty.split('\n').slice(4)).toEqual([
    `Current tree: scratch (started empty)${TREE_LINE_END}`,
    'Nothing is recorded yet: the first decision has parent null.',
  ])
  expect(empty.length).toBeLessThanOrEqual(MAX_SECTION)
  // before the tree has been replayed it reads the same
  expect(sectionText('recording', null, began)).toBe(empty)
  expect(sectionText('recording', null)).not.toContain('Current tree')

  // a tree whose beginning is not known, because there is no fork event to read: the name alone, no empty brackets
  const unknown: TreeNote = { name: 'old-tree', from: '' }
  const bare = `Current tree: old-tree${TREE_LINE_END}`
  expect(sectionText('recording', buildIndex({ nodes: [] }), unknown).split('\n').slice(4)).toEqual([bare, 'Nothing is recorded yet: the first decision has parent null.'])
  const nodes = [node(1), node(2, { parent: 'node-001' })]
  const text = sectionText('recording', buildIndex({ nodes }), unknown)
  expect(text.split('\n')[4]).toBe(bare)
  expect(text).not.toContain('()')
  expect(text).not.toContain('old-tree (')
  expect(idsOf(recentOf(text))).toEqual(['node-002', 'node-001'])

  // a project that is off or paused says its one line, whatever tree it was on
  expect(sectionText('off', null, began)).toBe(OFF_LINE)
  expect(sectionText('paused', buildIndex({ nodes }), unknown)).toBe(PAUSED_LINE)
})

test('prompt: the worst case with a tree line still fits', () => {
  // the longest name a tree may have, a beginning in a tree with another such name and a six-digit count,
  // the longest status, long titles, every node on the mainline, and ids as long as the mod makes them (48)
  // and as long as an imported event may bring (64)
  const name = 'longest-name-a-tree-may-have-xyz'
  expect(name).toHaveLength(32)
  expect(name).toMatch(TREE_NAME)
  const from = 'from another-tree-with-a-long-name-xy at #123456 (12-31 23:59)'
  const line = `Current tree: ${name} (${from})${TREE_LINE_END}`
  const slug = 'sync-ram-queue-sizes-timer-all-by-fraction-'
  const idOf = (i: number, length: number) => slug.repeat(2).slice(0, length - 5) + String(i).padStart(5, '0')
  const rules = sectionText('recording', null).split('\n').slice(0, 4)

  const counts: number[] = []
  for (const idLength of [48, 64]) {
    const nodes: DtNode[] = []
    for (let i = 1; i <= 30; i++) {
      const title = `决定 ${i}：把合并规则定为 v1.${i}，批的大小、重试、队列全部用比例并加上缓存区比例`
      nodes.push(node(i, { id: idOf(i, idLength), title, status: 'in-progress', trunk: true }))
    }
    const text = sectionText('recording', buildIndex({ nodes }), { name, from })
    const lines = text.split('\n')
    expect(text.length).toBeLessThanOrEqual(MAX_SECTION)
    // the rules and the whole tree line are there, and the tree is made of whole entries
    expect(lines.slice(0, 4)).toEqual(rules)
    expect(lines[4]).toBe(line)
    expect(lines[5]).toBe(`Mainline: ${idOf(30, idLength)} "决定 30…"`)
    expect(lines[6]).toBe('Recent (id · status · title):')
    // what goes is the oldest of the recent nodes: the ones that stay are the newest, in order
    const recent = recentOf(text)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent.length).toBeLessThan(RECENT_IN_PROMPT)
    expect(idsOf(recent)).toEqual(Array.from({ length: recent.length }, (_, k) => idOf(30 - k, idLength)))
    expect(lines.at(-1)).toBe(recent.at(-1))
    for (const l of recent) expect(l).toMatch(/^[a-z0-9-]+ · in-progress · 决定 \d+…$/)
    counts.push(recent.length)
  }
  // longer ids leave room for fewer of them
  expect(counts[1]).toBeLessThan(counts[0]!)
})
