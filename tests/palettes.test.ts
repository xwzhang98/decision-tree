import { test, expect } from 'claude-code/testing'

import { DEFAULT_SCHEME, SCHEMES, SCHEME_IDS, SLOTS, SLOT_KEYS, effectiveScheme, findScheme, paintColor, paintFor, schemeOf, slotOf, swatchOf } from '../lib/palettes'

const hex = (s: string) => /^#[0-9a-f]{6}$/.test(s)

function luminance(h: string): number {
  const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

test('palettes: the default is the first scheme and the ids are unique', () => {
  expect(SCHEMES[0]!.id).toBe(DEFAULT_SCHEME)
  expect(DEFAULT_SCHEME).toBe('terminal')
  expect(new Set(SCHEME_IDS).size).toBe(SCHEMES.length)
  expect(SCHEMES.length).toBe(16)
  for (const s of SCHEMES) {
    expect(s.id).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(s.name.length).toBeGreaterThan(0)
    expect(s.note.en.length).toBeGreaterThan(0)
    expect(s.note.zh.length).toBeGreaterThan(0)
  }
})

test('palettes: a scheme holds seven colours, hex ones (or the names of the terminal colours) that differ from one another', () => {
  for (const s of SCHEMES) {
    if (s.accents === null) {
      expect(s.id).toBe('theme')
      continue
    }
    const colours = SLOTS.map(slot => s.accents![slot])
    expect(new Set(colours).size).toBe(7)
    for (const c of colours) {
      if (s.id === 'terminal') expect(c).toMatch(/^(red|green|yellow|blue|magenta|cyan)(Bright)?$/)
      else expect(hex(c)).toBe(true)
    }
  }
})

test('palettes: a light scheme is dark enough for a white screen and a dark one light enough for a black one', () => {
  for (const s of SCHEMES) {
    if (s.accents === null || s.id === 'terminal') continue
    for (const slot of SLOTS) {
      const c = s.accents[slot]
      if (s.tone === 'dark') expect(contrast(c, '#1e1e1e')).toBeGreaterThan(3)
      // (the published Latte yellow is the lowest at 2.6)
      if (s.tone === 'light') expect(contrast(c, '#ffffff')).toBeGreaterThan(2.5)
    }
  }
})

test('palettes: ids are found whatever the case and spacing, and unknown ones fall back to the default', () => {
  expect(findScheme('Gruvbox Dark')?.id).toBe('gruvbox-dark')
  expect(findScheme('  tokyo_night ')?.id).toBe('tokyo-night')
  expect(findScheme('nope')).toBeUndefined()
  expect(schemeOf('nord').id).toBe('nord')
  expect(schemeOf('nope').id).toBe('terminal')
  expect(schemeOf(undefined).id).toBe('terminal')
  expect(schemeOf(42).id).toBe('terminal')
  expect(schemeOf('constructor').id).toBe('terminal')
})

test('palettes: the accent keys each stand in for a slot and nothing else is repainted', () => {
  const nord = schemeOf('nord')
  expect(paintColor(nord, 'error')).toBe('#bf616a')
  expect(paintColor(nord, 'claude')).toBe('#d08770')
  expect(paintColor(nord, 'warning')).toBe('#ebcb8b')
  expect(paintColor(nord, 'success')).toBe('#a3be8c')
  expect(paintColor(nord, 'planMode')).toBe('#88c0d0')
  for (const key of SLOT_KEYS.blue) expect(paintColor(nord, key)).toBe('#81a1c1')
  expect(paintColor(nord, 'merged')).toBe('#b48ead')
  // text, grey, the selection band and raw colours stay as they are
  for (const key of ['text', 'inactive', 'subtle', 'inverseText', '#123456', 'red', 'constructor']) expect(paintColor(nord, key)).toBe(key)
  expect(paintColor(nord, undefined)).toBeUndefined()
  // the scheme that follows the theme repaints nothing
  expect(paintColor(schemeOf('theme'), 'error')).toBe('error')
  // the terminal's own colours are named, not numbered
  expect(paintColor(schemeOf('terminal'), 'success')).toBe('green')
  expect(paintColor(schemeOf('terminal'), 'merged')).toBe('magenta')
  expect(paintFor(nord)('success')).toBe('#a3be8c')
})

test('palettes: slotOf knows the accent keys only', () => {
  expect(slotOf('ide')).toBe('blue')
  expect(slotOf('suggestion')).toBe('blue')
  expect(slotOf('merged')).toBe('purple')
  expect(slotOf('text')).toBeUndefined()
  expect(slotOf('toString')).toBeUndefined()
})

test('palettes: the terminal scheme is a terminal thing; elsewhere the theme is drawn', () => {
  const terminal = schemeOf('terminal')
  expect(effectiveScheme(terminal, 'terminal').id).toBe('terminal')
  expect(effectiveScheme(terminal, undefined).id).toBe('terminal')
  expect(effectiveScheme(terminal, 'desktop').id).toBe('theme')
  expect(effectiveScheme(schemeOf('nord'), 'desktop').id).toBe('nord')
})

test('palettes: a swatch has a colour per slot, theme keys for the scheme that follows the theme', () => {
  expect(swatchOf(schemeOf('nord'))).toEqual(['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#88c0d0', '#81a1c1', '#b48ead'])
  expect(swatchOf(schemeOf('theme'))).toEqual(['error', 'claude', 'warning', 'success', 'planMode', 'ide', 'merged'])
})
