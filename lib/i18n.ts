// Every fixed piece of text the mod shows, in Chinese and in English.
//
// The Chinese is written the way a Chinese engineer or researcher talks about their own work: the words of
// software and research stay English (tree, node, status and its values, summary, rationale, evidence, bug, doc,
// commit, run, seed, ...), and Chinese carries the sentences around them. Node content (titles, summaries, ...)
// is never in this table: it is recorded in the language it was written in, and the translation memory
// (lang.ts) holds what it reads like in the other one.

import type { DtLang, DtStatus } from '../types'

const EN = {
  // pane: header and chrome
  'pane.tab': 'Decisions',
  'pane.title': 'Decision tree',
  'pane.state.recording': 'recording',
  'pane.state.paused': 'paused',
  'pane.state.readOnly': 'read only',
  'pane.recordingIn': 'recording in {tree}',
  'pane.count.one': '1 decision',
  'pane.count.many': '{n} decisions',
  'pane.steps.one': 'mainline 1 step',
  'pane.steps.many': 'mainline {n} steps',
  'pane.updated': 'updated {time}',
  'pane.translating': 'translating {n}',
  'pane.now': 'Now',
  'pane.warnings': 'warnings {n}',
  'pane.empty':
    "No decisions are being recorded in this project yet. Run /decide init to have Claude find the starting point, /decide start for an empty tree, or say 'start recording decisions from now' in a prompt.",
  'pane.empty.config': 'The decision record in this project cannot be read: {error}',
  'pane.noNodes': 'No decisions recorded yet.',
  'pane.noMatch': 'Nothing matches this filter. Press a to show everything.',
  'pane.above': '▲ {n} more above',
  'pane.below': '▼ {n} more below',
  'pane.retracted': 'retracted',
  'pane.retractedBy': 'Retracted by {actor}',
  'pane.small': 'This pane is too small to draw. Make it larger.',

  // pane: keys and filters
  'key.move': 'move',
  'key.expand': 'expand',
  'key.edit': 'edit',
  'key.pending': 'pending',
  'key.clean': 'hide rejected',
  'key.all': 'all',
  'key.now': 'now',
  'key.tree': 'next tree',
  'key.trees': 'trees',
  'key.colors': 'colors',
  'key.open': 'open',
  'key.record': 'record here',
  'key.new': 'new tree',
  'key.back': 'back',
  'key.use': 'use',
  'key.create': 'create',
  'filter.all': 'showing everything',
  'filter.pending': 'pending only',
  'filter.clean': 'rejected hidden',

  // detail
  'detail.title': 'Details',
  'detail.rationale': 'Rationale',
  'detail.evidence': 'Evidence',
  'detail.sources': 'Sources',
  'detail.notes': 'Notes',
  'detail.supersededBy': 'Superseded by {id}',
  'detail.supersedes': 'Supersedes {ids}',
  'detail.decidedAt': 'decided {date}',
  'detail.recorded': 'recorded {date}',
  'detail.tags': 'Tags',

  // edit form
  'edit.title': 'Edit {id}',
  'edit.status': 'Status',
  'edit.summary': 'Summary',
  'edit.summaryHint': 'One-line conclusion',
  'edit.save': 'Save',
  'edit.cancel': 'Cancel',
  'edit.mobile': 'Editing needs a text field; use /decide status, /decide note or /decide add here.',
  'edit.saved': 'Saved {id}',
  'edit.nothing': 'Nothing changed',
  'edit.readOnly': 'This is {tree}, which is read only here. Press t, select it and press r to record in it.',

  // status labels
  'status.adopted': 'adopted',
  'status.rejected': 'rejected',
  'status.no-diff': 'no diff',
  'status.in-progress': 'in progress',
  'status.planned': 'planned',
  'status.proposed': 'proposed',
  'status.withdrawn': 'withdrawn',
  'status.superseded': 'superseded',
  'status.deferred': 'deferred',

  // the "now" block
  'now.loading': 'Reading the status command…',
  'now.allow': 'Allow',
  'now.askRun': 'The status command wants to run in this project:',
  'now.askNote': 'It runs on your machine, in the project folder, every {sec} s while this pane is open.',
  'now.tooLong': 'The status command in config.json is too long to check here. Put it in a script and point config.json at the script.',
  'now.resize': 'A status command awaits your OK; enlarge the pane to read it.',
  'now.changed': 'The status command in config.json changed. Look at the new one before allowing it.',
  'now.stale': 'stale {n} min',
  'now.staleSec': 'stale',
  'now.error': 'Status command failed: {error}',
  'now.next': 'Next',
  'now.eta': '~{eta}',
  'now.queued': 'queued',
  'now.done': 'done',
  'now.failed': 'failed',
  'now.idle': 'idle',
  'now.unreadable': 'Status output unusable: {error}',

  // the trees overview
  'trees.title': 'Trees',
  'trees.count.one': '1 tree',
  'trees.count.many': '{n} trees',
  'trees.steps.one': '1 step',
  'trees.steps.many': '{n} steps',
  'trees.empty': 'No trees to show yet.',
  'trees.new.title': 'New tree',
  'trees.new.name': 'Name',
  'trees.new.nameHint': 'letters, digits and hyphens',
  'trees.new.at': 'Version',
  'trees.new.atHint': 'blank = as it is now, or #9, 09-21, a node id',
  'trees.new.label': 'Title',
  'trees.new.labelHint': 'What it is for (optional)',
  'trees.new.from': 'Opens from {tree}',
  'trees.new.recording': 'You will record in it from then on.',
  'trees.new.create': 'Create',
  'trees.new.mobile': 'Opening a tree needs text fields; use /decide tree new <name> here.',

  // colour schemes
  'colors.title': 'Colors',
  'colors.count': '{n} schemes',
  'colors.inUse': 'in use',
  'colors.default': 'default',
  'colors.sample': 'Preview',
  'colors.hint': 'It stays as you choose it, in every project.',

  // translation
  'tr.failed': 'Translating the tree failed ({error}); the original text is shown meanwhile.',
  'tr.off': 'Translating is switched off in config.json (display.translate).',

  // receipts
  'r.started': 'Started recording decisions for {title} (data in .claude/decisions/)',
  'r.startedRoot': 'Started recording decisions for {title}, root {id}',
  'r.alreadyOn': 'Decisions are already being recorded here; use decision_record.',
  'r.alreadyPaused': 'Decision recording is paused here; the user can run /decide resume.',
  'r.paused': 'Decision recording paused',
  'r.resumed': 'Decision recording resumed',
  'r.pausedBlock': 'Not recorded: decision recording is paused (the user can run /decide resume).',
  'r.gitignore': 'Note: .gitignore ignores .claude/, so these files will not reach git.',
  'r.initAsked': 'Asked Claude to look through the project and record where it starts; the pane fills as it goes.',
  'r.initFailed': 'Could not hand init to Claude ({error}). Ask it to look through the project and record its starting point.',
  'r.recorded': 'Recorded {id} (under {parent}, {status})',
  'r.recordedRoot': 'Recorded {id} (root, {status})',
  'r.updated': 'Updated {id}: {changes}',
  'r.noted': 'Noted on {id}',
  'r.retracted': 'Retracted {id}',
  'r.moved': 'Moved {id} under {parent}',
  'r.movedRoot': 'Moved {id} to the root',
  'r.imported': 'Imported {n} nodes ({skipped} skipped)',
  'r.importUnchanged': 'Already in the record, left as they are: {n}.',
  'r.importRerooted': 'Placed at the root for lack of a usable parent: {n}.',
  'r.importNothingNew': 'Nothing new: {n} already in the record.',
  'r.changeStatus': 'status {status}',
  'r.changeSummary': 'summary',
  'r.changeRationale': 'rationale',
  'r.changeTitle': 'title',
  'r.changeEvidence': '{n} evidence added',
  'r.changeSources': '{n} sources added',
  'r.changeSuperseded': 'superseded by {id}',
  'r.changeOther': '{fields}',
  'r.openedPane': 'Opened the decision pane',
  'r.noPane': 'This screen has no room for the pane; the tree as text:',
  'r.untitled': '(untitled)',

  // commands
  'c.usage':
    'Usage: /decide start [title] | init [title] | pause | resume | status <id> <status> | note <id> <text> | add <title> --parent <id> [--status planned] | retract <id> <reason> | import <file> | lang [en|zh|auto] | translate [on|off] | colors [name|reset] | tree [new <name> [--at <version>] [--from <tree>] [--empty] [--title <text>] | use <name> | log [N]]',
  'c.notStarted': 'Decisions are not being recorded in this project. Run /decide start [title] first.',
  'c.alreadyStarted': 'Decisions are already being recorded here ({title}).',
  'c.initPaused': 'Decision recording is paused, so init has nowhere to write. Run /decide resume first.',
  'c.initNotEmpty': 'This tree already has decisions ({n}), and init only sets up an empty one. /decide new <name> --empty opens an empty tree.',
  'c.unknownNode': 'No node matches "{ref}". Use an id, or part of a title that matches one node.',
  'c.ambiguousNode': '"{ref}" matches several nodes: {ids}. Use an id.',
  'c.unknownStatus': 'Unknown status "{status}". Use one of: {list}.',
  'c.missingArg': 'Missing {what}. {usage}',
  'c.openedEdit': 'Editing {id} in the pane',
  'c.selectFirst': 'Opened the pane. Select a node there, then press e (or run /decide again) to edit it.',
  'c.importUsage': 'Usage: /decide import <file> (a JSON array of nodes: id, title, parent, status, ...)',
  'c.importRead': 'Cannot read {file}: {error}',
  'c.importBad': 'The file is not a JSON array of nodes: {error}',
  'c.importNone': 'No usable nodes in {file}.',
  'c.noneChanged': 'Nothing to change.',
  'c.cannotWrite': 'Cannot write the record: {error}',
  'c.cannotRead': 'Cannot read config.json just now ({error}); nothing was changed. Try again.',
  'e.titleEmpty': 'title must be a non-empty string',
  'e.titleLong': 'title is too long ({n} > {max} characters); keep it to one short line and put the rest in summary',
  'e.refAmbiguous': '"{ref}" matches several nodes ({ids}); use an id',
  'e.refUnknown': 'unknown node "{ref}"; call decision_tree to see the ids',
  'e.idRequired': 'id is required',
  'e.retractedNoChange': '{id} was retracted; it can no longer be changed',
  'e.retractedNoNote': '{id} was retracted; it can no longer take notes',
  'e.alreadyRetracted': '{id} is already retracted',
  'e.textRequired': 'text is required',
  'e.supersedeSelf': '{id} cannot supersede itself',
  'e.cycle': 'moving {id} under {parent} would make a cycle',
  'e.noFreeId': 'could not find a free id; try again with another id',
  'e.fieldRequired': '{field} is required',
  'e.parentRequired': 'parent is required (a node id, or null for a root)',
  'e.recordFirst': '{why}; record the new decision first',
  'e.enBad': '{field} must be the English version of the text, with no Chinese characters in it',
  'e.enShape': 'en must be an object with the English version of the fields you give: {"title": ..., "summary": ..., "rationale": ..., "evidence": [{"label": ..., "value": ..., "note": ...}]}; leave it out when the text is English',
  'e.enNoteShape': 'en must be a string: the English version of text; leave it out when the text is English',
  'r.noChange': 'No change: {id} already has these values.',
  'c.configExists': '.claude/decisions/config.json already exists (or could not be read just now), so nothing was changed. Try again in a moment.',
  'c.failed': 'Something went wrong inside the decision-tree mod: {error}',
  'r.readFailed': 'Cannot read the decision record ({error}); showing what was read last.',
  'r.readBack': 'The decision record can be read again.',
  'c.langSet': 'Language set to {lang}',
  'c.translateOn': "Translation is on: a text's version in the other language is asked from the session's model, in the background.",
  'c.translateOff': 'Translation is off: the model is not asked. Only the English versions recorded with each decision are shown.',
  'c.autoOpenSet': 'Auto-open set to {value}',
  'c.colorsSet': 'Colors set to {name}.',
  'c.colorsReset': 'Colors are back to the default ({name}).',
  'c.colorsNow': 'Colors: {name}. Choose with /decide colors <name> (one of: {list}), or press c in the pane to try them on.',
  'c.colorsUnknown': 'No color scheme called "{name}". Choose one of: {list}.',

  // trees: several lines of decisions in one project
  'tree.followed': 'Now recording in tree {name} (the project switched to it).',
  'tree.fellBack': 'config.json names tree {name}, but this project has no such tree (yet); staying on {current}.',
  'tree.from': 'from {base} at #{n} ({when})',
  'tree.fromEmpty': 'started empty',
  'tree.nodes.one': '1 node',
  'tree.nodes.many': '{n} nodes',
  'tree.events.one': '1 event',
  'tree.events.many': '{n} events',
  'tree.counts': '{nodes}, {events}',
  'tree.unfinished': 'unfinished copy (no fork event yet)',
  'tree.listHead': 'Trees in this project (recording in {current}):',
  'tree.pausedNote': 'Recording is paused; /decide resume turns it back on.',
  'tree.logHead': 'Tree {tree}: {events}; the last {shown} (use #N as --at):',
  'tree.logHeadAll': 'Tree {tree}: {events} (use #N as --at):',
  'tree.logEmpty': 'Tree {tree} has no events yet.',
  'tree.logFork': 'opened {from}',
  'e.treeNameEmpty': 'a tree needs a name (letters, digits and hyphens, 2-32 characters, e.g. crdt-engine)',
  'e.treeNameBad': '"{name}" cannot be a tree name: use 2-32 letters, digits and hyphens (a longer or Chinese name goes in --title)',
  'e.treeMain': '"main" is the first tree of the project; pick another name',
  'e.treeExists': 'tree {name} already exists; pick another name, or switch to it with /decide tree use {name}',
  'e.treeUnknown': 'there is no tree named {name}; /decide tree lists them',
  'e.treeLeftovers': 'trees/{name}/ already holds {n} event files from an earlier attempt that did not finish; delete that folder or pick another name',
  'e.treeCopyIncomplete': 'copying the events did not finish, so nothing was switched; try again',
  'e.versionEmpty': 'tree {tree} has no events yet, so there is no version to start from; use --empty for a blank tree',
  'e.versionNumber': 'there is no version #{n}: {tree} has {events} (#1 to #{max})',
  'e.versionNumberOne': 'there is no version #{n}: {tree} has 1 event (only #1)',
  'e.versionBefore': 'nothing had been recorded in {tree} by then; its first event is from {first}',
  'e.versionAmbiguous': '"{ref}" matches several nodes ({ids}); use an id',
  'e.versionUnknown': 'cannot tell which version "{spec}" is; use current, #N (see /decide tree log), a date or time such as 2026-10-08 17:44, or a node id',
  'r.treeNew': 'Opened tree {name}, {from}: {nodes}. Recording there now.',
  'r.treeNewStay': 'Opened tree {name}, {from}: {nodes}. Still recording in {current}; /decide tree use {name} switches.',
  'r.treeUse': 'Recording in tree {name} now.',
  'r.treeAlready': 'Already recording in tree {name}.',
} as const

export type Key = keyof typeof EN

const ZH: Record<Key, string> = {
  'pane.tab': 'Decisions',
  'pane.title': 'Decision tree',
  'pane.state.recording': '记录中',
  'pane.state.paused': '已暂停',
  'pane.state.readOnly': '只读',
  'pane.recordingIn': '正记录到 {tree}',
  'pane.count.one': '1 个决定',
  'pane.count.many': '{n} 个决定',
  'pane.steps.one': 'mainline 1 step',
  'pane.steps.many': 'mainline {n} steps',
  'pane.updated': '{time} 更新',
  'pane.translating': '翻译中 {n}',
  'pane.now': 'Now',
  'pane.warnings': 'warnings {n}',
  'pane.empty': "这个项目还没有开始记录决定。运行 /decide init 让 Claude 自己找出起点，/decide start 从空树开始，或在 prompt 里说'从现在开始记录决定'。",
  'pane.empty.config': '读不了这个项目的决定记录：{error}',
  'pane.noNodes': '还没有记录任何决定。',
  'pane.noMatch': '这个 filter 下没有内容。按 a 显示全部。',
  'pane.above': '▲ 上面还有 {n} 行',
  'pane.below': '▼ 下面还有 {n} 行',
  'pane.retracted': 'retracted',
  'pane.retractedBy': 'retracted by {actor}',
  'pane.small': 'pane 太小，画不下。请拉大一点。',

  'key.move': '移动',
  'key.expand': '展开',
  'key.edit': '编辑',
  'key.pending': 'pending',
  'key.clean': '隐藏 rejected',
  'key.all': '全部',
  'key.now': 'now',
  'key.tree': '下个 tree',
  'key.trees': '总览',
  'key.colors': '配色',
  'key.open': '打开',
  'key.record': '记到这里',
  'key.new': '新 tree',
  'key.back': '返回',
  'key.use': '使用',
  'key.create': '创建',
  'filter.all': '显示全部',
  'filter.pending': '只看 pending',
  'filter.clean': 'rejected 已隐藏',

  'detail.title': 'Details',
  'detail.rationale': 'Rationale',
  'detail.evidence': 'Evidence',
  'detail.sources': 'Sources',
  'detail.notes': 'Notes',
  'detail.supersededBy': 'superseded by {id}',
  'detail.supersedes': 'supersedes {ids}',
  'detail.decidedAt': '{date} 决定',
  'detail.recorded': '{date} 记录',
  'detail.tags': 'Tags',

  'edit.title': '编辑 {id}',
  'edit.status': 'Status',
  'edit.summary': 'Summary',
  'edit.summaryHint': '一句话结论',
  'edit.save': '保存',
  'edit.cancel': '取消',
  'edit.mobile': '这里没有文本框；用 /decide status、/decide note 或 /decide add。',
  'edit.saved': '已保存 {id}',
  'edit.nothing': '没有改动',
  'edit.readOnly': '{tree} 在这里是只读的。按 t，选中它，再按 r，就可以记到它里面。',

  'status.adopted': 'adopted',
  'status.rejected': 'rejected',
  'status.no-diff': 'no diff',
  'status.in-progress': 'in progress',
  'status.planned': 'planned',
  'status.proposed': 'proposed',
  'status.withdrawn': 'withdrawn',
  'status.superseded': 'superseded',
  'status.deferred': 'deferred',

  'now.loading': '正在读取 status 命令…',
  'now.allow': '允许运行',
  'now.askRun': 'status 命令想在这个项目里运行：',
  'now.askNote': '它在你的机器上、项目文件夹里运行；pane 打开期间每 {sec} 秒一次。',
  'now.tooLong': 'config.json 里的 status 命令太长，在这里没法看清。请把它写进脚本，再让 config.json 指向脚本。',
  'now.resize': '有一条 status 命令在等你确认；把 pane 拉大后才看得全。',
  'now.changed': 'config.json 里的 status 命令变了。请先看新的命令，再决定是否允许。',
  'now.stale': 'stale {n} min',
  'now.staleSec': 'stale',
  'now.error': 'status 命令失败：{error}',
  'now.next': '下一步',
  'now.eta': '约 {eta}',
  'now.queued': 'queued',
  'now.done': 'done',
  'now.failed': 'failed',
  'now.idle': 'idle',
  'now.unreadable': 'status 输出不可用：{error}',

  'trees.title': 'Trees',
  'trees.count.one': '1 个 tree',
  'trees.count.many': '{n} 个 tree',
  'trees.steps.one': '1 step',
  'trees.steps.many': '{n} steps',
  'trees.empty': '还没有 tree 可显示。',
  'trees.new.title': '新 tree',
  'trees.new.name': 'Name',
  'trees.new.nameHint': '字母、数字和连字符',
  'trees.new.at': 'Version',
  'trees.new.atHint': '留空 = 当前；也可写 #9、09-21 或 node id',
  'trees.new.label': 'Title',
  'trees.new.labelHint': '用来做什么（可不填）',
  'trees.new.from': '基于 {tree}',
  'trees.new.recording': '之后你会记到它里面。',
  'trees.new.create': '创建',
  'trees.new.mobile': '新开 tree 需要文本框；这里用 /decide tree new <name>。',

  'colors.title': '配色',
  'colors.count': '{n} 个方案',
  'colors.inUse': '当前',
  'colors.default': '默认',
  'colors.sample': '预览',
  'colors.hint': '选好后在所有项目里都保持这个配色。',

  'tr.failed': '翻译这棵 tree 失败（{error}）；先显示原文。',
  'tr.off': 'config.json 里关掉了翻译（display.translate）。',

  'r.started': '已开始记录 {title} 的决定（数据在 .claude/decisions/）',
  'r.startedRoot': '已开始记录 {title} 的决定，根 node {id}',
  'r.alreadyOn': '这个项目已经在记录决定；用 decision_record。',
  'r.alreadyPaused': '这个项目的决定记录已暂停；用户可以运行 /decide resume。',
  'r.paused': '决定记录已暂停',
  'r.resumed': '决定记录已恢复',
  'r.pausedBlock': '未记录：决定记录已暂停（用户可以运行 /decide resume）。',
  'r.gitignore': '注意：.gitignore 忽略了 .claude/，这些文件不会进 git。',
  'r.initAsked': '已请 Claude 浏览项目并记下起点；记录会陆续出现在 pane 里。',
  'r.initFailed': '没能把 init 交给 Claude（{error}）。可以直接让它浏览项目并记下起点。',
  'r.recorded': '已记录 {id}（挂在 {parent} 下，{status}）',
  'r.recordedRoot': '已记录 {id}（根 node，{status}）',
  'r.updated': '已更新 {id}：{changes}',
  'r.noted': '已给 {id} 加 note',
  'r.retracted': '已撤销 {id}',
  'r.moved': '已把 {id} 改挂到 {parent} 下',
  'r.movedRoot': '已把 {id} 改为根 node',
  'r.imported': '已导入 {n} 个 node（跳过 {skipped} 个）',
  'r.importUnchanged': '已在记录里、保持原样：{n} 个。',
  'r.importRerooted': '找不到可用的 parent、已放在根上：{n} 个。',
  'r.importNothingNew': '没有新内容：{n} 个都已在记录里。',
  'r.changeStatus': 'status {status}',
  'r.changeSummary': 'summary',
  'r.changeRationale': 'rationale',
  'r.changeTitle': 'title',
  'r.changeEvidence': '追加 {n} 条 evidence',
  'r.changeSources': '追加 {n} 个 source',
  'r.changeSuperseded': 'superseded by {id}',
  'r.changeOther': '{fields}',
  'r.openedPane': '已打开决策 pane',
  'r.noPane': '这个界面放不下 pane，文字版如下：',
  'r.untitled': '（无标题）',

  'c.usage':
    '用法：/decide start [title] | init [title] | pause | resume | status <id> <status> | note <id> <text> | add <title> --parent <id> [--status planned] | retract <id> <reason> | import <file> | lang [en|zh|auto] | translate [on|off] | colors [name|reset] | tree [new <name> [--at <version>] [--from <tree>] [--empty] [--title <text>] | use <name> | log [N]]',
  'c.notStarted': '这个项目还没有开始记录决定。先运行 /decide start [title]。',
  'c.alreadyStarted': '这个项目已经在记录决定（{title}）。',
  'c.initPaused': '决定记录已暂停，init 没有地方可写。先运行 /decide resume。',
  'c.initNotEmpty': '这棵 tree 已经有决定了（{n} 个），init 只用于空 tree。/decide new <name> --empty 可以新开一棵空 tree。',
  'c.unknownNode': '没有 node 匹配 "{ref}"。用 id，或者只匹配一个 node 的 title 片段。',
  'c.ambiguousNode': '"{ref}" 匹配多个 node：{ids}。请用 id。',
  'c.unknownStatus': '不认识的 status "{status}"。可用：{list}。',
  'c.missingArg': '缺少{what}。{usage}',
  'c.openedEdit': '在 pane 里编辑 {id}',
  'c.selectFirst': '已打开 pane。先在里面选一个 node，再按 e（或再运行 /decide）编辑。',
  'c.importUsage': '用法：/decide import <file>（node 的 JSON 数组：id、title、parent、status ……）',
  'c.importRead': '读不了 {file}：{error}',
  'c.importBad': '这个文件不是 node 的 JSON 数组：{error}',
  'c.importNone': '{file} 里没有可用的 node。',
  'c.noneChanged': '没有要改的内容。',
  'c.cannotWrite': '写不进记录：{error}',
  'c.cannotRead': '现在读不了 config.json（{error}），什么都没改。请再试一次。',
  'e.titleEmpty': 'title 不能为空',
  'e.titleLong': 'title 太长（{n} > {max} 个字符）；title 只写一行，其余放进 summary',
  'e.refAmbiguous': '"{ref}" 匹配多个 node（{ids}）；请用 id',
  'e.refUnknown': '没有 node "{ref}"；用 decision_tree 查看 id',
  'e.idRequired': '需要 node id',
  'e.retractedNoChange': '{id} 已撤销，不能再修改',
  'e.retractedNoNote': '{id} 已撤销，不能再加 note',
  'e.alreadyRetracted': '{id} 已经撤销了',
  'e.textRequired': '需要 text',
  'e.supersedeSelf': '{id} 不能取代自己',
  'e.cycle': '把 {id} 移到 {parent} 下会形成环',
  'e.noFreeId': '找不到可用的 id；换一个 id 再试',
  'e.fieldRequired': '需要 {field}',
  'e.parentRequired': '需要 parent（node id；根 node 用 null）',
  'e.recordFirst': '{why}；请先记录新的决定',
  'e.enBad': '{field} 必须是这段文字的英文版，里面不能有汉字',
  'e.enShape': 'en 必须是一个 object，放你给出的那些字段的英文版：{"title": ..., "summary": ..., "rationale": ..., "evidence": [{"label": ..., "value": ..., "note": ...}]}；文字本来是英文时不要传 en',
  'e.enNoteShape': 'en 必须是字符串：text 的英文版；文字本来是英文时不要传 en',
  'r.noChange': '没有变化：{id} 已经是这些值。',
  'c.configExists': '.claude/decisions/config.json 已经存在（或刚才读不出来），所以什么都没改。请稍后再试。',
  'c.failed': 'decision-tree mod 内部出错：{error}',
  'r.readFailed': '读不了决策记录（{error}）；先显示上一次读到的内容。',
  'r.readBack': '决策记录又可以读了。',
  'c.langSet': '语言已设为 {lang}',
  'c.translateOn': '翻译已开启：缺少的另一种语言版本，会在后台请当前 session 的模型翻译。',
  'c.translateOff': '翻译已关闭：不再请模型翻译，只显示记录决定时一并写下的英文版。',
  'c.autoOpenSet': '自动打开已设为 {value}',
  'c.colorsSet': '配色已设为 {name}。',
  'c.colorsReset': '配色恢复为默认（{name}）。',
  'c.colorsNow': '当前配色：{name}。用 /decide colors <name> 切换（可选：{list}），或在 pane 里按 c 试色。',
  'c.colorsUnknown': '没有叫 "{name}" 的配色。可选：{list}。',

  'tree.followed': '现在记录到 tree「{name}」（项目已切换到它）。',
  'tree.fellBack': 'config.json 指向 tree「{name}」，但这个项目里还没有它；暂时留在「{current}」。',
  'tree.from': '基于 {base} 的 #{n}（{when}）',
  'tree.fromEmpty': '从空白开始',
  'tree.nodes.one': '1 个 node',
  'tree.nodes.many': '{n} 个 node',
  'tree.events.one': '1 个 event',
  'tree.events.many': '{n} 个 event',
  'tree.counts': '{nodes}，{events}',
  'tree.unfinished': '没做完的复制（还没有 fork event）',
  'tree.listHead': '这个项目的 tree（正在记录到「{current}」）：',
  'tree.pausedNote': '记录现在是暂停的；/decide resume 可以恢复。',
  'tree.logHead': 'Tree「{tree}」：共 {events}，最近 {shown} 个（--at 里写 #N）：',
  'tree.logHeadAll': 'Tree「{tree}」：共 {events}（--at 里写 #N）：',
  'tree.logEmpty': 'Tree「{tree}」还没有 event。',
  'tree.logFork': '开出时{from}',
  'e.treeNameEmpty': 'tree 需要一个名字（字母、数字、连字符，2–32 个字符，例如 crdt-engine）',
  'e.treeNameBad': '"{name}" 不能做 tree 名：用 2–32 个字母、数字或连字符（中文或更长的名字放进 --title）',
  'e.treeMain': '"main" 是项目的第一棵 tree，请换个名字',
  'e.treeExists': 'tree「{name}」已经存在；换个名字，或用 /decide tree use {name} 切过去',
  'e.treeUnknown': '没有叫「{name}」的 tree；/decide tree 可以列出所有 tree',
  'e.treeLeftovers': 'trees/{name}/ 里已有 {n} 个上一次没做完的 event 文件；删掉那个文件夹，或换个名字',
  'e.treeCopyIncomplete': '复制 event 没有做完，没有切换；请再试一次',
  'e.versionEmpty': 'tree「{tree}」里还没有任何 event，没有可以作为起点的 version；要空白的 tree 用 --empty',
  'e.versionNumber': '没有 #{n} 这个 version：「{tree}」一共 {events}（#1 到 #{max}）',
  'e.versionNumberOne': '没有 #{n} 这个 version：「{tree}」只有 1 个 event（只有 #1）',
  'e.versionBefore': '那个时间点「{tree}」里还什么都没记录；它的第一个 event 在 {first}',
  'e.versionAmbiguous': '"{ref}" 匹配多个 node（{ids}）；请用 id',
  'e.versionUnknown': '看不出 "{spec}" 是哪个 version；可以写 current、#N（/decide tree log 里有）、日期时间如 2026-10-08 17:44，或 node id',
  'r.treeNew': '已新开 tree「{name}」，{from}：{nodes}。现在记录到这里。',
  'r.treeNewStay': '已新开 tree「{name}」，{from}：{nodes}。仍在记录到「{current}」；/decide tree use {name} 可以切换。',
  'r.treeUse': '现在记录到 tree「{name}」。',
  'r.treeAlready': '已经在记录到 tree「{name}」。',
}

const TABLE: Record<DtLang, Record<Key, string>> = { en: EN, zh: ZH }

/** The text for `key` in `lang`, with `{name}` placeholders filled from `vars`. */
export function t(lang: DtLang, key: Key, vars?: Record<string, string | number>): string {
  const raw = TABLE[lang][key]
  if (vars === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name]
    return v === undefined ? whole : String(v)
  })
}

/** `1 node` / `3 nodes` (`1 个 node` / `3 个 node`). */
export function nodesText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'tree.nodes.one' : 'tree.nodes.many', { n })
}

/** `1 event` / `6 events` (`1 个 event` / `6 个 event`). */
export function eventsText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'tree.events.one' : 'tree.events.many', { n })
}

/** `1 decision` / `23 decisions` (`1 个决定` / `23 个决定`). */
export function decisionsText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'pane.count.one' : 'pane.count.many', { n })
}

/** `mainline 1 step` / `mainline 6 steps`. */
export function mainlineText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'pane.steps.one' : 'pane.steps.many', { n })
}

/** `1 tree` / `3 trees`. */
export function treesText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'trees.count.one' : 'trees.count.many', { n })
}

/** `1 step` / `6 steps`. */
export function stepsText(lang: DtLang, n: number): string {
  return t(lang, n === 1 ? 'trees.steps.one' : 'trees.steps.many', { n })
}

/** The label of a status: `adopted` / `in progress`. The same words in both languages: they are the names the commands take. */
export function statusLabel(lang: DtLang, status: DtStatus): string {
  return t(lang, `status.${status}` as Key)
}

/** Han characters decide it: the one script that makes a prompt Chinese. */
const HAN = /[㐀-䶿一-鿿豈-﫿]/

/** Whether `text` holds a Han character. */
export function hasHan(text: string): boolean {
  return HAN.test(text)
}

/**
 * The language a prompt is written in: `zh` when it holds Chinese
 * characters, `en` when it holds a few English words, else null (a "y" or an
 * "ok" tells nothing, so the current language stays).
 */
export function detectLanguage(text: string): DtLang | null {
  if (HAN.test(text)) return 'zh'
  const letters = text.match(/[A-Za-z]/g)
  return letters !== null && letters.length >= 6 ? 'en' : null
}
