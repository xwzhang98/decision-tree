// What can be done to the record: start it, add a decision, change one, note on
// one, retract one, move one, import a batch. The model's tools and the person's
// commands both call these; they differ only in `ctx.actor`.
//
// Every operation validates, appends event files through the journal, and
// answers one line (`Done`): a receipt in the person's language, or a plain
// English error the model can act on.

import type { DtActor, DtDecidedBy, DtEvidence, DtForkBase, DtKind, DtLang, DtNode, DtNodeFields, DtPatch, DtStatus } from '../types'
import { defaultConfig, parseConfig, serializeConfig, setTree, withStatus } from './config'
import { ID_PATTERN, MAIN, autoId, isDecider, isIso, isKind, isStatus, isTreeName, isoLocal, slugify, treeNameOf, uniqueId } from './events'
import { eventsText, hasHan, nodesText, statusLabel, t } from './i18n'
import type { Key } from './i18n'
import type { Journal } from './journal'
import { firstLine } from './journal'
import { evidenceKey, evidenceOf } from './replay'
import { ancestorIds, buildIndex, resolveRef } from './tree'
import type { TreeIndex } from './tree'
import type { TmPair } from './tm'
import { describeEvent, forkText, numbered, resolveVersion, whenOf } from './versions'
import type { Resolved as Version } from './versions'
import { oneLine, padEnd, padStart, sanitize } from './width'

export type Ctx = {
  journal: Journal
  now: () => number
  lang: DtLang
  actor: DtActor
  /** Keeps the English versions that came with a call in the translation memory (absent where nothing keeps them). */
  english?: (pairs: TmPair[]) => Promise<void>
}

export type Done = { ok: true; text: string; id?: string } | { ok: false; error: string }

const ok = (text: string, id?: string): Done => (id === undefined ? { ok: true, text } : { ok: true, text, id })
const fail = (error: string): Done => ({ ok: false, error })

/** Errors for the model stay English (it reads them and acts on them); the ones a person reads follow the pane's language. */
const langOf = (ctx: Ctx): DtLang => (ctx.actor === 'model' ? 'en' : ctx.lang)
const say = (ctx: Ctx, key: Key, vars?: Record<string, string | number>): string => t(langOf(ctx), key, vars)

export const MAX_TITLE = 120
const MAX_SUMMARY = 2000
const MAX_RATIONALE = 8000
const MAX_NOTE = 4000
const MAX_LIST = 50

/** Statuses that mean the matter is settled. */
const DECIDED: readonly DtStatus[] = ['adopted', 'rejected', 'no-diff', 'withdrawn', 'superseded']

type Loose = Record<string, unknown>

function isLoose(x: unknown): x is Loose {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

// ---------------------------------------------------------------- reading fields

/** The fields a caller may set, as read from loose JSON; `null` means "clear it". */
type Fields = {
  title?: string
  parent?: string | null
  status?: DtStatus
  kind?: DtKind
  trunk?: boolean | null
  summary?: string | null
  rationale?: string | null
  evidence?: DtEvidence[] | null
  sources?: string[] | null
  decidedBy?: DtDecidedBy | null
  decidedAt?: string | null
  supersededBy?: string | null
  tags?: string[] | null
  addEvidence?: DtEvidence[]
  addSources?: string[]
}

function refError(ref: string, r: ReturnType<typeof resolveRef>, lang: DtLang): string {
  if ('node' in r) return ''
  if (r.error === 'ambiguous') return t(lang, 'e.refAmbiguous', { ref, ids: r.ids.join(', ') })
  return t(lang, 'e.refUnknown', { ref })
}

function scalarText(x: unknown): string | null {
  if (typeof x === 'string') return x
  if (typeof x === 'number' || typeof x === 'boolean') return String(x)
  return null
}

function readEvidence(raw: unknown, errors: string[], name: string): DtEvidence[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${name} must be an array of {label, value?, ci?, run?, note?, source?}`)
    return undefined
  }
  const out: DtEvidence[] = []
  for (const item of raw.slice(0, MAX_LIST)) {
    if (!isLoose(item)) {
      errors.push(`${name}: each item must be an object with a label`)
      continue
    }
    const coerced: Loose = {}
    for (const k of ['label', 'value', 'ci', 'run', 'note', 'source']) {
      const v = scalarText(item[k])
      if (v !== null) coerced[k] = v
    }
    const ev = evidenceOf(coerced)
    if (ev === null) errors.push(`${name}: each item needs a non-empty label`)
    else out.push(ev)
  }
  return out
}

function readStrings(raw: unknown, errors: string[], name: string): string[] | undefined {
  if (!Array.isArray(raw)) {
    errors.push(`${name} must be an array of strings`)
    return undefined
  }
  const out: string[] = []
  for (const item of raw.slice(0, MAX_LIST)) {
    const s = scalarText(item)
    if (s === null) {
      errors.push(`${name}: every item must be a string`)
      continue
    }
    const one = oneLine(s)
    if (one !== '' && !out.includes(one)) out.push(one)
  }
  return out
}

/**
 * Reads the fields present in `o`; absent keys stay absent. `idx` resolves node
 * references (`parent`, `supersededBy`) to ids.
 */
function readFields(o: Loose, idx: TreeIndex, lang: DtLang): { fields: Fields; errors: string[] } {
  const f: Fields = {}
  const errors: string[] = []

  if (o.title !== undefined) {
    const s = scalarText(o.title)
    const title = s === null ? '' : oneLine(s)
    if (title === '') errors.push(t(lang, 'e.titleEmpty'))
    else if (title.length > MAX_TITLE) errors.push(t(lang, 'e.titleLong', { n: title.length, max: MAX_TITLE }))
    else f.title = title
  }

  if (o.parent !== undefined) {
    if (o.parent === null || o.parent === '') f.parent = null
    else if (typeof o.parent === 'string') {
      const r = resolveRef(idx, o.parent)
      if ('node' in r) f.parent = r.node.id
      else errors.push(`parent: ${refError(o.parent, r, lang)}`)
    } else errors.push('parent must be a node id or null')
  }

  if (o.status !== undefined) {
    if (isStatus(o.status)) f.status = o.status
    else errors.push(`status must be one of adopted, rejected, no-diff, in-progress, planned, proposed, withdrawn, superseded, deferred (got ${JSON.stringify(o.status)})`)
  }

  if (o.kind !== undefined) {
    if (isKind(o.kind)) f.kind = o.kind
    else errors.push(`kind must be one of decision, protocol, design, milestone (got ${JSON.stringify(o.kind)})`)
  }

  if (o.trunk !== undefined) {
    if (typeof o.trunk === 'boolean' || o.trunk === null) f.trunk = o.trunk
    else errors.push('trunk must be true or false')
  }

  for (const [key, max] of [
    ['summary', MAX_SUMMARY],
    ['rationale', MAX_RATIONALE],
  ] as const) {
    const v = o[key]
    if (v === undefined) continue
    if (v === null) f[key] = null
    else {
      const s = scalarText(v)
      if (s === null) errors.push(`${key} must be a string`)
      else {
        const text = (key === 'summary' ? oneLine(s) : sanitize(s).trim()).slice(0, max)
        f[key] = text === '' ? null : text
      }
    }
  }

  if (o.evidence !== undefined) {
    if (o.evidence === null) f.evidence = null
    else f.evidence = readEvidence(o.evidence, errors, 'evidence')
  }
  if (o.addEvidence !== undefined) f.addEvidence = readEvidence(o.addEvidence, errors, 'addEvidence')

  if (o.sources !== undefined) {
    if (o.sources === null) f.sources = null
    else f.sources = readStrings(o.sources, errors, 'sources')
  }
  if (o.addSources !== undefined) f.addSources = readStrings(o.addSources, errors, 'addSources')
  if (o.tags !== undefined) {
    if (o.tags === null) f.tags = null
    else f.tags = readStrings(o.tags, errors, 'tags')
  }

  if (o.decidedBy !== undefined) {
    if (o.decidedBy === null) f.decidedBy = null
    else if (isDecider(o.decidedBy)) f.decidedBy = o.decidedBy
    else errors.push('decidedBy must be user, gate or model')
  }

  if (o.decidedAt !== undefined) {
    if (o.decidedAt === null || o.decidedAt === '') f.decidedAt = null
    else if (typeof o.decidedAt === 'string' && isIso(o.decidedAt.trim())) f.decidedAt = o.decidedAt.trim()
    else errors.push('decidedAt must be an ISO 8601 date or time, for example 2026-10-09 or 2026-10-09T17:44:00-04:00')
  }

  if (o.supersededBy !== undefined) {
    if (o.supersededBy === null || o.supersededBy === '') f.supersededBy = null
    else if (typeof o.supersededBy === 'string') {
      const r = resolveRef(idx, o.supersededBy)
      if ('node' in r) f.supersededBy = r.node.id
      else errors.push(`supersededBy: ${t(lang, 'e.recordFirst', { why: refError(o.supersededBy, r, lang) })}`)
    } else errors.push('supersededBy must be a node id')
  }

  return { fields: f, errors }
}

function problems(errors: string[]): Done {
  return fail(errors.slice(0, 4).join('; '))
}

// ---------------------------------------------------------------- the English version that comes with a call

/**
 * The English version of the text fields of a call (`en` in the arguments of the tools): given by the model that
 * wrote them in Chinese, so the pane can show English without asking for a translation.
 */
type English = {
  title?: string
  summary?: string
  rationale?: string
  evidence?: Partial<DtEvidence>[]
  addEvidence?: Partial<DtEvidence>[]
  /** `decision_note`: the English version of the note. */
  text?: string
}

/** One English text of `en`: trimmed, one line when it belongs on one; an error when it has Chinese in it. */
function englishText(x: unknown, name: string, oneLined: boolean, errors: string[], lang: DtLang): string | undefined {
  const s = scalarText(x)
  if (s === null) return undefined
  const text = oneLined ? oneLine(s) : sanitize(s).trim()
  if (text === '') return undefined
  if (hasHan(text)) {
    errors.push(t(lang, 'e.enBad', { field: name }))
    return undefined
  }
  return text
}

function englishEvidence(raw: unknown, name: string, errors: string[], lang: DtLang): Partial<DtEvidence>[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    errors.push(t(lang, 'e.enShape'))
    return undefined
  }
  return raw.slice(0, MAX_LIST).map((item, k) => {
    const out: Partial<DtEvidence> = {}
    if (!isLoose(item)) return out
    for (const key of ['label', 'value', 'note'] as const) {
      const text = englishText(item[key], `en.${name}[${k}].${key}`, true, errors, lang)
      if (text !== undefined) out[key] = text
    }
    return out
  })
}

/** Reads `en` of `decision_record` and `decision_update`; what is wrong with it goes into `errors`. */
function readEnglish(raw: unknown, errors: string[], lang: DtLang): English {
  if (raw === undefined || raw === null) return {}
  if (!isLoose(raw)) {
    errors.push(t(lang, 'e.enShape'))
    return {}
  }
  const out: English = {}
  const title = englishText(raw.title, 'en.title', true, errors, lang)
  const summary = englishText(raw.summary, 'en.summary', true, errors, lang)
  const rationale = englishText(raw.rationale, 'en.rationale', false, errors, lang)
  if (title !== undefined) out.title = title
  if (summary !== undefined) out.summary = summary
  if (rationale !== undefined) out.rationale = rationale
  const evidence = englishEvidence(raw.evidence, 'evidence', errors, lang)
  const addEvidence = englishEvidence(raw.addEvidence, 'addEvidence', errors, lang)
  if (evidence !== undefined) out.evidence = evidence
  if (addEvidence !== undefined) out.addEvidence = addEvidence
  return out
}

/** The pair a text written in Chinese and its English version make; nothing when the text is not Chinese or has no English version. */
function pairOf(recorded: string | null | undefined, english: string | undefined, into: TmPair[]): void {
  if (typeof recorded === 'string' && english !== undefined && hasHan(recorded)) into.push({ from: recorded, to: english })
}

function evidencePairs(recorded: readonly DtEvidence[] | null | undefined, english: readonly Partial<DtEvidence>[] | undefined, into: TmPair[]): void {
  if (recorded == null || english === undefined) return
  english.forEach((en, k) => {
    const rec = recorded[k]
    if (rec === undefined) return
    pairOf(rec.label, en.label, into)
    pairOf(rec.value, en.value, into)
    pairOf(rec.note, en.note, into)
  })
}

/** Hands the English versions to whatever keeps them. A memory that cannot be written costs nothing: the translator will make them. */
async function keepEnglish(ctx: Ctx, pairs: TmPair[]): Promise<void> {
  if (pairs.length === 0 || ctx.english === undefined) return
  try {
    await ctx.english(pairs)
  } catch {
    // (the record is written; its English version is made in the background instead)
  }
}

// ---------------------------------------------------------------- helpers

async function loadIndex(ctx: Ctx): Promise<TreeIndex> {
  await ctx.journal.sync()
  return buildIndex(ctx.journal.model())
}

function wrapWrite(err: unknown, ctx: Ctx): Done {
  return fail(say(ctx, 'c.cannotWrite', { error: firstLine(err) }))
}

const listSep = (lang: DtLang) => (lang === 'zh' ? '，' : ', ')

function resolveNode(ctx: Ctx, idx: TreeIndex, ref: unknown): { node: DtNode } | { error: string } {
  if (typeof ref !== 'string' || ref.trim() === '') return { error: say(ctx, 'e.idRequired') }
  const r = resolveRef(idx, ref)
  if ('node' in r) return { node: r.node }
  return { error: refError(ref, r, langOf(ctx)) }
}

function newId(idx: TreeIndex, wanted: unknown, title: string, nowMs: number, reserved: ReadonlySet<string> = new Set()): string {
  const taken = (id: string) => idx.byId.has(id) || reserved.has(id)
  let base = ''
  if (typeof wanted === 'string') base = ID_PATTERN.test(wanted.trim()) ? wanted.trim() : slugify(wanted)
  if (base === '') base = slugify(title)
  if (base === '') base = autoId(nowMs)
  return uniqueId(base, taken)
}

// ---------------------------------------------------------------- record

function nodeFieldsOf(f: Fields, parent: string | null): DtNodeFields {
  const node: DtNodeFields = {
    title: f.title!,
    parent,
    status: f.status!,
    kind: f.kind ?? 'decision',
  }
  if (f.trunk === true) node.trunk = true
  if (typeof f.summary === 'string' && f.summary !== '') node.summary = f.summary
  if (typeof f.rationale === 'string' && f.rationale !== '') node.rationale = f.rationale
  if (f.evidence != null && f.evidence.length > 0) node.evidence = f.evidence
  else if (f.addEvidence !== undefined && f.addEvidence.length > 0) node.evidence = f.addEvidence
  if (f.sources != null && f.sources.length > 0) node.sources = f.sources
  else if (f.addSources !== undefined && f.addSources.length > 0) node.sources = f.addSources
  if (f.decidedBy != null) node.decidedBy = f.decidedBy
  if (f.decidedAt != null) node.decidedAt = f.decidedAt
  if (f.supersededBy != null) node.supersededBy = f.supersededBy
  if (f.tags != null && f.tags.length > 0) node.tags = f.tags
  return node
}

/** Adds a decision. `input` is the tool's arguments (or a command's, shaped the same). */
export async function recordNode(ctx: Ctx, input: Loose): Promise<Done> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const idx = await loadIndex(ctx)
      const { fields, errors } = readFields(input, idx, langOf(ctx))
      if (input.title === undefined) errors.unshift(say(ctx, 'e.fieldRequired', { field: 'title' }))
      if (input.status === undefined) errors.unshift(say(ctx, 'e.fieldRequired', { field: 'status' }))
      if (input.parent === undefined) errors.unshift(say(ctx, 'e.parentRequired'))
      const en = readEnglish(input.en, errors, langOf(ctx))
      if (errors.length > 0) return problems(errors)
      // a matter the person settles themselves is theirs, even when they did not say so
      if (fields.decidedBy === undefined && ctx.actor === 'user' && fields.status !== undefined && DECIDED.includes(fields.status)) fields.decidedBy = 'user'

      const parent = fields.parent ?? null
      const node = nodeFieldsOf(fields, parent)
      const now = ctx.now()
      const id = newId(idx, input.id, node.title, now)
      const name = await ctx.journal.append({ op: 'add', actor: ctx.actor, id, node }, now)

      // Another session may have added the same id at the same moment; the earlier file wins.
      await ctx.journal.sync()
      const mine = ctx.journal.model().nodes.find(n => n.id === id)
      if (mine !== undefined && mine.addedBy !== name) continue

      const pairs: TmPair[] = []
      pairOf(node.title, en.title, pairs)
      pairOf(node.summary, en.summary, pairs)
      pairOf(node.rationale, en.rationale, pairs)
      evidencePairs(node.evidence, en.evidence, pairs)
      await keepEnglish(ctx, pairs)

      const status = statusLabel(ctx.lang, node.status)
      const text = parent === null ? t(ctx.lang, 'r.recordedRoot', { id, status }) : t(ctx.lang, 'r.recorded', { id, parent, status })
      return ok(text, id)
    }
    return fail(say(ctx, 'e.noFreeId'))
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

// ---------------------------------------------------------------- update

function sameList(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((x, i) => x === b[i])
}

/** Changes a decision: status, summary, rationale, evidence, sources, supersession, parent. */
export async function updateNode(ctx: Ctx, input: Loose): Promise<Done> {
  try {
    const idx = await loadIndex(ctx)
    const target = resolveNode(ctx, idx, input.id)
    if ('error' in target) return fail(target.error)
    const node = target.node
    if (node.retracted !== undefined) return fail(say(ctx, 'e.retractedNoChange', { id: node.id }))

    const { fields: f, errors } = readFields(input, idx, langOf(ctx))
    const en = readEnglish(input.en, errors, langOf(ctx))
    if (errors.length > 0) return problems(errors)
    if (f.supersededBy === node.id) return fail(say(ctx, 'e.supersedeSelf', { id: node.id }))
    if (f.parent !== undefined && f.parent !== null && (f.parent === node.id || ancestorIds(idx, f.parent).includes(node.id))) {
      return fail(say(ctx, 'e.cycle', { id: node.id, parent: f.parent }))
    }

    const patch: DtPatch & Record<string, unknown> = {}
    const changes: string[] = []
    const lang = ctx.lang

    if (f.title !== undefined && f.title !== node.title) {
      patch.title = f.title
      changes.push(t(lang, 'r.changeTitle'))
    }
    if (f.kind !== undefined && f.kind !== node.kind) patch.kind = f.kind
    if (f.trunk !== undefined && (f.trunk === true) !== (node.trunk === true)) patch.trunk = f.trunk === true ? true : (null as never)
    if (f.summary !== undefined && (f.summary ?? undefined) !== node.summary) {
      patch.summary = f.summary as never
      changes.push(t(lang, 'r.changeSummary'))
    }
    if (f.rationale !== undefined && (f.rationale ?? undefined) !== node.rationale) {
      patch.rationale = f.rationale as never
      changes.push(t(lang, 'r.changeRationale'))
    }
    if (f.evidence !== undefined) {
      patch.evidence = f.evidence as never
      if (f.evidence !== null && f.evidence.length > 0) changes.push(t(lang, 'r.changeEvidence', { n: f.evidence.length }))
    }
    if (f.sources !== undefined && !sameList(node.sources, f.sources ?? [])) {
      patch.sources = f.sources as never
      if (f.sources !== null && f.sources.length > 0) changes.push(t(lang, 'r.changeSources', { n: f.sources.length }))
    }
    if (f.tags !== undefined && !sameList(node.tags, f.tags ?? [])) patch.tags = f.tags as never
    if (f.decidedBy !== undefined && (f.decidedBy ?? undefined) !== node.decidedBy) patch.decidedBy = f.decidedBy as never
    if (f.decidedAt !== undefined && (f.decidedAt ?? undefined) !== node.decidedAt) patch.decidedAt = f.decidedAt as never
    if (f.addEvidence !== undefined) {
      const seen = new Set((node.evidence ?? []).map(evidenceKey))
      const fresh = f.addEvidence.filter(e => !seen.has(evidenceKey(e)))
      if (fresh.length > 0) {
        patch.addEvidence = fresh
        changes.push(t(lang, 'r.changeEvidence', { n: fresh.length }))
      }
    }
    if (f.addSources !== undefined) {
      const fresh = f.addSources.filter(s => !(node.sources ?? []).includes(s))
      if (fresh.length > 0) {
        patch.addSources = fresh
        changes.push(t(lang, 'r.changeSources', { n: fresh.length }))
      }
    }

    let status = f.status
    if (f.supersededBy !== undefined && (f.supersededBy ?? undefined) !== node.supersededBy) {
      patch.supersededBy = f.supersededBy as never
      if (f.supersededBy !== null) {
        changes.push(t(lang, 'r.changeSuperseded', { id: f.supersededBy }))
        if (status === undefined && node.status !== 'superseded') status = 'superseded'
      }
    }
    if (status !== undefined && status !== node.status) {
      patch.status = status
      changes.unshift(t(lang, 'r.changeStatus', { status: statusLabel(lang, status) }))
      // a matter that becomes settled has a decision time, unless one was given
      if (DECIDED.includes(status) && !DECIDED.includes(node.status) && node.decidedAt === undefined && patch.decidedAt === undefined) {
        patch.decidedAt = isoLocal(ctx.now())
      }
      // and when the person settles it themselves, it is their decision
      if (ctx.actor === 'user' && DECIDED.includes(status) && !DECIDED.includes(node.status) && node.decidedBy === undefined && patch.decidedBy === undefined) {
        patch.decidedBy = 'user'
      }
    }

    const currentParent = idx.parentOf.get(node.id) ?? null
    const moves = f.parent !== undefined && f.parent !== currentParent

    // the English version is of the node as it reads after this call (the new text where the call gives one, else the one it has)
    const pairs: TmPair[] = []
    pairOf(f.title ?? node.title, en.title, pairs)
    pairOf(f.summary === undefined ? node.summary : f.summary, en.summary, pairs)
    pairOf(f.rationale === undefined ? node.rationale : f.rationale, en.rationale, pairs)
    evidencePairs(f.evidence === undefined ? node.evidence : f.evidence, en.evidence, pairs)
    evidencePairs(f.addEvidence, en.addEvidence, pairs)

    if (Object.keys(patch).length === 0 && !moves) {
      await keepEnglish(ctx, pairs)
      return ok(t(lang, 'r.noChange', { id: node.id }), node.id)
    }
    if (Object.keys(patch).length > 0) {
      await ctx.journal.append({ op: 'update', actor: ctx.actor, id: node.id, patch }, ctx.now())
    }
    if (moves) {
      await ctx.journal.append({ op: 'move', actor: ctx.actor, id: node.id, parent: f.parent ?? null }, ctx.now())
      changes.push(f.parent === null ? t(lang, 'r.movedRoot', { id: node.id }) : t(lang, 'r.moved', { id: node.id, parent: f.parent! }))
    }
    await keepEnglish(ctx, pairs)
    if (changes.length === 0) changes.push(t(lang, 'r.changeOther', { fields: Object.keys(patch).join(', ') }))
    return ok(t(lang, 'r.updated', { id: node.id, changes: changes.join(listSep(lang)) }), node.id)
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

// ---------------------------------------------------------------- note, retract

export async function noteNode(ctx: Ctx, input: Loose): Promise<Done> {
  try {
    const idx = await loadIndex(ctx)
    const target = resolveNode(ctx, idx, input.id)
    if ('error' in target) return fail(target.error)
    const raw = scalarText(input.text)
    const text = raw === null ? '' : sanitize(raw).trim().slice(0, MAX_NOTE)
    if (text === '') return fail(say(ctx, 'e.textRequired'))
    if (target.node.retracted !== undefined) return fail(say(ctx, 'e.retractedNoNote', { id: target.node.id }))
    // `en` of a note is the English version of its text, as a string
    const errors: string[] = []
    let english: string | undefined
    if (input.en !== undefined && input.en !== null) {
      if (typeof input.en !== 'string') errors.push(say(ctx, 'e.enNoteShape'))
      else english = englishText(input.en, 'en', false, errors, langOf(ctx))
    }
    if (errors.length > 0) return problems(errors)
    await ctx.journal.append({ op: 'note', actor: ctx.actor, id: target.node.id, text }, ctx.now())
    const pairs: TmPair[] = []
    pairOf(text, english, pairs)
    await keepEnglish(ctx, pairs)
    return ok(t(ctx.lang, 'r.noted', { id: target.node.id }), target.node.id)
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

/** Marks a record as a mistake. Different from a decision being withdrawn: that is a status. */
export async function retractNode(ctx: Ctx, ref: string, reason: string): Promise<Done> {
  try {
    const idx = await loadIndex(ctx)
    const target = resolveNode(ctx, idx, ref)
    if ('error' in target) return fail(target.error)
    if (target.node.retracted !== undefined) return fail(say(ctx, 'e.alreadyRetracted', { id: target.node.id }))
    const text = sanitize(reason).trim().slice(0, MAX_NOTE)
    await ctx.journal.append({ op: 'retract', actor: ctx.actor, id: target.node.id, ...(text !== '' ? { reason: text } : {}) }, ctx.now())
    return ok(t(ctx.lang, 'r.retracted', { id: target.node.id }), target.node.id)
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

// ---------------------------------------------------------------- start

export type StartInput = {
  title: string
  rootTitle?: string
  statusArgv?: string[]
}

/** Creates config.json, the `start` event and, when asked, a root node. */
export async function startRecord(ctx: Ctx, input: StartInput): Promise<Done & { rootId?: string }> {
  try {
    // a config.json that is there (or that could not be read just now) is somebody's record: never overwritten
    if ((await ctx.journal.readConfig()).kind !== 'absent') return fail(say(ctx, 'c.configExists'))
    const now = ctx.now()
    let config = defaultConfig(oneLine(input.title) || 'project', isoLocal(now))
    if (input.statusArgv !== undefined && input.statusArgv.length > 0) config = withStatus(config, input.statusArgv)
    await ctx.journal.writeConfigText(serializeConfig(config))
    await ctx.journal.append({ op: 'start', actor: ctx.actor }, now)

    const rootTitle = input.rootTitle === undefined ? '' : oneLine(input.rootTitle)
    if (rootTitle !== '') {
      const idx = await loadIndex(ctx)
      const id = newId(idx, undefined, rootTitle, now)
      await ctx.journal.append(
        { op: 'add', actor: ctx.actor, id, node: { title: rootTitle.slice(0, MAX_TITLE), parent: null, status: 'adopted', kind: 'milestone', trunk: true } },
        ctx.now(),
      )
      return { ...ok(t(ctx.lang, 'r.startedRoot', { title: config.title, id }), id), rootId: id }
    }
    return ok(t(ctx.lang, 'r.started', { title: config.title }))
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

// ---------------------------------------------------------------- import

/**
 * Imports a batch of nodes (JSON array of node fields, each with an `id`).
 *
 * Running the same file again changes nothing: a node whose id and title are already in the record is
 * left as it is (the person may have edited it since) and counted as "already there". A parent that
 * cannot be found, or that would make a loop inside the batch, puts the node at the root, and the
 * receipt says how many.
 */
export async function importNodes(ctx: Ctx, raw: unknown): Promise<Done> {
  if (!Array.isArray(raw)) return fail(t(ctx.lang, 'c.importBad', { error: 'not an array' }))
  try {
    const idx = await loadIndex(ctx)
    const reserved = new Set<string>()
    // first pass: the ids the batch will use, so parents can name nodes that come later in the file
    const items: { id: string; item: Loose }[] = []
    const idOf = new Map<string, string>() // the file's id -> the id in the record
    let unchanged = 0
    for (const item of raw) {
      if (!isLoose(item)) continue
      const title = scalarText(item.title)
      const wanted = typeof item.id === 'string' ? item.id.trim() : ''
      const shown = title === null ? '' : oneLine(title)
      const there = wanted === '' ? undefined : idx.byId.get(wanted)
      if (there !== undefined && shown !== '' && oneLine(there.title) === shown) {
        idOf.set(wanted, there.id)
        unchanged++
        continue
      }
      const id = newId(idx, wanted, shown, ctx.now() + items.length, reserved)
      reserved.add(id)
      items.push({ id, item })
      if (wanted !== '' && !idOf.has(wanted)) idOf.set(wanted, id)
    }

    // each node's parent: the batch first, then the tree that is there; unresolved means the root
    const parentOf = new Map<string, string | null>()
    let rerooted = 0
    for (const { id, item } of items) {
      let parent: string | null = null
      if (typeof item.parent === 'string' && item.parent.trim() !== '') {
        const p = item.parent.trim()
        if (idOf.has(p)) parent = idOf.get(p)!
        else {
          const r = resolveRef(idx, p)
          parent = 'node' in r ? r.node.id : null
        }
        if (parent === null || parent === id) {
          parent = null
          rerooted++
        }
      }
      parentOf.set(id, parent)
    }
    // a loop inside the batch is cut at the node that comes last in the file
    const position = new Map(items.map(({ id }, k) => [id, k] as const))
    for (const { id } of items) {
      const seen: string[] = []
      let cur: string | null | undefined = id
      while (cur !== null && cur !== undefined && !seen.includes(cur) && parentOf.has(cur)) {
        seen.push(cur)
        cur = parentOf.get(cur)
      }
      if (cur !== null && cur !== undefined && seen.includes(cur)) {
        const loop = seen.slice(seen.indexOf(cur))
        const last = loop.reduce((a, b) => (position.get(a)! > position.get(b)! ? a : b))
        parentOf.set(last, null)
        rerooted++
      }
    }

    let imported = 0
    let skipped = 0
    for (const { id, item } of items) {
      const loose: Loose = { ...item }
      delete loose.id
      loose.parent = null
      delete loose.supersededBy
      const { fields, errors } = readFields(loose, idx, langOf(ctx))
      if (loose.title === undefined || loose.status === undefined) errors.push('title and status are required')
      if (errors.length > 0) {
        skipped++
        if (parentOf.get(id) === null && typeof item.parent === 'string' && item.parent.trim() !== '') rerooted-- // never written, so not placed anywhere
        continue
      }
      const node = nodeFieldsOf(fields, parentOf.get(id) ?? null)
      if (typeof item.supersededBy === 'string' && item.supersededBy.trim() !== '') {
        const by = item.supersededBy.trim()
        const found = idOf.get(by) ?? (() => {
          const r = resolveRef(idx, by)
          return 'node' in r ? r.node.id : undefined
        })()
        if (found !== undefined && found !== id) node.supersededBy = found
      }
      await ctx.journal.append({ op: 'add', actor: ctx.actor, id, node }, ctx.now())
      imported++
    }
    skipped += raw.length - items.length - unchanged
    if (imported === 0 && unchanged === 0) return fail(t(ctx.lang, 'c.importNone', { file: 'the file' }))
    if (imported === 0) return ok(t(ctx.lang, 'r.importNothingNew', { n: unchanged }))
    const extra: string[] = []
    if (unchanged > 0) extra.push(t(ctx.lang, 'r.importUnchanged', { n: unchanged }))
    if (rerooted > 0) extra.push(t(ctx.lang, 'r.importRerooted', { n: rerooted }))
    return ok([t(ctx.lang, 'r.imported', { n: imported, skipped }), ...extra].join(' '))
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

// ---------------------------------------------------------------- manual add (commands)

export type AddInput = {
  title: string
  parent: string | null
  status: DtStatus
  kind: DtKind
  id: string | null
  trunk: boolean
}

export async function addNode(ctx: Ctx, input: AddInput): Promise<Done> {
  return recordNode(ctx, {
    title: input.title,
    parent: input.parent,
    status: input.status,
    kind: input.kind,
    ...(input.id !== null ? { id: input.id } : {}),
    ...(input.trunk ? { trunk: true } : {}),
  })
}

// ---------------------------------------------------------------- trees

export type NewTreeInput = {
  /** What to call the tree: letters, digits and hyphens (other text is made into that where it can be). */
  name: string
  /** The tree to copy (default: the one in use). */
  from?: string
  /** Which version of it to copy (default: current): see versions.ts. */
  at?: string
  /** A tree with nothing in it. */
  empty?: boolean
  /** A label for people, shown beside the name. */
  title?: string
  /** Open it but go on recording in the current tree. */
  stay?: boolean
}

function versionError(ctx: Ctx, r: Extract<Version, { ok: false }>, tree: string): string {
  switch (r.error) {
    case 'empty':
      return say(ctx, 'e.versionEmpty', { tree })
    case 'number':
      return r.max === 1
        ? say(ctx, 'e.versionNumberOne', { n: r.n, tree })
        : say(ctx, 'e.versionNumber', { n: r.n, max: r.max, tree, events: eventsText(langOf(ctx), r.max) })
    case 'before':
      return say(ctx, 'e.versionBefore', { tree, first: r.first })
    case 'ambiguous':
      return say(ctx, 'e.versionAmbiguous', { ref: r.ref, ids: r.ids.join(', ') })
    default:
      return say(ctx, 'e.versionUnknown', { spec: r.spec })
  }
}

/**
 * Opens a new tree: a copy of the events of the current tree (or of `from`) up to a version, then a
 * `fork` event that says where it began. The tree it was copied from is not touched. Unless `stay`,
 * config.json then names the new tree, and every session of the project records into it.
 *
 * The copy goes first and the `fork` event last, so a tree that shows up as opened is whole; a copy
 * that was interrupted is a folder without that event, and a second try takes it over.
 */
export async function newTree(ctx: Ctx, input: NewTreeInput): Promise<Done> {
  try {
    const named = treeNameOf(input.name)
    if ('error' in named) {
      return fail(say(ctx, named.error === 'main' ? 'e.treeMain' : named.error === 'empty' ? 'e.treeNameEmpty' : 'e.treeNameBad', { name: input.name.trim() }))
    }
    const name = named.name

    const cfg = await ctx.journal.readConfig()
    if (cfg.kind === 'error') return fail(say(ctx, 'c.cannotRead', { error: cfg.error }))
    if (cfg.kind === 'absent') return fail(say(ctx, 'c.notStarted'))

    const target = ctx.journal.sibling(name)
    await target.sync()
    if (target.model().fork !== null) return fail(say(ctx, 'e.treeExists', { name }))

    const empty = input.empty === true
    let base = ctx.journal
    let version: Extract<Version, { ok: true }> | null = null
    let copy: string[] = []
    if (!empty) {
      const wanted = (input.from ?? '').trim().toLowerCase()
      if (wanted !== '' && wanted !== ctx.journal.tree) {
        if (!isTreeName(wanted)) return fail(say(ctx, 'e.treeUnknown', { name: wanted }))
        base = ctx.journal.sibling(wanted)
      }
      await base.sync()
      if (base.tree !== MAIN && base.model().fork === null) return fail(say(ctx, 'e.treeUnknown', { name: base.tree }))
      const list = numbered(base.entries())
      const found = resolveVersion(input.at ?? '', list, buildIndex(base.model()), ctx.now())
      if (!found.ok) return fail(versionError(ctx, found, base.tree))
      version = found
      copy = list.slice(0, found.count).map(e => e.name)
    }

    // files of an earlier attempt that was not finished and are not part of this copy would end up in the tree
    const wantedFiles = new Set(copy)
    const strays = target.fileNames().filter(n => !wantedFiles.has(n))
    if (strays.length > 0) return fail(say(ctx, 'e.treeLeftovers', { name, n: strays.length }))

    if (empty) {
      await target.append({ op: 'start', actor: ctx.actor }, ctx.now())
    } else {
      await base.copyTo(target, copy)
      await target.sync()
      const have = new Set(target.fileNames())
      if (copy.some(n => !have.has(n))) return fail(say(ctx, 'e.treeCopyIncomplete'))
    }

    const label = input.title === undefined ? '' : Array.from(oneLine(input.title)).slice(0, 120).join('')
    const origin: DtForkBase = { tree: empty ? ctx.journal.tree : base.tree, at: version?.at ?? null, count: version?.count ?? 0 }
    await target.append({ op: 'fork', actor: ctx.actor, ...(label !== '' ? { text: label } : {}), base: origin }, ctx.now())

    try {
      const parsed = parseConfig(cfg.text)
      await target.writeTree('config' in parsed ? parsed.config.title : '', ctx.now())
    } catch {
      // tree.json is a convenience for other tools; the events are the record
    }

    const vars = {
      name,
      from: forkText(langOf(ctx), origin),
      nodes: nodesText(langOf(ctx), target.model().nodes.filter(n => n.retracted === undefined).length),
      current: ctx.journal.tree,
    }
    if (input.stay === true) return ok(say(ctx, 'r.treeNewStay', vars), name)
    const next = setTree(cfg.text, name)
    if (next === null) return fail(say(ctx, 'c.cannotWrite', { error: 'config.json' }))
    await ctx.journal.writeConfigText(next)
    return ok(say(ctx, 'r.treeNew', vars), name)
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

/** Points config.json at a tree that is there (`main` always is). */
export async function useTree(ctx: Ctx, raw: string): Promise<Done> {
  try {
    const wanted = raw.trim().toLowerCase()
    let name: string = MAIN
    if (wanted !== MAIN) {
      const named = treeNameOf(raw)
      if ('error' in named) return fail(say(ctx, named.error === 'empty' ? 'e.treeNameEmpty' : 'e.treeUnknown', { name: raw.trim() }))
      name = named.name
    }
    const cfg = await ctx.journal.readConfig()
    if (cfg.kind === 'error') return fail(say(ctx, 'c.cannotRead', { error: cfg.error }))
    if (cfg.kind === 'absent') return fail(say(ctx, 'c.notStarted'))
    const parsed = parseConfig(cfg.text)
    if ('error' in parsed) return fail(say(ctx, 'c.cannotWrite', { error: parsed.error }))
    if ((parsed.config.tree ?? MAIN) === name && ctx.journal.tree === name) return ok(say(ctx, 'r.treeAlready', { name }), name)
    if (name !== MAIN) {
      const target = ctx.journal.sibling(name)
      await target.sync()
      if (target.model().fork === null) return fail(say(ctx, 'e.treeUnknown', { name }))
    }
    const next = setTree(cfg.text, name)
    if (next === null) return fail(say(ctx, 'c.cannotWrite', { error: 'config.json' }))
    await ctx.journal.writeConfigText(next)
    return ok(say(ctx, 'r.treeUse', { name }), name)
  } catch (err) {
    return wrapWrite(err, ctx)
  }
}

/** Every tree of the project, one line each: where it began and how big it is. */
export async function treeList(ctx: Ctx): Promise<Done> {
  try {
    const lang = langOf(ctx)
    const current = ctx.journal.tree
    const names = [MAIN, ...(await ctx.journal.listTrees())]
    const rows: { name: string; text: string }[] = []
    for (const name of names) {
      const j = name === current ? ctx.journal : ctx.journal.sibling(name)
      await j.sync()
      const m = j.model()
      const counts = t(lang, 'tree.counts', {
        nodes: nodesText(lang, m.nodes.filter(n => n.retracted === undefined).length),
        events: eventsText(lang, numbered(j.entries()).length),
      })
      let text: string
      if (name === MAIN) text = counts
      else if (m.fork === null) text = t(lang, 'tree.unfinished')
      else text = [forkText(lang, m.fork), counts, ...(m.fork.title !== undefined ? [`"${m.fork.title}"`] : [])].join(' · ')
      rows.push({ name, text })
    }
    const width = Math.max(...rows.map(r => r.name.length))
    return ok([t(lang, 'tree.listHead', { current }), ...rows.map(r => `${r.name === current ? '*' : ' '} ${padEnd(r.name, width)}  ${r.text}`)].join('\n'))
  } catch (err) {
    return fail(say(ctx, 'c.failed', { error: firstLine(err) }))
  }
}

/** The last events of a tree, numbered, for choosing a version to open a tree from. */
export async function treeLog(ctx: Ctx, limit: number | null): Promise<Done> {
  try {
    const lang = langOf(ctx)
    await ctx.journal.sync()
    const list = numbered(ctx.journal.entries())
    const tree = ctx.journal.tree
    if (list.length === 0) return ok(t(lang, 'tree.logEmpty', { tree }))
    const shown = Math.min(list.length, Math.max(1, Math.min(limit ?? 12, 60)))
    const first = list.length - shown
    const digits = String(list.length).length + 1
    const lines = list.slice(first).map((e, i) => {
      const n = padStart(`#${first + i + 1}`, digits)
      return `${n}  ${padEnd(whenOf(e.event), 11)}  ${padEnd(e.event.actor, 6)}  ${describeEvent(e.event)}`
    })
    const fork = ctx.journal.model().fork
    const origin = fork === null ? [] : [t(lang, 'tree.logFork', { from: forkText(lang, fork) })]
    const head = t(lang, shown === list.length ? 'tree.logHeadAll' : 'tree.logHead', { tree, events: eventsText(lang, list.length), shown })
    return ok([head, ...origin, ...lines].join('\n'))
  } catch (err) {
    return fail(say(ctx, 'c.failed', { error: firstLine(err) }))
  }
}
