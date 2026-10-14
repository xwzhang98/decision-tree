// Which language a text is written in, and what it reads like in the other one.
//
// A decision's words are written once, in the language the person works in. The other rendition
// lives in the project's translation memory (tm.ts), keyed by the text itself: nothing in the events
// changes, an edit simply makes a new text that has no rendition until one arrives, and a tree opened
// from another needs nothing copied. The pane asks `localize` for every piece of text it draws.
//
// English is the one language every text must have a rendition in; Chinese renditions of English
// text are made when someone reads in Chinese. Technical terms and everyday work words (bug, doc,
// commit, run, seed ...) stay English in the Chinese ones: `RENDITION_RULES` is what the translator
// and the recording model are told.

import type { DtEvidence, DtLang, DtModel, DtNode, DtTm } from '../types'
import { hasHan } from './i18n'
import { EMPTY_TM } from './state'

export { EMPTY_TM }

export const other = (lang: DtLang): DtLang => (lang === 'zh' ? 'en' : 'zh')

/** The language a text is written in: Chinese when it holds Han characters, else English. */
export function scriptOf(text: string): DtLang {
  return hasHan(text) ? 'zh' : 'en'
}

function lookup(table: Readonly<Record<string, string>>, text: string): string | undefined {
  // (own keys only: a title that reads "constructor" is not a translation)
  return Object.hasOwn(table, text) ? table[text] : undefined
}

/** `text` as it reads in `lang`: itself when it is written in that language, else its rendition, else itself. */
export function localize(tm: DtTm, lang: DtLang, text: string): string {
  if (text === '' || scriptOf(text) === lang) return text
  return lookup(tm[lang], text) ?? text
}

/** Whether `text` reads in `lang` as it is, or has a rendition there. */
export function readsIn(tm: DtTm, lang: DtLang, text: string): boolean {
  return text === '' || scriptOf(text) === lang || lookup(tm[lang], text) !== undefined
}

/** The rendition of `text` in `lang` the memory holds, if any (the text itself is not one). */
export function renditionOf(tm: DtTm, lang: DtLang, text: string): string | undefined {
  return lookup(tm[lang], text)
}

// ---------------------------------------------------------------- what is worth rendering

/**
 * Whether `text` is worth a rendition in `to`: Chinese text always is, for English; English text is
 * when it holds words (a lone identifier or a number reads the same in Chinese).
 */
export function worthRendering(text: string, to: DtLang): boolean {
  if (to === 'en') return scriptOf(text) === 'zh'
  return scriptOf(text) === 'en' && /[A-Za-z]{3,}[^A-Za-z]+[A-Za-z]{2,}/.test(text)
}

/** The words of a node that can be rendered: title, summary, rationale, what the evidence says, notes, a retraction's reason. */
export function textsOf(n: DtNode): string[] {
  const out: string[] = [n.title]
  if (n.summary !== undefined) out.push(n.summary)
  if (n.rationale !== undefined) out.push(n.rationale)
  for (const e of n.evidence ?? []) {
    out.push(e.label)
    if (e.value !== undefined) out.push(e.value)
    if (e.note !== undefined) out.push(e.note)
  }
  for (const note of n.notes) out.push(note.text)
  if (n.retracted?.reason !== undefined) out.push(n.retracted.reason)
  return out
}

export type Want = { lang: DtLang; text: string }

/**
 * The texts that still lack a rendition, English ones first, in the order the pane needs them: models
 * in the order given, the newest node of each first. `zh` asks for Chinese renditions of English text too.
 * Retracted nodes are not drawn by default and are not asked for.
 */
export function wantedRenditions(
  models: readonly Pick<DtModel, 'nodes' | 'fork'>[],
  tm: DtTm,
  options: { zh: boolean; limit: number; /** Texts not to ask for (the ones that were tried and would not translate). */ skip?: (want: Want) => boolean },
): Want[] {
  const out: Want[] = []
  const seen = new Set<string>()
  const langs: DtLang[] = options.zh ? ['en', 'zh'] : ['en']
  for (const to of langs) {
    for (const m of models) {
      const texts: string[] = []
      for (let k = m.nodes.length - 1; k >= 0; k--) {
        const n = m.nodes[k]!
        if (n.retracted === undefined) texts.push(...textsOf(n))
      }
      if (m.fork?.title !== undefined) texts.push(m.fork.title)
      for (const text of texts) {
        if (text === '' || !worthRendering(text, to) || lookup(tm[to], text) !== undefined) continue
        const key = `${to}\u0000${text}`
        if (seen.has(key)) continue
        seen.add(key)
        if (options.skip?.({ lang: to, text }) === true) continue
        out.push({ lang: to, text })
        if (out.length >= options.limit) return out
      }
    }
  }
  return out
}

// ---------------------------------------------------------------- what the translator and the model are told

/** The words the Chinese rendition keeps in English: written for a model to read, so in English. */
export const KEEP_ENGLISH =
  'Keep every professional name and every common word of software and research work in English, the way a Chinese engineer or researcher says them when they talk: names of tools, libraries, models and datasets (SQLite, Redis, GPU, API, git, PR, CI), code, file and run names, ids, numbers and units, and everyday words such as bug, doc, commit, branch, merge, log, config, prompt, pane, tree, node, run, seed, baseline, checkpoint, benchmark, metric, loss, accuracy, ablation, pipeline, deploy, rollback, cache, timeout, token, schema, migration, review, release, retry, sync, fallback. When in doubt, keep the English word. Only the words that join them (verbs, particles, plain description) are Chinese.'

/** What a rendition of a text in `to` must look like. */
export function renditionRules(to: DtLang): string {
  return to === 'en'
    ? 'English: natural and concise; keep every technical name, id, number and file name exactly as written.'
    : `Chinese (简体): natural and concise. ${KEEP_ENGLISH}`
}

/**
 * Whether `rendition` is a usable rendering of `text` into `to`: not empty, one language (an English
 * rendition has no Han characters; a Chinese one has some, unless it is the text unchanged because there was nothing to render).
 */
export function isUsableRendition(text: string, rendition: string, to: DtLang): boolean {
  const r = rendition.trim()
  if (r === '') return false
  if (to === 'en') return !hasHan(r)
  return hasHan(r) || r === text
}

// ---------------------------------------------------------------- a model in the pane's language

export type Localizer = {
  /** `text` as it reads in the pane's language (itself when its rendition is not there yet). */
  text: (text: string) => string
  /** Whether a text the pane draws is still in the language it was written in because its rendition has not arrived. */
  waiting: (drawn: string) => boolean
}

export function localizer(tm: DtTm, lang: DtLang): Localizer {
  const waiting = new Set<string>()
  return {
    text(text) {
      if (readsIn(tm, lang, text)) return localize(tm, lang, text)
      if (worthRendering(text, lang)) waiting.add(text)
      return text
    },
    waiting: drawn => waiting.has(drawn),
  }
}

/** The small mark after a text shown in the language it was written in: `中` or `EN`. */
export function markOf(text: string): string {
  return scriptOf(text) === 'zh' ? '中' : 'EN'
}

/** A node with every text it holds as it reads in the pane's language. Ids, statuses, numbers and file names are not texts. */
export function localizeNode(n: DtNode, loc: Localizer): DtNode {
  const out: DtNode = { ...n, title: loc.text(n.title), notes: n.notes.map(note => ({ ...note, text: loc.text(note.text) })) }
  if (n.summary !== undefined) out.summary = loc.text(n.summary)
  if (n.rationale !== undefined) out.rationale = loc.text(n.rationale)
  if (n.evidence !== undefined) {
    out.evidence = n.evidence.map(e => {
      const ev: DtEvidence = { ...e, label: loc.text(e.label) }
      if (e.value !== undefined) ev.value = loc.text(e.value)
      if (e.note !== undefined) ev.note = loc.text(e.note)
      return ev
    })
  }
  if (n.retracted?.reason !== undefined) out.retracted = { ...n.retracted, reason: loc.text(n.retracted.reason) }
  return out
}

/** The model the pane draws: its nodes and the title of its fork in the pane's language, and what is still waiting for a rendition. */
export function localizeModel(model: DtModel, tm: DtTm, lang: DtLang): { model: DtModel; loc: Localizer } {
  const loc = localizer(tm, lang)
  const fork = model.fork === null || model.fork.title === undefined ? model.fork : { ...model.fork, title: loc.text(model.fork.title) }
  return { model: { ...model, nodes: model.nodes.map(n => localizeNode(n, loc)), fork }, loc }
}
