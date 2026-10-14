import { expect, test } from 'claude-code/testing'

import { barLine, fitSpans, indent, lineText, lineWidth, padSpans, ruleLine, sp, truncateSpans } from '../lib/spans'

test('spans: cutting keeps styles, ends in an ellipsis and never exceeds the width', () => {
  const line = [sp('ab', { bold: true }), sp('中文字', { dim: true }), sp('xyz')]
  expect(lineWidth(line)).toBe(11)
  for (let w = 0; w <= 14; w++) expect(lineWidth(truncateSpans(line, w)) <= w).toBe(true)
  expect(lineText(truncateSpans(line, 5))).toBe('ab中…')
  expect(truncateSpans(line, 5)[1]!.dim).toBe(true)
  expect(lineText(truncateSpans(line, 1))).toBe('…')
  expect(truncateSpans(line, 0)).toEqual([])
  expect(lineText(truncateSpans(line, 11))).toBe('ab中文字xyz')
})

test('spans: fit puts the right part flush right and cuts the left part first', () => {
  const a = fitSpans([sp('hello world')], [sp('10-09')], 20, 2)
  expect(lineText(a)).toBe('hello world    10-09')
  const b = fitSpans([sp('x'.repeat(30))], [sp('10-09')], 20, 2)
  expect(lineWidth(b)).toBe(20)
  expect(lineText(b).endsWith('10-09')).toBe(true)
  expect(lineText(b).includes('…')).toBe(true)
  // nothing on the right: not padded
  expect(lineText(fitSpans([sp('abc')], [], 20))).toBe('abc')
  // the right part alone wider than the line is cut instead
  expect(lineWidth(fitSpans([sp('a')], [sp('0123456789')], 6))).toBe(6)
})

test('spans: a rule is as wide as the pane, with the label near its right end', () => {
  expect(lineText(ruleLine(10, false))).toBe('──────────')
  expect(lineText(ruleLine(10, true))).toBe('----------')
  const labelled = ruleLine(24, false, 'only pending')
  expect(lineWidth(labelled)).toBe(24)
  expect(lineText(labelled).includes(' only pending ──')).toBe(true)
  // too narrow for the label: a plain rule
  expect(lineText(ruleLine(10, false, 'only pending'))).toBe('──────────')
  expect(lineWidth(ruleLine(30, false, '只看 pending'))).toBe(30)
  expect(ruleLine(0, false)).toEqual([])
})

test('spans: a bar puts its background behind every span and pads the line out to the width', () => {
  const line = [sp('ab', { bold: true }), sp('中', { dim: true })]
  const bar = barLine(line, 'subtle', 10)
  expect(lineWidth(bar)).toBe(10)
  expect(lineText(bar)).toBe('ab中' + ' '.repeat(6))
  expect(bar.every(s => s.bg === 'subtle')).toBe(true)
  // the styles are kept; the line given is not changed
  expect(bar[0]!.bold).toBe(true)
  expect(bar[1]!.dim).toBe(true)
  expect(line.every(s => s.bg === undefined)).toBe(true)
  // a span with a background of its own keeps it
  expect(barLine([{ text: 'x', bg: 'error' }, sp('y')], 'subtle', 3).map(s => s.bg)).toEqual(['error', 'subtle', 'subtle'])
  // already as wide as the bar, or wider: nothing is added, nothing cut
  expect(lineText(barLine([sp('abcd')], 'subtle', 4))).toBe('abcd')
  expect(lineText(barLine([sp('abcdef')], 'subtle', 4))).toBe('abcdef')
})

test('spans: padding fills a line out with blanks and cuts one that is too wide', () => {
  expect(lineText(padSpans([sp('ab')], 5))).toBe('ab   ')
  expect(lineWidth(padSpans([sp('中文')], 6))).toBe(6)
  expect(lineText(padSpans([sp('abcdef')], 4))).toBe('abc…')
  expect(lineText(padSpans([], 3))).toBe('   ')
  expect(lineText([indent(3)])).toBe('   ')
  expect(lineText([indent(-2)])).toBe('')
})
