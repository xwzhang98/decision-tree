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

/**
 * The project's translation memory (`.claude/decisions/i18n/`): a text as it was recorded, and what it
 * reads like in the other language. Keyed by the text itself, so nothing in the events is touched.
 */
export type DtTm = {
  /** English renditions of texts written in Chinese. */
  en: Record<string, string>
  /** Chinese renditions of texts written in English (technical terms stay English in them). */
  zh: Record<string, string>
}

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
    /** Whether the mod may ask the session's model for the other language's version of a text (false: only what was recorded with one is shown). */
    translate: boolean
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

/** What the pane is showing: the tree in use, the overview of all the trees, the colour picker. */
export type DtView = 'tree' | 'trees' | 'colors'

/** The form for a new tree in the overview. */
export type DtNewTree = {
  name: string
  /** The version of the tree to open it from: what the person wrote (nothing is "as it is now"). */
  at: string
  title: string
  /** First line of why the tree could not be made, once the person tried. */
  error: string | null
}

/** What this session's pane shows and how: per session, never written to disk. */
export type DtUi = {
  selected: string | null
  expanded: string[]
  collapsed: string[]
  filter: DtFilter
  showNow: boolean
  editing: DtEdit | null
  view: DtView
  /** The tree the pane looks at; null is the one the project records into. */
  tree: string | null
  /** The tree highlighted in the overview, or the colour scheme highlighted in the picker. */
  pick: string | null
  /** The new-tree form of the overview, while it is open. */
  newTree: DtNewTree | null
}

/**
 * A step of a tree's mainline that the tree recorded itself, and not one it was given by being opened from
 * another: a point of the overview's graph.
 */
export type DtGraphStep = {
  id: string
  title: string
  status: DtStatus
  /** When the decision took effect, else when it was recorded (ISO). */
  at: string
  /** Name of the event file that recorded it. File names sort in the order of the events, in every tree. */
  by: string
  /** It is the newest step of the tree that is adopted: the head of its rail. */
  head: boolean
}

/** One tree of the project, as the tabs and the overview list it. */
export type DtTreeInfo = {
  name: string
  /** What it is for: the title it was opened with; the first tree, which has none, carries its oldest step's title. */
  title: string | null
  /** Where it began; null for the first tree. */
  fork: DtForkBase | null
  /** Nodes that are not retracted, steps of its mainline, and events. */
  nodes: number
  steps: number
  events: number
  lastEventAt: string | null
  lastActor: DtActor | null
  /** The steps it recorded itself, oldest first (the newest few dozen at most). */
  own: DtGraphStep[]
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
      tm: DtTm
      /** Every tree of the project, for the tabs and the overview. */
      trees: DtTreeInfo[]
      /** The colour scheme in use (an id of lib/palettes.ts). */
      scheme: string
      /** How many texts wait for their rendition in the other language. */
      translating: number
      /** Token of the Runtime that owns the poll (a reload replaces it). */
      owner: string
    }
  }
}
