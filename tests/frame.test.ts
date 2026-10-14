import { expect, test } from 'claude-code/testing'

import { FRAME_COLUMNS, frameBand, frameBlank, frameBottom, frameInner, frameRow, frameSides, frameTop } from '../lib/frame'
import { lineText, lineWidth } from '../lib/spans'
import { QUIET, S } from '../lib/style'

test('frame: the top border carries a title on the left and a few words on the right, and is as wide as asked', () => {
  const top = frameTop(40, { title: [S('Details', { bold: true })], right: [S('✓ adopted')], ascii: false })
  expect(lineText(top)).toBe('╭─ Details ──────────────── ✓ adopted ─╮')
  expect(lineWidth(top)).toBe(40)
  // the title keeps its style, the border is quiet
  expect(top.find(s => s.text === 'Details')).toEqual({ text: 'Details', bold: true })
  expect(top[0]).toEqual(S('╭', QUIET))
  // nothing to say on the right, or no title at all
  expect(lineText(frameTop(20, { title: [S('Now')], ascii: false }))).toBe('╭─ Now ────────────╮')
  expect(lineText(frameTop(12, { title: [], ascii: false }))).toBe('╭──────────╮')
  // ASCII corners and dashes
  expect(lineText(frameTop(30, { title: [S('Now')], right: [S('stale 3 min')], ascii: true }))).toBe('+- Now -------- stale 3 min -+')
  // a Chinese word on the right counts two columns a character
  expect(lineText(frameTop(30, { title: [S('Details')], right: [S('✓ 采用  user')], ascii: false }))).toBe('╭─ Details ─── ✓ 采用  user ─╮')
})

test('frame: with too little room the words on the right go first, then the title is cut; the line never gets wider', () => {
  // no room for the right-hand words beside the title: they are left out whole
  expect(lineText(frameTop(22, { title: [S('Details')], right: [S('✓ adopted  model')], ascii: false }))).toBe('╭─ Details ──────────╮')
  // no room for the title: it is cut
  expect(lineText(frameTop(8, { title: [S('Details')], right: [S('x')], ascii: false }))).toBe('╭─ De…─╮')
  for (let width = 4; width <= 60; width++) {
    for (const right of [[], [S('✓ adopted  model  10-01')]]) {
      const top = frameTop(width, { title: [S('Details')], right, ascii: false })
      expect(lineWidth(top), `${width}`).toBe(width)
    }
  }
})

test('frame: a row is its content between the sides, padded or cut to the width inside', () => {
  expect(lineText(frameRow([S('hello')], 20, false))).toBe('│ hello            │')
  expect(lineText(frameRow([S('hello there my friend, how are you')], 20, false))).toBe('│ hello there my … │')
  expect(lineText(frameRow([S('中文字')], 20, false))).toBe('│ 中文字           │')
  expect(lineText(frameBlank(20, false))).toBe('│                  │')
  expect(lineText(frameRow([S('x')], 12, true))).toBe('| x        |')
  for (let width = 5; width <= 40; width++) {
    for (const content of [[], [S('a short one')], [S('一个很长很长很长的句子'.repeat(4))]]) {
      expect(lineWidth(frameRow(content, width, false)), `${width}`).toBe(width)
    }
  }
  // the content has four columns less than the frame: a side and a blank on each
  expect(FRAME_COLUMNS).toBe(4)
  expect(frameInner(20)).toBe(16)
  expect(frameInner(2)).toBe(1)
})

test('frame: the bottom border closes it, in ASCII too', () => {
  expect(lineText(frameBottom(20, false))).toBe('╰──────────────────╯')
  expect(lineText(frameBottom(20, true))).toBe('+------------------+')
  expect(lineWidth(frameBottom(3, false))).toBe(3)
})

test('frame: a row that draws its own content (a button) gets only its two sides, which add up to the frame', () => {
  for (const [width, content] of [
    [20, 9],
    [30, 12],
    [80, 1],
  ] as const) {
    const { left, right } = frameSides(width, content, false)
    expect(lineText(left)).toBe('│ ')
    expect(lineWidth(left) + content + lineWidth(right)).toBe(width)
    expect(lineText(right).endsWith('│')).toBe(true)
  }
  // content wider than the room is not padded negatively
  const { left, right } = frameSides(10, 20, true)
  expect(lineText(left)).toBe('| ')
  expect(lineText(right)).toBe(' |')
})

const BAND = { bg: 'subtle', bar: '▌', barColor: 'suggestion' }

test('frame: a row that is picked is the row of the frame with a bar in its first column and a background under its content', () => {
  const band = frameBand([S('hello', { bold: true }), S(' there')], 20, false, BAND)
  expect(lineText(band)).toBe('│▌hello there      │')
  expect(lineWidth(band)).toBe(20)
  // the sides keep their look, the bar has its colour, and everything between has the background, the content its own style too
  expect(band[0]).toEqual(S('│', QUIET))
  expect(band[1]).toEqual({ text: '▌', color: 'suggestion', bg: 'subtle' })
  expect(band[band.length - 1]).toEqual(S('│', QUIET))
  const inside = band.slice(1, -1)
  expect(inside.every(s => s.bg === 'subtle')).toBe(true)
  expect(inside.find(s => s.text === 'hello')).toEqual({ text: 'hello', bold: true, bg: 'subtle' })
  // a span that has a background of its own keeps it
  expect(frameBand([S('x', { bg: 'other' })], 12, false, BAND).find(s => s.text === 'x')!.bg).toBe('other')
  // it reads like the plain row, with the bar in place of the blank beside the side
  for (const width of [8, 20, 33, 60]) {
    for (const content of [[], [S('a short one')], [S('一个很长很长很长的句子'.repeat(4))]]) {
      const plain = lineText(frameRow(content, width, false))
      expect(lineText(frameBand(content, width, false, BAND)), `${width}`).toBe(plain.replace('│ ', '│▌'))
      expect(lineWidth(frameBand(content, width, false, BAND)), `${width}`).toBe(width)
    }
  }
  // in ASCII, with the bar the caller gives
  expect(lineText(frameBand([S('x')], 12, true, { ...BAND, bar: '>' }))).toBe('|>x        |')
})
