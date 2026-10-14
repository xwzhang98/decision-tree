// What this mod asks of the engine, as a plain object.
//
// The engine refuses a hooks module that hands `$` to a function in another file
// (it must be able to list every `$.noun.method()` the module calls). So
// hooks/register.tsx builds one of these from `$`, each member spelled out where
// it is written, and everything under lib/ takes the Port instead. A test builds
// one from memory (tests/port.ts) and needs no engine at all.
//
// The members are the engine's own signatures, so what a call takes and
// returns is exactly what `$` takes and returns.

import type { EngineInterface } from 'claude-code'

import type { DtLang, DtModel, DtNow, DtProject, DtTm, DtTreeInfo, DtUi } from '../types'

type E = EngineInterface

export type Port = {
  session: Pick<E['session'], 'cwd' | 'id'>
  clock: Pick<E['clock'], 'now' | 'every' | 'after'>
  store: Pick<E['store'], 'get' | 'set'>
  fs: Pick<E['fs'], 'write' | 'list' | 'exists'> & {
    /** The file's text (`$.fs.read(path)`). */
    read: (path: string) => Promise<string>
  }
  process: Pick<E['process'], 'run'>
  command: Pick<E['command'], 'register'>
  /** Hands the model a prompt of its own, which starts a turn once the session is idle (`/decide init`). */
  prompt: Pick<E['prompt'], 'submit'>
  tool: Pick<E['tool'], 'register'>
  /** One completion through the session's own client: the translator asks for the other language's version of a text (`display.translate` switches it off). */
  model: Pick<E['model'], 'complete'>
  ui: Pick<E['ui'], 'open' | 'panes' | 'focus' | 'toast'> & {
    /** Draws the pane again (its ages move with the clock). */
    invalidate: () => void
  }
  /**
   * The values in `$.state`, one cell each. The engine lists the values a module reads and
   * writes from the atoms it can see, so each cell is tied to its atom in register.tsx.
   */
  state: {
    model: Cell<DtModel>
    project: Cell<DtProject>
    ui: Cell<DtUi>
    lang: Cell<DtLang>
    now: Cell<DtNow>
    /** The translation memory: what the texts of the tree read like in the other language. */
    tm: Cell<DtTm>
    /** Every tree of the project, for the tabs and the overview. */
    trees: Cell<DtTreeInfo[]>
    /** The colour scheme in use (an id of lib/palettes.ts). */
    scheme: Cell<string>
    /** How many texts wait for their rendition. */
    translating: Cell<number>
    /** Token of the Runtime that owns the poll (a reload replaces it). */
    owner: Cell<string>
  }
}

/** `read($, atom)` and `update($, atom, change)` of one atom. */
export type Cell<T> = {
  read: () => Promise<T>
  update: (change: (value: T) => T) => Promise<T>
}
