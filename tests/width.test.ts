import { test, expect } from 'claude-code/testing'

import { charWidth, drawable, fit, isAltered, oneLine, padEnd, padStart, plain, sanitize, strWidth, truncate, wrap } from '../lib/width'

test('width: ascii, CJK, fullwidth and mixed text', () => {
  expect(strWidth('abc')).toBe(3)
  expect(strWidth('中文')).toBe(4)
  expect(strWidth('a中b')).toBe(4)
  expect(strWidth('ＡＢ')).toBe(4)
  expect(strWidth('，。')).toBe(4)
  expect(strWidth('（exp-2）')).toBe(2 + 5 + 2)
  expect(strWidth('')).toBe(0)
})

test('width: ambiguous-width glyphs the tree draws count one column', () => {
  for (const g of ['✓', '✗', '=', '◐', '○', '◌', '⊘', '‖', '─', '│', '├', '└', '█', '░', '›', '…']) {
    expect(strWidth(g)).toBe(1)
  }
  expect(strWidth('├ ✓ 连接只走池化')).toBe(4 + 12)
})

test('width: combining marks take no column and emoji take two', () => {
  expect(strWidth('é')).toBe(1)
  expect(strWidth('中́')).toBe(2)
  expect(strWidth('😀')).toBe(2)
  expect(strWidth('a‍b')).toBe(2)
  expect(charWidth(0x1b)).toBe(0)
})

test('sanitize drops control characters and oneLine folds whitespace', () => {
  expect(sanitize('a\u001b[31mb\tc\r\nd')).toBe('a[31mb  c\nd')
  expect(oneLine('  a \n\n b\t c  ')).toBe('a b c')
})

test('truncate never exceeds the limit and marks the cut', () => {
  expect(truncate('abcdef', 6)).toBe('abcdef')
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(truncate('决策树决策树', 7)).toBe('决策树…')
  expect(truncate('a中中', 4)).toBe('a中…')
  expect(truncate('中中中', 4)).toBe('中…')
  expect(truncate('中中', 4)).toBe('中中')
  expect(truncate('abc', 0)).toBe('')
  expect(truncate('abc', 1)).toBe('…')
  for (let max = 1; max < 14; max++) {
    for (const s of ['中英 mixed 文本 with 标点，and more', 'plain ascii text that is long', '全是中文的标题没有空格也要截断']) {
      expect(strWidth(truncate(s, max)) <= max).toBe(true)
    }
  }
})

test('pad helpers pad by display width', () => {
  expect(padEnd('中', 4)).toBe('中  ')
  expect(padStart('中', 4)).toBe('  中')
  expect(padEnd('abcdef', 3)).toBe('abcdef')
})

test('fit puts the right part flush right and cuts the left part first', () => {
  const line = fit('连接只走池化（exp-2）', '10-09', 24)
  expect(strWidth(line)).toBe(24)
  expect(line.endsWith('10-09')).toBe(true)
  const tight = fit('一个很长很长很长的标题', '10-09', 14)
  expect(strWidth(tight)).toBe(14)
  expect(tight.endsWith('10-09')).toBe(true)
  expect(tight.includes('…')).toBe(true)
  expect(strWidth(fit('abc', '', 10))).toBe(10)
  expect(strWidth(fit('abc', 'a very long right part', 6))).toBeLessThanOrEqual(6)
})

test('wrap breaks at spaces and between CJK characters', () => {
  expect(wrap('hello world foo', 11)).toEqual(['hello world', 'foo'])
  expect(wrap('hello world', 5)).toEqual(['hello', 'world'])
  expect(wrap('池的大小、线程、队列全部用比例', 12)).toEqual(['池的大小、线', '程、队列全部', '用比例'])
  expect(wrap('a\nb', 10)).toEqual(['a', 'b'])
  expect(wrap('', 10)).toEqual([''])
  // a word wider than the line is broken by characters
  expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  for (const line of wrap('中英文 mixed text 一起 wrap，看看会不会超宽 with very-long-unbroken-token-here', 9)) {
    expect(strWidth(line) <= 9).toBe(true)
  }
})

test('wrap keeps closing marks off the start of a line and opening brackets off the end', () => {
  // the stop would start the second line: the character before it goes down with it
  expect(wrap('池的大小，线程', 8)).toEqual(['池的大', '小，线程'])
  // an opening bracket would end the first line: it goes down to what it opens
  expect(wrap('池的大（默认）', 8)).toEqual(['池的大', '（默认）'])
  expect(wrap('选择连接池（默认值）。', 12)).toEqual(['选择连接池', '（默认值）。'])
  // two closing marks in a row stay with the text before them
  expect(wrap('池的大）。线', 8)).toEqual(['池的', '大）。线'])
  // the same for the plain brackets and stops next to CJK characters, and for the dash and the ellipsis
  expect(wrap('池的大小(默认)', 9)).toEqual(['池的大小', '(默认)'])
  expect(wrap('池的大小……还有', 8)).toEqual(['池的大', '小……还有'])
  expect(wrap('池的大小——还有', 8)).toEqual(['池的大', '小——还有'])
  // a space is a break of its own: nothing moves
  expect(wrap('池的大小 ，线程', 8)).toEqual(['池的大小', '，线程'])
  // the text is whole, every line fits, and no mark is on an edge it must not touch (from the width that holds the
  // longest word with two marks after it)
  const prose = '先把连接池的大小定为 32，再看 P99 的变化（见 exp-2）；如果没有改善，就改成按比例分配——线程、队列也一样。结论：采用“比例”方案。'
  for (let width = 10; width <= 40; width++) {
    const lines = wrap(prose, width)
    expect(lines.join(' ').replace(/ /g, '')).toBe(prose.replace(/ /g, ''))
    for (const line of lines) {
      expect(strWidth(line) <= width).toBe(true)
      expect(/^[，。、；：！？）”…—,.;:!?)]/.test(line)).toBe(false)
      expect(/[（“(]$/.test(line)).toBe(false)
    }
  }
  // too narrow to move anything: the lines still fit
  for (const line of wrap('池，的。大）小', 2)) expect(strWidth(line) <= 2).toBe(true)
})

// ---------------------------------------------------------------- drawable: text every terminal counts the same
//
// Terminals disagree about emoji sequences: is a heart with a selector one group of cells or two,
// how wide is a flag, what of an emoji the width table is too old to know? So the pane draws
// `drawable(s)`. The sequences are spelled with escapes because their joiners and selectors are the point.

const HEART = '❤\ufe0f' // a heart and the emoji selector
const FAMILY = '\u{1F468}\u200d\u{1F469}\u200d\u{1F467}' // man, woman and girl joined by zero-width joiners
const THUMB = '\u{1F44D}\u{1F3FD}' // a thumb and a skin-tone modifier
const KEYCAP = '1\ufe0f\u20e3' // a 1, the emoji selector and the enclosing keycap
const CHINA = '\u{1F1E8}\u{1F1F3}' // the regional indicators C and N: a flag
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}' // a black flag and tag letters
const MELTING = '\u{1FAE0}' // melting face, added in Unicode 14

test('drawable: variation selectors, joiners, modifiers, keycaps and tags go; flags become letters; new emoji become ?', () => {
  // variation selectors, emoji style (FE0F) and text style (FE0E)
  expect(drawable(HEART)).toBe('❤')
  expect(drawable('✔\ufe0f ☺\ufe0e')).toBe('✔ ☺')
  // joiners: a family is drawn as the people side by side
  expect(drawable(FAMILY)).toBe('\u{1F468}\u{1F469}\u{1F467}')
  expect(drawable('\u{1F469}\u200d\u{1F4BB}')).toBe('\u{1F469}\u{1F4BB}')
  // skin-tone modifiers, all five
  for (let tone = 0x1f3fb; tone <= 0x1f3ff; tone++) expect(drawable('\u{1F44D}' + String.fromCodePoint(tone))).toBe('\u{1F44D}')
  expect(drawable(THUMB)).toBe('\u{1F44D}')
  // keycaps, with and without the selector
  expect(drawable(KEYCAP)).toBe('1')
  expect(drawable('#\ufe0f\u20e3 0\u20e3')).toBe('# 0')
  // tags: the flag of England is a black flag followed by tag letters
  expect(drawable(ENGLAND)).toBe('\u{1F3F4}')
  // flags are the letters of their country code, and a lone indicator is its letter
  expect(drawable(CHINA)).toBe('CN')
  expect(drawable('\u{1F1FA}\u{1F1F8}\u{1F1EF}\u{1F1F5}')).toBe('USJP')
  expect(drawable('from \u{1F1E8}\u{1F1F3} to \u{1F1E9}')).toBe('from CN to D')
  // emoji newer than the width table, one question mark each; the neighbours from Unicode 12 stay
  for (const cp of [0x1f6d6, 0x1f6fb, 0x1f7f0, 0x1f90c, 0x1f972, 0x1f978, 0x1f9cc, 0x1fae0, 0x1fae8]) {
    expect(drawable(`a${String.fromCodePoint(cp)}b`)).toBe('a?b')
  }
  for (const cp of [0x1f6d5, 0x1f6fa, 0x1f90d, 0x1f971]) expect(drawable(String.fromCodePoint(cp))).toBe(String.fromCodePoint(cp))
  // all of it in one line
  const messy = `ok ✅ ${HEART} ${FAMILY} ${CHINA} ${KEYCAP} ${THUMB} ${MELTING} ${ENGLAND}`
  expect(drawable(messy)).toBe('ok ✅ ❤ \u{1F468}\u{1F469}\u{1F467} CN 1 \u{1F44D} ? \u{1F3F4}')
})

test('drawable: leaves alone what every terminal already counts the same', () => {
  const alone = [
    'plain ASCII, digits 0123456789 and (symbols) -> [ok] "q" #1 @ 100%',
    '决策树 连接只走池化（exp-2）',
    'ＡＢＣ，。！',
    'ひらがな カタカナ',
    '한국어 결정',
    '\u1112\u1161\u11ab', // the syllable 한 as conjoining jamo
    'café naïve ÀÉÎÕÜ',
    'cafe\u0301 nai\u0308ve', // the same accents as combining marks
    'Привет мир αβγ שלום مرحبا',
    '−12.6% [−15.1, −10.4]',
    '├ └ │ ─ ✓ ✗ ◐ ○ ⊘ ‖ █ ░ › … ▾ ▸ ▲ ▼ ❯', // what the tree draws itself
    '✓ ✔ ✅ ❌ ★ ☆ ⭐ ✨ ☀ ⚡ 😀 🎉 👍 🔥 🚀 🤖 🥰', // emoji every table knows, with no selector or modifier
    '\u{1F6D5} \u{1F6FA} \u{1F90D} \u{1F971}', // the newest ones the table knows: Unicode 12
    'a\tb\nc', // layout is sanitize's business, not drawable's
  ]
  for (const s of alone) {
    expect(drawable(s)).toBe(s)
    expect(strWidth(drawable(s))).toBe(strWidth(s))
    for (const ch of s) expect(isAltered(ch.codePointAt(0)!)).toBe(false)
  }
})

test('drawable: invisible characters and half a surrogate pair are dropped', () => {
  const invisible = [
    '\u00ad', // soft hyphen
    '\u034f', // combining grapheme joiner
    '\u061c', // Arabic letter mark
    '\u180b', // Mongolian free variation selector
    '\u200b', // zero-width space
    '\u200c', // zero-width non-joiner
    '\u200d', // zero-width joiner
    '\u200e', // left-to-right mark
    '\u200f', // right-to-left mark
    '\u2060', // word joiner
    '\u2062', // invisible times
    '\u206a', // inhibit symmetric swapping
    '\ufeff', // byte order mark
    '\ufff9', // interlinear annotation anchor
    '\ufe00', // variation selector 1
    '\u{E0100}', // variation selector 17
  ]
  for (const ch of invisible) {
    expect(drawable(`a${ch}b`)).toBe('ab')
    expect(strWidth(drawable(`a${ch}b`))).toBe(2)
  }
  expect(drawable('\u200b\u200d\ufe0f\ufeff')).toBe('')

  // half of a pair: what a string cut in the middle of an emoji leaves behind
  const smile = '\u{1F600}'
  expect(smile.length).toBe(2)
  expect(drawable(`ok ${smile.slice(0, 1)}`)).toBe('ok ')
  expect(drawable(`${smile.slice(1)} ok`)).toBe(' ok')
  expect(drawable(`${smile.slice(0, 1)}\u200b${smile.slice(1)}`)).toBe('')
  expect(drawable(`ok ${smile}`)).toBe(`ok ${smile}`)
  expect(drawable('ok \u{1F44D}'.slice(0, -1))).toBe('ok ')

  // not invisible: an accent changes the letter under it, and these take room
  expect(drawable('e\u0301 a\u00a0b \u3000 \u2003')).toBe('e\u0301 a\u00a0b \u3000 \u2003')
})

test('drawable: idempotent, and isAltered says exactly which code points it changes', () => {
  // [first, last, what they are drawn as]: '' for nothing, 'letter' for a country-code letter, '?' for a stand-in
  const CHANGED: readonly (readonly [number, number, string])[] = [
    [0x00ad, 0x00ad, ''], // soft hyphen
    [0x034f, 0x034f, ''], // combining grapheme joiner
    [0x061c, 0x061c, ''], // Arabic letter mark
    [0x180b, 0x180f, ''], // Mongolian variation selectors
    [0x200b, 0x200f, ''], // zero-width space, joiners, direction marks
    [0x2060, 0x2064, ''], // word joiner, invisible operators
    [0x206a, 0x206f, ''], // deprecated format characters
    [0x20e3, 0x20e3, ''], // enclosing keycap
    [0xd800, 0xdfff, ''], // half of a surrogate pair
    [0xfe00, 0xfe0f, ''], // variation selectors
    [0xfeff, 0xfeff, ''], // byte order mark
    [0xfff9, 0xfffb, ''], // interlinear annotations
    [0x1f1e6, 0x1f1ff, 'letter'], // regional indicators, the halves of a flag
    [0x1f3fb, 0x1f3ff, ''], // skin-tone modifiers
    [0x1f6d6, 0x1f6df, '?'], // emoji from Unicode 13 on
    [0x1f6fb, 0x1f6fc, '?'],
    [0x1f7f0, 0x1f7f0, '?'],
    [0x1f90c, 0x1f90c, '?'],
    [0x1f972, 0x1f972, '?'],
    [0x1f977, 0x1f979, '?'],
    [0x1f9cc, 0x1f9cc, '?'],
    [0x1fa70, 0x1faff, '?'], // the whole block, so the Unicode 12 emoji at its start (ballet shoes, yo-yo, ringed planet) too
    [0xe0000, 0xe0fff, ''], // tags
  ]
  const drawnAs = new Map<number, string>()
  for (const [first, last, as] of CHANGED) {
    for (let cp = first; cp <= last; cp++) drawnAs.set(cp, as === 'letter' ? String.fromCharCode(0x41 + cp - 0x1f1e6) : as)
  }
  // every code point there is: what it is drawn as, whether isAltered says so, and that drawing it again changes nothing
  const wrong: string[] = []
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    const ch = String.fromCodePoint(cp)
    const want = drawnAs.get(cp) ?? ch
    const got = drawable(ch)
    if (got !== want || isAltered(cp) !== (want !== ch) || drawable(got) !== got) wrong.push(`U+${cp.toString(16).toUpperCase()}`)
  }
  expect(wrong.slice(0, 8)).toEqual([])
  expect(isAltered(0x200d)).toBe(true)
  expect(isAltered(0x1f1e8)).toBe(true)
  expect(isAltered(0x1fae0)).toBe(true)
  expect(isAltered(0x2764)).toBe(false)
  expect(isAltered(0x4e2d)).toBe(false)

  // text: drawing what was drawn changes nothing
  const samples = [
    `${HEART} ${FAMILY} ${CHINA} ${KEYCAP} ${THUMB} ${MELTING} ${ENGLAND}`,
    'a\u200b\u200bb\ud83d',
    '\ud83d\u200b\ude00', // two halves with an invisible character between: nothing may join them up again
    '中文 é 한글 ✓',
    '',
  ]
  for (const s of samples) expect(drawable(drawable(s))).toBe(drawable(s))
  // and a deterministic scramble of the interesting code points
  const pool = [0x41, 0x20, 0x4e2d, 0xe9, 0x301, 0x2764, 0xfe0f, 0x200d, 0x20e3, 0x1f468, 0x1f469, 0x1f3fd, 0x1f1e8, 0x1f1f3, 0x1f3f4, 0xe0067, 0xe007f, 0x1fae0, 0xd83d, 0xde00, 0xad]
  let seed = 7
  for (let k = 0; k < 300; k++) {
    let s = ''
    for (let n = 0; n < 12; n++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
      s += String.fromCodePoint(pool[seed % pool.length]!)
    }
    const once = drawable(s)
    if (drawable(once) !== once) throw new Error(`not idempotent for ${JSON.stringify(s)}`)
  }
})

// Two ways a terminal can count a line. One counts code points: each takes the columns the table gives
// it. The other clusters graphemes (Ghostty does, by default): a cluster is its base character, widened
// to two columns by an emoji selector or a keycap, and a flag is two.
const isRegionalIndicator = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff
const clustersBySegmenter = (s: string): string[] => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map(x => x.segment)
// the hand rule for where there is no Intl.Segmenter: a flag, or a character with the marks, modifiers, tags and joined emoji after it
const clustersByRule = (s: string): string[] => s.match(/\p{Regional_Indicator}{2}|\P{M}(?:\p{M}|\p{Emoji_Modifier}|[\u{E0020}-\u{E007F}]|\u200d\P{M})*/gu) ?? []
const clusters = typeof Intl.Segmenter === 'function' ? clustersBySegmenter : clustersByRule

const byCodePoints = (s: string): number => strWidth(s)

function byClusters(s: string): number {
  let w = 0
  for (const cluster of clusters(s)) {
    const cps = [...cluster].map(ch => ch.codePointAt(0)!)
    const widened = cps.includes(0xfe0f) || cps.includes(0x20e3) || (cps.length === 2 && cps.every(isRegionalIndicator))
    w += widened ? 2 : charWidth(cps[0]!)
  }
  return w
}

test('drawable: what is left is counted the same by terminals that cluster graphemes and ones that count code points', () => {
  // as they are written, these are counted differently by the two
  const sequences = [HEART, FAMILY, THUMB, KEYCAP, ENGLAND, '✔\ufe0f', '\u{1F469}\u200d\u{1F4BB}']
  for (const s of sequences) expect(byCodePoints(s)).not.toBe(byClusters(s))
  expect(byCodePoints(FAMILY)).toBe(6) // three people of two columns, the joiners none
  expect(byClusters(FAMILY)).toBe(2) // one family of two columns

  // as drawable leaves them, they are not
  const others = [
    CHINA,
    MELTING,
    '☺\ufe0e',
    `ok ✅ ${HEART} ${FAMILY} ${CHINA} ${KEYCAP} ${THUMB} ${MELTING} ${ENGLAND} done`,
    '决策树 连接只走池化（exp-2） ✓ ✗ ◐ ○ ⊘',
    'cafe\u0301 中\u0301 한국어',
  ]
  for (const s of [...sequences, ...others, '\u1112\u1161\u11ab']) {
    expect(byClusters(drawable(s))).toBe(byCodePoints(drawable(s)))
  }
  expect(byCodePoints(drawable(FAMILY))).toBe(6)
  expect(byClusters(drawable(FAMILY))).toBe(6)
  expect(byCodePoints(drawable(KEYCAP))).toBe(1)
  expect(byClusters(drawable(KEYCAP))).toBe(1)

  // where there is an Intl.Segmenter, the hand rule clusters these the same way
  if (typeof Intl.Segmenter === 'function') {
    for (const s of [...sequences, ...others]) expect(clustersByRule(s)).toEqual(clustersBySegmenter(s))
  }
})

test('plain: one line of drawable text', () => {
  expect(plain(`${HEART} love\n  ${FAMILY}\tfamily\u200b `)).toBe('❤ love \u{1F468}\u{1F469}\u{1F467} family')
  expect(plain(`${CHINA}\r\n${MELTING}`)).toBe('CN ?')
  // control characters go, as for sanitize; what followed the escape is only text
  expect(plain('a\u001b[31mb')).toBe('a[31mb')
  // nothing visible left: empty, which is how a title of invisible characters shows as untitled
  expect(plain('  \u200b \u200d\n\ufe0f ')).toBe('')
  expect(plain('')).toBe('')
  // exactly oneLine of drawable, and never a newline, a tab or a run of spaces
  for (const s of [`a\n\n${HEART}   b\t${KEYCAP}`, `${THUMB}\r\n ${ENGLAND} `, 'x \u200b y', '  plain   text  ']) {
    expect(plain(s)).toBe(oneLine(drawable(s)))
    expect(/[\n\r\t]| {2}|^ | $/.test(plain(s))).toBe(false)
  }
  expect(plain('x \u200b y')).toBe('x y')
})

test('wrap draws drawable text, so its lines hold no joiner or selector', () => {
  const text = `${FAMILY} ${HEART} ${KEYCAP} ${THUMB} ${CHINA} ${MELTING} ${ENGLAND} done`
  for (const width of [2, 3, 5, 8, 12, 30]) {
    const lines = wrap(text, width)
    expect(lines).toEqual(wrap(drawable(text), width))
    for (const line of lines) {
      expect(/[\u200d\ufe0f\u20e3\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{E0000}-\u{E0FFF}]/u.test(line)).toBe(false)
      expect(strWidth(line) <= width).toBe(true)
    }
  }
  // a family too wide for the line is split between the people, never in the middle of a joiner
  expect(wrap(FAMILY, 4)).toEqual(['\u{1F468}\u{1F469}', '\u{1F467}'])
  expect(wrap(HEART.repeat(4), 2)).toEqual(['❤❤', '❤❤'])
  expect(wrap(`${KEYCAP} 2\ufe0f\u20e3 3\ufe0f\u20e3`, 3)).toEqual(['1 2', '3'])
  expect(wrap(`ok ${CHINA}`, 10)).toEqual(['ok CN'])
  expect(wrap(`${THUMB} ok`, 4)).toEqual(['\u{1F44D}', 'ok'])
})
