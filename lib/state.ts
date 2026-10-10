// The values this mod keeps in `$.state`: what the pane draws from. They live in
// the session (they survive a hot reload) and are never written to disk.
// The types are the contract in ../types/index.d.ts. The atoms themselves are
// declared in hooks/register.tsx, where the engine can list them; these are
// their initial values.

import type { DtModel, DtNow, DtProject, DtUi } from '../types'

export const EMPTY_MODEL: DtModel = {
  isStarted: false,
  startedAt: null,
  nodes: [],
  warnings: [],
  warningCount: 0,
  eventCount: 0,
  lastEventAt: null,
  fork: null,
}

export const EMPTY_PROJECT: DtProject = { root: '', mode: 'off', config: null, configError: null, tree: 'main' }

export const EMPTY_UI: DtUi = { selected: null, expanded: [], collapsed: [], filter: 'default', showNow: true, editing: null }

export const EMPTY_NOW: DtNow = { approval: 'none', argv: [], data: null, fetchedAt: null, error: null }
