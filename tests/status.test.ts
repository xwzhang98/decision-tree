import { expect, test } from 'claude-code/testing'
import { glyphOf, isQuiet, toneOf } from '../lib/glyphs'
import {
  approvalHash,
  describeArgv,
  failureText,
  hash,
  isStale,
  minutesSince,
  parseStatusOutput,
  progressBar,
  sameArgv,
  stepText,
  storeKey,
} from '../lib/status'
import type { DtStatus } from '../types'

const SAMPLE = JSON.stringify({
  updatedAt: '2026-10-10T00:20:00-04:00',
  lanes: [
    { name: 'ZETA', run: 'gateway s0', state: 'running', step: 3400, total: 4000, eta: '23:50', note: '预热中' },
    { name: 'BETA-0', run: 'ablate_wide s0', state: 'running', step: 420, total: 4000, eta: '09:10' },
  ],
  next: [{ text: '闸 → probe s1', eta: '06:15' }],
  warnings: ['GAMMA 空闲'],
})

test('status output: the documented example parses', () => {
  const out = parseStatusOutput(SAMPLE)
  if (!('data' in out)) throw new Error(out.error)
  expect(out.data.lanes.length).toBe(2)
  expect(out.data.lanes[0]!.name).toBe('ZETA')
  expect(out.data.lanes[0]!.step).toBe(3400)
  expect(out.data.lanes[0]!.note).toBe('预热中')
  expect(out.data.lanes[1]!.note).toBe('')
  expect(out.data.next[0]!.text).toBe('闸 → probe s1')
  expect(out.data.next[0]!.eta).toBe('06:15')
  expect(out.data.warnings).toEqual(['GAMMA 空闲'])
  expect(out.data.updatedAt).toBe('2026-10-10T00:20:00-04:00')
})

test('status output: bad input gives a one-line reason, never throws', () => {
  for (const bad of ['', '   \n', 'not json', '[1,2]', '"text"', '42', '{"lanes": 3}']) {
    const out = parseStatusOutput(bad)
    expect('error' in out).toBe(true)
  }
})

test('status output: a script that logs first and prints JSON last still works', () => {
  const out = parseStatusOutput(`loading cache...\nwarming up\n${SAMPLE}\n`)
  expect('data' in out).toBe(true)
})

test('status output: odd lanes are repaired or skipped, caps hold', () => {
  const lanes: unknown[] = [
    { name: 'A', state: 'weird', step: -3, total: 'x' },
    { run: 'no name' },
    'string lane',
    { name: 'B\u001b[31m\nred', run: 'r', state: 'failed' },
  ]
  for (let i = 0; i < 40; i++) lanes.push({ name: `L${i}` })
  const out = parseStatusOutput(
    JSON.stringify({
      lanes,
      next: ['plain string', { text: 'obj' }, { eta: 'x' }, 7, ...Array.from({ length: 20 }, (_, i) => `n${i}`)],
      warnings: Array.from({ length: 20 }, (_, i) => `w${i}`),
    }),
  )
  if (!('data' in out)) throw new Error(out.error)
  expect(out.data.lanes.length).toBe(20)
  expect(out.data.lanes[0]!.state).toBe('running')
  expect(out.data.lanes[0]!.step).toBe(null)
  expect(out.data.lanes[0]!.total).toBe(null)
  // the escape character is gone and the newline folded to a space
  expect(out.data.lanes[1]!.name).toBe('B[31m red')
  expect(out.data.lanes[1]!.state).toBe('failed')
  expect(out.data.next.length).toBe(6)
  expect(out.data.next[0]!.text).toBe('plain string')
  expect(out.data.warnings.length).toBe(6)
})

test('status output: a missing lanes/next/warnings is an empty block, not an error', () => {
  const out = parseStatusOutput('{}')
  if (!('data' in out)) throw new Error(out.error)
  expect(out.data.lanes).toEqual([])
  expect(out.data.next).toEqual([])
  expect(out.data.warnings).toEqual([])
})

test('progress bar: ten cells, unicode and ascii, clamped', () => {
  expect(progressBar(3400, 4000, false)).toBe('████████░░')
  expect(progressBar(420, 4000, false)).toBe('█░░░░░░░░░')
  expect(progressBar(120, 4000, false)).toBe('░░░░░░░░░░')
  expect(progressBar(4000, 4000, false)).toBe('██████████')
  expect(progressBar(9000, 4000, false)).toBe('██████████')
  expect(progressBar(null, 4000, false)).toBe('░░░░░░░░░░')
  expect(progressBar(5, 0, false)).toBe('░░░░░░░░░░')
  expect(progressBar(3400, 4000, true)).toBe('########..')
  expect(progressBar(2, 4, true, 4)).toBe('##..')
})

test('step text is right-aligned to the width of the total', () => {
  expect(stepText(3400, 4000)).toBe('3400/4000')
  expect(stepText(420, 4000)).toBe(' 420/4000')
  expect(stepText(120, 4000)).toBe(' 120/4000')
  expect(stepText(null, null)).toBe('')
  expect(stepText(null, 40)).toBe(' ?/40')
})

test('staleness: failed runs and old data are stale, never-fetched is not', () => {
  const t0 = 1_000_000
  expect(isStale(t0, null, 30, null)).toBe(false)
  expect(isStale(t0 + 10_000, t0, 30, null)).toBe(false)
  expect(isStale(t0 + 61_000, t0, 30, null)).toBe(true)
  expect(isStale(t0 + 1_000, t0, 30, 'boom')).toBe(true)
  expect(minutesSince(t0 + 5 * 60_000 + 59_000, t0)).toBe(5)
  expect(minutesSince(t0 - 1000, t0)).toBe(0)
})

test('approval hash depends on the project root and the exact argv', () => {
  const a = approvalHash('/p/one', ['bash', 'scripts/decision_status.sh'])
  expect(a).toBe(approvalHash('/p/one', ['bash', 'scripts/decision_status.sh']))
  expect(a === approvalHash('/p/two', ['bash', 'scripts/decision_status.sh'])).toBe(false)
  expect(a === approvalHash('/p/one', ['bash', 'scripts/decision_status.sh', '-v'])).toBe(false)
  expect(a === approvalHash('/p/one', ['bash scripts/decision_status.sh'])).toBe(false)
  expect(a.length).toBe(16)
  expect(hash('x') === hash('y')).toBe(false)
  expect(storeKey('approved', '/p/one')).toBe('approved:/p/one')
})

test('failure text is the first line of stderr, else of the error', () => {
  expect(failureText(new Error('timed out after 15000 ms'), '')).toBe('timed out after 15000 ms')
  expect(failureText(new Error('x'), '\n  bash: foo: not found\nsecond')).toBe('bash: foo: not found')
})

test('glyphs: nine statuses, one column each, ascii fallback distinct enough', () => {
  const all: DtStatus[] = [
    'adopted',
    'rejected',
    'no-diff',
    'in-progress',
    'planned',
    'proposed',
    'withdrawn',
    'superseded',
    'deferred',
  ]
  const seen = new Set<string>()
  for (const s of all) {
    expect(glyphOf(s, false).length).toBe(1)
    expect(glyphOf(s, true).length).toBe(1)
    seen.add(glyphOf(s, true))
  }
  // withdrawn and superseded share a glyph by design: eight distinct ASCII marks
  expect(seen.size).toBe(8)
  expect(glyphOf('adopted', false)).toBe('✓')
  expect(glyphOf('adopted', true)).toBe('+')
  expect(glyphOf('rejected', false)).toBe('✗')
  expect(toneOf('adopted').color).toBe('success')
  expect(toneOf('rejected').color).toBe('error')
  expect(isQuiet('withdrawn')).toBe(true)
  expect(isQuiet('adopted')).toBe(false)
})

test('describeArgv: the command as a shell reads it, nothing hidden', () => {
  // words a shell reads as they stand are shown as they stand
  expect(describeArgv(['bash', 'scripts/decision_status.sh', '--lane=ZETA', '-v'])).toBe('bash scripts/decision_status.sh --lane=ZETA -v')
  expect(describeArgv([])).toBe('')

  // words it would split, expand or run are quoted, so one word is one word
  expect(describeArgv(['echo', 'hello world'])).toBe("echo 'hello world'")
  expect(describeArgv(['echo', 'hello', 'world'])).toBe('echo hello world')
  expect(describeArgv(['printf', '%s', ''])).toBe("printf %s ''")
  expect(describeArgv(['sh', '-c', 'rm -rf $HOME; ls *.log | tee `id` > out'])).toBe("sh -c 'rm -rf $HOME; ls *.log | tee `id` > out'")
  expect(describeArgv(['echo', "it's"])).toBe("echo 'it'\\''s'")
  expect(describeArgv(['cat', '日志.txt'])).toBe("cat '日志.txt'")

  // a shell expands a word that starts with `~` (a home folder) or `=` (a path), so those are quoted; inside a word they are plain
  expect(describeArgv(['bash', '~/x.sh'])).toBe("bash '~/x.sh'")
  expect(describeArgv(['bash', '=x'])).toBe("bash '=x'")
  expect(describeArgv(['bash', 'a~b', 'dir/~x', '--lane=ZETA'])).toBe('bash a~b dir/~x --lane=ZETA')
  // a first word of the form NAME=value is an assignment to a shell, not the command, so it is quoted there and nowhere else
  expect(describeArgv(['FOO=bar', 'cmd'])).toBe("'FOO=bar' cmd")
  expect(describeArgv(['_x1=2'])).toBe("'_x1=2'")
  expect(describeArgv(['env', 'FOO=bar', 'cmd'])).toBe('env FOO=bar cmd')
  expect(describeArgv(['2=x', 'cmd'])).toBe('2=x cmd')

  // control characters are spelled out, not drawn or acted on
  expect(describeArgv(['echo', 'a\nb'])).toBe("echo 'a<U+000A>b'")
  expect(describeArgv(['echo', 'tab\there'])).toBe("echo 'tab<U+0009>here'")
  expect(describeArgv(['echo', 'esc\u001b[31mred'])).toBe("echo 'esc<U+001B>[31mred'")
  expect(describeArgv(['echo', 'nul\u0000del\u007f'])).toBe("echo 'nul<U+0000>del<U+007F>'")

  // so are characters that draw as nothing, or reorder what is around them
  expect(describeArgv(['bash', 'run\u200b.sh'])).toBe("bash 'run<U+200B>.sh'")
  expect(describeArgv(['bash', 'a\u202eb'])).toBe("bash 'a<U+202E>b'")
  expect(describeArgv(['bash', 'a\u00a0b\u3000c\u3164'])).toBe("bash 'a<U+00A0>b<U+3000>c<U+3164>'")
  expect(describeArgv(['bash', '\ufeffrun.sh'])).toBe("bash '<U+FEFF>run.sh'")
  expect(describeArgv(['bash', String.fromCodePoint(0xe0041) + 'x'])).toBe("bash '<U+E0041>x'")

  // and characters the pane would draw as something else: a flag as letters, a new emoji as ?, a skin tone as nothing
  expect(describeArgv(['echo', '\u{1F1E8}\u{1F1F3}'])).toBe("echo '<U+1F1E8><U+1F1F3>'")
  expect(describeArgv(['echo', '\u{1FAE0}'])).toBe("echo '<U+1FAE0>'")
  expect(describeArgv(['echo', '\u{1F44D}\u{1F3FD}'])).toBe("echo '\u{1F44D}<U+1F3FD>'")
  expect(describeArgv(['echo', "x'\u200b"])).toBe("echo 'x'\\''<U+200B>'")

  // two commands that differ only by something invisible are not shown the same
  expect(describeArgv(['bash', 'run.sh'])).not.toBe(describeArgv(['bash', 'run\u200b.sh']))
  expect(describeArgv(['bash', 'a b'])).not.toBe(describeArgv(['bash', 'a', 'b']))
})

test('sameArgv: word for word', () => {
  expect(sameArgv(['bash', 'scripts/status.sh'], ['bash', 'scripts/status.sh'])).toBe(true)
  expect(sameArgv([], [])).toBe(true)

  // a different length is a different command, whichever side is longer
  expect(sameArgv(['bash'], ['bash', 'scripts/status.sh'])).toBe(false)
  expect(sameArgv(['bash', 'scripts/status.sh'], ['bash'])).toBe(false)
  expect(sameArgv(['bash'], [])).toBe(false)
  expect(sameArgv(['echo', ''], ['echo'])).toBe(false)

  // one word that differs by anything at all
  expect(sameArgv(['bash', 'scripts/status.sh'], ['bash', 'scripts/other.sh'])).toBe(false)
  expect(sameArgv(['bash', 'scripts/status.sh'], ['Bash', 'scripts/status.sh'])).toBe(false)
  expect(sameArgv(['bash', 'scripts/status.sh'], ['bash', 'scripts/status.sh '])).toBe(false)
  expect(sameArgv(['bash', 'scripts/status.sh'], ['bash', 'scripts/status\u200b.sh'])).toBe(false)

  // the same characters cut into other words, or in another order, are another command
  expect(sameArgv(['bash scripts/status.sh'], ['bash', 'scripts/status.sh'])).toBe(false)
  expect(sameArgv(['a', 'b'], ['b', 'a'])).toBe(false)
})
