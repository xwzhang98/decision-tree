# decision-tree

**English** | [简体中文](README.zh-CN.md)

A general-purpose Claude Code mod that records the decisions made in a project as a tree and shows it in a pane docked on the right of the terminal.

- Decisions are recorded by Claude through tools the mod registers. You can also change them with commands, or by hand in the pane.
- The data lives in the project folder (`.claude/decisions/`). Every session started in that project reads the same record and keeps adding to it; sync it with git and the tree follows you across machines.
- A project can have several trees: open a new one from the current version, or from any earlier version, and keep recording there (like branching in git). The original stays untouched and you can switch back at any time. See [Multiple trees](#multiple-trees).
- Above the tree there is a "Now" block: a status command that the project configures itself (it prints JSON) is refreshed every 30 seconds and shows the progress of long-running jobs, their estimated finish times and the next gate.
- It contains no project names, paths or machine names. Everything specific to a project lives in that project's own `config.json`.
- The interface text and the receipts follow the language you type in (Chinese if there is Chinese in it, English if it is plain English). Technical terms always stay in English.

**Quick start**

```
/plugin install decision-tree --marketplace xwzhang98/decision-tree
```

Then, in any project, run `/decide init`: Claude looks through the project, records where it starts, and the pane fills in (open it with `/tree`). For an empty tree instead, tell Claude "start recording decisions from now" or run `/decide start`. Details are in [Installation](#installation) and [Getting started](#getting-started).

## Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Getting started](#getting-started)
4. [Commands](#commands)
5. [Multiple trees](#multiple-trees)
6. [The pane](#the-pane)
7. [Ghostty and other terminals](#ghostty-and-other-terminals)
8. [Tools for the model](#tools-for-the-model)
9. [Data format](#data-format)
10. [The "Now" block and the status command](#the-now-block-and-the-status-command)
11. [Language](#language)
12. [Behavior to know about](#behavior-to-know-about)
13. [Development and tests](#development-and-tests)
14. [Using it in your own project](#using-it-in-your-own-project)
15. [Implementation notes and assumptions](#implementation-notes-and-assumptions)
16. [Authors](#authors)
17. [License](#license)

## Prerequisites

- Written against the mod API of Claude Code **2.1.296** (`claude plugin validate`, `tsc -p` and `claude plugin test` all pass on that version). The mod API changes with every version: after changing versions, run validate and test first, see [Development and tests](#development-and-tests).
- With the fullscreen terminal layout the pane docks on the right and shares the space with the diff panel as tabs. The width rules belong to the engine. When a project is already recording, the mod opens the pane **on its own**, and it only draws once the terminal is at least 144 columns wide (110 is enough after you have opened it once with `/tree`); on a narrower terminal it waits and appears when you widen the window. A pane you open yourself with `/tree` or `/decide` docks on the right from 110 columns; on a narrower terminal it is drawn above the prompt (see [Behavior to know about](#behavior-to-know-about)).
- It needs no network and no external program. The only external commands it runs are `git rev-parse` and `git check-ignore` (to find the project root and to check `.gitignore`), and the status command you have approved.

## Installation

### From GitHub

```
/plugin install decision-tree --marketplace xwzhang98/decision-tree
```

Claude Code asks `Add marketplace?`: press `y`, choose **Install for you (user scope)** and press Enter. When `Installed decision-tree. Plugin is now active.` appears it is installed: it takes effect in the current session at once, and every session you start on this machine from now on loads it.

The same from the command line:

```bash
claude plugin marketplace add xwzhang98/decision-tree
claude plugin install decision-tree@decision-tree --scope user
```

To publish your own copy, push this folder as the root of a repository (`.claude-plugin/marketplace.json` is already written) and use `/plugin install decision-tree --marketplace <owner>/<repo>`.

### On a remote server (without interrupting running sessions)

Sessions on a remote server may be carrying unattended, long-running job queues. **Do not restart them to install or debug**: open another Claude Code session to install and try the mod. The sessions that are already running are not affected (they do not load the mod until you restart them).

1. Copy the whole folder to the server, for example to `~/mods/decision-tree`:

   ```bash
   rsync -a --exclude '.claude-plugin/types' decision-tree/ server:~/mods/decision-tree/
   ```

   (If the server can reach GitHub you can skip the copy and use the GitHub install above in that new session.)

2. In that new Claude Code session type:

   ```
   /plugin install decision-tree --marketplace ~/mods/decision-tree
   ```

   Press `y` at `Add marketplace?`, choose **Install for you (user scope)** and press Enter. When `Installed decision-tree. Plugin is now active.` appears it is installed: it takes effect in the current session at once, and every session you start on this machine from now on loads it.

3. To change the code later, edit `~/mods/decision-tree` directly and run `/reload-plugins` in the session.

Outside the interactive UI you can use the command line:

```bash
claude plugin marketplace add ~/mods/decision-tree
claude plugin install decision-tree@decision-tree --scope user
```

### Try it without installing

```bash
claude --plugin-dir ~/mods/decision-tree
```

It applies to that one session only, and reloads by itself when you edit the files.

## Getting started

A project is **not recorded** by default. Without `.claude/decisions/config.json` the mod writes no file, the system prompt gets one extra line ("If the user asks to start recording this project's decisions …, call decision_log_start."), and the model sees only one tool, `decision_log_start`.

There are three ways to turn recording on:

- run `/decide init [title]`: it turns recording on **and** has Claude look through the project and record where it starts, see [Setting up from the project itself](#setting-up-from-the-project-itself);
- say "start recording decisions from now" in a prompt (the Chinese "从现在开始记录决定" works too) and the model calls `decision_log_start`;
- or run `/decide start [title]` yourself.

The last two begin with an empty tree.

Once on, the mod: writes `config.json` and a `start` event; registers the other six tools (`decision_record`, `decision_update`, `decision_note`, `decision_tree`, `decision_new_tree`, `decision_use_tree`); replaces the system-prompt section with the full version; and the session that turned it on opens the pane (when you turn it on with `/decide start` the pane also gets the keyboard, with `/decide init` it does not, because Claude starts working at once; it only draws if there is room, see [Prerequisites](#prerequisites)). Other sessions already running in this project notice `config.json` within 5 seconds and switch to on as well; if their terminal uses the fullscreen layout and `display.autoOpen` is true, each of them opens the pane once.

Pause and resume with `/decide pause` and `/decide resume`. While paused, the model's write tools answer "Not recorded: decision recording is paused", and the system-prompt section shrinks to one line saying recording is paused. Your own commands and manual edits in the pane still work.

If the project's `.gitignore` ignores `.claude/`, turning recording on prints "Note: .gitignore ignores .claude/, so these files will not reach git." The mod **never edits `.gitignore`**. Git cannot re-include a path inside an ignored directory, so to get `decisions/` into git change `.claude/` to:

```
.claude/*
!.claude/decisions/
```

### Setting up from the project itself

`/decide init [title]` is to this mod what `/init` is to Claude Code: instead of starting with an empty tree, Claude looks through the project and records where it stands.

```
Started recording decisions for orders-api (data in .claude/decisions/)
Asked Claude to look through the project and record where it starts; the
pane fills as it goes.
```

1. If recording is off, the mod turns it on (like `/decide start`, except that the pane does not take the keyboard).
2. A moment later it hands Claude a task, as if you had typed it: look through the README and docs, notes, `CLAUDE.md` / `AGENTS.md`, decision records (`docs/adr`, `DECISIONS.md`), the changelog, the last 30 commits and the tags, the main config and manifest files and the layout of the code. A quick look, about a dozen reads.
3. Claude records the **starting point** with `decision_record`: the root of the mainline (a milestone, adopted) saying what the project is and where it stands, with the files it used as `sources`.
4. Then, under it, up to seven decisions the project has clearly already made: `adopted` for what the files say is decided or in use, `rejected` for alternatives they say were dropped, `planned` or `proposed` for what they list as next or still open. Each has its sources, and a `decidedAt` date when a commit or a document gives one. Nothing is invented: what the files do not show is left out.
5. It ends with two or three sentences on what it recorded and what it could not tell.

What it leaves behind looks like this (an example for a made-up project, as Claude might record it):

```
  Decision tree  orders-api   ● Recording   6 decisions   updated 12:00
  Mainline  Orders API

▌ ✓ Orders API: v1 in production
    ✓ Use PostgreSQL for storage
    ✗ MongoDB for storage
    ✓ Serve a REST API, not GraphQL
    ○ Move order processing to async workers
    ◌ Rate limiting at the gateway
  ─────────────────────────────────────────────────────────────────────
▾ Orders API: v1 in production
  ✓ Adopted   model   03-14
  REST service on PostgreSQL, live since March
  Sources  README.md  CHANGELOG.md

  ─────────────────────────────────────────────────────────────────────
  k: ↑  j: ↓  Enter expand  e: Edit  p: Pending  h: Hide rejected
  a: All
```

It changes no file in your project (the record in `.claude/decisions/` apart), runs none of the project's code, starts no jobs and skips secrets such as `.env` files. It writes only through the ordinary `decision_record` tool, so everything it records can be edited in the pane, corrected with `/decide status`, or taken back with `/decide retract`, like any other node. It is a request to the model, not a program: what it records depends on what the project's files say and how the model reads them, so look the result over. Reading the project goes through the usual permission prompts of your Claude Code settings.

`/decide init` sets up an **empty** tree only. In a tree that already has decisions it says so and does nothing (`/decide new <name> --empty` opens an empty tree to run it in); while recording is paused it asks you to `/decide resume` first. The task starts a turn of its own once the session is idle, so if Claude is busy it waits until the current turn ends. The records are written in the language `display.language` fixes; with `auto` they are in Chinese once you have typed Chinese, and otherwise in the language you write in (English if Claude cannot tell). The wording of the task is in `lib/init.ts`.

## Commands

| Command | What it does |
|---|---|
| `/tree` | Opens the pane (or switches to it) and gives it the keyboard. If the screen has no room for the pane, returns the tree as text |
| `/decide init [title]` | Turn recording on **and** have Claude look through the project and record where it starts, see [Setting up from the project itself](#setting-up-from-the-project-itself) |
| `/decide start [title]` | Turn recording on by hand, with an empty tree |
| `/decide pause`, `/decide resume` | Pause, resume |
| `/decide status <id> <status>` | Change a status, e.g. `/decide status v22-adopted adopted`. A status can be written as its id, its English name or its Chinese name (`采用`, `否决`, `进行中`, …) |
| `/decide note <id> <text>` | Add a note |
| `/decide add <title> --parent <id> [--status planned]` | Add a node by hand. Also `--kind decision\|protocol\|design\|milestone`, `--id <slug>`, `--trunk` |
| `/decide retract <id> <reason>` | Take back a record made by mistake (not the same as a decision being `withdrawn`) |
| `/decide import <file>` | Import a batch of nodes, see [Importing seed data](#importing-seed-data) |
| `/decide new <name> [--at <version>] [--from <tree>] [--title <text>] [--empty] [--stay]` | Open a new tree: it starts as a copy of the current version (or of the version `--at` names) and the project switches to it, see [Multiple trees](#multiple-trees) |
| `/decide use <name>` | Switch to another tree (`main` is the first one) |
| `/decide tree` | List the project's trees, where each was opened from, and how big each is |
| `/decide log [N]` | The last N events of the current tree (default 12, at most 60), numbered: `#N` is a version you can use with `--at` |
| `/decide` (no arguments) | Open the pane and start editing the selected node |
| `/decide lang zh\|en\|auto` | Fix the interface language, or go back to automatic (written to `config.json`) |
| `/decide autoopen on\|off` | Whether the pane opens by itself once recording is on |

Wherever `<id>` is expected you can also give a piece of a title that matches exactly one node; if several match, the command lists the candidate ids. Events written by hand have `actor` `"user"`. A command returns a one-line receipt. The three tree commands also have a long form, `/decide tree new|use|log` (`list` is the same as `/decide tree`); `new` can also be written `fork`, `新建` or `新开`, and `use` can also be written `switch` or `切换`.

## Multiple trees

A project has one tree by default, called `main`. When you want to try a different line of thought ("same premise, a third approach") without messing up the record you have, open a new tree. It starts as a copy of some **version** of a tree; everything recorded afterwards goes only into the new tree, and the original stays exactly as it was and can be switched back to at any time. It is the same idea as a branch in git.

```
/decide log                                  # look at the event numbers first: #17 is the 17th event
/decide new sql-v3                           # base = the current version
/decide new sql-v3 --at #17                  # base = the state after the 17th event
/decide new sql-v3 --at v22-adopted          # base = the state at the moment v22-adopted was recorded
/decide new sql-v3 --at "2026-10-08 17:44"   # base = the state at that point in time
/decide new sql-v3 --title "SQL third try"   # a name takes letters, digits and hyphens only; a longer description goes in --title
/decide tree                                 # list all trees
/decide use main                             # switch back to main
```

Once a tree is opened the project switches to it at once: decisions that you, the model and the other sessions record from then on go into the new tree. Here is a small example from a real run (the data is illustrative). `main` holds `start` plus four nodes; `/decide new sql-v3 --at #4 --title "SQL third try"` opens a tree based on the first four events, and the receipt is

```
Opened tree sql-v3, from main at #4 (10-09 12:00): 3 nodes. Recording there now.
```

After one more node (`sql-plan-b`) is recorded in the new tree, `/decide tree` lists all trees (the marked one is where recording goes; what you see below is the text itself, with `*` at the start of the line. In the conversation a receipt is treated as markdown, which draws a leading `*` as `-`, with the same meaning; the model's `decision_tree` tool receives the `*`), and `/decide log` shows the current tree's events:

```
Trees in this project (recording in sql-v3):
  main    4 nodes, 5 events
* sql-v3  from main at #4 (10-09 12:00) · 4 nodes, 5 events · "SQL third try"
```

```
Tree sql-v3: 5 events (use #N as --at):
opened from main at #4 (10-09 12:00)
#1  10-09 12:00  model   start
#2  10-09 12:00  model   add design-v2 "Design v2 final"
#3  10-09 12:00  model   add pool-32 "Keep pool count at 32"
#4  10-09 12:00  model   add probe-s1-gate "Gate: probe s1 passed"
#5  10-10 12:00  user    add sql-plan-b "SQL plan B"
```

### Options

| Option | Meaning |
|---|---|
| `--at <version>` (also `--version`) | Which version to copy; see the table below. Without it, the current version |
| `--from <tree>` | Copy another tree instead of the one you are on (`/decide new sql-v4 --from main --at #3`) |
| `--title <text>` | A human-readable description of the tree (at most 120 characters), shown in the pane and in `/decide tree`. Anything that does not fit in a name goes here |
| `--empty` | A blank tree: no events are copied, it holds only a `start` |
| `--stay` | Open it but do not switch: the project keeps recording into the original tree; switch later with `/decide use <name>` |

A name is 2–32 lowercase letters, digits and hyphens. If you write capitals, spaces or punctuation that turn into a valid name once replaced by hyphens, they are replaced automatically (`SQL v3` becomes `sql-v3`); `main` is taken; a name that cannot be made valid (all Chinese, say) is refused with a hint to put it in `--title`. A name that already exists, a tree that does not exist and a version that cannot be understood are each refused in one sentence, and nothing is written.

### Writing a version

A tree's history is its event files in file-name order (see [Data format](#data-format)), and **a version is simply the first N events**:

| Written as | Meaning |
|---|---|
| nothing, or `current`, `now`, `head`, `latest`, `当前`, `最新` | Everything recorded so far |
| `#17` | The first 17 events. `/decide log` numbers every event; `fork` markers take no number |
| `2026-10-08 17:44`, `10-08 17:44`, `10-08`, `17:44`, `10月8日 17:44` | Everything up to that time. Local time zone; a time given to the minute counts to the last instant of that minute, a date alone to the end of that day; without a year the current year is used (the previous one if that would be in the future), with only a time today is used (yesterday if that would be in the future) |
| `20261008T214400Z` | A UTC timestamp like the one at the start of event file names; the leading part is enough |
| `v22-adopted`, `build version` | The moment that node was recorded: a node id, or a piece of a title that matches exactly one node (several matches are refused and the candidates listed) |
| `node:current` | The same; use the `node:` prefix when a node's id happens to look like one of the forms above |

A time earlier than the tree's first event is refused, and the message says when that first event was; so is a `#N` beyond the number of events.

### How it is stored

- `main` still lives in `events/` and `tree.json` under `.claude/decisions/`, exactly as when there was only one tree. Other trees live in `.claude/decisions/trees/<name>/`, each with its own `events/` and `tree.json`. There is a single `config.json` for the whole project.
- Opening a tree means copying the event files before the base version **byte for byte, under the same file names** into the new tree's `events/`, and **finally** writing a `fork` event that records which tree and which event it was opened from. Keeping the file names keeps the order of the events in the new tree. The order of operations is deliberate: a tree counts as open only once its `fork` event exists; a copy interrupted halfway leaves a folder without a `fork` event, which is never switched to (`/decide tree` marks it "unfinished copy").
- Opening the same name again: if the files left behind all fall within what this run would copy, it carries on and finishes the job; if the folder holds files this run would not copy, it refuses and says how many. The mod never deletes files for you: look at that folder yourself and deal with it, or pick another name.
- You can open a tree from a tree that is itself a fork: the new tree carries just one `fork` event, recording its direct source.
- Everything that happens in the new tree (the model's tools, your commands, manual edits in the pane) is written only into the new tree; the original does not gain a single file.

### Who a switch affects

Which tree recording currently goes to is written in an optional key of `config.json`, `"tree": "<name>"` (without the key it is `main`). **There is one pointer for the whole project**, not one per session:

- When you run `/decide new` or `/decide use` in one session, every other session running in this project follows: at the latest on the next 5-second poll, with a notice ("Now recording in tree sql-v3 (the project switched to it)."). The session where you made the switch gets only the receipt, not this notice.
- The model's write and read tools and the write commands you type (`add`, `status`, `note`, `retract`, `import`, `new`, `use`) all read `config.json` before they act, so a switch another session has just made takes effect at once; there is no window in which this session still writes into the old tree. (A manual edit in the pane is written into the tree the pane is showing: it changes the node in front of you.)
- This includes unattended sessions (a long-running one on a remote server, say): once you switch, the decisions they record afterwards go into the new tree. If you do not want that, run `/decide pause` first, or open the tree with `--stay`.
- If `config.json` names a tree that does not exist on this machine (say `config.json` arrived through git before the event files did), the session stays on its current tree, says so once, and switches by itself when the event files arrive.
- If the same tree name was opened on two machines, git merges them into the same folder (the copied files have the same names and contents, so they do not conflict). Open trees on different machines under different names, or `git pull` first.

### The model and this feature

The model has `decision_new_tree` and `decision_use_tree`, and `decision_tree` can also list all trees and show event numbers (see [Tools for the model](#tools-for-the-model)). The tool descriptions say it opens or switches a tree only when you ask it to; it does not do so on its own. In a tree other than `main`, the system-prompt section carries one more line, `Current tree: sql-v3 (from main at #17 (10-08 17:44)). …`, so the model knows which tree it is recording into; the recent nodes listed below it are that tree's as well. When you switch trees the section is rewritten at once, without waiting for the next turn.

### While paused, or before recording starts

- While paused you can still open and switch trees (those are your own actions). The receipt adds "Recording is paused; /decide resume turns it back on." and later decisions are not recorded; the model's `decision_new_tree` and `decision_use_tree` are blocked like its other write tools.
- When the project is not recording yet there is nothing to copy, and the command asks you to run `/decide start` first.

### In the pane

The title row carries `[sql-v3]` (`main` has none). When the pane is tall enough (16 rows or more) there is also a line under the title saying where the tree was opened from, followed by your `--title`. In a narrow pane that line is truncated, in a short pane it is left out.

```
  Decision tree  demo  [sql-v3]               ● Recording   4 decisions
  from main at #4 (10-09 12:00) · SQL third try
  Mainline  Design v2 final

▎ ✓ Design v2 final
    ✗ Keep pool count at 32
    ✓ Gate: probe s1 passed
▌     ○ SQL plan B
  ─────────────────────────────────────────────────────────────────────
▾ SQL plan B
  ○ Planned   user   10-10

  ─────────────────────────────────────────────────────────────────────
  k: ↑  j: ↓  Enter expand  e: Edit  p: Pending  h: Hide rejected
  a: All
```

## The pane

![The pane: title row, mainline, tree with the selected row highlighted, details and key hints](docs/pane.png)

*An illustration drawn from the pane's own layout code with a sample tree. The fonts and colors are those of your terminal and your Claude Code theme.*

The same thing as text, as the layout really draws it (72 columns wide, English interface; the data is illustrative):

```
  Decision tree  demo         ● Recording   3 decisions   updated 12:00

  Mainline  Design v2 final
  ─────────────────────────────────────────────────────────────────────
  Now
    ZETA    gateway s0      ████████░░  3400/4000  ~23:50  warming up
    BETA-0  ablate_wide s0  █░░░░░░░░░   420/4000  ~09:10
    GAMMA                   idle
    Next  gate → probe s1 (~06:15)
    ! GAMMA idle

▌ ✓ Design v2 final
    ✗ Keep pool count at 32
    ✓ Gate: probe s1 passed
  ─────────────────────────────────────────────────────────────────────
▾ Design v2 final
  ✓ Adopted   user   10-08

  ─────────────────────────────────────────────────────────────────────
  k: ↑  j: ↓  Enter expand  e: Edit  p: Pending  h: Hide rejected
  a: All  s: Now
```

From top to bottom:

- **Title row**: the project name, whether it is recording, how many decisions the record holds and when it last changed. In a narrow pane the update time goes first, then the count. Outside `main` the row carries `[tree name]`, and a line under it says where the tree was opened from (see [Multiple trees](#multiple-trees)).
- **Mainline**: the decisions that make up the project's path, oldest first. The newest is in full strength; older ones are dim and cut short. In the tree below, the rows on the mainline have a thin line in the margin (`▎`, in the theme's `merged` color).
- **Now**, only when the project has a status command: its live data, see [The "Now" block and the status command](#the-now-block-and-the-status-command).
- **Tree**: one row per decision, a status symbol and a title, indented two columns for each level. A row says nothing else, so the tree stays easy to scan; `+2` at the end of a row counts children that are folded away. The selected row is a bar across the pane with `▌` in the margin.
- **Details** of the selected decision: its status, who decided it and when, the summary, then rationale, evidence, sources, what replaces what and notes, each under a label of its own.
- **Key hints** at the bottom; the number of warnings appears at their right end only when there are any.

In the Chinese interface the same labels read `现在`, `主线`, `采用` and `下一步`.

From 20 rows up, blank rows set the parts apart. A docked pane keeps the key hints on its last rows, so a short tree leaves blank rows above them (the examples here cut those short). When the window is too short, the "Now" block is dropped first, then the details are compressed and dropped, so that the tree keeps a few rows; the key hints at the bottom never give way (two lines at 12 rows or more, one line below that; when too narrow, the less common keys go first). A status command awaiting your approval is the exception: it takes priority over the details, which are folded away first when space runs short. If even the whole command plus its button does not fit, no button is drawn and the "Now" block shows only one line, `A status command awaits your OK; enlarge the pane to read it.`; the command and **Allow** appear once the pane is larger.

Status symbols and colors:

| status | English | Chinese | symbol | ASCII fallback | color |
|---|---|---|---|---|---|
| `adopted` | Adopted | 采用 | ✓ | `+` | green |
| `rejected` | Rejected | 否决 | ✗ | `x` | red |
| `no-diff` | No diff | 无差别 | = | `=` | gray |
| `in-progress` | In progress | 进行中 | ◐ | `~` | accent |
| `planned` | Planned | 计划 | ○ | `o` | accent |
| `proposed` | Proposed | 提议 | ◌ | `?` | accent, dim |
| `withdrawn` | Withdrawn | 撤回 | ⊘ | `/` | dim |
| `superseded` | Superseded | 被取代 | ⊘ | `/` | dim |
| `deferred` | Deferred | 暂缓 | ‖ | `"` | dim |

Decisions that are over or parked (rejected, withdrawn, superseded, deferred) are drawn dim, title and all.

◐ ○ ◌ ⊘ and the line and block characters (─ ▎ ▌ █ ░) have "ambiguous width" in Unicode, and some terminals draw them two columns wide. By default they are counted as one column (as Claude Code's own layout does). If your terminal draws them crooked, set `display.asciiGlyphs: true` in `config.json`, and the status symbols, rules, margin marks and progress bars switch to ASCII. For Ghostty see [the next section](#ghostty-and-other-terminals).

**Keyboard** (when the pane has the keyboard: `/tree`, or `ctrl+x` then `Tab`, hands the keyboard to the pane; Esc gives it back to the prompt):

| Key | Action |
|---|---|
| ↑ ↓ / `k` `j` / Tab | Move between rows |
| Enter | Select; press again to expand or collapse |
| `a` | Show everything |
| `p` | Pending only (planned, proposed, in progress) |
| `h` | Hide rejected and withdrawn |
| `s` | Show or hide the "Now" block |
| `e` | Edit the selected node: its status (one of nine) and a one-line summary; on submit an `update` event is written |
| Esc | Give the keyboard back to the prompt |

All truncation and wrapping is done by **display width** (CJK and fullwidth characters take two columns, combining marks zero, ambiguous-width characters one), using the number of columns the pane can actually draw.

## Ghostty and other terminals

It works in Ghostty. Three things to know.

**1. Width.** Every line in the pane is laid out by the mod itself, by "display width", before it is handed to Claude Code. Terminals disagree about the width of a small class of characters: an emoji followed by a variation selector (❤️), zero-width joiners (👨‍👩‍👧), skin-tone modifiers (👍🏽), flags (🇨🇳), keycaps (1️⃣), and emoji newer than the terminal's width table. Ghostty counts width by grapheme cluster by default (`grapheme-width-method = unicode`, with fairly recent Unicode data), Claude Code has a width table of its own, and tmux has yet another. When two of them count differently by one cell, that line wraps at the edge of the screen and pushes everything below it, the whole pane, out of place. So the **text the pane draws** goes through a filter first and becomes a form that all the algorithms count the same:

| Original | Drawn in the pane as |
|---|---|
| ❤️ ⚠️ (with a variation selector), 1️⃣ | ❤ ⚠ 1 (selector and keycap sign removed) |
| 👨‍👩‍👧 👩‍💻 (joiners) | 👨👩👧 👩💻 (split into single emoji) |
| 👍🏽 (skin tone) | 👍 |
| 🇨🇳 (flag) | `CN` (country code) |
| Emoji added after Unicode 12 (🫠 🥹 🪄 🛜 …) | `?` |
| Invisible characters (zero-width space, soft hyphen, direction marks, tag characters) and half-cut emoji | removed |

Han characters, fullwidth punctuation, Latin letters with combining marks (é), Hangul, and older emoji such as ✅ ❌ ⭐ 🚀 🔥 🟢 are not affected. **Only the way things are drawn changes**: `events/` and `tree.json` hold the original text, and the prompt given to the model and the output of the `decision_tree` tool are the original text too. Indic scripts and the Thai SARA AM, which are "placeholder combining marks", are not handled and may be off by one cell.

Setting `grapheme-width-method` to `unicode` (the default) or `legacy` makes no difference to the pane: after the filter both algorithms count the same.

**2. Glyphs.** The status symbols ✓ ✗ ◐ ○ ◌ ⊘ ‖, the progress bar █ ░, the rules ─ and the margin marks ▎ ▌ are all "ambiguous width" characters; Ghostty counts them as one column, the same as the mod. Ghostty draws box-drawing and block characters itself; the geometric shapes (◐ ○ ◌ ⊘) depend on the font, and when a glyph is missing Ghostty falls back to another font, which can make them look too large or too small. In that case pick one of two:

- set `display.asciiGlyphs: true` in `config.json`, and everything becomes ASCII;
- or point those code points at a monospace font that has them. In the Ghostty config:

  ```
  font-codepoint-map = U+25CB-U+25D1=DejaVu Sans Mono
  font-codepoint-map = U+2298=DejaVu Sans Mono
  ```

  The syntax is `codepoint=font name`; a codepoint is either a single one or a range `U+start-U+end`; use a font name that exists on your machine.

**3. ssh from Ghostty to a remote server.** Ghostty's `TERM` is `xterm-ghostty`, and most servers do not have its terminfo. The symptom is `claude` or `tmux` complaining `missing or unsuitable terminal: xterm-ghostty`, or wrong colors or keys. Three ways out (from the Ghostty documentation):

- let Ghostty handle it, by writing `shell-integration-features = ssh-env,ssh-terminfo` in the Ghostty config. `ssh-terminfo` installs the terminfo on a new machine when you ssh to it, and `ssh-env` forwards environment variables; when the install fails it falls back to `TERM=xterm-256color`. They wrap the `ssh` of your local interactive shell, so Ghostty's shell integration has to be enabled in that shell;
- install it by hand once: `infocmp -x xterm-ghostty | ssh your-server -- tic -x -`;
- or do not install it: in `~/.ssh/config` write `SetEnv TERM=xterm-256color` for that machine (OpenSSH 8.7 or newer; only for machines without the terminfo).

Inside tmux or screen the multiplexer counts the width once more; the filter above works there too.

## Tools for the model

The model sees the names as `mcp__decision-tree__<name>`.

| Tool | Visible | What it does |
|---|---|---|
| `decision_log_start` | while recording is off | Turn recording on for this project (`title`; optionally `rootTitle`, `statusArgv`) |
| `decision_record` | once on | Add a decision; returns the id and the node it hangs under |
| `decision_update` | once on | Change status, summary or rationale; append evidence and sources; mark what superseded it |
| `decision_note` | once on | Append a note to a node |
| `decision_tree` | once on | Read the tree. By default the mainline plus the 20 most recent nodes as compact text; with `id`, the details of that node; with `query`, a search by a piece of an id or title; `trees: true` lists all trees and where each came from; `log: N` gives the numbers of the last N events of the current tree (`#N` is the `at` of `decision_new_tree`). Used before recording, to find the right parent and avoid duplicates |
| `decision_new_tree` | once on | Open a new tree: `name`, optionally `at` (version), `from`, `empty`, `title`, `stay`, with the same meaning as in `/decide new`. **Called only when you explicitly ask** |
| `decision_use_tree` | once on | Switch to another tree of the project: `name`. Likewise only when you ask |

Every call: validate the input → write an event file → rebuild `tree.json` → update the interface → return a one-line receipt (for example `Recorded v22-adopted (under dbpool-adopted, Adopted)`; with Chinese input it reads "已记录 …"). Invalid input returns an explanation the model can correct itself from (a `deny`) and writes nothing.

The tool descriptions carry the recording rules:

- **Record**: what you decided explicitly (adopted, rejected, withdrawn, a rule changed, a next step set); conclusions that follow automatically from a rule agreed beforehand (a "gate": a rule lets a step through or skips it, `decidedBy: "gate"`); plans you have accepted (`planned`); things proposed but not decided yet (`proposed`).
- **Do not record**: ideas under discussion that you have not agreed to are never recorded as `adopted`; plain progress and logs are not recorded (that is the business of the "Now" block).
- Evidence takes key numbers and intervals; the run name goes in `evidence.run` and the report path in `evidence.source`. Status follows the result: `planned → in-progress → adopted / rejected`. When a new decision replaces an old one, set `supersededBy` on the old node and change its status to `superseded`. One matter, one node (the second seed of the same experiment is added evidence, not a new node). When unsure about the parent, call `decision_tree` first.

Once recording is on, the system prompt gets one more section (`scope: session`, within about 1,500 characters): the rules in short, the current mainline (ids and titles) and the 10 most recent nodes (id · status · title), so that most of the time the model can attach a node to the right parent without looking at the tree first. In a tree other than `main` there is also a line `Current tree: …` saying which tree it is recording into and where that tree was opened from.

## Data format

```
<project root>/.claude/decisions/
  config.json        project-level settings: title, start time, whether recording, which tree recording goes to, status command, display options
  events/*.json      main's event files: immutable, the only source of truth
  tree.json          main's derived snapshot, for external tools; can be rebuilt at any time
  trees/<name>/      other trees, each with its own events/ and tree.json (no such folder until a tree has been opened)
```

The **project root** is found in this order: the first directory, going up from the session's working directory, that contains `.claude/decisions/config.json` (so starting in a subdirectory still connects); otherwise `git rev-parse --show-toplevel`; otherwise the working directory.

### config.json

```json
{
  "v": 1,
  "title": "orders-api-rewrite",
  "startedAt": "2026-10-10T00:30:00-04:00",
  "recording": true,
  "status": {
    "argv": ["bash", "scripts/decision_status.sh"],
    "intervalSec": 30,
    "timeoutSec": 15
  },
  "display": { "asciiGlyphs": false, "autoOpen": true, "language": "auto" }
}
```

`status` can be left out (then there is no "Now" block); `intervalSec` takes 5–3600 and `timeoutSec` 1–120. `display.language` fixes the language when it is `"zh"` or `"en"`; `"auto"` follows what you type. `tree` can be left out too (it is not in the example above): it says which tree the whole project is recording into right now, and is `main` when absent; `/decide new` and `/decide use` change it, see [Multiple trees](#multiple-trees). A name that is not valid is treated as if the key were absent. When the mod changes this file it touches only the key it means to change; all other keys (including ones it does not recognize) are kept as they were, but the whole file is rewritten with 2-space indentation. This file should go into git.

### Event files

Every write creates a new file, and old files are never modified: `events/<ts>_<session>_<seq>.json`, where `ts` is the UTC time `YYYYMMDDTHHMMSSmmmZ`, `session` is the first 6 characters of the session id, and `seq` is a 4-digit sequence number within the process. **The lexicographic order of the file names is the order of the events**; a tie within the same millisecond is broken by session and seq. When writing, the time in the file name is the later of the local clock and the time of the newest event already read plus 1 millisecond. So even if this machine's clock is behind another's, the events it writes sort after the events it has already seen (a time more than a day later than the local clock is taken to be a clock error somewhere else and is not followed).

```ts
type DecisionEvent = {
  v: 1
  op: 'start' | 'add' | 'update' | 'note' | 'move' | 'retract' | 'fork'
  id?: string                  // target node (not on start or fork)
  ts: string                   // ISO 8601, with a time zone
  session: string
  actor: 'user' | 'model' | 'gate' | 'import'
  node?: NodeFields            // add: the full fields
  patch?: Partial<NodeFields> & {
    addEvidence?: Evidence[]   // appended, never overwritten
    addSources?: string[]
  }                            // update
  text?: string                // note: the note; fork: the tree's description (--title)
  parent?: string | null       // move: where to re-attach
  reason?: string              // retract: why this record is taken back
  base?: {                     // fork: where this tree was opened from
    tree: string               //   name of the source tree
    at: string | null          //   file name of the last event copied; null for a blank tree
    count: number              //   how many events were copied; 0 for a blank tree
  }
}

type NodeFields = {
  title: string                // one line, about 40 columns at most in the interface
  parent: string | null        // which decision it hangs under; null is a root
  status: 'adopted' | 'rejected' | 'no-diff' | 'in-progress' | 'planned'
        | 'proposed' | 'withdrawn' | 'superseded' | 'deferred'
  kind: 'decision' | 'protocol' | 'design' | 'milestone'
  trunk?: boolean              // a decision on the mainline
  summary?: string             // one-line conclusion
  rationale?: string           // the reasons; may be several lines
  evidence?: Evidence[]
  sources?: string[]           // paths of reports and documents, relative to the project root
  decidedBy?: 'user' | 'gate' | 'model'
  decidedAt?: string           // when the decision took effect; may be earlier than when it was recorded
  supersededBy?: string        // which decision replaced it
  tags?: string[]
}

type Evidence = {
  label: string                // e.g. "P99 after warm-up, within suite"
  value?: string               // e.g. "−12.6%"
  ci?: string                  // e.g. "[−15.1, −10.4]"
  run?: string                 // e.g. "v22_db_pool_cap s0"
  note?: string
  source?: string              // path of the report
}
```

**External scripts may also write event files directly** (a script at a gate checkpoint writing an `add` or `update` with `actor: "gate"`, say): create a new file with the file name and JSON format above, and never modify an existing file. Every open session picks it up within 5 seconds and updates its interface. The safest way is to write a temporary file and `mv` it to its final name; if a half-written file is ever read, the mod reads it a few more times before it records a warning.

A minimal example:

```json
{
  "v": 1,
  "op": "add",
  "id": "probe-s1-gate",
  "ts": "2026-10-10T06:15:00-04:00",
  "session": "gate01",
  "actor": "gate",
  "node": {
    "title": "Gate: probe s1 passed",
    "parent": "design-v2",
    "status": "adopted",
    "kind": "decision",
    "decidedBy": "gate",
    "evidence": [{ "label": "val loss", "value": "0.412", "run": "ablate_wide s1" }]
  }
}
```

### Replay rules

- All events are read in file-name order.
- `start`: marks the log as on (only the first one counts).
- `add`: creates a node; if the id already exists, the event is ignored and one warning is counted.
- `update`: overwrites field by field; `addEvidence` and `addSources` append and de-duplicate.
- `move`: changes the parent; one that would make a cycle is refused and counted as a warning.
- `retract`: marks the node as retracted; it is hidden by default and can be shown in the filter.
- `fork`: only the first one counts (a tree is opened once). It is not a decision: it does not appear in the tree and takes no version number; it only records where this tree came from (`base`, the description, who opened it, and when). A `base` that is not valid counts as one warning and is treated as absent.
- `note`: appended to the node's list of notes.
- A file that fails to parse, has an unknown version or has an unknown op is skipped and counted as a warning; the number of warnings is shown at the right end of the key hints (only when there are any).
- Conflicts: when two sessions change the same field, the one whose file name sorts later wins.

### Node ids

The readable slug given by the model is preferred (kebab-case, for example `v22-adopted`); it has to match `^[a-z0-9][a-z0-9-]{2,47}$` and be unique, and on a duplicate the suffix `-2`, `-3` is added. With none given, one is made from the title, and when the title has no usable characters (all Chinese, say) `d-<base36 timestamp>` is used. Commands and tools that refer to a node also accept a piece of its title that matches exactly one node.

### tree.json

Rebuilt by this session on every event it writes: `{ generatedAt, project, tree, fork?, nodes, warnings }`. `tree` says which tree the snapshot belongs to (`main`'s is at `.claude/decisions/tree.json`, the others at `trees/<name>/tree.json`); `fork` is present only for trees that were opened from another (the event's `base` plus the description, who opened it, and when); the nodes are the full replayed fields (plus derived fields such as `createdAt`, `createdBy`, `updatedAt`, `notes` and `addedBy`). It is a derived product and is **never read as a source of truth**; it is there for external tools (a web view of the experiment tree, say). When another process (or a script) only appends event files, `tree.json` is not updated until some session next writes.

### Size and git

An event file is usually under 2 KB, and hundreds or thousands of them are no problem; reading is incremental (only newly appeared file names are read). `.claude/decisions/` should go into git, as plain text, not through LFS. Every event is a separate new file, so merges in `events/` do not conflict. The only two files that can conflict are the ones rewritten whole: `config.json` (only if both sides changed it, for example both switched trees) and `tree.json` (derived; keep either side on a conflict, the next write rebuilds it). Opening a tree copies all the event files before its base; each file is tiny, so the copying itself is no burden.

### Importing seed data

`/decide import <file>` reads a JSON file in the project: an array of nodes (`{ "nodes": [...] }` is accepted too), each node being `NodeFields` plus an `id`, and writes them as `add` events with `actor: "import"`. `parent` is an id in the file (it may point at a node further down the file) or a node that is already in the tree. Nodes that are not valid are skipped, and the receipt says how many were imported and how many skipped.

## The "Now" block and the status command

Set `status.argv` in `config.json` and the mod runs it under the project root, reads the JSON on stdout, refreshes it every `intervalSec` seconds (30 by default), and draws it above the tree.

### Output contract

```json
{
  "updatedAt": "2026-10-10T00:20:00-04:00",
  "lanes": [
    { "name": "ZETA",   "run": "gateway s0",     "state": "running", "step": 3400, "total": 4000, "eta": "23:50", "note": "warming up" },
    { "name": "BETA-0", "run": "ablate_wide s0", "state": "running", "step": 420,  "total": 4000, "eta": "09:10" }
  ],
  "next": [ { "text": "gate → probe s1", "eta": "06:15" } ],
  "warnings": [ "GAMMA idle" ]
}
```

- `state` is one of `running`, `queued`, `done`, `failed`, `idle`; `step`/`total`, `eta`, `note` and `run` can all be left out.
- The progress bar is 10 cells wide, drawn with `█` and `░` (`#` and `.` in ASCII mode).
- When the command fails (a non-zero exit code, a timeout, output that is not valid JSON), the last good data is kept and marked "stale N min", and the first line of the error is shown below it.

### Security: it asks you the first time

The status command is an arbitrary shell command. Before it runs for the first time in a project, the "Now" block shows the argv and an **Allow** button, and it runs only after you confirm. The confirmation is recorded as a hash of "project root + argv" in `$.store` (each machine has its own; it does not go into git). Changing the argv asks again. So a project that someone else cloned never runs a command you have not seen.

- **What is approved is the command line, not what the script contains.** After `["bash", "scripts/decision_status.sh"]` is approved, a later change to the script file (say `git pull` brings in someone's new version) does not ask again; it is the same trust as running that script in your shell.
- **What you see is what will run.** The pane shows the argv word by word. A word with spaces or shell-special characters is put in single quotes (a leading `~` as in `~/x.sh` too, because the shell would expand it), and control characters, invisible characters and characters the pane would draw as something else are written in the form `<U+200B>`. When the command is too long for the pane, **Allow** is not offered (see [The pane](#the-pane)).
- **At the moment you press Allow** the mod reads `config.json` once more: if the command has changed in the meantime, nothing is approved and you are asked to look at the new command first. Before it runs there is one more check, that what the pane shows, what `config.json` holds and what you approved are identical letter for letter. If the command in `config.json` is replaced while a command is running, that command's result is thrown away and does not cover the new command that is waiting for approval.

The command runs only while the pane is **showing** (it does not run when the pane is not shown, so as not to occupy the machine for nothing). `/tree` and the moment you press Allow run it once right away, and after that it follows `intervalSec`. The command is started directly from the argv (not through a shell), so if you need pipes or redirection, wrap them in a script of your own, for example `["bash", "scripts/decision_status.sh"]`.

## Language

- Technical terms (run names, `db_pool_cap`, `P99`, `seed`, command names …) always stay in English.
- The fixed text of the interface and the receipts of commands and tools follow **your most recent input**: if it contains CJK characters it is Chinese; if it has at least 6 Latin letters and no Chinese it is English; input that starts with `/` and input that is too short do not change the language. Only your own words count: a prompt that comes from a notification, a scheduled task, another session or another plugin (the task `/decide init` hands Claude included) says nothing about the language you write in. The result is stored per project in `$.store`; the next time the project is opened the last one is used first, and with none it is English.
- When `display.language` in `config.json` is `"zh"` or `"en"` the language is fixed and does not follow your input (`/decide lang zh|en|auto`).
- The titles, summaries and rationales the model writes into decisions follow the language you write in; **recorded node content is never translated**.
- The system-prompt section the model sees is in English (the model reads it), and it states the rule above.

## Behavior to know about

- **Prompt cache.** The system-prompt section changes with the decisions, and a change in a session-level section invalidates the cache from that point on. So the mod refreshes the section only **at the start of each turn**, and it does not change within a turn. A decision another session has just written shows up in this session's briefing to the model only at the next turn (the pane updates within 5 seconds). The exceptions are the things that change the whole section: turning recording on, pausing, resuming and switching trees rewrite it at once.
- **Several sessions.** Sessions do not talk to each other directly, only through the event files on disk and `config.json`. Each session only creates new files for events and never modifies old ones, so concurrent use is safe. Interface state (selection, expansion, filters) belongs to each session; which tree recording goes to is shared by the whole project (see [Multiple trees](#multiple-trees)).
- **`/clear` and resume.** `/clear` wipes the session's interface state values, and the mod restores them at the next touch (the pane does not turn into "not recording"); the 5-second poll carries on across `/clear` and resume.
- **Narrow terminals.** A pane you open yourself with `/tree` docks on the right from 110 columns; narrower, it is drawn in a frame above the prompt, where space is small: the tree takes priority, and the "Now" block and the details get what is left. To see everything, widen the terminal, or ask the model to call `decision_tree` for the text version. When the screen does not draw a pane at all (an interface that does not support panes, say), `/tree` returns the tree as text.
- **Mobile** (the `mobile` surface) has no text field and no dropdown, so the pane is read-only there: you can see the tree but cannot edit it.
- **After recording is on**, `decision_log_start` stays in the tool list of sessions that were already running (a registered tool cannot be taken back); calling it again only answers "already on". A new session in a project that is already on sees only the other six tools.
- **Importing twice.** Running `/decide import` on the same file again does not duplicate anything: nodes whose id and title are already in the tree are left as they are and the receipt says how many were already there; only the nodes new to the file are added.
- **A stuck disk.** The mod's reads and writes (tool calls, commands, the 5-second poll) are queued and done one after another. An operation that gets no answer for 30 seconds (a network disk that has stalled, say) is given up on. That call gets an explanation ("no answer after 30 s (the disk or a command is not responding). The record may or may not have been changed; call decision_tree to check before trying again."), and what is queued behind it goes on as usual. Opening a tree copies many files, so it gets 120 seconds. When the events folder cannot be read, the pane keeps what it last read and shows one notice, and one more when it can be read again.
- **`config.json` temporarily unreadable** (a network disk, or the file being replaced). One failed read does not change the known state, and recording carries on as usual; the file counts as gone only if two 5-second polls in a row cannot find it, so the moment of absence caused by `git checkout` or an editor's save does not stop recording. Pause, resume, changing the language and changing auto-open need the file as it currently is; when it cannot be read they refuse and say so, and write nothing.
- **ASCII mode** (`asciiGlyphs: true`) changes only what the mod draws itself (status symbols, rules, margin marks, progress bars); Claude Code's own borders, close button and so on are not affected.
- **Not verified**: Windows terminals; Claude Code versions other than 2.1.296 (see [Implementation notes and assumptions](#implementation-notes-and-assumptions)).

## Development and tests

```bash
claude plugin validate  <folder>     # manifests, marketplace, hooks module
tsc -p <folder>                      # type-check (.claude-plugin/types is generated once the mod has been loaded)
claude plugin test      <folder>     # 372 tests: unit, pane (terminal/desktop/vscode/mobile surfaces), engine-level wiring
```

Code layout:

```
hooks/register.tsx     registration only: session.start / session.end / tool.call / command.run /
                       turn.start / prompt.compose / prompt.submit / ui.render / ui.focus
lib/project.ts         finding the project root     lib/events.ts   event file names, validation, ids, tree names
lib/journal.ts         incremental reads and writes of events (one Journal per tree)   lib/replay.ts   replaying into a tree
lib/config.ts          reading and partly modifying config.json   lib/io.ts   the file-access interface
lib/tree.ts            ordering, filtering, the mainline   lib/ops.ts   one write = validation + events (shared by tools and
                       commands); opening and switching trees, listing them and showing the log live here too
lib/versions.ts        how a "version" is written and parsed (#N, times, nodes)
lib/tools.ts           the tools' schemas   lib/commands.ts   parsing of /decide
lib/prompt.ts          the system-prompt section   lib/init.ts   the task /decide init hands the model
lib/status.ts          parsing the status command's output, staleness, showing the command at approval
lib/width.ts spans.ts glyphs.ts layout.ts  display width, truncation and wrapping, symbols, the pane's layout (pure functions)
lib/i18n.ts            Chinese and English text
lib/view.tsx           draws the layout as elements (Box/Text/Button/Select/Input)
lib/runtime.ts         ties the above together: polling, state, commands, tools
lib/port.ts state.ts   Port: the minimal interface of `$` that the runtime needs; initial values of `$.state`
types/index.d.ts       the PluginState contract
tests/                 an in-memory FakeEngine plus engine-level tests
```

Why there is a `Port`: the engine does not let `$` cross an import boundary (`$` can only flow into functions in the same file), so `register.tsx` wraps the `$` methods it uses into a plain object, the `Port`, and `lib/` knows only the `Port`. The benefit is that `lib/` can be tested in full on an in-memory fake engine.

## Using it in your own project

A typical way to bring a project in:

1. **Turn it on.** In the project's Claude Code run `/decide init <project name>` and Claude finds the starting point in the project itself ([Setting up from the project itself](#setting-up-from-the-project-itself)); or say "start recording decisions from now", or use `/decide start <project name>`, for an empty tree.
2. **Seed data (optional).** Put the decisions already made into a node array of their own (format in [Importing seed data](#importing-seed-data), each node with an `id`), keep it in the project (say `docs/decision_seed.json`), and import it with `/decide import docs/decision_seed.json`.
3. **A status command (optional).** Write a script (say `scripts/decision_status.sh`) that reads your job queue, the step counts in your logs and so on, and prints JSON to stdout following the [output contract](#output-contract) above; you can ask Claude Code to write it for you. Then add to `config.json`:

   ```json
   "status": { "argv": ["bash", "scripts/decision_status.sh"], "intervalSec": 30, "timeoutSec": 15 }
   ```

   or have the model pass `statusArgv` when it turns recording on. Press **Allow** in the pane the first time it shows.
4. `git add .claude/decisions` and commit.
5. Later, to try another line without messing up the record: `/decide log` shows the event numbers, `/decide new <name> --at #17 --title "description"` opens a new tree and keeps recording there, and `/decide use main` switches back at any time, see [Multiple trees](#multiple-trees). A reminder: a switch applies to the **whole project**, so unattended sessions follow it too and record into the new tree. To let them keep recording into the original, open the tree with `--stay`, and run `/decide use <name>` once they are idle.

## Implementation notes and assumptions

The original design brief (numbers like `spec 9.2` in code comments are its section numbers; the brief itself is not in this repository) is implemented point by point. These are the places where it was silent, or where the implementation made a trade-off:

- **API version**: written for 2.1.296; after changing versions, run `validate` and `test` first (see [Prerequisites](#prerequisites)).
- **When the prompt refreshes**: once at the start of each turn rather than on every request (see above; it protects the prompt cache).
- **The status command runs only while the pane is showing.**
- **The "mainline"** is the nodes with `trunk: true`, listed in tree order (titles truncated).
- **While paused**, only the model's write tools are blocked; your own commands and pane edits work as usual.
- **Slash commands** (input that starts with `/`) take no part in language detection, and neither do prompts that are not the person's own (notifications, scheduled tasks, other sessions, other plugins).
- **`/decide init` hands its task over with `$.prompt.submit`**, as the person's own words (`asUser`). The engine checks that call and refuses it from inside a `command.run` hook (the hook holds the turn the prompt would wait for) and when the text begins with `/` (it would run as a command), so the task is worded not to begin with one and is submitted 250 ms after the command is done; a refusal is tried again 1 s and then 3 s later, and told in a toast if it still fails or if another plugin's hook drops the prompt. The call answers when the turn it starts begins, so nothing waits for it. The task is stateless: its first step reads the tree and stops if it already has decisions, which also covers running `/decide init` twice in a row.
- **Extras**: the `decision_tree` tool supports `id` for details; `/decide lang` and `/decide autoopen`; `/decide import` also accepts `{ "nodes": [...] }`; `k`/`j` also move up and down in the key hints; the selected row is a highlighted bar with `▌` in the margin.
- **Node ids**: when neither the model nor the command gives an id, a readable slug is made from the title first (`Use SQLite for cache` → `use-sqlite-for-cache`), and `d-<base36 timestamp>` is used only when the title has no usable characters (all Chinese, say); on a duplicate `-2`, `-3` is added. That makes `/decide status <id> …` easier to type by hand.
- **Event sequence numbers** start from `0000` in each process; before writing a file the mod checks whether a file of the same name exists, and if it does the sequence number goes up by one.
- **Multiple trees were added beyond the original design.** The trade-offs:
  - a "version" is understood as a **point on a tree's event history** (the current one, the Nth event, a point in time, the moment a node was recorded), not a tagged snapshot;
  - opening a tree copies the event files and then writes a `fork` event (like branching in git), rather than adding a "belongs to which tree" field to nodes; the original gains no files;
  - "which tree is being recorded to" is a **single pointer for the whole project** in `config.json` (all sessions switch together, unattended ones too), not one per session; a pointer per session is left as a later option;
  - a `fork` event is not copied when a tree is opened, so a tree opened from a fork carries just one `fork`, recording its direct source;
  - the number of events actually in a tree is not checked against `fork.count`: when git brings only some of the files, the tree is short a few nodes and nothing reports an error (the `update` and `note` events that refer to those nodes later are counted as warnings).
- **Ghostty**: the text the pane draws goes through a filter (emoji sequences, new emoji, invisible characters), which changes only how it is drawn; what is stored and what the model gets stays the original text. See [Ghostty and other terminals](#ghostty-and-other-terminals).
- **`display.autoOpen` lives in `config.json`** (in the original design user preferences were to live in `$.store`, but the `config.json` example also had it). That way a project behaves the same on every machine, and `/decide autoopen` changes it directly. **The default filter is not saved**: each session opens with the default view, and `a`/`p`/`h` apply to that session only.
- **Event timestamps have a floor**: when writing, the later of the local clock and the newest event read plus 1 millisecond is used, see [Data format](#data-format). In trees from several machines, or copied ones, events written by the machine with the slower clock still do not sort before events it has already seen.
- **Approving the status command covers only the command line**, not the script's contents, see [The "Now" block and the status command](#the-now-block-and-the-status-command).

## Authors

- [Xiaowen Zhang](https://github.com/xwzhang98): author and maintainer.
- Built together with [Claude](https://claude.com/claude-code) (Anthropic) in Claude Code sessions.

## License

[MIT](LICENSE) © 2026 Xiaowen Zhang
