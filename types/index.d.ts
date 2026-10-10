// The decision-tree mod's type contract: the data shapes shared by the hooks module,
// the libraries under lib/, and the values this mod keeps in `$.state`.
// Self-contained on purpose (no imports): `claude plugin validate` reads it alone.

export type DtStatus =
  | 'adopted'
  | 'rejected'
  | 'no-diff'
  | 'in-progress'
  | 'planned'
  | 'proposed'
  | 'withdrawn'
  | 'superseded'
  | 'deferred'

export type DtKind = 'decision' | 'protocol' | 'design' | 'milestone'

/** Who wrote an event. */
export type DtActor = 'user' | 'model' | 'gate' | 'import'

/** Who made the decision a node records. */
export type DtDecidedBy = 'user' | 'gate' | 'model'

export type DtEvidence = {
  label: string
  value?: string
  ci?: string
  run?: string
  note?: string
  source?: string
}

/** The fields of a node as an `add` event carries them. */
export type DtNodeFields = {
  title: string
  parent: string | null
  status: DtStatus
  kind: DtKind
  trunk?: boolean
  summary?: string
  rationale?: string
  evidence?: DtEvidence[]
  sources?: string[]
  decidedBy?: DtDecidedBy
  decidedAt?: string
  supersededBy?: string
  tags?: string[]
}

export type DtPatch = Partial<DtNodeFields> & {
  addEvidence?: DtEvidence[]
  addSources?: string[]
}

/** Where a tree began: the tree it was copied from and the point in that tree's history. */
export type DtForkBase = {
  /** The tree copied from: "main", or the name of another. */
  tree: string
  /** Name of the last event file copied; null for a tree that started empty. */
  at: string | null
  /** How many events were copied: the version number written `#N`. */
  count: number
}

/** The `fork` event of a tree: what it began from, and who made it, when. */
export type DtFork = DtForkBase & { ts: string; actor: DtActor; title?: string }

/** One immutable event file under .claude/decisions/events/ (or trees/<name>/events/). */
export type DecisionEvent = {
  v: 1
  op: 'start' | 'add' | 'update' | 'note' | 'move' | 'retract' | 'fork'
  id?: string
  ts: string
  session: string
  actor: DtActor
  node?: DtNodeFields
  patch?: DtPatch
  text?: string
  parent?: string | null
  reason?: string
  /** `fork` only. */
  base?: DtForkBase
}

export type DtNote = { ts: string; actor: DtActor; text: string }

/** A node as replayed from the events. */
export type DtNode = DtNodeFields & {
  id: string
  createdAt: string
  createdBy: DtActor
  updatedAt: string
  notes: DtNote[]
  retracted?: { ts: string; actor: DtActor; reason?: string }
  /** Name of the event file that created the node. */
  addedBy: string
}

export type DtModel = {
  isStarted: boolean
  startedAt: string | null
  nodes: DtNode[]
  warnings: string[]
  warningCount: number
  eventCount: number
  lastEventAt: string | null
  /** How this tree began, when it was opened from another (`null` for the main tree). */
  fork: DtFork | null
}

export type DtLanguage = 'auto' | 'zh' | 'en'
export type DtLang = 'zh' | 'en'

export type DtStatusConfig = {
  argv: string[]
  intervalSec: number
  timeoutSec: number
}

/** `.claude/decisions/config.json`. */
export type DtConfig = {
  v: 1
  title: string
  startedAt: string
  recording: boolean
  /** The tree every session of the project records into; absent means "main". */
  tree?: string
  status?: DtStatusConfig
  display: {
    asciiGlyphs: boolean
    autoOpen: boolean
    language: DtLanguage
  }
}

export type DtMode = 'off' | 'recording' | 'paused'

export type DtProject = {
  /** Absolute project root; empty before the session started. */
  root: string
  mode: DtMode
  config: DtConfig | null
  /** First line of why config.json could not be used, if it could not. */
  configError: string | null
  /** The tree in use: "main", or the one config.json names once it is there. */
  tree: string
}

export type DtFilter = 'default' | 'all' | 'pending' | 'clean'

export type DtEdit = { id: string; status: DtStatus; summary: string }

/** What this session's pane shows and how: per session, never written to disk. */
export type DtUi = {
  selected: string | null
  expanded: string[]
  collapsed: string[]
  filter: DtFilter
  showNow: boolean
  editing: DtEdit | null
}

export type DtLaneState = 'running' | 'queued' | 'done' | 'failed' | 'idle'

export type DtLane = {
  name: string
  run: string
  state: DtLaneState
  step: number | null
  total: number | null
  eta: string
  note: string
}

export type DtNowData = {
  updatedAt: string
  lanes: DtLane[]
  next: { text: string; eta: string }[]
  warnings: string[]
}

export type DtNow = {
  /** none: no status command configured; pending: waiting for the person's OK; approved. */
  approval: 'none' | 'pending' | 'approved'
  argv: string[]
  data: DtNowData | null
  /** Epoch ms of the last successful run. */
  fetchedAt: number | null
  /** First line of the last failure, or null. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'decision-tree': {
      model: DtModel
      project: DtProject
      ui: DtUi
      lang: DtLang
      now: DtNow
      /** Token of the Runtime that owns the poll (a reload replaces it). */
      owner: string
    }
  }
}
