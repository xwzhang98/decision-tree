// Colour schemes for the pane.
//
// The pane paints with the theme keys of Claude Code (`success`, `error`, `ide` ...), so it follows whatever
// theme the person has. A scheme replaces the accent colours only: the statuses, the mainline, the coloured
// words, the markers. Text, grey and the selection band stay the terminal's own, so the pane still sits in
// the person's terminal. The layout never knows about schemes; `paintFor(scheme)` is applied to the colours
// just before they are drawn.
//
// A scheme has seven accent slots, and each slot stands in for the theme keys it is named after:
//   red     error                                 rejected, problems
//   orange  claude                                the model; the third tree
//   yellow  warning                               numbers, things to look at
//   green   success                               adopted, quotes, recording
//   cyan    planMode                              technical words; the second tree
//   blue    ide, suggestion, remember, permission topics, file names, in progress, markers
//   purple  merged                                the mainline; the first tree
//
// The colours of each scheme are the accent colours its authors publish (see THIRD_PARTY.md). A scheme made
// for a light terminal and one made for a dark terminal are separate entries, because a mod cannot ask the
// terminal which it is; the person picks the one that sits well in theirs.

export const SLOTS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const
export type Slot = (typeof SLOTS)[number]
export type Accents = Readonly<Record<Slot, string>>

/** The theme key each slot stands in for (the first key of a slot is the one its swatch shows). */
export const SLOT_KEYS: Readonly<Record<Slot, readonly string[]>> = {
  red: ['error'],
  orange: ['claude'],
  yellow: ['warning'],
  green: ['success'],
  cyan: ['planMode'],
  blue: ['ide', 'suggestion', 'remember', 'permission'],
  purple: ['merged'],
}

const KEYMAP: Readonly<Record<string, Slot>> = Object.fromEntries(
  (Object.entries(SLOT_KEYS) as [Slot, readonly string[]][]).flatMap(([slot, keys]) => keys.map(key => [key, slot] as const)),
)

export type SchemeTone = 'dark' | 'light' | 'any'

export type Scheme = {
  /** What a person types and what is remembered. */
  readonly id: string
  /** What the picker shows: the name its authors give it. */
  readonly name: string
  /** What the scheme is like, in the two languages of the pane. */
  readonly note: { readonly en: string; readonly zh: string }
  /** The kind of terminal it was made for. */
  readonly tone: SchemeTone
  /** The seven colours; null for the scheme that leaves the theme keys alone. */
  readonly accents: Accents | null
}

function accents(red: string, orange: string, yellow: string, green: string, cyan: string, blue: string, purple: string): Accents {
  return { red, orange, yellow, green, cyan, blue, purple }
}

export const DEFAULT_SCHEME = 'terminal'

export const SCHEMES: readonly Scheme[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    note: { en: "your terminal's own 16 colors", zh: '用 terminal 自带的 16 色' },
    tone: 'any',
    // The names of the 16 ANSI colours: whatever the terminal's own theme makes of them. The same pairs Claude Code's
    // ANSI themes use, except that blue is the bright one on every terminal (the plain one is dark on a black screen).
    accents: accents('red', 'redBright', 'yellow', 'green', 'cyan', 'blueBright', 'magenta'),
  },
  {
    id: 'theme',
    name: 'Theme',
    note: { en: "follows Claude Code's own theme", zh: '跟随 Claude Code 的 theme' },
    tone: 'any',
    accents: null,
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    note: { en: 'Atom, for dark terminals', zh: 'Atom 的深色' },
    tone: 'dark',
    accents: accents('#e06c75', '#d19a66', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd'),
  },
  {
    id: 'one-light',
    name: 'One Light',
    note: { en: 'Atom, for light terminals', zh: 'Atom 的浅色' },
    tone: 'light',
    accents: accents('#e45649', '#986801', '#c18401', '#50a14f', '#0184bc', '#4078f2', '#a626a4'),
  },
  {
    id: 'nord',
    name: 'Nord',
    note: { en: 'cool and muted, for dark terminals', zh: '冷色、低饱和，适合深色' },
    tone: 'dark',
    accents: accents('#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#88c0d0', '#81a1c1', '#b48ead'),
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    note: { en: 'warm and retro', zh: '暖色、复古' },
    tone: 'dark',
    accents: accents('#fb4934', '#fe8019', '#fabd2f', '#b8bb26', '#8ec07c', '#83a598', '#d3869b'),
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    note: { en: 'warm and retro', zh: '暖色、复古' },
    tone: 'light',
    accents: accents('#9d0006', '#af3a03', '#b57614', '#79740e', '#427b58', '#076678', '#8f3f71'),
  },
  {
    id: 'dracula',
    name: 'Dracula',
    note: { en: 'vivid, purple and pink, for dark terminals', zh: '鲜艳、紫粉，适合深色' },
    tone: 'dark',
    accents: accents('#ff5555', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9', '#ff79c6'),
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    note: { en: 'blue and violet, soft', zh: '蓝紫、柔和' },
    tone: 'dark',
    accents: accents('#f7768e', '#ff9e64', '#e0af68', '#9ece6a', '#7dcfff', '#7aa2f7', '#bb9af7'),
  },
  {
    id: 'tokyo-night-day',
    name: 'Tokyo Night Day',
    note: { en: 'blue and violet, soft, for light terminals', zh: '蓝紫、柔和，适合浅色' },
    tone: 'light',
    accents: accents('#f52a65', '#b15c00', '#8c6c3e', '#587539', '#007197', '#2e7de9', '#9854f1'),
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    note: { en: 'pastel', zh: '粉彩' },
    tone: 'dark',
    accents: accents('#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#94e2d5', '#89b4fa', '#cba6f7'),
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    note: { en: 'pastel, for light terminals', zh: '粉彩，适合浅色' },
    tone: 'light',
    accents: accents('#d20f39', '#fe640b', '#df8e1d', '#40a02b', '#179299', '#1e66f5', '#8839ef'),
  },
  {
    id: 'solarized',
    name: 'Solarized',
    note: { en: 'low contrast, classic; for dark and light', zh: '低对比、经典；深浅色通用' },
    tone: 'any',
    accents: accents('#dc322f', '#cb4b16', '#b58900', '#859900', '#2aa198', '#268bd2', '#6c71c4'),
  },
  {
    id: 'monokai',
    name: 'Monokai',
    note: { en: 'high contrast, for dark terminals', zh: '高对比，适合深色' },
    tone: 'dark',
    accents: accents('#f92672', '#fd971f', '#f4bf75', '#a6e22e', '#a1efe4', '#66d9ef', '#ae81ff'),
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    note: { en: 'neutral and familiar', zh: '中性、熟悉' },
    tone: 'dark',
    accents: accents('#ff7b72', '#ffa657', '#e3b341', '#7ee787', '#39c5cf', '#79c0ff', '#d2a8ff'),
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    note: { en: 'neutral and familiar', zh: '中性、熟悉' },
    tone: 'light',
    accents: accents('#cf222e', '#953800', '#9a6700', '#116329', '#1b7c83', '#0550ae', '#8250df'),
  },
]

const BY_ID = new Map(SCHEMES.map(s => [s.id, s]))

export const SCHEME_IDS: readonly string[] = SCHEMES.map(s => s.id)

/** The scheme with this id, or undefined. Case and surrounding space do not matter. */
export function findScheme(id: string): Scheme | undefined {
  return BY_ID.get(id.trim().toLowerCase().replace(/[\s_]+/g, '-'))
}

/** The scheme a stored value names; the default when it names none (a scheme removed in a later version, a typo in the store). */
export function schemeOf(value: unknown): Scheme {
  return (typeof value === 'string' ? findScheme(value) : undefined) ?? BY_ID.get(DEFAULT_SCHEME)!
}

/**
 * The scheme to draw with on a surface. The terminal's own 16 colours are a terminal's: any other surface
 * (the desktop app, an editor) draws the theme's.
 */
export function effectiveScheme(scheme: Scheme, surface: string | undefined): Scheme {
  if (scheme.id === 'terminal' && surface !== undefined && surface !== 'terminal') return BY_ID.get('theme')!
  return scheme
}

/** The slot a theme key stands in for, if it is one of the accent keys. */
export function slotOf(key: string): Slot | undefined {
  return Object.hasOwn(KEYMAP, key) ? KEYMAP[key] : undefined
}

/** The colour a scheme gives a color the layout names (a theme key stays as it is where the scheme leaves it alone). */
export function paintColor(scheme: Scheme, color: string | undefined): string | undefined {
  if (color === undefined || scheme.accents === null) return color
  const slot = slotOf(color)
  return slot === undefined ? color : scheme.accents[slot]
}

/** `paintColor` for one scheme, ready to hand around. */
export function paintFor(scheme: Scheme): (color: string | undefined) => string | undefined {
  return color => paintColor(scheme, color)
}

/** The seven colours the picker shows for a scheme, in slot order (theme keys for the scheme that follows the theme). */
export function swatchOf(scheme: Scheme): string[] {
  return SLOTS.map(slot => scheme.accents?.[slot] ?? SLOT_KEYS[slot][0]!)
}
