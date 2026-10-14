// The model's side of the translator in tests: it reads the numbered texts of a request and answers the way
// the translator asks to be answered (a JSON object with the same numbers).

import type { ModelCompleteRequest, ModelCompleteResult } from 'claude-code'

import type { DtLang } from '../types'
import { NO_MODEL } from './port'
import type { ModelHandler } from './port'

const USAGE = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

export { NO_MODEL }
export type { ModelHandler }

/** A reply with this text. */
export const said = (text: string): ModelCompleteResult => ({ isAnswered: true, text, usage: USAGE })

/** A failure of the API, as the engine tells it. */
export const apiError = (error: string, status: number | null = null): ModelCompleteResult =>
  ({ isAnswered: false, reason: 'api-error', status, error, usage: { ...USAGE, input_tokens: 0, output_tokens: 0 } }) as ModelCompleteResult

const promptText = (request: Pick<ModelCompleteRequest, 'prompt'>): string => (typeof request.prompt === 'string' ? request.prompt : request.prompt.map(b => b.text).join(''))

/** The texts a request asks to be translated, in the order of their numbers. */
export function textsOf(request: Pick<ModelCompleteRequest, 'prompt'>): string[] {
  const body = JSON.parse(promptText(request)) as Record<string, string>
  return Object.keys(body)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => body[k]!)
}

/** The language a request asks for. */
export function targetOf(request: Pick<ModelCompleteRequest, 'system'>): DtLang {
  const system = typeof request.system === 'string' ? request.system : (request.system ?? []).map(b => b.text).join('')
  return system.includes('into Chinese') ? 'zh' : 'en'
}

/** A reply that numbers `renditions` (one per text asked for, in order); a null is a text the reply leaves out. */
export function numbered(renditions: readonly (string | null)[]): ModelCompleteResult {
  const body: Record<string, string> = {}
  renditions.forEach((r, k) => {
    if (r !== null) body[String(k + 1)] = r
  })
  return said(JSON.stringify(body))
}

/** A model that has a version for each text of `dict` and none for the others. */
export function translatesWith(dict: Record<string, string>): ModelHandler {
  return request => numbered(textsOf(request).map(text => (Object.hasOwn(dict, text) ? dict[text]! : null)))
}
