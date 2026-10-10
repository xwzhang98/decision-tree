import { test, expect } from 'claude-code/testing'

import type { DecisionEvent } from '../types'
import {
  MAX_ID,
  autoId,
  eventFileName,
  fmtClock,
  fmtDate,
  isEventFile,
  isIso,
  isoLocal,
  parseEventText,
  parseTime,
  shortSession,
  slugify,
  uniqueId,
  utcStamp,
} from '../lib/events'
import { replay } from '../lib/replay'
import type { ReplayEntry } from '../lib/replay'

let seq = 0
function ev(partial: Partial<DecisionEvent> & Pick<DecisionEvent, 'op'>): ReplayEntry {
  seq += 1
  const sec = String(seq % 60).padStart(2, '0')
  return {
    name: `e${String(seq).padStart(4, '0')}.json`,
    event: { v: 1, session: 'aaaaaa', actor: 'model', ts: `2026-10-10T00:00:${sec}.000Z`, ...partial },
  }
}
const add = (id: string, parent: string | null, extra: Record<string, unknown> = {}, actor: DecisionEvent['actor'] = 'model') =>
  ev({ op: 'add', id, actor, node: { title: `title ${id}`, parent, status: 'adopted', kind: 'decision', ...extra } as never })

test('replay: add builds a node and update overwrites field by field', () => {
  const m = replay([
    ev({ op: 'start' }),
    add('root-node', null, { trunk: true, summary: 'first' }),
    ev({ op: 'update', id: 'root-node', patch: { status: 'rejected', summary: 'second' } }),
    ev({ op: 'note', id: 'root-node', text: 'a note' }),
  ])
  expect(m.isStarted).toBe(true)
  expect(m.nodes).toHaveLength(1)
  const n = m.nodes[0]!
  expect(n.status).toBe('rejected')
  expect(n.summary).toBe('second')
  expect(n.trunk).toBe(true)
  expect(n.title).toBe('title root-node')
  expect(n.notes).toHaveLength(1)
  expect(n.notes[0]!.text).toBe('a note')
  expect(n.createdBy).toBe('model')
  expect(m.warningCount).toBe(0)
  expect(m.eventCount).toBe(4)
})

test('replay: a duplicate id is ignored and counted as a warning', () => {
  const m = replay([add('same-id', null, { summary: 'first' }), add('same-id', null, { summary: 'second' })])
  expect(m.nodes).toHaveLength(1)
  expect(m.nodes[0]!.summary).toBe('first')
  expect(m.warningCount).toBe(1)
  expect(m.warnings[0]).toContain('duplicate id same-id')
})

test('replay: addEvidence and addSources append without duplicates; null clears', () => {
  const e1 = { label: 'warmed P99', value: '-12.6%', ci: '[-15.1, -10.4]', run: 'v22 s0' }
  const m = replay([
    add('n-one', null, { evidence: [e1], sources: ['reports/a.md'] }),
    ev({ op: 'update', id: 'n-one', patch: { addEvidence: [e1, { label: 'seed 1', value: '-13.5%' }], addSources: ['reports/a.md', 'reports/b.md'] } }),
  ])
  const n = m.nodes[0]!
  expect(n.evidence).toHaveLength(2)
  expect(n.evidence![1]!.label).toBe('seed 1')
  expect(n.sources).toEqual(['reports/a.md', 'reports/b.md'])
  const cleared = replay([
    add('n-one', null, { summary: 'x', supersededBy: 'other' }),
    ev({ op: 'update', id: 'n-one', patch: { summary: null, supersededBy: null } as never }),
  ])
  expect(cleared.nodes[0]!.summary).toBeUndefined()
  expect(cleared.nodes[0]!.supersededBy).toBeUndefined()
})

test('replay: move re-parents; a move that makes a cycle or names nothing is refused', () => {
  const m = replay([
    add('aaa', null),
    add('bbb', 'aaa'),
    add('ccc', 'bbb'),
    ev({ op: 'move', id: 'ccc', parent: 'aaa' }),
    ev({ op: 'move', id: 'aaa', parent: 'ccc' }),
    ev({ op: 'move', id: 'bbb', parent: 'does-not-exist' }),
    ev({ op: 'move', id: 'bbb', parent: 'bbb' }),
  ])
  const by = new Map(m.nodes.map(n => [n.id, n] as const))
  expect(by.get('ccc')!.parent).toBe('aaa')
  expect(by.get('aaa')!.parent).toBeNull()
  expect(by.get('bbb')!.parent).toBe('aaa')
  expect(m.warningCount).toBe(3)
})

test('replay: retract marks a node, keeps the first retraction, and update still applies', () => {
  const m = replay([
    add('wrong-one', null),
    ev({ op: 'retract', id: 'wrong-one', reason: 'recorded by mistake', actor: 'user' }),
    ev({ op: 'retract', id: 'wrong-one', reason: 'second', actor: 'model' }),
  ])
  const n = m.nodes[0]!
  expect(n.retracted!.reason).toBe('recorded by mistake')
  expect(n.retracted!.actor).toBe('user')
})

test('replay: unreadable files and unknown ids are skipped and counted', () => {
  const m = replay([
    { name: 'bad1.json', event: null, problem: 'not valid JSON' },
    add('fine-one', null),
    ev({ op: 'update', id: 'nobody', patch: { summary: 'x' } }),
    ev({ op: 'note', id: 'nobody', text: 'x' }),
    ev({ op: 'retract', id: 'nobody' }),
    ev({ op: 'add', id: 'no-status', node: { title: 't', parent: null, status: 'bogus', kind: 'decision' } as never }),
    ev({ op: 'add', id: 'no-title', node: { parent: null, status: 'adopted', kind: 'decision' } as never }),
    ev({ op: 'add', node: { title: 't', parent: null, status: 'adopted', kind: 'decision' } as never }),
  ])
  expect(m.nodes.map(n => n.id)).toEqual(['fine-one'])
  expect(m.warningCount).toBe(7)
  expect(m.warnings[0]).toBe('bad1.json: not valid JSON')
})

test('replay: two sessions changing one field, the later file name wins', () => {
  const entries = [
    { ...add('contested', null, { summary: 'base' }), name: '20261010T000000000Z_aaaaaa_0000.json' },
    { ...ev({ op: 'update', id: 'contested', patch: { summary: 'from A' } }), name: '20261010T000001000Z_aaaaaa_0001.json' },
    { ...ev({ op: 'update', id: 'contested', patch: { summary: 'from B' } }), name: '20261010T000001000Z_bbbbbb_0001.json' },
  ]
  entries.sort((a, b) => (a.name < b.name ? -1 : 1))
  expect(replay(entries).nodes[0]!.summary).toBe('from B')
})

test('replay: parents that arrive later are fine, cycles among them are cut', () => {
  const late = replay([add('child-one', 'parent-one'), add('parent-one', null)])
  expect(late.warningCount).toBe(0)
  const cyc = replay([add('xxx-1', 'yyy-2'), add('yyy-2', 'xxx-1')])
  expect(cyc.warningCount).toBe(1)
  const by = new Map(cyc.nodes.map(n => [n.id, n] as const))
  expect(by.get('yyy-2')!.parent).toBeNull()
  expect(by.get('xxx-1')!.parent).toBe('yyy-2')
})

test('replay: only the first start counts, and the last event time is tracked', () => {
  const m = replay([
    { name: 'a.json', event: { v: 1, op: 'start', ts: '2026-10-10T00:00:00.000Z', session: 's', actor: 'user' } },
    { name: 'b.json', event: { v: 1, op: 'start', ts: '2026-10-11T00:00:00.000Z', session: 's', actor: 'user' } },
  ])
  expect(m.startedAt).toBe('2026-10-10T00:00:00.000Z')
  expect(m.lastEventAt).toBe('2026-10-11T00:00:00.000Z')
})

test('replay: text from files is sanitized', () => {
  const m = replay([add('clean-me', null, { title: 'a\u001b[31m red\nline', summary: 'x\u0007y' })])
  expect(m.nodes[0]!.title).toBe('a[31m red line')
  expect(m.nodes[0]!.summary).toBe('xy')
})

test('parseEventText accepts good events and names what is wrong with bad ones', () => {
  const good = parseEventText(JSON.stringify({ v: 1, op: 'note', id: 'x', ts: '2026-10-10T00:00:00Z', session: 'abc', actor: 'gate', text: 't' }))
  expect('event' in good && good.event.actor).toBe('gate')
  const noSession = parseEventText(JSON.stringify({ v: 1, op: 'start', ts: '2026-10-10T00:00:00Z', actor: 'user' }))
  expect('event' in noSession && noSession.event.session).toBe('external')
  expect(parseEventText('{oops')).toEqual({ problem: 'not valid JSON' })
  expect(parseEventText('[1]')).toEqual({ problem: 'not a JSON object' })
  expect(parseEventText(JSON.stringify({ v: 2, op: 'start', ts: 't', actor: 'user' }))).toEqual({ problem: 'unknown version 2' })
  expect(parseEventText(JSON.stringify({ v: 1, op: 'explode', ts: 't', actor: 'user' }))).toEqual({ problem: 'unknown op "explode"' })
  expect(parseEventText(JSON.stringify({ v: 1, op: 'start', actor: 'user' }))).toEqual({ problem: 'missing ts' })
  expect(parseEventText(JSON.stringify({ v: 1, op: 'start', ts: 't', actor: 'robot' }))).toEqual({ problem: 'unknown actor "robot"' })
})

test('event file names sort in time order and carry session and sequence', () => {
  const a = eventFileName(Date.UTC(2026, 9, 10, 4, 28, 0, 123), 'abc123', 7)
  expect(a).toBe('20261010T042800123Z_abc123_0007.json')
  const b = eventFileName(Date.UTC(2026, 9, 10, 4, 28, 0, 124), 'aaa111', 0)
  expect(a < b).toBe(true)
  expect(utcStamp(Date.UTC(2026, 0, 2, 3, 4, 5, 6))).toBe('20260102T030405006Z')
  expect(isEventFile(a)).toBe(true)
  expect(isEventFile('.tmp.json')).toBe(false)
  expect(isEventFile('notes.txt')).toBe(false)
})

test('ids: slugs are validated, made unique, and generated when absent', () => {
  expect(slugify('V22 Adopted!')).toBe('v22-adopted')
  expect(slugify('构建版本定为')).toBe('')
  expect(slugify('ab')).toBe('')
  expect(slugify('a'.repeat(80)).length).toBe(48)
  expect(uniqueId('v22-adopted', id => id === 'v22-adopted')).toBe('v22-adopted-2')
  expect(uniqueId('v22-adopted', id => id === 'v22-adopted' || id === 'v22-adopted-2')).toBe('v22-adopted-3')
  const long = 'a'.repeat(48)
  expect(uniqueId(long, id => id === long).length).toBeLessThanOrEqual(48)
  expect(autoId(1000)).toBe('d-rs')
  expect(shortSession('8051809e-79f1-5a13')).toBe('805180')
  expect(shortSession('ab-')).toHaveLength(6)
  expect(shortSession(undefined)).toHaveLength(6)
})

test('time helpers: iso checks, local ISO with offset, and display formats', () => {
  expect(isIso('2026-10-09')).toBe(true)
  expect(isIso('2026-10-08T17:44:00-04:00')).toBe(true)
  expect(isIso('2026-10-08T17:44:00.123Z')).toBe(true)
  expect(isIso('last tuesday')).toBe(false)
  expect(isIso('2026-13-45')).toBe(false)
  expect(parseTime('nope')).toBeNull()
  const local = isoLocal(Date.UTC(2026, 9, 10, 4, 28, 0, 123))
  expect(local).toMatch(/^2026-10-(09|10|11)T\d\d:\d\d:00\.123[+-]\d\d:\d\d$/)
  expect(parseTime(local)).toBe(Date.UTC(2026, 9, 10, 4, 28, 0, 123))
  expect(fmtDate('2026-10-09T12:00:00Z')).toBe('10-09')
  expect(fmtDate('')).toBe('')
  expect(fmtClock('2026-10-09T12:00:00Z')).toMatch(/^\d\d:\d\d$/)
  expect(fmtClock('garbage')).toBe('')
})

// ------------------------------------------------------------ ids and text from outside

test('replay: ids from outside are taken as they are, unless they would break a line, a key or a prompt', () => {
  // scripts and other tools write ids too: capitals, underscores, dots, colons, Chinese, up to MAX_ID long
  const longest = 'g'.repeat(MAX_ID)
  const odd = ['Gate_1', 'run.v2.2', 'seed:0', '决定-一', '__proto__', longest]
  const m = replay([
    ...odd.map(id => add(id, null)),
    ev({ op: 'update', id: 'Gate_1', patch: { summary: 'found by its own id' } }),
    ev({ op: 'update', id: '__proto__', patch: { summary: 'only an id here' } }),
    add('child-of-gate', 'Gate_1'),
  ])
  expect(m.nodes.map(n => n.id)).toEqual([...odd, 'child-of-gate'])
  const by = new Map(m.nodes.map(n => [n.id, n] as const))
  expect(by.get('Gate_1')!.summary).toBe('found by its own id')
  expect(by.get('child-of-gate')!.parent).toBe('Gate_1')
  expect(by.get(longest)!.title).toBe(`title ${longest}`)
  // an id that is also a name on Object.prototype is only an id: it finds its node, and nothing leaks onto other objects
  expect(by.get('__proto__')!.summary).toBe('only an id here')
  expect(({} as Record<string, unknown>).summary).toBeUndefined()
  expect(m.warningCount).toBe(0)

  // what is kept out: a line break, a control character, a tab, a space (also a no-break and a full-width one),
  // an invisible or direction-changing character, a leading ~ (the pane's own keys start with it), and anything too long
  const refused = ['two\nlines', 'bell\u0007', 'tab\there', 'with space', 'no\u00a0break', 'full\u3000width', 'zero\u200bwidth', 'right\u202eleft', '~pane-key', `${longest}g`]
  const bad = replay([add('base-one', null), ...refused.map(id => add(id, null))])
  expect(bad.nodes.map(n => n.id)).toEqual(['base-one'])
  expect(bad.warningCount).toBe(refused.length)
  // the warning shows the id as JSON, so a line break is the two characters \n and the message stays on one line
  expect(bad.warnings[0]).toContain('add with an id that cannot be used: "two\\nlines"')
  expect(bad.warnings[2]).toContain('add with an id that cannot be used: "tab\\there"')
  expect(bad.warnings[3]).toContain('add with an id that cannot be used: "with space"')
  expect(bad.warnings[8]).toContain('add with an id that cannot be used: "~pane-key"')
  expect(bad.warnings.every(w => !w.includes('\n'))).toBe(true)

  // an event that names a node by an id like that finds nothing; one with no id at all says so
  const nothing = replay([
    ev({ op: 'update', id: 'two\nlines', patch: { summary: 'x' } }),
    ev({ op: 'add', node: { title: 't', parent: null, status: 'adopted', kind: 'decision' } as never }),
    ev({ op: 'add', id: 42 as never, node: { title: 't', parent: null, status: 'adopted', kind: 'decision' } as never }),
  ])
  expect(nothing.nodes).toEqual([])
  expect(nothing.warnings[0]).toContain('update of unknown id "two\\nlines"')
  expect(nothing.warnings[1]).toContain('add without an id')
  expect(nothing.warnings[2]).toContain('add without an id')
})

test('replay: a file name or a reference with control characters never reaches a warning as it is', () => {
  const dirty = 'x\u001b[31m\nred\u0007'
  const move = ev({ op: 'move', id: 'fine-one', parent: dirty })
  const m = replay([
    { name: 'bad\u001b[2J\nname\u202e.json', event: null, problem: 'not valid JSON' },
    add('fine-one', null),
    move,
    ev({ op: 'update', id: dirty, patch: { summary: 'x' } }),
  ])
  expect(m.warningCount).toBe(3)
  // the file name: no escape sequence, no line break, no direction override
  expect(m.warnings[0]).toBe('bad[2J name.json: not valid JSON')
  // a reference written into the message as it is loses its control characters and line breaks
  expect(m.warnings[1]).toBe(`${move.name}: unknown parent x[31m red`)
  // one that is quoted into the message is escaped, so it reads as it was written
  expect(m.warnings[2]).toContain('update of unknown id "x\\u001b[31m\\nred\\u0007"')
  for (const w of m.warnings) expect(/\p{Cc}|[\u202a-\u202e]/u.test(w)).toBe(false)

  // and a very long name is cut to one short line
  const long = replay([{ name: `${'n'.repeat(300)}.json`, event: null, problem: 'not valid JSON' }])
  expect(long.warnings[0]).toBe(`${'n'.repeat(199)}…`)
})

// ------------------------------------------------------------ forks

test('replay: a fork event says where the tree began, and the first one counts', () => {
  const at = '20261010T120003000Z_abcdef_0002.json'
  const first = ev({ op: 'fork', actor: 'user', text: 'SQL 第三版', base: { tree: 'main', at, count: 3 } })
  const m = replay([
    ev({ op: 'start' }),
    add('copied-node', null),
    first,
    // a tree is opened once: a second fork event (a stray file, a script's) does not move where it began
    ev({ op: 'fork', actor: 'model', text: 'elsewhere', base: { tree: 'sql-v2', at: 'x.json', count: 9 } }),
    add('own-node', 'copied-node'),
  ])
  expect(m.fork).toEqual({ tree: 'main', at, count: 3, ts: first.event!.ts, actor: 'user', title: 'SQL 第三版' })
  expect(m.warningCount).toBe(0)
  // a fork is not a decision: the nodes are the ones the other events made
  expect(m.nodes.map(n => n.id)).toEqual(['copied-node', 'own-node'])

  // a tree that began empty has no file to name, and a fork with no label has no title
  const blank = replay([ev({ op: 'fork', base: { tree: 'main', at: null, count: 0 } })])
  expect(blank.fork).toMatchObject({ tree: 'main', at: null, count: 0, actor: 'model' })
  expect('title' in blank.fork!).toBe(false)

  // the tree every project has was not opened from anything
  expect(replay([ev({ op: 'start' }), add('only-one', null)]).fork).toBeNull()
})

test('replay: a fork without a usable base is a warning and makes no tree', () => {
  const unusable: [string, unknown][] = [
    ['no base at all', undefined],
    ['a base that is not an object', 'main'],
    ['a tree that cannot be a tree', { tree: 'No Such Tree', at: null, count: 0 }],
    ['an empty file name', { tree: 'main', at: '', count: 1 }],
    ['a file name that is not text', { tree: 'main', at: 7, count: 1 }],
    ['a negative count', { tree: 'main', at: null, count: -1 }],
    ['a fractional count', { tree: 'main', at: null, count: 1.5 }],
    ['a count that is text', { tree: 'main', at: null, count: '3' }],
    ['no count', { tree: 'main', at: null }],
  ]
  for (const [why, base] of unusable) {
    const m = replay([add('some-node', null), ev({ op: 'fork', base: base as never })])
    expect([why, m.fork]).toEqual([why, null])
    expect([why, m.warningCount]).toEqual([why, 1])
    expect(m.warnings[0]).toContain('fork without a usable base')
    // the rest of the record is read as usual
    expect(m.nodes.map(n => n.id)).toEqual(['some-node'])
  }
})

test('replay: a long label is cut, and control characters in it are not kept', () => {
  const base = { tree: 'main', at: null, count: 0 }
  const label = (text: unknown) => replay([ev({ op: 'fork', text: text as never, base })]).fork!.title
  expect(label('x'.repeat(300))).toBe('x'.repeat(120))
  expect(label('版本'.repeat(100))).toBe('版本'.repeat(60))
  // the control characters go first, so they do not use up the room
  expect(label('x\u0007'.repeat(200))).toBe('x'.repeat(120))
  expect(label('SQL\u001b[31m 第三版\n再试')).toBe('SQL[31m 第三版 再试')
  // the cut is at a character, not in the middle of a pair of UTF-16 units: 120 characters, the last of them whole
  const pair = '\u{1F600}' // one character, two UTF-16 units
  expect(label(`${'x'.repeat(119)}${pair}tail`)).toBe(`${'x'.repeat(119)}${pair}`)
  expect(label(`${'x'.repeat(120)}${pair}`)).toBe('x'.repeat(120))
  expect(label(pair.repeat(200))).toBe(pair.repeat(120))
  expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(label(`${'x'.repeat(119)}${pair}tail`)!)).toBe(false)
  // nothing left once it is cleaned, or nothing to begin with: no label at all
  expect(label(' \n\u0007 ')).toBeUndefined()
  expect(label(undefined)).toBeUndefined()
})
