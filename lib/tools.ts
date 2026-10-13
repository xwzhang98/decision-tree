// The tools the model sees (spec 7): their names, the schemas, and the rules the
// descriptions carry. The text is for the model, so it is English whatever
// language the pane is in.

import type { ToolSpec } from 'claude-code'

import { STATUSES } from './events'
import type { TreeIndex } from './tree'
import { recentNodes, resolveRef, trunkNodes } from './tree'
import { oneLine, truncate } from './width'
import type { DtNode } from '../types'

export const PLUGIN = 'decision-tree'
export const TOOL_PREFIX = `mcp__${PLUGIN}__`

export type ToolName =
  | 'decision_log_start'
  | 'decision_record'
  | 'decision_update'
  | 'decision_note'
  | 'decision_tree'
  | 'decision_new_tree'
  | 'decision_use_tree'

export const WRITE_TOOLS: readonly ToolName[] = ['decision_record', 'decision_update', 'decision_note', 'decision_tree', 'decision_new_tree', 'decision_use_tree']

/** `mcp__decision-tree__decision_record`: the name the engine and the model use. */
export type FullName = `mcp__decision-tree__${ToolName}`

export function fullName(name: ToolName): FullName {
  return `${TOOL_PREFIX}${name}` as FullName
}

/** The short tool name for a full `mcp__decision-tree__x` name, or null for any other tool. */
export function shortName(full: string): ToolName | null {
  if (!full.startsWith(TOOL_PREFIX)) return null
  const name = full.slice(TOOL_PREFIX.length)
  return (ALL_TOOLS as readonly string[]).includes(name) ? (name as ToolName) : null
}

const ALL_TOOLS: readonly ToolName[] = ['decision_log_start', ...WRITE_TOOLS]

const KINDS = ['decision', 'protocol', 'design', 'milestone']
const DECIDERS = ['user', 'gate', 'model']

const EVIDENCE_ITEM = {
  type: 'object',
  required: ['label'],
  properties: {
    label: { type: 'string', description: 'What was measured or observed, e.g. "model A, seed 0, after warm-up".' },
    value: { type: 'string', description: 'The key number, e.g. "metric X -12.6%".' },
    ci: { type: 'string', description: 'The interval, e.g. "[-15.1, -10.4]".' },
    run: { type: 'string', description: 'The run name, e.g. "model_a_s0".' },
    note: { type: 'string' },
    source: { type: 'string', description: 'Path of the report or file the number comes from.' },
  },
}

const FIELDS = {
  title: {
    type: 'string',
    description:
      'A short statement of the decision: one line, about 40 characters at most (the pane shows it on one row); the detail goes in summary and rationale. Technical terms in English; the rest in the language the user writes in.',
  },
  status: { enum: [...STATUSES] },
  kind: { enum: KINDS, default: 'decision' },
  trunk: { type: 'boolean', description: 'True for a step on the project mainline (listed in the Mainline line at the top of the pane and marked by a thin line beside its row).' },
  summary: { type: 'string', description: 'The conclusion in one line.' },
  rationale: { type: 'string', description: 'Why, in a few sentences.' },
  decidedBy: { enum: DECIDERS, description: '"user" when the user decided, "gate" when a rule agreed beforehand decided, "model" for your own call.' },
  decidedAt: { type: 'string', description: 'ISO 8601; leave out for now.' },
}

const RULES = [
  'RECORD: what the user decides (adopt, reject, withdraw, change a rule, set a next step); conclusions that follow from rules agreed beforehand (a gate letting something through or skipping it: decidedBy "gate"); plans the user accepts (status planned); proposals not decided yet (status proposed).',
  'DO NOT RECORD: ideas the user has not agreed to (never mark them adopted); progress and logs (the pane\'s "now" block covers those).',
  'EVIDENCE: key numbers and intervals in evidence[].value and .ci; the run name in evidence[].run; the report path in evidence[].source.',
  'STATUS FOLLOWS RESULTS: planned -> in-progress -> adopted / rejected. When a new decision replaces an old one, call decision_update on the old node with supersededBy (its status becomes "superseded").',
  'ONE MATTER, ONE NODE: another seed of the same thing is more evidence (decision_update with addEvidence), not a new node.',
  'BEFORE RECORDING: pick the parent from the tree in the system prompt; if unsure, call decision_tree first.',
  'LANGUAGE: technical terms (run names, metric and column names, seed, ...) always in English; title, summary and rationale in the language the user writes in (Chinese if they write Chinese, English if English). Never translate text already recorded.',
].join('\n')

export const SPECS: Record<ToolName, ToolSpec> = {
  decision_log_start: {
    name: 'decision_log_start',
    description: [
      "Start recording this project's decisions as a tree. Data goes to .claude/decisions/ in the project (plain text, meant for git); the tree is shown in a pane beside the transcript.",
      "Call it only when the user asks to begin, for example 'start recording decisions from now' or '从现在开始记录决定'. Do not call it on your own.",
      "title: the project's name. rootTitle (optional): the first milestone, recorded as the root of the mainline. statusArgv (optional): only if the user named one, a command as an argv array that prints JSON of live run status for the pane's \"now\" block.",
      'Once it succeeds, decision_record, decision_update, decision_note, decision_tree, decision_new_tree and decision_use_tree are available from the next user message.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: "The project's name." },
        rootTitle: { type: 'string', description: 'Optional first milestone, recorded as the root.' },
        statusArgv: { type: 'array', items: { type: 'string' }, description: 'Optional status command as an argv array.' },
      },
    },
    isDeferred: false,
  },

  decision_record: {
    name: 'decision_record',
    description: [
      "Record one decision in this project's decision tree. Returns its id and the node it hangs under.",
      RULES,
    ].join('\n'),
    inputSchema: {
      type: 'object',
      required: ['title', 'parent', 'status'],
      properties: {
        id: { type: 'string', description: 'kebab-case slug; optional (one is made from the title).' },
        title: FIELDS.title,
        parent: { type: ['string', 'null'], description: 'Id of the parent node; null for a root.' },
        status: FIELDS.status,
        kind: FIELDS.kind,
        trunk: FIELDS.trunk,
        summary: FIELDS.summary,
        rationale: FIELDS.rationale,
        evidence: { type: 'array', items: EVIDENCE_ITEM },
        sources: { type: 'array', items: { type: 'string' }, description: 'Report or file paths.' },
        decidedBy: FIELDS.decidedBy,
        decidedAt: FIELDS.decidedAt,
      },
    },
    isDeferred: false,
  },

  decision_update: {
    name: 'decision_update',
    description: [
      'Change a recorded decision: its status, title, summary or rationale; append evidence (addEvidence) or sources (addSources); mark it replaced (supersededBy: the id of the new node; the status becomes "superseded" unless you give one); move it (parent).',
      'Only the fields you give are changed. summary and rationale accept null to clear. Use it when a result arrives, a plan starts or finishes, or a decision is replaced; not for progress.',
      RULES,
    ].join('\n'),
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'The node to change.' },
        title: FIELDS.title,
        parent: { type: ['string', 'null'], description: 'Move the node under this parent; null makes it a root.' },
        status: FIELDS.status,
        kind: FIELDS.kind,
        trunk: FIELDS.trunk,
        summary: { type: ['string', 'null'] },
        rationale: { type: ['string', 'null'] },
        evidence: { type: 'array', items: EVIDENCE_ITEM, description: 'Replaces the whole list; usually use addEvidence.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'Replaces the whole list; usually use addSources.' },
        addEvidence: { type: 'array', items: EVIDENCE_ITEM, description: 'Evidence to append (repeats are ignored).' },
        addSources: { type: 'array', items: { type: 'string' }, description: 'Sources to append.' },
        supersededBy: { type: ['string', 'null'], description: 'Id of the node that replaces this one.' },
        decidedBy: FIELDS.decidedBy,
        decidedAt: FIELDS.decidedAt,
      },
    },
    isDeferred: false,
  },

  decision_note: {
    name: 'decision_note',
    description:
      'Add a short dated note to a node: a caveat, a follow-up, what the user said about it. Results belong in evidence (decision_update addEvidence), not in notes. Same language rule as decision_record.',
    inputSchema: {
      type: 'object',
      required: ['id', 'text'],
      properties: {
        id: { type: 'string' },
        text: { type: 'string' },
      },
    },
    isDeferred: false,
  },

  decision_tree: {
    name: 'decision_tree',
    description: [
      'Read the decision tree. With no arguments: the mainline plus the 20 most recently touched nodes as compact text (id · status · title · parent).',
      'With id: that node in full (summary, rationale, evidence, sources, notes, children). With query: nodes whose id or title contains it.',
      'With trees: true, the trees of this project and where each began; with log: N, the last N events of the current tree, numbered (#N is a version a new tree can start from).',
      'Call it before recording when you are unsure of the parent or whether the matter is already recorded.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A node id (or a piece of its title) to read in full.' },
        query: { type: 'string', description: 'Find nodes by a piece of their id or title.' },
        trees: { type: 'boolean', description: 'List the trees of this project.' },
        log: { type: 'integer', description: 'Show the last N events of the current tree, numbered.' },
      },
    },
    isDeferred: false,
  },

  decision_new_tree: {
    name: 'decision_new_tree',
    description: [
      'Open a new decision tree in this project: a copy of the current tree (or of one version of it) to record the next line of work in, without touching the original. Recording then switches to the new tree for every session of the project.',
      "Call it only when the user asks for a new tree, branch or alternative line (for example 'open a new tree from the current one', '新开一个 tree'). Never on your own.",
      'name: letters, digits and hyphens, 2-32 characters, e.g. "sql-v3" (main is taken). at (optional): the version to copy: leave out or "current" for everything recorded so far; "#N" for the first N events (decision_tree with log: N numbers them); a date or time such as "2026-10-08 17:44" or "10-08"; or a node id or piece of its title for the tree as it was when that node was recorded. from (optional): the tree to copy, default the current one. empty (optional): true for a blank tree. title (optional): a label for people. stay (optional): true to open it without switching to it.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'The new tree\'s name, e.g. "sql-v3".' },
        at: { type: 'string', description: 'The version to copy: current, #N, a date or time, or a node.' },
        from: { type: 'string', description: 'The tree to copy; default the current one.' },
        empty: { type: 'boolean', description: 'Open a blank tree instead of a copy.' },
        title: { type: 'string', description: 'A label for the tree.' },
        stay: { type: 'boolean', description: 'Open it without switching recording to it.' },
      },
    },
    isDeferred: false,
  },

  decision_use_tree: {
    name: 'decision_use_tree',
    description:
      'Switch recording to another tree of this project ("main" is the first one). Every session of the project follows. Call it only when the user asks to go to another tree; decision_tree with trees: true lists them.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'The tree to record in from now on.' },
      },
    },
    isDeferred: false,
  },
}

// ---------------------------------------------------------------- decision_tree output

const RECENT = 20
const QUERY_LIMIT = 30

function parentLabel(idx: TreeIndex, n: DtNode): string {
  const p = idx.parentOf.get(n.id) ?? null
  return p === null ? 'root' : p
}

function compact(idx: TreeIndex, n: DtNode): string {
  const flag = n.retracted !== undefined ? ' [retracted]' : ''
  return `${n.id} · ${n.status} · ${truncate(oneLine(n.title), 80)} · ${parentLabel(idx, n)}${flag}`
}

function evidenceText(n: DtNode): string[] {
  return (n.evidence ?? []).map(e => {
    const parts = [e.label, e.value, e.ci, e.run !== undefined ? `run ${e.run}` : undefined, e.note, e.source !== undefined ? `source ${e.source}` : undefined]
    return `  - ${parts.filter((p): p is string => p !== undefined && p !== '').join(' | ')}`
  })
}

/** One node in full, as plain lines. */
export function nodeText(idx: TreeIndex, n: DtNode): string {
  const lines: string[] = [compact(idx, n)]
  lines.push(`title: ${oneLine(n.title)}`)
  lines.push(`kind: ${n.kind}${n.trunk === true ? ' · mainline' : ''}`)
  if (n.decidedBy !== undefined || n.decidedAt !== undefined) lines.push(`decided: ${[n.decidedBy, n.decidedAt].filter(Boolean).join(' ')}`)
  if (n.summary !== undefined) lines.push(`summary: ${n.summary}`)
  if (n.rationale !== undefined) lines.push(`rationale: ${n.rationale}`)
  if ((n.evidence ?? []).length > 0) lines.push('evidence:', ...evidenceText(n))
  if ((n.sources ?? []).length > 0) lines.push(`sources: ${(n.sources ?? []).join(', ')}`)
  if (n.supersededBy !== undefined) lines.push(`supersededBy: ${n.supersededBy}`)
  const replaced = idx.nodes.filter(o => o.supersededBy === n.id).map(o => o.id)
  if (replaced.length > 0) lines.push(`supersedes: ${replaced.join(', ')}`)
  const kids = idx.children.get(n.id) ?? []
  if (kids.length > 0) lines.push('children:', ...kids.slice(0, 30).map(k => `  - ${compact(idx, k)}`))
  if (n.notes.length > 0) lines.push('notes:', ...n.notes.map(x => `  - ${x.ts.slice(0, 10)} ${x.actor}: ${oneLine(x.text)}`))
  if (n.retracted !== undefined) lines.push(`retracted by ${n.retracted.actor}${n.retracted.reason !== undefined ? `: ${n.retracted.reason}` : ''}`)
  return lines.join('\n')
}

/** The answer to `decision_tree`: the mainline and recent nodes, one node, or a search. */
export function treeReport(idx: TreeIndex, args: { id?: unknown; query?: unknown }): string {
  if (idx.nodes.length === 0) return 'The tree is empty. The first decision has parent null.'

  const id = typeof args.id === 'string' ? args.id.trim() : ''
  if (id !== '') {
    const r = resolveRef(idx, id)
    if ('node' in r) return nodeText(idx, r.node)
    if (r.error === 'ambiguous') return `"${id}" matches several nodes: ${r.ids.join(', ')}. Use an id.`
    return `No node matches "${id}". Call decision_tree with no arguments to list the tree.`
  }

  const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
  if (query !== '') {
    const hits = idx.nodes.filter(n => n.id.toLowerCase().includes(query) || n.title.toLowerCase().includes(query))
    if (hits.length === 0) return `No node has "${query}" in its id or title.`
    const shown = hits.slice(0, QUERY_LIMIT).map(n => compact(idx, n))
    return [`${hits.length} match${hits.length === 1 ? '' : 'es'} (id · status · title · parent):`, ...shown, ...(hits.length > QUERY_LIMIT ? [`… and ${hits.length - QUERY_LIMIT} more`] : [])].join('\n')
  }

  const trunk = trunkNodes(idx)
  const recent = recentNodes(idx, RECENT)
  const lines: string[] = []
  lines.push(
    trunk.length > 0
      ? `Mainline: ${trunk.map(n => `${n.id} "${truncate(oneLine(n.title), 40)}"`).join(' > ')}`
      : 'Mainline: none marked yet (set trunk: true on the steps of the project mainline).',
  )
  lines.push(`Recent ${recent.length} of ${idx.nodes.length}, newest first (id · status · title · parent):`)
  for (const n of recent) lines.push(compact(idx, n))
  return lines.join('\n')
}
