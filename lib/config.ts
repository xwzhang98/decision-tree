// `.claude/decisions/config.json`: the project's own settings, shared through git.

import type { DtConfig, DtLanguage, DtStatusConfig } from '../types'
import { MAIN, isTreeName } from './events'

export const DEFAULT_INTERVAL_SEC = 30
export const DEFAULT_TIMEOUT_SEC = 15

export function defaultConfig(title: string, startedAt: string): DtConfig {
  return {
    v: 1,
    title,
    startedAt,
    recording: true,
    display: { asciiGlyphs: false, autoOpen: true, language: 'auto', translate: true },
  }
}

export function withStatus(config: DtConfig, argv: readonly string[]): DtConfig {
  return {
    ...config,
    status: { argv: [...argv], intervalSec: DEFAULT_INTERVAL_SEC, timeoutSec: DEFAULT_TIMEOUT_SEC },
  }
}

export function serializeConfig(config: DtConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

/** Reads config.json's text. Fields that are missing or the wrong type take their defaults. */
export function parseConfig(text: string): { config: DtConfig } | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { error: 'config.json is not valid JSON' }
  }
  if (!isRecord(raw)) return { error: 'config.json is not a JSON object' }
  if (raw.v !== undefined && raw.v !== 1) return { error: `config.json has an unsupported version ${JSON.stringify(raw.v)}` }

  let status: DtStatusConfig | undefined
  if (raw.status !== undefined && raw.status !== null) {
    const s = raw.status
    if (!isRecord(s) || !Array.isArray(s.argv) || s.argv.length === 0 || !s.argv.every(a => typeof a === 'string' && a !== '')) {
      return { error: 'config.json: status.argv must be a non-empty list of strings' }
    }
    status = {
      argv: s.argv as string[],
      intervalSec: clamp(s.intervalSec, 5, 3600, DEFAULT_INTERVAL_SEC),
      timeoutSec: clamp(s.timeoutSec, 1, 120, DEFAULT_TIMEOUT_SEC),
    }
  }

  const d = isRecord(raw.display) ? raw.display : {}
  const language: DtLanguage = d.language === 'zh' || d.language === 'en' ? d.language : 'auto'
  const config: DtConfig = {
    v: 1,
    title: typeof raw.title === 'string' && raw.title.trim() !== '' ? raw.title.trim() : 'project',
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : '',
    recording: raw.recording !== false,
    // a name that cannot be a tree is not an error: the project stays on main
    ...(isTreeName(raw.tree) && raw.tree !== MAIN ? { tree: raw.tree } : {}),
    ...(status !== undefined ? { status } : {}),
    display: {
      asciiGlyphs: d.asciiGlyphs === true,
      autoOpen: d.autoOpen !== false,
      language,
      translate: d.translate !== false,
    },
  }
  return { config }
}

/**
 * Sets `recording` in config.json's text and leaves every other key (including
 * ones a newer version added) as it was. Null when the text is not an object.
 */
export function setRecording(text: string, recording: boolean): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  return `${JSON.stringify({ ...raw, recording }, null, 2)}\n`
}

/** Changes keys of `display` in config.json's text and leaves everything else as it was. Null when the text is not an object. */
export function setDisplay(text: string, patch: Partial<DtConfig['display']>): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  const display = isRecord(raw.display) ? raw.display : {}
  return `${JSON.stringify({ ...raw, display: { ...display, ...patch } }, null, 2)}\n`
}

/**
 * Points config.json at a tree (`main` removes the key) and leaves every other key as it was.
 * Null when the text is not an object.
 */
export function setTree(text: string, tree: string): string | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw)) return null
  const { tree: _old, ...rest } = raw
  return `${JSON.stringify(tree === MAIN ? rest : { ...rest, tree }, null, 2)}\n`
}
