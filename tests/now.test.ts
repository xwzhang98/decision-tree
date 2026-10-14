import { expect, test } from 'claude-code/testing'

import { MAX_COMMAND_LINES, laneLine, lanesCols, nowBlock, resizeNotice } from '../lib/now'
import type { NowBlock, NowInput } from '../lib/now'
import { lineText, lineWidth } from '../lib/spans'
import { describeArgv } from '../lib/status'
import { isAltered, isHidden } from '../lib/width'
import type { DtLane, DtLang } from '../types'
import { NOW, NOW_DATA, NOW_NONE, NOW_PENDING, nowApproved } from './notes'

const block = (over: Partial<NowInput> = {}): NowBlock => nowBlock({ now: nowApproved(), intervalSec: 30, nowMs: NOW, width: 68, ascii: false, lang: 'en', ...over })
const linesOf = (b: NowBlock) => b.lines.map(lineText)

const lane = (over: Partial<DtLane> = {}): DtLane => ({ name: 'CHARLIE', run: 'queue-soak s0', state: 'running', step: 10, total: 100, eta: '', note: '', ...over })

// ---------------------------------------------------------------- the lanes

test('now: lanes in aligned columns with a bar, the steps and the eta; what is next and the warnings under them', () => {
  const b = block()
  expect(b.needsApproval).toBe(false)
  expect(b.title).toEqual([{ text: 'Now', bold: true }])
  expect(b.right).toEqual([])
  expect(b.argv).toEqual(['bash', 'scripts/status.sh'])
  expect(linesOf(b)).toEqual([
    'ALPHA    sync-bench s0  ████████░░  1700/2000  ~18:40  warming up',
    'BRAVO    merge-eval s1  █░░░░░░░░░   210/2000  ~07:25',
    'CHARLIE  queue-soak s0  idle      ',
    'Next  restore-test s1 (~05:05)',
    '! CHARLIE is idle',
  ])
  // the warning is in the colour of one
  expect(b.lines[4]).toEqual([{ text: '! CHARLIE is idle', color: 'warning' }])

  // Chinese: the words of the block are Chinese, the names the project gave its lanes are what they are
  expect(linesOf(block({ lang: 'zh' }))).toEqual([
    'ALPHA    sync-bench s0  ████████░░  1700/2000  约 18:40  warming up',
    'BRAVO    merge-eval s1  █░░░░░░░░░   210/2000  约 07:25',
    'CHARLIE  queue-soak s0  idle      ',
    '下一步  restore-test s1（约 05:05）',
    '! CHARLIE is idle',
  ])
  expect(block({ lang: 'zh' }).title).toEqual([{ text: 'Now', bold: true }])

  // ASCII: the bar is made of # and .
  const ascii = linesOf(block({ ascii: true, width: 80 }))
  expect(ascii[0]).toBe('ALPHA    sync-bench s0  ########..  1700/2000  ~18:40  warming up')
  expect(ascii[1]).toBe('BRAVO    merge-eval s1  #.........   210/2000  ~07:25')
  for (const l of b.lines) expect(lineWidth(l)).toBeLessThanOrEqual(68)
})

test('now: a running lane is in the colour of the work in hand, a done one green, a failed one red; the rest say their state', () => {
  const cols = { name: 7, run: 13, step: 7 }
  const o = { width: 70, ascii: false, lang: 'en', stale: false } as const
  const running = laneLine(lane({ eta: '10:00' }), cols, o)
  expect(running.find(s => s.text === '█░░░░░░░░░')).toEqual({ text: '█░░░░░░░░░', color: 'suggestion' })
  expect(lineText(running)).toBe('CHARLIE  queue-soak s0  █░░░░░░░░░   10/100  ~10:00')
  const done = laneLine(lane({ state: 'done', step: 100 }), cols, o)
  expect(lineText(done)).toBe('CHARLIE  queue-soak s0  ██████████  100/100  done')
  expect(done.some(s => s.color === 'success')).toBe(true)
  const failed = laneLine(lane({ state: 'failed', note: 'nan loss' }), cols, o)
  expect(lineText(failed)).toBe('CHARLIE  queue-soak s0  █░░░░░░░░░   10/100  failed  nan loss')
  expect(failed.some(s => s.color === 'error')).toBe(true)
  // no total to count to: the state in the place of the bar
  const queued = laneLine(lane({ state: 'queued', step: null, total: null }), cols, o)
  expect(lineText(queued)).toBe('CHARLIE  queue-soak s0  queued    ')
  expect(lineText(laneLine(lane({ state: 'idle', step: null, total: null }), cols, o))).toBe('CHARLIE  queue-soak s0  idle      ')
  expect(lineText(laneLine(lane({ state: 'queued', step: null, total: null }), cols, { ...o, lang: 'zh' }))).toBe('CHARLIE  queue-soak s0  queued    ')
  // names are bold; a lane that is not running is dim
  expect(queued[0]).toMatchObject({ bold: true })
  expect(queued.some(s => s.dim === true)).toBe(true)
})

test('now: narrow panes drop the note, then the eta, then the steps, then shorten the run name, then the bar', () => {
  const l = NOW_DATA.lanes[0]!
  const cols = lanesCols(NOW_DATA.lanes)
  expect(cols).toEqual({ name: 7, run: 13, step: 9 })
  const at = (w: number) => lineText(laneLine(l, cols, { width: w, ascii: false, lang: 'en', stale: false }))
  expect(at(65)).toBe('ALPHA    sync-bench s0  ████████░░  1700/2000  ~18:40  warming up')
  expect(at(64)).toBe('ALPHA    sync-bench s0  ████████░░  1700/2000  ~18:40')
  expect(at(52)).toBe('ALPHA    sync-bench s0  ████████░░  1700/2000')
  expect(at(40)).toBe('ALPHA    sync-bench s0  ████████░░')
  // below that the run name is shortened to keep the bar, and last the bar itself goes
  expect(at(30)).toBe('ALPHA    sync-ben…  ████████░░')
  expect(at(24)).toBe('ALPHA    syn…')
  // each element is there only if the ones that matter more are
  const items = ['warming up', '~18:40', '1700/2000', 'sync-bench s0', '████████░░']
  for (let w = 8; w <= 90; w++) {
    const text = at(w)
    const shown = items.map(x => text.includes(x))
    for (let k = 1; k < items.length; k++) if (shown[k - 1]) expect(shown[k], `${w}: ${items[k - 1]} without ${items[k]}`).toBe(true)
    expect(lineWidth(laneLine(l, cols, { width: w, ascii: false, lang: 'en', stale: false }))).toBeLessThanOrEqual(w)
  }
})

test('now: the columns are as wide as the longest name, run and step count, up to a limit', () => {
  expect(lanesCols([])).toEqual({ name: 0, run: 0, step: 0 })
  expect(lanesCols([lane({ name: 'A', run: 'x', step: 1, total: 3 })])).toEqual({ name: 1, run: 1, step: 3 })
  // a lane with no total adds no step column; long names and runs are held to 10 and 18 columns
  expect(lanesCols([lane({ name: 'a-very-long-lane-name', run: 'a-very-long-run-name-that-goes-on', state: 'idle', step: null, total: null })])).toEqual({ name: 10, run: 18, step: 0 })
  const long = lane({ name: 'a-very-long-lane-name', run: 'a-very-long-run-name-that-goes-on', eta: '10:00', step: 1, total: 3 })
  const text = lineText(laneLine(long, lanesCols([long]), { width: 70, ascii: false, lang: 'en', stale: false }))
  expect(text).toBe('a-very-lo…  a-very-long-run-n…  ███░░░░░░░  1/3  ~10:00')
})

// ---------------------------------------------------------------- freshness

test('now: stale data says how old on the right of the border, dims the lanes and shows the error under them', () => {
  const stale = block({ now: nowApproved({ fetchedAt: NOW - 5 * 60_000 - 1000, error: 'timed out after 15000 ms' }) })
  expect(stale.right).toEqual([{ text: 'stale 5 min', color: 'warning' }])
  const lines = linesOf(stale)
  expect(lines.slice(0, 5)).toEqual(linesOf(block()).slice(0, 5))
  expect(lines[5]).toBe('Status command failed: timed out after 15000 ms')
  expect(stale.lines[5]).toEqual([{ text: 'Status command failed: timed out after 15000 ms', color: 'error' }])
  // the lanes are still there, dim
  expect(stale.lines[0]!.every(s => s.dim === true || s.text.trim() === '')).toBe(true)
  expect(block().lines[0]!.some(s => s.dim !== true && s.text.trim() !== '')).toBe(true)

  // in Chinese the term stays English
  const zh = block({ lang: 'zh', now: nowApproved({ fetchedAt: NOW - 5 * 60_000 - 1000, error: 'timed out after 15000 ms' }) })
  expect(zh.right).toEqual([{ text: 'stale 5 min', color: 'warning' }])
  expect(linesOf(zh)[5]).toBe('status 命令失败：timed out after 15000 ms')

  // older than the interval but under two minutes; and just now with an error: no number to show
  expect(block({ now: nowApproved({ fetchedAt: NOW - 70_000 }) }).right).toEqual([{ text: 'stale 1 min', color: 'warning' }])
  expect(block({ now: nowApproved({ fetchedAt: NOW - 10_000, error: 'boom' }) }).right).toEqual([{ text: 'stale', color: 'warning' }])
  // fresh: nothing to say
  expect(block().right).toEqual([])
  expect(block({ now: nowApproved({ fetchedAt: NOW - 20_000 }) }).right).toEqual([])
})

test('now: before there is any data there is a line saying so, or the error; with no status command there is nothing', () => {
  expect(linesOf(block({ now: nowApproved({ data: null, fetchedAt: null }) }))).toEqual(['Reading the status command…'])
  expect(linesOf(block({ now: nowApproved({ data: null, fetchedAt: null }), lang: 'zh' }))).toEqual(['正在读取 status 命令…'])
  const failed = block({ now: nowApproved({ data: null, fetchedAt: null, error: 'bash: no such file' }) })
  expect(linesOf(failed)).toEqual(['Status command failed: bash: no such file'])
  expect(failed.lines[0]).toEqual([{ text: 'Status command failed: bash: no such file', color: 'error' }])
  expect(linesOf(block({ now: nowApproved({ data: null, fetchedAt: null, error: 'bash: no such file' }), lang: 'zh' }))).toEqual(['status 命令失败：bash: no such file'])
  // a long error is cut to two lines
  const long = block({ now: nowApproved({ data: null, fetchedAt: null, error: 'word '.repeat(80) }), width: 40 })
  expect(long.lines).toHaveLength(2)
  expect(block({ now: NOW_NONE })).toEqual({ title: [{ text: 'Now', bold: true }], right: [], lines: [], needsApproval: false, argv: [] })
})

test('now: at most two of what comes next and two warnings are shown', () => {
  const data = { ...NOW_DATA, next: [{ text: 'one', eta: '01:00' }, { text: 'two', eta: '' }, { text: 'three', eta: '' }], warnings: ['a', 'b', 'c'] }
  expect(linesOf(block({ now: nowApproved({ data }) })).slice(3)).toEqual(['Next  one (~01:00)', '      two', '! a', '! b'])
  // none: just the lanes
  expect(linesOf(block({ now: nowApproved({ data: { ...NOW_DATA, next: [], warnings: [] } }) }))).toHaveLength(3)
})

// ---------------------------------------------------------------- waiting for the person's OK

// A word of 30 columns: two fit on a line of a 68-column pane, three do not.
const word = (i: number): string => `w${String(i).padStart(2, '0')}`.padEnd(30, 'x')
const words = (n: number): string[] => Array.from({ length: n }, (_, i) => word(i + 1))

const pending = (argv: string[], over: Partial<NowInput> = {}): NowBlock => block({ now: { ...NOW_PENDING, argv }, ...over })

/** The lines that spell the command out: the ones indented two columns, as nothing else in the block is. */
const commandOf = (b: NowBlock): string[] => linesOf(b).filter(l => /^ {2}\S/.test(l))

test('now: the command waiting for approval is shown whole, quoted, with nothing hidden', () => {
  const simple = pending(['bash', 'scripts/status.sh'])
  expect(simple.needsApproval).toBe(true)
  expect(simple.argv).toEqual(['bash', 'scripts/status.sh'])
  expect(linesOf(simple)).toEqual([
    'The status command wants to run in this project:',
    '  bash scripts/status.sh',
    'It runs on your machine, in the project folder, every 30 s while',
    'this pane is open.',
  ])
  expect(simple.lines[1]).toEqual([{ text: '  ' }, { text: 'bash scripts/status.sh', color: 'warning' }])
  expect(simple.right).toEqual([])
  expect(linesOf(pending(['bash', 'scripts/status.sh'], { lang: 'zh' }))).toEqual([
    'status 命令想在这个项目里运行：',
    '  bash scripts/status.sh',
    '它在你的机器上、项目文件夹里运行；pane 打开期间每 30 秒一次。',
  ])

  // quoted as a shell would read it: a word that needs it, quotes inside a word, an empty word
  expect(commandOf(pending(['bash', '-c', 'echo "hi there"; cat /etc/hosts | head -3']))).toEqual([`  bash -c 'echo "hi there"; cat /etc/hosts | head -3'`])
  expect(commandOf(pending(['sh', '-c', "echo 'it'"]))).toEqual(["  sh -c 'echo '\\''it'\\'''"])
  expect(commandOf(pending(['bash', '', 'x']))).toEqual(["  bash '' x"])

  // what the pane would hide, or draw as something else, is spelled out: the person reads what would run
  const HEART = '❤️'
  const CHINA = '\u{1F1E8}\u{1F1F3}'
  const MELTING = '\u{1FAE0}'
  const odd = ['bash', 'scripts/status​.sh', 'a‮b', 'two\nlines', `heart${HEART}`, CHINA, MELTING, 'half\ud83d']
  const spelled = pending(odd, { width: 120 })
  expect(spelled.needsApproval).toBe(true)
  expect(commandOf(spelled).map(l => l.trim()).join(' ')).toBe("bash 'scripts/status<U+200B>.sh' 'a<U+202E>b' 'two<U+000A>lines' 'heart❤<U+FE0F>' '<U+1F1E8><U+1F1F3>' '<U+1FAE0>' 'half<U+D83D>'")
  for (const line of linesOf(spelled)) {
    for (const ch of line) expect(isHidden(ch.codePointAt(0)!) || isAltered(ch.codePointAt(0)!)).toBe(false)
  }
  // the button will carry the command itself, with its real characters
  expect(spelled.argv).toEqual(odd)

  // shown whole: a command of MAX_COMMAND_LINES lines is not cut
  const six = pending(words(12))
  expect(six.needsApproval).toBe(true)
  expect(commandOf(six)).toHaveLength(MAX_COMMAND_LINES)
  expect(commandOf(six)[0]).toBe(`  ${word(1)} ${word(2)}`)
  expect(commandOf(six)[5]).toBe(`  ${word(11)} ${word(12)}`)
})

test('now: at any width, what is offered for approval is the whole command, and every line fits', () => {
  const argv = ['python3', 'scripts/status.py', '--config', 'configs/side b.yaml', '--out', 'results/status.json']
  const whole = "python3 scripts/status.py --config 'configs/side b.yaml' --out results/status.json"
  expect(describeArgv(argv)).toBe(whole)
  for (const lang of ['en', 'zh'] as DtLang[]) {
    for (let width = 30; width <= 120; width++) {
      const b = pending(argv, { width, lang })
      expect(b.needsApproval).toBe(true)
      expect(commandOf(b).map(l => l.trim()).join(' ')).toBe(whole)
      for (const line of b.lines) expect(lineWidth(line)).toBeLessThanOrEqual(width)
    }
  }
})

test('now: a command too long to read in the pane is not offered for approval', () => {
  // twelve words fill the six lines allowed, a thirteenth is one line too many
  const fits = pending(words(12))
  const tooLong = pending(words(13))
  expect(fits.needsApproval).toBe(true)
  expect(commandOf(fits)).toHaveLength(MAX_COMMAND_LINES)
  expect(tooLong.needsApproval).toBe(false)
  // not a word of the command is drawn, not even the part that would fit; the block says why instead
  expect(linesOf(tooLong)).toEqual(['The status command in config.json is too long to check here. Put it', 'in a script and point config.json at the script.'])
  expect(tooLong.lines.every(l => l.some(s => s.color === 'warning'))).toBe(true)
  expect(tooLong.argv).toEqual(words(13))
  const zh = pending(words(13), { lang: 'zh' })
  expect(zh.needsApproval).toBe(false)
  expect(linesOf(zh).join('')).toContain('status 命令太长')

  // it is lines that count, not characters: the same command fits a wider pane, and a short one a narrow pane
  expect(pending(words(13), { width: 140 }).needsApproval).toBe(true)
  const narrow = pending(['bash', 'scripts/status.sh'], { width: 20 })
  expect(narrow.needsApproval).toBe(true)
  expect(commandOf(narrow)).toEqual(['  bash', '  scripts/status.sh'])
  // and one that is too long for any pane
  expect(pending(words(60), { width: 140 }).needsApproval).toBe(false)
})

test('now: the notice that there is no room to read a command is a single line cut to the pane', () => {
  expect(lineText(resizeNotice('en', 80))).toBe('A status command awaits your OK; enlarge the pane to read it.')
  expect(lineText(resizeNotice('zh', 80))).toBe('有一条 status 命令在等你确认；把 pane 拉大后才看得全。')
  expect(resizeNotice('en', 80).every(s => s.color === 'warning')).toBe(true)
  for (let width = 1; width <= 70; width++) for (const lang of ['en', 'zh'] as DtLang[]) expect(lineWidth(resizeNotice(lang, width))).toBeLessThanOrEqual(width)
  expect(lineText(resizeNotice('en', 12))).toBe('A status co…')
})
