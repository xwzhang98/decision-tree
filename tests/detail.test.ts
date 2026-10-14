import { expect, test } from 'claude-code/testing'

import { capLines, detailBadge, detailContent, detailTitle, evidenceLine, pathSpans, statusChip } from '../lib/detail'
import { localizeNode, localizer } from '../lib/lang'
import type { Line } from '../lib/spans'
import { lineText, lineWidth, sp } from '../lib/spans'
import { EMPTY_TM } from '../lib/state'
import { QUIET } from '../lib/style'
import { buildIndex } from '../lib/tree'
import { drawable, strWidth } from '../lib/width'
import type { DtLang, DtModel, DtNode, DtTm } from '../types'
import { NOW, iso, noon, notesModel, notesTm } from './notes'

const model = notesModel('en')
const idx = buildIndex(model)
const zhModel = notesModel('zh')
/** A node of the main tree, in the language its model was written in. */
const nodeOf = (id: string, m: DtModel = model): DtNode => m.nodes.find(n => n.id === id)!
const node = (id: string): DtNode => nodeOf(id)

/** The conflicts step, with everything a node can carry. */
const n3 = node('n3')
const BARE = node('n12')

type Over = { lang?: DtLang; roomy?: boolean; model?: DtModel; tm?: DtTm }

/** `n` as the pane draws it: its texts put through the language of the pane first, as the layout does. */
const draw = (n: DtNode, width: number, over: Over = {}): Line[] => {
  const lang = over.lang ?? 'en'
  const loc = localizer(over.tm ?? EMPTY_TM, lang)
  const shown = localizeNode(n, loc)
  return detailContent({ node: shown, idx: over.model !== undefined ? buildIndex(over.model) : idx, width, lang, ascii: false, loc, roomy: over.roomy === true })
}
const textsOf = (lines: readonly Line[]) => lines.map(lineText)

// Emoji sequences, spelled with escapes: their joiners and selectors are what the test is about.
const HEART = '❤️' // a heart and the emoji selector
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}' // man, woman and girl joined by zero-width joiners
const THUMB = '\u{1F44D}\u{1F3FD}' // a thumb and a skin-tone modifier
const KEYCAP = '1️⃣' // a 1, the emoji selector and the enclosing keycap
const CHINA = '\u{1F1E8}\u{1F1F3}' // the regional indicators C and N: a flag
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}' // a black flag and tag letters
const MELTING = '\u{1FAE0}' // melting face, added in Unicode 14
const MESSY = `${HEART} ${FAMILY} ${CHINA} ${KEYCAP} ${THUMB} ${MELTING} ${ENGLAND}`
const TIDY = '❤ \u{1F468}\u{1F469}\u{1F467} CN 1 \u{1F44D} ? \u{1F3F4}'
/** What a pane must not hold: joiners, selectors, keycap marks, skin tones, regional indicators and tag characters. */
const UNDRAWN = /[\p{Join_Control}\p{Variation_Selector}\p{Me}\p{Emoji_Modifier}\p{Regional_Indicator}\u{E0000}-\u{E0FFF}]/u

// ---------------------------------------------------------------- the border

test('detail border: the status is a chip, tinted when the decision is made and quiet when it is not', () => {
  const o = { lang: 'en', ascii: false } as const
  expect(statusChip('adopted', o)).toEqual({ text: ' ✓ adopted ', color: 'success', bg: 'diffAddedDimmed' })
  expect(statusChip('rejected', o)).toEqual({ text: ' ✗ rejected ', color: 'error', bg: 'diffRemovedDimmed' })
  expect(statusChip('planned', o)).toEqual({ text: ' ○ planned ', color: 'suggestion', bg: 'subtle' })
  expect(statusChip('withdrawn', o)).toEqual({ text: ' ⊘ withdrawn ', color: 'inactive', bg: 'subtle', dim: true })
  // ASCII glyphs, and the same words in Chinese: the status words are the terms of the trade
  expect(statusChip('rejected', { lang: 'zh', ascii: true }).text).toBe(' x rejected ')
  for (const status of ['adopted', 'rejected', 'no-diff', 'in-progress', 'planned', 'proposed', 'withdrawn', 'superseded', 'deferred'] as const) {
    expect(statusChip(status, { lang: 'zh', ascii: false })).toEqual(statusChip(status, { lang: 'en', ascii: false }))
  }
})

test('detail border: who decided and when sit after the chip; a node not decided yet shows who recorded it', () => {
  const o = { lang: 'en', ascii: false } as const
  const line = detailBadge(n3, o)
  expect(lineText(line)).toBe(' ✓ adopted  model  10-01')
  expect(line[2]).toEqual({ text: 'model', color: 'claude' })
  expect(line[3]).toEqual({ text: '  10-01', color: 'inactive', dim: true })
  expect(lineText(detailBadge(node('n8'), o))).toBe(' ○ planned  model  10-06')
  expect(lineText(detailBadge({ ...n3, decidedBy: undefined, decidedAt: undefined, createdBy: 'import', createdAt: noon(9, 2) }, o))).toBe(' ✓ adopted  import  09-02')
  // no date at all: only the chip and the actor
  expect(lineText(detailBadge({ ...n3, decidedAt: undefined, createdAt: '' }, o))).toBe(' ✓ adopted  model')
  expect(lineText(detailBadge(n3, { lang: 'zh', ascii: true }))).toBe(' + adopted  model  10-01')
})

test('detail border: the title is Details in both languages', () => {
  expect(detailTitle('en')).toEqual([{ text: 'Details', bold: true }])
  expect(detailTitle('zh')).toEqual([{ text: 'Details', bold: true }])
})

// ---------------------------------------------------------------- sources and evidence

test('paths: the folders are quiet and the file has a colour of its own; the start of a long path goes first', () => {
  expect(pathSpans('docs/design/merge-rules.md', 40)).toEqual([
    { text: 'docs/design/', color: 'inactive', dim: true },
    { text: 'merge-rules.md', color: 'ide' },
  ])
  expect(pathSpans('README.md', 40)).toEqual([{ text: 'README.md', color: 'ide' }])
  const long = pathSpans('reports/merge_replay_20261001/RESULTS.md', 24)
  expect(lineText(long)).toBe('…lay_20261001/RESULTS.md')
  expect(lineWidth(long)).toBe(24)
  // a name wider than the room is cut itself
  expect(lineText(pathSpans('a-very-long-file-name-indeed.md', 10))).toBe('a-very-lo…')
  for (let max = 1; max <= 50; max++) expect(lineWidth(pathSpans('reports/merge_replay_20261001/RESULTS.md', max))).toBeLessThanOrEqual(max)
})

test('evidence: the run goes first, then the label, and the value last', () => {
  const ev = { label: 'cold start, 3 phones', value: 'median −17.4%', ci: '[−19.8, −15.3]', run: 'bench_cold_run' }
  const at = (w: number) => lineText(evidenceLine(ev, w, 4))
  expect(at(80)).toBe('    cold start, 3 phones  median −17.4% [−19.8, −15.3]  bench_cold_run')
  const cutRun = at(66)
  expect(cutRun.startsWith('    cold start, 3 phones  median −17.4% [−19.8, −15.3]  bench_')).toBe(true)
  expect(cutRun.endsWith('…')).toBe(true)
  const noRun = at(60)
  expect(noRun).toBe('    cold start, 3 phones  median −17.4% [−19.8, −15.3]')
  const cutLabel = at(50)
  expect(cutLabel.includes('cold start, 3 phones')).toBe(false)
  expect(cutLabel.includes('median −17.4% [−19.8, −15.3]')).toBe(true)
  expect(cutLabel.startsWith('    cold start, 3 p…  median')).toBe(true)
  for (let w = 6; w < 90; w++) expect(strWidth(at(w))).toBeLessThanOrEqual(w)
  // a result with only a note
  expect(lineText(evidenceLine({ label: 'smoke test', note: 'passed' }, 40, 4))).toBe('    smoke test  passed')
  // a note beside a value is not shown: the value is the result
  expect(lineText(evidenceLine({ label: 'x', value: 'v', note: 'n' }, 40, 0))).toBe('x  v')
})

test('evidence: labels padded to one column line the values up, and a run shows only when enough of it can', () => {
  const a = { label: 'short', value: '1.5', run: 'run-a' }
  const b = { label: 'a longer label', value: '2.5 ms', ci: '[1, 3]' }
  expect(lineText(evidenceLine(a, 60, 4, 14))).toBe(`    ${'short'.padEnd(14)}  1.5  run-a`)
  expect(lineText(evidenceLine(b, 60, 4, 14))).toBe('    a longer label  2.5 ms [1, 3]')
  // no padding when the value would no longer fit beside the padded label: the line keeps its own label
  expect(lineText(evidenceLine(a, 14, 4, 14))).toBe('    short  1.5')
  // the padding goes before the run does: the value stays under the others', and the run is what gives way
  expect(lineText(evidenceLine(a, 4 + 14 + 2 + 3 + 2 + 2, 4, 14))).toBe(`    ${'short'.padEnd(14)}  1.5`)
  // a run cut to fewer than 6 columns says nothing, so it is left out; from 6 columns it is cut with an ellipsis
  const r = { label: 'x', value: 'v', run: 'bench_20261009_long' }
  expect(lineText(evidenceLine(r, 15, 4))).toBe('    x  v')
  expect(lineText(evidenceLine(r, 16, 4))).toBe('    x  v  bench…')
  expect(lineText(evidenceLine(r, 40, 4))).toBe('    x  v  bench_20261009_long')
  // a run that fits whole is shown however short it is
  expect(lineText(evidenceLine({ label: 'x', value: 'v', run: 's0' }, 12, 4))).toBe('    x  v  s0')
})

test('evidence: the numbers are coloured like code, the interval and the run are quiet, and grey marks a text still waiting', () => {
  const line = evidenceLine({ label: 'replay', value: '3 left', ci: '[1, 5]', run: 'replay_a' }, 60, 0)
  const by = (text: string) => line.find(s => s.text === text)
  expect(by(' [1, 5]')).toEqual({ text: ' [1, 5]', color: 'inactive', dim: true })
  expect(by('replay_a')).toEqual({ text: 'replay_a', color: 'planMode', dim: true })
  expect(line.some(s => s.text.includes('3') && s.color !== undefined && s.color !== 'inactive')).toBe(true)
  // waiting for its rendition: the label and the words of the result are grey, the interval stays quiet
  const waiting = evidenceLine({ label: '回放', value: '剩 3 处', ci: '[1, 5]', run: 'replay_a' }, 60, 0, 0, true, true)
  expect(waiting.filter(s => s.text.trim() !== '' && s.text !== '[1, 5]' && s.text !== ' [1, 5]' && s.text !== 'replay_a').every(s => s.color === 'inactive')).toBe(true)
  // the label alone waiting
  const label = evidenceLine({ label: '回放', value: '3 left' }, 60, 0, 0, true, false)
  expect(label[1]).toEqual({ text: '回放', color: 'inactive' })
  expect(label.some(s => s.color !== undefined && s.color !== 'inactive')).toBe(true)
})

test('capLines: what is cut is marked on the last line', () => {
  const lines = ['a', 'b', 'c', 'd'].map(x => [sp(x)])
  expect(capLines(lines, 10)).toHaveLength(4)
  expect(capLines(lines, 4)).toHaveLength(4)
  expect(capLines(lines, 3).map(lineText)).toEqual(['a', 'b', '…'])
  expect(capLines(lines, 3)[2]).toEqual([{ text: '…', color: 'inactive', dim: true }])
  expect(capLines(lines, 1).map(lineText)).toEqual(['…'])
  expect(capLines(lines, 0)).toEqual([])
  expect(capLines(lines, -2)).toEqual([])
})

// ---------------------------------------------------------------- the content

test('detail: a node with everything — title, summary, then rationale, evidence, sources and a note, each under its label', () => {
  const lines = textsOf(draw(n3, 92))
  expect(lines).toEqual([
    'Conflicts: merge by paragraph, last edit wins for titles',
    'Body text merges by paragraph; titles and tags take the last edit. Replaying 200 recorded',
    'edit sessions left 3 conflicts, all in titles.',
    'Rationale  A paragraph is the smallest unit people think of as "the thing I changed", so',
    '           merging by it surprises them least. The CRDT prototype made cold start 0.5 s',
    '           slower, more on phones three years old, and it only pays off when several people',
    '           edit one paragraph at once, which this release does not allow.',
    'Evidence   Paragraph merge (200 sessions)  3 left, all in titles  replay_a',
    '           CRDT prototype                  cold start 2.4 s vs 1.9 s  proto_b',
    'Sources    docs/adr/0004-sync.md',
    '           docs/design/merge-rules.md',
    '           reports/merge_replay_20261001/RESULTS.md',
    'Notes      10-04 user  Fine for now; revisit if titles start to conflict more often.',
  ])
})

test('detail: the title is bold with the topic before the colon in a colour of its own; the labels are quiet', () => {
  const lines = draw(n3, 92)
  const title = lines[0]!
  expect(title[0]).toMatchObject({ text: 'Conflicts:', bold: true })
  expect(title[0]!.color).toBeDefined()
  expect(title.slice(1).every(s => s.bold === true)).toBe(true)
  // the labels are quiet, in one column of their own
  const label = (text: string) => lines.map(l => l[0]).find(s => s !== undefined && s.text.startsWith(text))!
  for (const text of ['Rationale', 'Evidence', 'Sources', 'Notes']) {
    expect(label(text)).toMatchObject({ color: 'inactive', dim: true })
    expect(label(text).text).toHaveLength(11)
  }
  // the date of a note is quiet, who wrote it has the colour of the actor
  const note = lines[lines.length - 1]!
  expect(note.find(s => s.text === '10-04')).toEqual({ text: '10-04', color: 'inactive', dim: true })
  expect(note.find(s => s.text === 'user')).toEqual({ text: 'user', color: 'text' })
  // the source is a quiet folder and a coloured file
  const source = lines[lines.length - 2]!
  expect(source.find(s => s.text === 'RESULTS.md')).toEqual({ text: 'RESULTS.md', color: 'ide' })
})

test('detail: with room to spare a blank line sets the parts apart; a node with nothing to add draws only its title', () => {
  const lines = textsOf(draw(n3, 92, { roomy: true }))
  expect(lines[1]).toBe('')
  expect(lines[4]).toBe('')
  expect(lines).toHaveLength(textsOf(draw(n3, 92)).length + 2)
  expect(lines.filter(l => l === '')).toHaveLength(2)
  // never a blank first, last or twice in a row
  expect(lines[0]).not.toBe('')
  expect(lines[lines.length - 1]).not.toBe('')
  expect(lines.some((l, i) => l === '' && lines[i - 1] === '')).toBe(false)
  // only a title, however much room there is
  expect(textsOf(draw(BARE, 60, { roomy: true }))).toEqual(['Desktop client: after the spring release'])
  // a title and a summary
  const summarised = { ...BARE, summary: 'Not before the first beta.' }
  expect(textsOf(draw(summarised, 60, { roomy: true }))).toEqual(['Desktop client: after the spring release', '', 'Not before the first beta.'])
  expect(textsOf(draw(summarised, 60))).toEqual(['Desktop client: after the spring release', 'Not before the first beta.'])
})

test('detail: in a pane too narrow for a label beside its text, the label goes above and the text is set in two columns', () => {
  const wide = textsOf(draw(n3, 37))
  expect(wide.filter(l => l.startsWith('Rationale  '))).toHaveLength(1)
  const narrow = textsOf(draw(n3, 36))
  expect(narrow).toContain('Rationale')
  expect(narrow).toContain('Evidence')
  expect(narrow).toContain('Sources')
  expect(narrow).toContain('Notes')
  expect(narrow.some(l => l.startsWith('Rationale '))).toBe(false)
  expect(narrow[narrow.indexOf('Rationale') + 1]!.startsWith('  A paragraph')).toBe(true)
  // sources keep the end of the path, which is what tells it apart
  expect(narrow).toContain('  …/merge_replay_20261001/RESULTS.md')
  // evidence gives up the run, then the end of its labels, and keeps the values
  expect(narrow[narrow.indexOf('Evidence') + 1]).toBe('  Paragraph …  3 left, all in titles')
  expect(narrow[narrow.indexOf('Evidence') + 2]).toBe('  CRDT p…  cold start 2.4 s vs 1.9 s')
  // a note too narrow to sit beside its date and author goes under them
  const tiny = textsOf(draw(n3, 20))
  expect(tiny.slice(tiny.indexOf('Notes'))).toEqual(['Notes', '  10-04 user', '  Fine for now;', '  revisit if titles', '  start to conflict', '  more often.'])
})

test('detail: labels line up in a column as wide as the longest one that is there', () => {
  // a node with only a rationale: the column is as wide as that label, not as wide as the longest label there could be
  const only = textsOf(draw({ ...BARE, rationale: 'Two quarters of work for one platform.' }, 60))
  expect(only).toEqual(['Desktop client: after the spring release', 'Rationale  Two quarters of work for one platform.'])
  const tagged = textsOf(draw({ ...BARE, tags: ['ui', 'platform'] }, 60))
  expect(tagged).toEqual(['Desktop client: after the spring release', 'Tags  ui, platform'])
  const both = textsOf(draw({ ...BARE, tags: ['ui'], sources: ['docs/ui.md'] }, 60))
  expect(both).toEqual(['Desktop client: after the spring release', 'Sources  docs/ui.md', 'Tags     ui'])
})

test('detail: a long title takes at most three lines and says it was cut; a title with nothing in it is untitled', () => {
  const long = textsOf(draw({ ...BARE, title: 'x'.repeat(400) }, 40))
  expect(long).toEqual(['x'.repeat(40), 'x'.repeat(40), 'x'.repeat(39) + '…'])
  const words = textsOf(draw({ ...BARE, title: 'word '.repeat(60) }, 30))
  expect(words).toHaveLength(3)
  expect(words[2]!.endsWith('…')).toBe(true)
  // not cut: no ellipsis
  expect(textsOf(draw({ ...BARE, title: 'a title long enough to need two lines in a narrow pane' }, 30))).toEqual(['a title long enough to need', 'two lines in a narrow pane'])
  const untitled = draw({ ...BARE, title: '' }, 40)
  expect(textsOf(untitled)).toEqual(['(untitled)'])
  expect(untitled[0]![0]).toMatchObject({ dim: true })
  expect(textsOf(draw({ ...BARE, title: ' \n\t ' }, 40, { lang: 'zh' }))).toEqual(['（无标题）'])
  // a title of nothing a terminal draws: joiners, selectors, a tag letter and half of a surrogate pair
  const invisible = String.fromCodePoint(0x200b, 0x200d, 0xfe0f, 0x2060, 0xfeff, 0xad, 0x1f3fd, 0xe0067, 0xd83d)
  expect(textsOf(draw({ ...BARE, title: invisible }, 40))).toEqual(['(untitled)'])
  expect(textsOf(draw({ ...BARE, title: `a${invisible}b` }, 40))).toEqual(['ab'])
})

test('detail: a retraction comes right under the title, in the colour of an error, with its reason', () => {
  const retracted = { ...n3, retracted: { ts: iso(NOW), actor: 'user' as const, reason: 'duplicate of n2' } }
  const lines = draw(retracted, 60)
  expect(lineText(lines[1]!)).toBe('Retracted by user: duplicate of n2')
  expect(lines[1]).toEqual([{ text: 'Retracted by user: duplicate of n2', color: 'error' }])
  // without a reason, in Chinese the term stays English
  const bare = { ...retracted, retracted: { ts: iso(NOW), actor: 'model' as const } }
  expect(lineText(draw(bare, 60)[1]!)).toBe('Retracted by model')
  expect(lineText(draw(bare, 60, { lang: 'zh' })[1]!)).toBe('retracted by model')
  // roomy: set apart from the title and from the summary
  const roomy = textsOf(draw(retracted, 60, { roomy: true }))
  expect(roomy.slice(0, 5)).toEqual(['Conflicts: merge by paragraph, last edit wins for titles', '', 'Retracted by user: duplicate of n2', '', 'Body text merges by paragraph; titles and tags take the last'])
})

test('detail: what replaced a node and what it replaced are told in a line of their own', () => {
  const superseded = { ...n3, status: 'superseded' as const, supersededBy: 'n16', tags: ['storage', 'sync'] }
  const lines = textsOf(draw(superseded, 60))
  const at = lines.indexOf('Superseded by n16')
  expect(at).toBeGreaterThan(0)
  // after the sources, before the tags and the notes
  expect(lines[at - 1]).toBe('           reports/merge_replay_20261001/RESULTS.md')
  expect(lines[at + 1]).toBe('Tags       storage, sync')
  expect(draw(superseded, 60)[at]).toEqual([{ text: 'Superseded by n16', color: 'inactive', dim: true }])
  expect(textsOf(draw(superseded, 60, { lang: 'zh' }))).toContain('superseded by n16')

  // the other way round: n16 says it supersedes n3 when n3 points at it
  const pointing: DtModel = { ...model, nodes: model.nodes.map(n => (n.id === 'n3' ? { ...n, supersededBy: 'n16' } : n)) }
  expect(textsOf(draw(node('n16'), 60, { model: pointing }))).toEqual(['Offline queue: at most 5,000 operations per note', 'Supersedes n3'])
  expect(textsOf(draw(node('n16'), 60, { model: pointing, lang: 'zh' }))[1]).toBe('supersedes n3')
})

test('detail: notes wrap under their text, not under their date', () => {
  const lines = textsOf(draw(n3, 50))
  const at = lines.findIndex(l => l.startsWith('Notes'))
  expect(lines.slice(at)).toEqual(['Notes      10-04 user  Fine for now; revisit if', `${' '.repeat(23)}titles start to conflict`, `${' '.repeat(23)}more often.`])
  // several notes, one after the other; a note with no text still shows who wrote it
  const many = { ...BARE, notes: [{ ts: noon(10, 9), actor: 'user' as const, text: 'First.' }, { ts: noon(10, 10), actor: 'model' as const, text: 'Second.' }, { ts: noon(10, 11), actor: 'user' as const, text: '' }] }
  expect(textsOf(draw(many, 60))).toEqual(['Desktop client: after the spring release', 'Notes  10-09 user  First.', '       10-10 model  Second.', '       10-11 user'])
})

// ---------------------------------------------------------------- languages

test('detail: a text still in the language it was written in is grey and marked with that language; its rendition, when it comes, is coloured', () => {
  const waiting = draw(nodeOf('n3', zhModel), 92)
  const title = waiting[0]!
  // the title: every span grey, and the language it is written in at the end
  expect(title.filter(s => s.text !== ' ' && s.text !== '中').every(s => s.color === 'inactive')).toBe(true)
  expect(title.some(s => s.bold === true)).toBe(false)
  expect(lineText(title)).toBe('冲突：按段落合并，标题以最后一次编辑为准 中')
  // the summary and the rationale are grey too, the label stays quiet
  expect(waiting[1]!.every(s => s.color === 'inactive')).toBe(true)
  expect(lineText(waiting[1]!).startsWith('正文按段落合并')).toBe(true)
  // with the renditions in the translation memory it reads as the English tree does
  const done = draw(nodeOf('n3', zhModel), 92, { tm: notesTm('zh') })
  expect(textsOf(done)).toEqual(textsOf(draw(n3, 92)))
  expect(done[0]![0]).toMatchObject({ bold: true })
  expect(done.flat().some(s => s.text === '中')).toBe(false)
})

test('detail: in Chinese the labels stay English, as the terms of the trade do, and the texts are the ones written', () => {
  const lines = textsOf(draw(nodeOf('n3', zhModel), 92, { lang: 'zh' }))
  expect(lines[0]).toBe('冲突：按段落合并，标题以最后一次编辑为准')
  expect(lines.filter(l => /^(Rationale|Evidence|Sources|Notes)  /.test(l))).toHaveLength(4)
  expect(lines.find(l => l.startsWith('Evidence'))).toBe('Evidence   按段落合并（200 次会话）  剩 3 处，都在标题  replay_a')
  expect(lines[lines.length - 1]).toBe('Notes      10-04 user  先这样；如果标题冲突变多再回来看。')
  // the Chinese texts are measured by columns, so no line is wider than the pane
  for (const w of [30, 41, 60, 92]) for (const l of textsOf(draw(nodeOf('n3', zhModel), w, { lang: 'zh' }))) expect(strWidth(l)).toBeLessThanOrEqual(w)
})

test('detail: no line is ever wider than the pane, whatever the width, the language or the room', () => {
  const heavy = { ...n3, status: 'superseded' as const, supersededBy: 'n16', tags: ['storage', 'sync', 'merge', 'offline'], retracted: { ts: iso(NOW), actor: 'user' as const, reason: 'duplicate of n2, which says the same in other words' } }
  for (const lang of ['en', 'zh'] as const) {
    const written = lang === 'en' ? model : zhModel
    for (const roomy of [false, true]) {
      for (let width = 1; width <= 120; width++) {
        for (const n of [heavy, nodeOf('n12', written), nodeOf('n7', written)]) {
          for (const l of draw(n, width, { lang, roomy })) expect(lineWidth(l), `${lang} ${roomy} ${width} ${n.id}`).toBeLessThanOrEqual(width)
        }
      }
    }
  }
})

// ---------------------------------------------------------------- emoji

test('detail: titles, summaries, evidence, notes and sources full of emoji sequences are drawn without joiners, selectors or flags, and still fit', () => {
  expect(UNDRAWN.test(MESSY)).toBe(true)
  expect(drawable(MESSY)).toBe(TIDY)
  expect(UNDRAWN.test(TIDY)).toBe(false)

  const messy: DtNode = {
    ...BARE,
    title: `Title ${MESSY}`,
    summary: `Summary ${MESSY}`,
    rationale: `Because ${MESSY}`,
    evidence: [
      { label: `label ${MESSY}`, value: `value ${MESSY}`, ci: `[${HEART}, ${CHINA}]`, run: `run_${FAMILY}` },
      { label: `only a note ${HEART}`, note: `note ${MESSY}` },
    ],
    sources: [`docs/${MESSY}.md`, `${KEYCAP}.txt`],
    tags: [`tag${HEART}`, CHINA],
    notes: [{ ts: noon(10, 10), actor: 'user', text: `Note ${MESSY} ${MESSY}` }],
  }
  for (const lang of ['en', 'zh'] as const) {
    for (const width of [12, 20, 28, 40, 68, 100]) {
      for (const l of textsOf(draw(messy, width, { lang }))) {
        expect(UNDRAWN.test(l), `${lang}/${width}: ${JSON.stringify(l)}`).toBe(false)
        expect(drawable(l)).toBe(l)
        expect(strWidth(l)).toBeLessThanOrEqual(width)
      }
    }
  }
  expect(textsOf(draw(messy, 100))).toEqual([
    `Title ${TIDY}`,
    `Summary ${TIDY}`,
    `Rationale  Because ${TIDY}`,
    `Evidence   label ${TIDY}  value ${TIDY} [❤, CN]  run_\u{1F468}\u{1F469}\u{1F467}`,
    `           only a note ❤${' '.repeat(strWidth(`label ${TIDY}`) - strWidth('only a note ❤'))}  note ${TIDY}`,
    `Sources    docs/${TIDY}.md`,
    '           1.txt',
    'Tags       tag❤, CN',
    `Notes      10-10 user  Note ${TIDY} ${TIDY}`,
  ])
})
