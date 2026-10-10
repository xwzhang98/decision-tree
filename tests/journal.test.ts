import { test, expect } from 'claude-code/testing'

import {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_TIMEOUT_SEC,
  defaultConfig,
  parseConfig,
  serializeConfig,
  setRecording,
  setTree,
  withStatus,
} from '../lib/config'
import { utcStamp } from '../lib/events'
import { Journal } from '../lib/journal'
import type { EventDraft } from '../lib/journal'
import { MemDisk } from './mem'

const ROOT = '/work/proj'
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0, 0)
const EVENTS = `${ROOT}/.claude/decisions/events`

const addDraft = (id: string, parent: string | null = null, extra: Record<string, unknown> = {}): EventDraft => ({
  op: 'add',
  actor: 'model',
  id,
  node: { title: `title ${id}`, parent, status: 'adopted', kind: 'decision', ...extra } as never,
})

const shape = (j: Journal) => JSON.stringify(j.model().nodes.map(n => [n.id, n.parent, n.status, n.summary ?? '']))

/** A disk that cannot even say whether a path is there (a permission error on the parent folder). */
class MuteDisk extends MemDisk {
  override async exists(path: string): Promise<boolean> {
    throw new Error(`EACCES: cannot stat ${path}\nsecond line`)
  }
}

test('journal: append writes one immutable file per event, named by time, session and sequence', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'abc123')
  const a = await j.append({ op: 'start', actor: 'user' }, T0)
  // the clock has not moved, but an event is never stamped with the time of one already held: a millisecond later
  const b = await j.append(addDraft('first-one'), T0)
  const c = await j.append(addDraft('second-one', 'first-one'), T0 + 5)
  expect(a).toBe('20261010T120000000Z_abc123_0000.json')
  expect(b).toBe('20261010T120000001Z_abc123_0001.json')
  expect(c).toBe('20261010T120000005Z_abc123_0002.json')
  expect([...disk.files.keys()].sort()).toEqual([`${EVENTS}/${a}`, `${EVENTS}/${b}`, `${EVENTS}/${c}`])
  const written = JSON.parse(disk.text(`${EVENTS}/${b}`))
  expect(written).toMatchObject({ v: 1, op: 'add', id: 'first-one', session: 'abc123', actor: 'model' })
  expect(typeof written.ts).toBe('string')
  expect(Date.parse(written.ts)).toBe(T0 + 1) // the time inside the file is the one in its name
  const m = j.model()
  expect(m.isStarted).toBe(true)
  expect(m.nodes.map(n => n.id)).toEqual(['first-one', 'second-one'])
  expect(m.nodes[1]!.parent).toBe('first-one')
})

test('journal: a second session reads what the first wrote, and both replay to the same tree', async () => {
  const disk = new MemDisk()
  const a = new Journal(disk, ROOT, 'aaaaaa')
  const b = new Journal(disk, ROOT, 'bbbbbb')
  await a.append({ op: 'start', actor: 'user' }, T0)
  await a.append(addDraft('base-node'), T0 + 1)
  expect(await b.sync()).toBe(true)
  expect(b.model().nodes.map(n => n.id)).toEqual(['base-node'])

  // interleaved writes from both sessions
  await b.append({ op: 'update', actor: 'model', id: 'base-node', patch: { summary: 'from B' } }, T0 + 10)
  await a.append(addDraft('child-a', 'base-node'), T0 + 11)
  await b.append(addDraft('child-b', 'base-node'), T0 + 12)
  await a.append({ op: 'update', actor: 'user', id: 'base-node', patch: { status: 'rejected' } }, T0 + 13)

  await a.sync()
  await b.sync()
  expect(shape(a)).toBe(shape(b))
  expect(a.model().nodes.map(n => n.id)).toEqual(['base-node', 'child-a', 'child-b'])
  expect(a.model().nodes[0]!.status).toBe('rejected')
  expect(a.model().nodes[0]!.summary).toBe('from B')
  expect(a.model().eventCount).toBe(6)
  expect(await a.sync()).toBe(false)
})

test('journal: sync reads only the file names it has not seen', async () => {
  const disk = new MemDisk()
  const writer = new Journal(disk, ROOT, 'wwwwww')
  for (let i = 0; i < 5; i++) await writer.append(addDraft(`node-${i}`), T0 + i)

  const reader = new Journal(disk, ROOT, 'rrrrrr')
  await reader.sync()
  expect(disk.reads).toHaveLength(5)
  expect(await reader.sync()).toBe(false)
  expect(disk.reads).toHaveLength(5)

  await writer.append(addDraft('node-5'), T0 + 6)
  expect(await reader.sync()).toBe(true)
  expect(disk.reads).toHaveLength(6)
  expect(reader.model().nodes).toHaveLength(6)
})

test('journal: replay order is file-name order, not the order files arrived in', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'cccccc')
  const ev = (op: string, extra: object) => JSON.stringify({ v: 1, op, ts: '2026-10-10T12:00:00.000Z', session: 'x', actor: 'model', ...extra })
  // the update's name sorts after the add's, though it is put on the disk first
  disk.put(`${EVENTS}/20261010T120002000Z_xxxxxx_0000.json`, ev('update', { id: 'late-add', patch: { summary: 'updated' } }))
  disk.put(
    `${EVENTS}/20261010T120001000Z_xxxxxx_0000.json`,
    ev('add', { id: 'late-add', node: { title: 'added', parent: null, status: 'planned', kind: 'decision' } }),
  )
  await j.sync()
  const n = j.model().nodes[0]!
  expect(n.title).toBe('added')
  expect(n.summary).toBe('updated')
  expect(j.model().warningCount).toBe(0)
})

test('journal: a file that does not parse is a warning, and is read again once it is fixed', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'dddddd')
  await j.append(addDraft('good-one'), T0)
  const bad = `${EVENTS}/20261010T120001000Z_other1_0000.json`
  disk.put(bad, '{"v": 1, "op": "add", "id": "half-writ')
  await j.sync()
  expect(j.model().warningCount).toBe(1)
  expect(j.model().warnings[0]).toContain('20261010T120001000Z_other1_0000.json: not valid JSON')
  expect(j.model().nodes.map(n => n.id)).toEqual(['good-one'])

  // the other session finishes writing it
  disk.put(
    bad,
    JSON.stringify({ v: 1, op: 'add', id: 'fixed-one', ts: '2026-10-10T12:00:01.000Z', session: 'other1', actor: 'model', node: { title: 'fixed', parent: null, status: 'adopted', kind: 'decision' } }),
  )
  expect(await j.sync()).toBe(true)
  expect(j.model().warningCount).toBe(0)
  expect(j.model().nodes.map(n => n.id)).toEqual(['good-one', 'fixed-one'])
})

test('journal: a file that stays unreadable is retried a few times and then left alone until it changes', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'eeeeee')
  const bad = `${EVENTS}/20261010T120001000Z_other2_0000.json`
  disk.put(bad, 'not json at all')
  for (let i = 0; i < 6; i++) await j.sync()
  expect(disk.reads.filter(p => p === bad)).toHaveLength(3)
  expect(j.model().warningCount).toBe(1)

  // a changed size means someone wrote to it: read again
  disk.put(bad, 'not json at all, longer now')
  await j.sync()
  expect(disk.reads.filter(p => p === bad)).toHaveLength(4)
})

test('journal: a read that throws is a warning that names the first line of the error', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'ffffff')
  const path = `${EVENTS}/20261010T120001000Z_other3_0000.json`
  disk.put(path, '{}')
  disk.failing.add(path)
  await j.sync()
  expect(j.model().warnings[0]).toBe('20261010T120001000Z_other3_0000.json: unreadable: EIO: cannot read ' + path)
  disk.failing.delete(path)
  disk.put(path, JSON.stringify({ v: 1, op: 'start', ts: '2026-10-10T12:00:00.000Z', session: 'o', actor: 'user' }))
  await j.sync()
  expect(j.model().isStarted).toBe(true)
  expect(j.model().warningCount).toBe(0)
})

test('journal: hidden files and other kinds of file in events/ are not events', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'gggggg')
  await j.append(addDraft('only-one'), T0)
  disk.put(`${EVENTS}/.20261010T120001000Z_x_0000.json.tmp`, 'partial')
  disk.put(`${EVENTS}/.hidden.json`, 'x')
  disk.put(`${EVENTS}/README.md`, '# notes')
  await j.sync()
  expect(j.model().warningCount).toBe(0)
  expect(j.model().eventCount).toBe(1)
})

test('journal: a file that vanishes (git checkout, a deleted event) leaves the model', async () => {
  const disk = new MemDisk()
  const a = new Journal(disk, ROOT, 'hhhhhh')
  const b = new Journal(disk, ROOT, 'iiiiii')
  const name = await a.append(addDraft('goes-away'), T0)
  await a.append(addDraft('stays-here'), T0 + 1)
  await b.sync()
  expect(b.model().nodes).toHaveLength(2)
  disk.remove(`${EVENTS}/${name}`)
  expect(await b.sync()).toBe(true)
  expect(b.model().nodes.map(n => n.id)).toEqual(['stays-here'])
})

test('journal: two sessions writing in the same millisecond never overwrite each other', async () => {
  const disk = new MemDisk()
  const a = new Journal(disk, ROOT, 'jjjjjj')
  const same = new Journal(disk, ROOT, 'jjjjjj') // the same short session id, e.g. a resumed session
  const n1 = await a.append(addDraft('one-one'), T0)
  const n2 = await same.append(addDraft('two-two'), T0)
  expect(n1).not.toBe(n2)
  expect(disk.files.size).toBe(2)
  await a.sync()
  expect(a.model().nodes.map(n => n.id).sort()).toEqual(['one-one', 'two-two'])
})

test('journal: a missing events folder is an empty journal, and the first append creates the file', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'kkkkkk')
  expect(await j.sync()).toBe(false)
  expect(j.model().nodes).toEqual([])
  expect(j.model().isStarted).toBe(false)
  await j.append({ op: 'start', actor: 'user' }, T0)
  expect(j.model().isStarted).toBe(true)
})

test('journal: tree.json is a derived snapshot with the generation time, project and nodes', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, `${ROOT}/`, 'llllll')
  expect(j.dir).toBe(`${ROOT}/.claude/decisions`)
  await j.append(addDraft('shown-one', null, { trunk: true }), T0)
  await j.writeTree('proj', T0 + 100)
  const tree = JSON.parse(disk.text(`${ROOT}/.claude/decisions/tree.json`))
  expect(tree.project).toBe('proj')
  expect(tree.nodes).toHaveLength(1)
  expect(tree.nodes[0]).toMatchObject({ id: 'shown-one', trunk: true, status: 'adopted' })
  expect(typeof tree.generatedAt).toBe('string')
  // tree.json is never an event
  await j.sync()
  expect(j.model().eventCount).toBe(1)
})

test('journal: config.json text is read and written whole; a read that fails is not "nothing there"', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'mmmmmm')
  expect(await j.readConfig()).toEqual({ kind: 'absent' })

  const whole = '{"v": 1,\n  "title": "kept as written", "futureKey": [1, 2]}\n'
  await j.writeConfigText(whole)
  expect(await j.readConfig()).toEqual({ kind: 'text', text: whole })
  expect(disk.text(j.configPath)).toBe(whole) // not parsed and printed again: the person's own layout stays

  // the file is there, but the disk will not give it: that says nothing about what it holds
  disk.failing.add(j.configPath)
  const failed = await j.readConfig()
  expect(failed).toEqual({ kind: 'error', error: `EIO: cannot read ${j.configPath}` }) // the first line of the error
  expect(failed.kind).not.toBe('absent')
  disk.failing.delete(j.configPath)
  expect(await j.readConfig()).toEqual({ kind: 'text', text: whole })

  // not even being able to ask whether it is there is an error, not an absence
  const mute = new Journal(new MuteDisk(), ROOT, 'nnnnnn')
  expect(await mute.readConfig()).toEqual({ kind: 'error', error: `EACCES: cannot stat ${mute.configPath}` })
})

test('journal: a folder that cannot be read is not an empty folder; the model stays and sync recovers', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'oooooo')
  await j.append({ op: 'start', actor: 'user' }, T0)
  await j.append(addDraft('kept-one'), T0 + 1)
  await j.append(addDraft('kept-two', 'kept-one'), T0 + 2)
  const before = shape(j)

  // the folder is there, the disk does not answer for it (a stalled share, a permission error)
  disk.listFailing.add(EVENTS)
  await expect(j.sync()).rejects.toThrow(`EIO: cannot list ${EVENTS}`)
  await expect(j.sync()).rejects.toThrow('EIO: cannot list') // a second look fails the same way: two failed looks never add up to "empty"
  expect(shape(j)).toBe(before)
  expect(j.model().isStarted).toBe(true)
  expect(j.model().eventCount).toBe(3)
  expect(j.fileNames()).toHaveLength(3)

  // the disk answers again, and what another session wrote in the meantime is found
  disk.listFailing.delete(EVENTS)
  disk.put(
    `${EVENTS}/${utcStamp(T0 + 3)}_other1_0000.json`,
    JSON.stringify({ v: 1, op: 'add', id: 'late-one', ts: '2026-10-10T12:00:00.003Z', session: 'other1', actor: 'model', node: { title: 'late', parent: 'kept-one', status: 'planned', kind: 'decision' } }),
  )
  expect(await j.sync()).toBe(true)
  expect(j.model().nodes.map(n => n.id)).toEqual(['kept-one', 'kept-two', 'late-one'])
  expect(j.model().warningCount).toBe(0)

  // a journal that has read nothing yet is no different: a folder it cannot list is not "nothing recorded"
  const fresh = new Journal(disk, ROOT, 'pppppp')
  disk.listFailing.add(EVENTS)
  await expect(fresh.sync()).rejects.toThrow('EIO: cannot list')
  disk.listFailing.delete(EVENTS)
  expect(await fresh.sync()).toBe(true)
  expect(fresh.model().nodes).toHaveLength(3)

  // and when even "is the folder there?" gets no answer, it is not taken for missing either
  const mute = new MuteDisk()
  mute.put(`${EVENTS}/${utcStamp(T0)}_other1_0000.json`, JSON.stringify({ v: 1, op: 'start', ts: '2026-10-10T12:00:00.000Z', session: 'other1', actor: 'user' }))
  mute.listFailing.add(EVENTS)
  await expect(new Journal(mute, ROOT, 'qqqqqq').sync()).rejects.toThrow('EIO: cannot list')
})

test('journal: events that all vanish at once are believed on the second look, not the first', async () => {
  const disk = new MemDisk()
  const writer = new Journal(disk, ROOT, 'vvvvvv')
  const names = [
    await writer.append({ op: 'start', actor: 'user' }, T0),
    await writer.append(addDraft('here-one'), T0 + 1),
    await writer.append(addDraft('here-two'), T0 + 2),
  ]
  const reader = new Journal(disk, ROOT, 'rrrrrr')
  await reader.sync()
  expect(reader.model().nodes).toHaveLength(2)
  const kept = names.map(n => [`${EVENTS}/${n}`, disk.text(`${EVENTS}/${n}`)] as const)

  // a checkout in the middle of a poll, or a disk that went away: every file is gone at the first look
  for (const [path] of kept) disk.remove(path)
  expect(await reader.sync()).toBe(false)
  expect(reader.model().nodes).toHaveLength(2) // not believed yet
  expect(reader.model().isStarted).toBe(true)

  // the files are back at the second look: nothing was lost, and nothing had to be read again
  for (const [path, text] of kept) disk.put(path, text)
  const reads = disk.reads.length
  expect(await reader.sync()).toBe(false)
  expect(disk.reads).toHaveLength(reads)
  expect(reader.model().nodes).toHaveLength(2)

  // gone at two looks in a row: now it is true, and the model is empty
  for (const [path] of kept) disk.remove(path)
  expect(await reader.sync()).toBe(false)
  expect(reader.model().nodes).toHaveLength(2)
  expect(await reader.sync()).toBe(true)
  expect(reader.model().nodes).toEqual([])
  expect(reader.model().isStarted).toBe(false)
  expect(reader.fileNames()).toEqual([])

  // only some of the files going is believed at once: that is a deleted event, not a lost disk
  const again = new Journal(disk, ROOT, 'ssssss')
  for (const [path, text] of kept) disk.put(path, text)
  await again.sync()
  disk.remove(kept[2]![0])
  expect(await again.sync()).toBe(true)
  expect(again.model().nodes.map(n => n.id)).toEqual(['here-one'])
})

test('journal: an event written after others were read sorts after them, whatever this clock says', async () => {
  const disk = new MemDisk()
  const fast = new Journal(disk, ROOT, 'fast01') // another machine, its clock a minute ahead
  const slow = new Journal(disk, ROOT, 'slow02')
  await fast.append({ op: 'start', actor: 'user' }, T0 + 60_000)
  await fast.append(addDraft('from-fast'), T0 + 60_000)
  await slow.sync()
  expect(slow.fileNames()).toEqual([`${utcStamp(T0 + 60_000)}_fast01_0000.json`, `${utcStamp(T0 + 60_001)}_fast01_0001.json`])

  // this clock says T0, a minute before the newest event it has read: the event still goes after it
  const name = await slow.append({ op: 'update', actor: 'model', id: 'from-fast', patch: { summary: 'written on the slow clock' } }, T0)
  expect(name).toBe(`${utcStamp(T0 + 60_002)}_slow02_0000.json`)
  expect(Date.parse(JSON.parse(disk.text(`${EVENTS}/${name}`)).ts)).toBe(T0 + 60_002)

  // so every session replays it after the add it changes
  await fast.sync()
  expect(shape(fast)).toBe(shape(slow))
  expect(fast.model().nodes[0]!.summary).toBe('written on the slow clock')
  expect(fast.model().warningCount).toBe(0)

  // the same event under the name the clock alone would have given it sorts first, and is an update of nothing
  const alone = new MemDisk()
  for (const [path, f] of disk.files) if (!path.endsWith(name)) alone.put(path, f.text)
  alone.put(`${EVENTS}/${utcStamp(T0)}_slow02_0000.json`, disk.text(`${EVENTS}/${name}`))
  const control = new Journal(alone, ROOT, 'contr0')
  await control.sync()
  expect(control.model().warnings).toHaveLength(1)
  expect(control.model().warnings[0]).toContain('update of unknown id "from-fast"')
  expect(control.model().nodes[0]!.summary).toBeUndefined()

  // a clock ahead of the files is used as it is
  const later = await slow.append(addDraft('on-time'), T0 + 120_000)
  expect(later).toBe(`${utcStamp(T0 + 120_000)}_slow02_0001.json`)
})

test('journal: a stray file stamped far in the future does not hold new events back', async () => {
  const stray = JSON.stringify({ v: 1, op: 'start', ts: '2026-10-10T12:00:00.000Z', session: 'stray0', actor: 'user' })
  const nameAfter = async (...strays: string[]) => {
    const disk = new MemDisk()
    for (const s of strays) disk.put(`${EVENTS}/${s}`, stray)
    const j = new Journal(disk, ROOT, 'tttttt')
    await j.sync()
    const first = await j.append(addDraft('fresh-one'), T0)
    const second = await j.append(addDraft('fresh-two'), T0)
    return [first, second]
  }
  const DAY = 24 * 3600 * 1000

  // a year 2099 name (a clock gone wrong, a file made by hand), and one with no time in its name at all
  expect(await nameAfter('20990101T000000000Z_stray0_0000.json', 'notes.json')).toEqual([
    `${utcStamp(T0)}_tttttt_0000.json`,
    `${utcStamp(T0 + 1)}_tttttt_0001.json`,
  ])
  // up to a day ahead can be a real clock (another machine's), and new events are kept after it
  expect(await nameAfter(`${utcStamp(T0 + 3_600_000)}_other1_0000.json`)).toEqual([
    `${utcStamp(T0 + 3_600_001)}_tttttt_0000.json`,
    `${utcStamp(T0 + 3_600_002)}_tttttt_0001.json`,
  ])
  expect((await nameAfter(`${utcStamp(T0 + DAY)}_other1_0000.json`))[0]).toBe(`${utcStamp(T0 + DAY + 1)}_tttttt_0000.json`) // a day exactly still counts
  // more than a day ahead is not another machine running fast, it is a stray
  expect((await nameAfter(`${utcStamp(T0 + DAY + 1)}_stray0_0000.json`))[0]).toBe(`${utcStamp(T0)}_tttttt_0000.json`)

  // the stray stays a file of the journal; it just does not set the pace
  const disk = new MemDisk()
  disk.put(`${EVENTS}/20990101T000000000Z_stray0_0000.json`, stray)
  const j = new Journal(disk, ROOT, 'uuuuuu')
  await j.sync()
  await j.append(addDraft('fresh-one'), T0)
  expect(j.fileNames().map(n => n.slice(0, 8))).toEqual(['20261010', '20990101'])
  expect(j.model().isStarted).toBe(true)
})

// ------------------------------------------------------------ config

test('config: defaults, and a round trip through the text', () => {
  const c = defaultConfig('orders', '2026-10-10T12:00:00.000+00:00')
  expect(c).toEqual({
    v: 1,
    title: 'orders',
    startedAt: '2026-10-10T12:00:00.000+00:00',
    recording: true,
    display: { asciiGlyphs: false, autoOpen: true, language: 'auto' },
  })
  const parsed = parseConfig(serializeConfig(c))
  expect('config' in parsed && parsed.config).toEqual(c)
  const withCmd = withStatus(c, ['python', 'tools/status.py'])
  expect(withCmd.status).toEqual({ argv: ['python', 'tools/status.py'], intervalSec: DEFAULT_INTERVAL_SEC, timeoutSec: DEFAULT_TIMEOUT_SEC })
  const again = parseConfig(serializeConfig(withCmd))
  expect('config' in again && again.config.status!.argv).toEqual(['python', 'tools/status.py'])
})

test('config: missing or wrong-typed fields take their defaults; a bad file is an error that says why', () => {
  const lenient = parseConfig('{"title": "  t  ", "recording": false, "display": {"language": "zh", "asciiGlyphs": true, "autoOpen": false}}')
  expect('config' in lenient && lenient.config).toEqual({
    v: 1,
    title: 't',
    startedAt: '',
    recording: false,
    display: { asciiGlyphs: true, autoOpen: false, language: 'zh' },
  })
  const odd = parseConfig('{"title": 5, "recording": "yes", "display": {"language": "klingon"}}')
  expect('config' in odd && odd.config.title).toBe('project')
  expect('config' in odd && odd.config.recording).toBe(true)
  expect('config' in odd && odd.config.display.language).toBe('auto')

  expect(parseConfig('{nope')).toEqual({ error: 'config.json is not valid JSON' })
  expect(parseConfig('[]')).toEqual({ error: 'config.json is not a JSON object' })
  expect(parseConfig('{"v": 2}')).toEqual({ error: 'config.json has an unsupported version 2' })
  expect(parseConfig('{"status": {"argv": []}}')).toEqual({ error: 'config.json: status.argv must be a non-empty list of strings' })
  expect(parseConfig('{"status": {"argv": ["a", 3]}}')).toEqual({ error: 'config.json: status.argv must be a non-empty list of strings' })
  expect(parseConfig('{"status": "python x.py"}')).toEqual({ error: 'config.json: status.argv must be a non-empty list of strings' })
})

test('config: the status interval and timeout are clamped', () => {
  const c = parseConfig('{"status": {"argv": ["x"], "intervalSec": 1, "timeoutSec": 9999}}')
  expect('config' in c && c.config.status).toEqual({ argv: ['x'], intervalSec: 5, timeoutSec: 120 })
  const d = parseConfig('{"status": {"argv": ["x"]}}')
  expect('config' in d && d.config.status).toEqual({ argv: ['x'], intervalSec: DEFAULT_INTERVAL_SEC, timeoutSec: DEFAULT_TIMEOUT_SEC })
})

test('config: setRecording changes one key and keeps every other, including unknown ones', () => {
  const text = JSON.stringify({ v: 1, title: 'p', recording: true, futureKey: { a: 1 } })
  const off = setRecording(text, false)!
  expect(JSON.parse(off)).toEqual({ v: 1, title: 'p', recording: false, futureKey: { a: 1 } })
  expect(off.endsWith('\n')).toBe(true)
  expect(setRecording('{broken', false)).toBeNull()
  expect(setRecording('[1]', false)).toBeNull()
})

test('config: the tree config.json names, and setTree changes that key only', () => {
  // no key, or main, is the main tree: there is no `tree` in what is read
  const none = parseConfig('{"title": "p"}')
  expect('config' in none && 'tree' in none.config).toBe(false)
  const main = parseConfig('{"title": "p", "tree": "main"}')
  expect('config' in main).toBe(true)
  expect('config' in main && 'tree' in main.config).toBe(false)
  // any other tree is named the way its folder is
  const named = parseConfig('{"title": "p", "tree": "sql-v3"}')
  expect('config' in named && named.config.tree).toBe('sql-v3')
  const c = { ...defaultConfig('orders', '2026-10-10T12:00:00.000+00:00'), tree: 'sql-v3' }
  const again = parseConfig(serializeConfig(c))
  expect('config' in again && again.config).toEqual(c)
  expect('config' in parseConfig(JSON.stringify({ tree: 'x'.repeat(32) }))).toBe(true) // 32 characters is the longest name

  // a name that cannot be a tree's is not taken, and is not an error either: the project stays on main
  for (const bad of ['SQL v3', 'Sql-V3', 'a', '-sql', 'sql_v3', '../up', '', 'x'.repeat(33), 5, null, ['sql-v3']]) {
    const r = parseConfig(JSON.stringify({ title: 'p', tree: bad }))
    expect('config' in r).toBe(true)
    expect('config' in r && 'tree' in r.config).toBe(false)
  }

  const text = JSON.stringify({ v: 1, title: 'p', recording: true, display: { language: 'zh' }, futureKey: { a: 1 } })
  const set = setTree(text, 'sql-v3')!
  expect(JSON.parse(set)).toEqual({ v: 1, title: 'p', recording: true, display: { language: 'zh' }, futureKey: { a: 1 }, tree: 'sql-v3' })
  expect(set.endsWith('\n')).toBe(true)
  expect(JSON.parse(setTree(set, 'other-tree')!)).toEqual({ ...JSON.parse(text), tree: 'other-tree' }) // a second call replaces it
  // main is no key at all, and the rest is as it was
  const back = setTree(set, 'main')!
  expect(JSON.parse(back)).toEqual(JSON.parse(text))
  expect('tree' in JSON.parse(back)).toBe(false)
  expect(JSON.parse(setTree(text, 'main')!)).toEqual(JSON.parse(text))
  // what was written is read back as the same tree
  const read = parseConfig(set)
  expect('config' in read && read.config.tree).toBe('sql-v3')
  expect(setTree('{broken', 'sql-v3')).toBeNull()
  expect(setTree('[1]', 'sql-v3')).toBeNull()
})

// ------------------------------------------------------------ other trees

test('journal: other trees live under trees/<name>/ with their own events and snapshot', async () => {
  const DIR = `${ROOT}/.claude/decisions`
  const disk = new MemDisk()
  const main = new Journal(disk, ROOT, 'wwwwww')
  expect(await main.listTrees()).toEqual([]) // no trees/ folder: no other tree

  // main holds a start and eleven decisions
  const names = [await main.append({ op: 'start', actor: 'user' }, T0)]
  for (let i = 0; i < 11; i++) names.push(await main.append(addDraft(`base-${String(i).padStart(2, '0')}`), T0 + 1 + i))

  const sql = main.sibling('sql-v3')
  expect([sql.tree, sql.session, sql.root, main.tree]).toEqual(['sql-v3', 'wwwwww', ROOT, 'main'])
  expect(sql.dir).toBe(`${DIR}/trees/sql-v3`)
  expect(sql.eventsDir).toBe(`${DIR}/trees/sql-v3/events`)
  expect(sql.treePath).toBe(`${DIR}/trees/sql-v3/tree.json`)
  expect(sql.configPath).toBe(`${DIR}/config.json`) // one config.json for the whole project
  expect(await sql.sync()).toBe(false)
  expect(sql.model().nodes).toEqual([])

  // nine events are copied (more than one batch), byte for byte and under the same names; a second try is harmless
  await main.copyTo(sql, names.slice(0, 9))
  for (const n of names.slice(0, 9)) expect(disk.text(`${sql.eventsDir}/${n}`)).toBe(disk.text(`${EVENTS}/${n}`))
  expect(disk.files.has(`${sql.eventsDir}/${names[9]}`)).toBe(false)
  const files = disk.files.size
  await main.copyTo(sql, names.slice(0, 9))
  expect(disk.files.size).toBe(files)
  await sql.sync()
  expect(sql.model().nodes.map(n => n.id)).toEqual(Array.from({ length: 8 }, (_, i) => `base-${String(i).padStart(2, '0')}`))

  // then the event that says where it began, and work of its own
  await sql.append({ op: 'fork', actor: 'user', text: 'SQL third try', base: { tree: 'main', at: names[8]!, count: 9 } }, T0 + 20)
  await sql.append(addDraft('sql-only', 'base-00'), T0 + 21)
  expect(sql.model().fork).toMatchObject({ tree: 'main', at: names[8], count: 9, title: 'SQL third try', actor: 'user' })
  expect(sql.model().nodes).toHaveLength(9)
  expect(sql.fileNames()).toHaveLength(11)

  // main did not notice any of it
  expect(await main.sync()).toBe(false)
  expect(main.fileNames()).toEqual(names)
  expect(main.model().fork).toBeNull()
  expect(main.model().nodes).toHaveLength(11)

  // trees/ lists, by name, the folders whose names can be a tree's, the one just made among them
  disk.put(`${DIR}/trees/aaa-first/events/${names[0]}`, disk.text(`${EVENTS}/${names[0]}`))
  disk.put(`${DIR}/trees/mid-tree/events/${names[0]}`, disk.text(`${EVENTS}/${names[0]}`))
  disk.put(`${DIR}/trees/Not A Tree/events/x.json`, '{}') // not a name
  disk.put(`${DIR}/trees/x/events/x.json`, '{}') // too short to be one
  disk.put(`${DIR}/trees/leftover`, 'a file that could be a name, but is not a folder')
  disk.put(`${DIR}/trees/main/events/${names[0]}`, disk.text(`${EVENTS}/${names[0]}`)) // made by hand: main is the one at the top, never one of these
  expect(await main.listTrees()).toEqual(['aaa-first', 'mid-tree', 'sql-v3'])
  expect(await sql.listTrees()).toEqual(['aaa-first', 'mid-tree', 'sql-v3'])

  // each has its own snapshot, which says which tree it is and where it began
  await sql.writeTree('proj', T0 + 100)
  await main.writeTree('proj', T0 + 100)
  const snap = JSON.parse(disk.text(`${DIR}/trees/sql-v3/tree.json`))
  expect(snap).toMatchObject({ project: 'proj', tree: 'sql-v3', fork: { tree: 'main', at: names[8], count: 9, title: 'SQL third try', actor: 'user' } })
  expect(snap.nodes.map((n: { id: string }) => n.id)).toContain('sql-only')
  expect(snap.nodes).toHaveLength(9)
  const mainSnap = JSON.parse(disk.text(`${DIR}/tree.json`))
  expect(mainSnap).toMatchObject({ project: 'proj', tree: 'main' })
  expect('fork' in mainSnap).toBe(false)
  expect(mainSnap.nodes).toHaveLength(11)
  expect(await main.sync()).toBe(false) // neither snapshot is an event
  expect(main.model().eventCount).toBe(12)
})

test('journal: fileNames lists every file seen, readable or not; entries only the ones that make sense', async () => {
  const disk = new MemDisk()
  const j = new Journal(disk, ROOT, 'yyyyyy')
  const other = (ms: number, seq: number) => `${utcStamp(T0 + ms)}_other1_000${seq}.json`
  const start = JSON.stringify({ v: 1, op: 'start', ts: '2026-10-10T12:00:00.000Z', session: 'other1', actor: 'user' })
  const good = await j.append(addDraft('good-one'), T0 + 30)
  disk.put(`${EVENTS}/${other(10, 0)}`, start)
  disk.put(`${EVENTS}/${other(20, 1)}`, start)
  disk.failing.add(`${EVENTS}/${other(20, 1)}`) // the disk will not give this one
  disk.put(`${EVENTS}/${other(40, 2)}`, '{"v": 1, "op": "add", "id": "half-writ') // this one does not parse
  disk.put(`${EVENTS}/${other(50, 3)}`, JSON.stringify({ v: 7, op: 'start' })) // a version this one does not know
  disk.put(`${EVENTS}/.${other(60, 4)}.tmp`, 'partial') // not events at all
  disk.put(`${EVENTS}/README.md`, '# notes')
  await j.sync()

  // all five event files, by name, wherever they came from
  expect(j.fileNames()).toEqual([other(10, 0), other(20, 1), good, other(40, 2), other(50, 3)])
  expect(j.model().warningCount).toBe(3)
  // the two that were read and make sense
  expect(j.entries().map(e => e.name)).toEqual([other(10, 0), good])
  expect(j.entries().map(e => e.event.op)).toEqual(['start', 'add'])
  expect(j.entries()[1]!.event).toMatchObject({ id: 'good-one', session: 'yyyyyy' })

  // a file that becomes readable moves from one list to the other, and the names do not change
  disk.failing.delete(`${EVENTS}/${other(20, 1)}`)
  disk.put(`${EVENTS}/${other(40, 2)}`, JSON.stringify({ v: 1, op: 'add', id: 'fixed-one', ts: '2026-10-10T12:00:00.040Z', session: 'other1', actor: 'model', node: { title: 'fixed', parent: null, status: 'adopted', kind: 'decision' } }))
  await j.sync()
  expect(j.fileNames()).toHaveLength(5)
  expect(j.entries().map(e => e.name)).toEqual([other(10, 0), other(20, 1), good, other(40, 2)])
  expect(j.model().warningCount).toBe(1)
  expect(j.model().warnings[0]).toContain(`${other(50, 3)}: unknown version 7`)
})
