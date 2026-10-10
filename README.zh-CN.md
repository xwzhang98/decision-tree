# decision-tree

[English](README.md) | **简体中文**

一个通用的 Claude Code mod：把一个项目里做过的决定记成一棵树，显示在终端界面右侧停靠的 pane 里。

- 决定由 Claude 通过 mod 注册的工具自动记录，你可以用命令或在 pane 里手动改。
- 数据放在项目文件夹里（`.claude/decisions/`），任何在该项目里启动的 session 读同一份、接着往下记；用 git 同步，不同机器上的树也同步。
- 一个项目可以有多棵 tree：从当前版本，或指定的某个版本，新开一棵接着往下记（像 git 开分支），原来那棵不动，随时切回去，见[多棵 tree](#多棵-tree)。
- 树上方有"现在"一栏：由项目自己配置的状态命令（输出 JSON）每 30 秒刷新，显示长任务的进度、预计时间和下一个关口。
- 不含任何项目名、路径、机器名；项目相关的东西都在项目自己的 `config.json` 里。
- 界面文字和回执跟随你输入的语言（有中文就中文，纯英文就英文），技术名词始终英文。

**快速开始**

```
/plugin install decision-tree --marketplace xwzhang98/decision-tree
```

然后在任何项目里运行 `/decide init`：Claude 会浏览项目、记下它的起点，pane 随之填起来（用 `/tree` 打开）。只想要一棵空树的话，对 Claude 说"从现在开始记录决定"，或运行 `/decide start`。详见[安装](#安装)和[开始使用](#开始使用)。

## 目录

1. [前提](#前提)
2. [安装](#安装)
3. [开始使用](#开始使用)
4. [命令](#命令)
5. [多棵 tree](#多棵-tree)
6. [界面](#界面)
7. [Ghostty 和其他终端](#ghostty-和其他终端)
8. [给模型的工具](#给模型的工具)
9. [数据格式](#数据格式)
10. ["现在"一栏和状态命令](#现在一栏和状态命令)
11. [语言](#语言)
12. [需要知道的行为](#需要知道的行为)
13. [开发和测试](#开发和测试)
14. [接入你自己的项目](#接入你自己的项目)
15. [实现取舍与假设](#实现取舍与假设)
16. [作者](#作者)
17. [License](#license)

## 前提

- 按 Claude Code **2.1.296** 的 mod API 写成（`claude plugin validate`、`tsc -p`、`claude plugin test` 都在这一版上通过）。mod API 每个版本都会变；换版本后先跑一遍 validate 和 test，见[开发和测试](#开发和测试)。
- 终端用 fullscreen 布局时，pane 停靠在右侧，和 diff 面板以 tab 并存。宽度规则是引擎的：项目已开启时 mod **主动**打开 pane，终端要 ≥ 144 列才画出来（你用 `/tree` 打开过一次之后 110 列就够），更窄时先等着，终端拉宽后自动出现；你自己用 `/tree`、`/decide` 打开的，≥ 110 列停靠在右侧，更窄时画在输入框上方（见[需要知道的行为](#需要知道的行为)）。
- 不依赖网络、不依赖任何外部程序；唯一会跑的外部命令是 `git rev-parse` / `git check-ignore`（找项目根、检查 `.gitignore`），以及你自己批准的状态命令。

## 安装

### 从 GitHub 装

```
/plugin install decision-tree --marketplace xwzhang98/decision-tree
```

依次是：`Add marketplace?` 按 `y`；选 **Install for you (user scope)**，回车。出现 `Installed decision-tree. Plugin is now active.` 就装好了：当前 session 立刻生效，以后在这台机器上启动的每个 session 都会加载。

不在交互界面里也可以用命令行：

```bash
claude plugin marketplace add xwzhang98/decision-tree
claude plugin install decision-tree@decision-tree --scope user
```

想发布你自己的一份：把这个文件夹作为仓库根目录推上去（`.claude-plugin/marketplace.json` 已经写好），然后用 `/plugin install decision-tree --marketplace <owner>/<repo>`。

### 装到远程服务器（不打断正在跑的 session）

远程服务器上的 session 可能正带着无人值守的长任务队列。**安装和调试都不要重启它们**：另开一个 Claude Code session 来装和试，其他正在跑的 session 不受影响（它们不会加载这个 mod，直到你下次重启它们）。

1. 把整个文件夹拷到服务器上，例如 `~/mods/decision-tree`：

   ```bash
   rsync -a --exclude '.claude-plugin/types' decision-tree/ server:~/mods/decision-tree/
   ```

   （服务器能访问 GitHub 的话，可以不拷文件，直接在那个新 session 里用上面的 GitHub 方式安装。）

2. 在那个新开的 Claude Code session 里输入：

   ```
   /plugin install decision-tree --marketplace ~/mods/decision-tree
   ```

   依次是：`Add marketplace?` 按 `y`；选 **Install for you (user scope)**，回车。出现 `Installed decision-tree. Plugin is now active.` 就装好了：当前 session 立刻生效，以后在这台机器上启动的每个 session 都会加载。

3. 以后改代码：直接编辑 `~/mods/decision-tree`，然后在 session 里 `/reload-plugins`。

不在交互界面里也可以用命令行：

```bash
claude plugin marketplace add ~/mods/decision-tree
claude plugin install decision-tree@decision-tree --scope user
```

### 只试一试，不安装

```bash
claude --plugin-dir ~/mods/decision-tree
```

只对这一个 session 生效，改文件后会自动重新加载。

## 开始使用

一个项目默认**不记录**：没有 `.claude/decisions/config.json` 时 mod 不写任何文件，system prompt 里只多一行（"如果用户要求开始记录决定，调用 decision_log_start"），模型只看得到 `decision_log_start` 这一个工具。

开启记录有三种方式：

- 运行 `/decide init [标题]`：开启记录，**并且**让 Claude 浏览项目、记下起点，见[从项目本身建立起点](#从项目本身建立起点)；
- 在 prompt 里说"从现在开始记录决定"（英文 "start recording decisions from now" 也行），模型会调用 `decision_log_start`；
- 或者自己运行 `/decide start [标题]`。

后两种得到的是一棵空树。

开启后会：写 `config.json` 和一条 `start` 事件、注册其余六个工具（`decision_record`、`decision_update`、`decision_note`、`decision_tree`、`decision_new_tree`、`decision_use_tree`）、把 system prompt 里那一段换成完整版、由发起开启的这个 session 打开 pane（你用 `/decide start` 开启时，pane 还会拿到键盘，用 `/decide init` 则不会，因为 Claude 马上就开始干活；够宽才会画出来，见[前提](#前提)）。其他已经在这个项目里运行的 session 在 5 秒内会发现 `config.json` 出现，同样切到开启状态；它们的终端是 fullscreen 布局、且 `display.autoOpen` 为真时，也会各自打开一次 pane。

暂停和恢复：`/decide pause`、`/decide resume`。暂停期间模型的写工具返回"已暂停"，system prompt 那一段只剩一行"记录已暂停"；你自己用命令和 pane 手动改仍然可用。

如果项目的 `.gitignore` 忽略了 `.claude/`，开启时会提示"这些文件不会进 git"。mod **不会**改 `.gitignore`。git 不能在被忽略的目录里再放行子路径，要让 `decisions/` 进 git，把 `.claude/` 改成：

```
.claude/*
!.claude/decisions/
```

### 从项目本身建立起点

`/decide init [标题]` 之于这个 mod，就像 `/init` 之于 Claude Code：不从一棵空树开始，而是让 Claude 先看一遍项目，把项目现在的位置记下来。

```
已开始记录 orders-api 的决定（数据在 .claude/decisions/）
已请 Claude 浏览项目并记下起点；记录会陆续出现在 pane 里。
```

1. 记录还没开启时，mod 先开启它（和 `/decide start` 一样，只是 pane 不拿键盘）。
2. 稍后它把一个任务交给 Claude，就像你自己打字发出的一样：看 README 和 docs、笔记、`CLAUDE.md` / `AGENTS.md`、决定记录（`docs/adr`、`DECISIONS.md`）、changelog、最近 30 个 commit 和 tag、主要的配置和清单文件、代码的目录结构。只是快速看一遍，大约十来次读取。
3. Claude 用 `decision_record` 记下**起点**：主线的根（milestone，已采用），说明这个项目是什么、现在到哪了，用到的文件作为 `sources`。
4. 然后在它下面，最多再记七条项目里已经明确做出的决定：文件里写明已定或在用的记 `adopted`，写明被放弃的备选记 `rejected`，列为下一步或仍待定的记 `planned` 或 `proposed`。每条都带来源；commit 或文档给出了日期的，带 `decidedAt`。不编造：文件里看不出来的就不记。
5. 最后用两三句话说明记了什么、哪些看不出来。

留下来的样子大致是这样（虚构项目的示例，Claude 可能会记成这样）：

```
决策树 · orders-api                       记录中 · 6 个决定 · 12:00 更新
────────────────────────────────────────────────────────────────────────
主线  订单 API：v1 已上线
────────────────────────────────────────────────────────────────────────
❯ ✓ 订单 API：v1 已上线                                            03-14
  ├ ✓ 存储用 PostgreSQL                                            01-20
  ├ ✗ 存储用 MongoDB                                               01-20
  ├ ✓ 对外用 REST，不用 GraphQL                                    02-03
  ├ ○ 订单处理改为异步 worker                                       计划
  └ ◌ 在网关做限流                                                  提议
────────────────────────────────────────────────────────────────────────
▾ 订单 API：v1 已上线                             ✓ 采用 · model · 03-14
  基于 PostgreSQL 的 REST 服务，3 月上线
  来源  README.md  CHANGELOG.md
────────────────────────────────────────────────────────────────────────
k: ↑  j: ↓  Enter 展开  e: 编辑  p: 只看待定  h: 隐藏否决         警告 0
a: 全部
```

它不改你项目里的任何文件（`.claude/decisions/` 里的记录除外），不运行项目的代码，不启动任务，也会跳过 `.env` 这类机密文件。它只通过普通的 `decision_record` 工具写入，所以记下的每一条都和别的节点一样：可以在 pane 里编辑，用 `/decide status` 改正，或用 `/decide retract` 撤掉。它是对模型的一个请求，不是一个程序：记下什么取决于项目文件里写了什么、模型怎么读，所以请看一眼结果。读取项目走你 Claude Code 设置里通常的权限提示。

`/decide init` 只给**空**树建起点。树里已经有决定时，它会说一声然后什么都不做（想在空树里跑，用 `/decide new <名字> --empty` 开一棵）；记录暂停时，它会请你先 `/decide resume`。这个任务会在 session 空下来之后自己开一个 turn，所以 Claude 正忙时，它要等当前 turn 结束。记录用的语言：`display.language` 固定了就用它；`auto` 时，你打过中文就写中文，否则用你写的语言（Claude 看不出来时用英文）。任务的措辞在 `lib/init.ts`。

## 命令

| 命令 | 作用 |
|---|---|
| `/tree` | 打开或切到 pane，并让 pane 拿到键盘。屏幕放不下 pane 时，把树以文本返回 |
| `/decide init [标题]` | 开启记录，**并且**让 Claude 浏览项目、记下起点，见[从项目本身建立起点](#从项目本身建立起点) |
| `/decide start [标题]` | 手动开启，得到一棵空树 |
| `/decide pause`、`/decide resume` | 暂停、恢复 |
| `/decide status <id> <状态>` | 改状态，例：`/decide status v22-adopted adopted`。状态可以写 id、英文名或中文名（`采用`、`否决`、`进行中`…） |
| `/decide note <id> <文字>` | 加备注 |
| `/decide add <标题> --parent <id> [--status planned]` | 手动新增。另有 `--kind decision\|protocol\|design\|milestone`、`--id <slug>`、`--trunk` |
| `/decide retract <id> <原因>` | 撤掉一条记错的记录（和"决定被撤回"`withdrawn` 不同） |
| `/decide import <文件>` | 导入一批节点，见[种子数据](#导入种子数据) |
| `/decide new <名字> [--at <版本>] [--from <tree>] [--title <文字>] [--empty] [--stay]` | 新开一棵 tree：复制当前版本（或 `--at` 指定的版本）起步，并让项目切到它，见[多棵 tree](#多棵-tree) |
| `/decide use <名字>` | 切到另一棵 tree（`main` 是第一棵） |
| `/decide tree` | 列出这个项目的所有 tree、各自从哪里开出来、有多大 |
| `/decide log [N]` | 当前 tree 最近 N 个事件（默认 12，最多 60），带编号：`#N` 就是可以用作 `--at` 的版本 |
| `/decide`（不带参数） | 打开 pane，并进入当前选中节点的编辑 |
| `/decide lang zh\|en\|auto` | 固定界面语言，或恢复自动（写进 `config.json`） |
| `/decide autoopen on\|off` | 开启后是否自动打开 pane |

`<id>` 的位置也接受标题里唯一匹配的一段文字；有多个匹配时命令会列出候选 id。手动操作写出的事件 `actor` 是 `"user"`。命令返回一行回执。tree 的三个命令另有长写法 `/decide tree new|use|log`（`list` 同 `/decide tree`），`new` 也可以写 `fork`、`新建`、`新开`，`use` 也可以写 `switch`、`切换`。

## 多棵 tree

一个项目默认只有一棵 tree，叫 `main`。想换一条思路试（比如"前提不变，换第三种做法"），又不想弄乱原来的记录，就新开一棵：它从某个**版本**的 tree 复制起步，之后新记的决定只进新 tree，原来的 tree 保持原样，随时可以切回去。和 git 开分支是同一个想法。

```
/decide log                                  # 先看事件编号：#17 是第 17 个事件
/decide new sql-v3                           # 以当前版本为 base
/decide new sql-v3 --at #17                  # 以第 17 个事件之后的状态为 base
/decide new sql-v3 --at v22-adopted          # 以记下 v22-adopted 那一刻的状态为 base
/decide new sql-v3 --at "2026-10-08 17:44"   # 以那个时间点的状态为 base
/decide new sql-v3 --title "SQL 第三版"      # 名字只能是字母、数字、连字符；中文说明放 --title
/decide tree                                 # 列出所有 tree
/decide use main                             # 切回 main
```

新开之后项目立刻切到新 tree：你、模型、其他 session 之后记的决定都进新 tree。下面是一个真实跑出来的小例子（数据是示意）：`main` 里有 `start` 加四个节点，用 `/decide new sql-v3 --at #4 --title "SQL 第三版"` 以前四个事件为 base 新开一棵，回执是

```
已新开 tree「sql-v3」，基于 main 的 #4（10-09 12:00）：3 个节点。现在记录到这里。
```

在新 tree 里又记了一个节点（`sql-plan-b`）之后，`/decide tree` 列出所有 tree（带标记的是正在记录的；下面是文本本身，行首是 `*`。命令的回执在对话里会被当成 markdown，行首的 `*` 画成 `-`，意思一样；模型的 `decision_tree` 工具拿到的就是 `*`），`/decide log` 看当前 tree 的事件：

```
这个项目的 tree（正在记录到「sql-v3」）：
  main    4 个节点，5 个事件
* sql-v3  基于 main 的 #4（10-09 12:00） · 4 个节点，5 个事件 · "SQL 第三版"
```

```
Tree「sql-v3」：共 5 个事件（--at 里写 #N）：
开出时基于 main 的 #4（10-09 12:00）
#1  10-09 12:00  model   start
#2  10-09 12:00  model   add design-v2 "design v2 定稿"
#3  10-09 12:00  model   add pool-32 "pool 数维持 32"
#4  10-09 12:00  model   add probe-s1-gate "闸门：probe s1 通过"
#5  10-10 12:00  user    add sql-plan-b "SQL 方案 B"
```

### 选项

| 选项 | 含义 |
|---|---|
| `--at <版本>`（也可写 `--version`） | 从哪个版本复制，写法见下表；不写就是当前版本 |
| `--from <tree>` | 复制另一棵 tree，而不是当前所在的这棵（`/decide new sql-v4 --from main --at #3`） |
| `--title <文字>` | 给这棵 tree 一句人看的说明（最多 120 个字符），显示在 pane 里和 `/decide tree` 里；名字放不下的中文说明都放这里 |
| `--empty` | 空白 tree：不复制任何事件，只有一个 `start` |
| `--stay` | 新开但不切过去，项目继续记录到原来的 tree；以后用 `/decide use <名字>` 再切 |

名字是 2–32 个小写字母、数字、连字符。写了大写、空格、标点的，只要换成连字符就能成名字的，会自动换（`SQL v3` → `sql-v3`）；`main` 被占用；换不成的（比如全是中文）会拒绝并提示放进 `--title`。已经有的名字、不存在的 tree、看不懂的版本，都是一句话的拒绝，什么都不写。

### "版本"怎么写

tree 的历史就是它的事件文件按文件名排好的顺序（见[数据格式](#数据格式)），**一个版本就是前 N 个事件**：

| 写法 | 含义 |
|---|---|
| 不写，或 `current`、`now`、`head`、`latest`、`当前`、`最新` | 到现在为止记下的全部 |
| `#17` | 前 17 个事件。`/decide log` 给每个事件编了号；`fork` 标记不占编号 |
| `2026-10-08 17:44`、`10-08 17:44`、`10-08`、`17:44`、`10月8日 17:44` | 到那个时间为止的全部。本机时区；写到分钟算到那一分钟的最后一刻，只写日期算到当天最后一刻；没写年份取今年（那样会在未来就取去年），只写时刻取今天（会在未来就取昨天） |
| `20261008T214400Z` | 事件文件名开头的那种 UTC 时间戳，可以只写前一段 |
| `v22-adopted`、`构建版本` | 记下那个节点的那一刻：节点 id，或标题里唯一匹配的一段文字（匹配多个会拒绝并列出候选） |
| `node:current` | 同上；节点的 id 恰好像上面某一种写法时，加 `node:` 前缀 |

时间点比这棵 tree 的第一个事件还早，会拒绝并告诉你第一个事件是什么时候的；`#N` 超过事件数也一样。

### 它怎么存

- `main` 还在 `.claude/decisions/` 的 `events/` 和 `tree.json` 里，和只有一棵 tree 时完全一样。其他 tree 在 `.claude/decisions/trees/<名字>/`，各有自己的 `events/` 和 `tree.json`。`config.json` 整个项目只有一份。
- 新开 = 把 base 版本之前的事件文件**逐字节、同样的文件名**复制进新 tree 的 `events/`，**最后**再写一个 `fork` 事件，记下是从哪棵 tree 的哪个事件开出来的。同样的文件名让事件的顺序在新 tree 里不变。顺序是有意的：看到 `fork` 事件，这棵 tree 才算开好；复制到一半被打断的，是一个没有 `fork` 事件的文件夹，不会被切过去（`/decide tree` 会标成"没做完的复制"）。
- 再用同一个名字新开一次：上次留下的文件都在这次要复制的范围里，就接着做完；文件夹里有这次不会复制的文件，拒绝，并说明有几个。mod 不会替你删文件，请自己看一眼再处理那个文件夹，或换个名字。
- 从一棵已经是 fork 的 tree 再开新 tree 也行：新 tree 只带一个 `fork` 事件，记的是它直接的来源。
- 在新 tree 里的一切（模型的工具、你的命令、pane 里手动编辑）都只写进新 tree；原来那棵不会因此多一个文件。

### 切换对谁生效

当前记录到哪棵 tree，写在 `config.json` 的一个可选键 `"tree": "<名字>"` 里（没有这个键就是 `main`）。**整个项目共用一个指针**，不是每个 session 各一个：

- 你在一个 session 里 `/decide new` 或 `/decide use`，其他所有在这个项目里运行的 session 都跟着切：最迟在下一个 5 秒轮询里跟上，弹一条提示（"现在记录到 tree「sql-v3」（项目已切换到它）"）。你自己切换的那个 session 只有回执，没有这条提示。
- 模型的写工具和读工具、你敲的写命令（`add`、`status`、`note`、`retract`、`import`、`new`、`use`），动手之前都会先读一遍 `config.json`，所以别的 session 刚做的切换会立刻生效，不会有"刚切换完，这边还写进旧 tree"的空档。（pane 里的手动编辑写进 pane 当时显示的那棵 tree：它改的就是眼前这个节点。）
- 这也包括无人值守的 session（比如远程服务器上长时间运行的）：你一切换，它们之后记的决定就进新 tree。不想这样，先 `/decide pause`，或者用 `--stay` 新开。
- `config.json` 指向的 tree 在这台机器上还没有（比如 `config.json` 通过 git 先到，事件文件还没到）：session 留在原来的 tree，说一次，等事件文件到了再自己切过去。
- 同名的 tree 在两台机器上各开了一次，git 合并后会落进同一个文件夹（复制出来的文件同名同内容，不冲突）。在不同机器上开 tree，请用不同的名字，或者先 `git pull`。

### 模型和这个功能

模型有 `decision_new_tree`、`decision_use_tree`，`decision_tree` 也能列出所有 tree、看事件编号（见[给模型的工具](#给模型的工具)）。工具说明里写明：只有你要求时才新开或切换，它不会自己动手。在不是 `main` 的 tree 里，system prompt 那一段会多一行 `Current tree: sql-v3 (from main at #17 (10-08 17:44)). …`，让模型知道它记的是哪一棵，下面列出的最近节点也是这一棵的；切换 tree 时这一段立即重写，不等下一个 turn。

### 暂停和未开启时

- 暂停期间你仍然可以新开和切换 tree（那是你自己的操作），回执会补一句"记录现在是暂停的"，之后的决定不记；模型的 `decision_new_tree`、`decision_use_tree` 和其他写工具一样被挡。
- 项目还没有开始记录时，没有东西可以复制，命令会让你先 `/decide start`。

### 在 pane 里

标题行带 `[sql-v3]`（`main` 不带）。pane 高度够（≥ 16 行）时，标题下面还有一行说这棵 tree 从哪里开出来，后面接你给的 `--title`。窄的 pane 里这一行会被截断，矮的 pane 里省掉。

```
决策树 [sql-v3] · e2e-demo                记录中 · 4 个决定 · 12:00 更新
基于 main 的 #4（10-09 12:00）· SQL 第三版
────────────────────────────────────────────────────────────────────────
主线  design v2 定稿
────────────────────────────────────────────────────────────────────────
  ✓ design v2 定稿                                                 10-08
  ├ ✗ pool 数维持 32                                               10-09
  └ ✓ 闸门：probe s1 通过                                          10-10
❯   └ ○ SQL 方案 B
────────────────────────────────────────────────────────────────────────
▾ SQL 方案 B                                       ○ 计划 · user · 10-10
────────────────────────────────────────────────────────────────────────
k: ↑  j: ↓  Enter 展开  e: 编辑  p: 只看待定  h: 隐藏否决         警告 0
a: 全部
```

## 界面

下面是真实运行时的 pane（宽 72 列，中文界面；数据是示意）：

```
决策树 · e2e-demo                         记录中 · 3 个决定 · 02:15 更新
────────────────────────────────────────────────────────────────────────
现在
  ZETA    gateway s0      ████████░░  3400/4000  约 23:50  预热中
  BETA-0  ablate_wide s0  █░░░░░░░░░   420/4000  约 09:10
  GAMMA                   空闲
  下一步  闸 → probe s1（约 06:15）
  ! GAMMA 空闲
────────────────────────────────────────────────────────────────────────
主线  design v2 定稿
────────────────────────────────────────────────────────────────────────
❯ ✓ design v2 定稿                                                 10-10
  ├ ✗ pool 数维持 32                                               10-10
  └ ✓ 闸门：probe s1 通过                                          10-10
────────────────────────────────────────────────────────────────────────
▾ design v2 定稿                                          ✓ 采用 · 10-10
────────────────────────────────────────────────────────────────────────
k: ↑  j: ↓  Enter 展开  e: 编辑  p: 只看待定  h: 隐藏否决         警告 0
a: 全部  s: 现在
```

从上到下：标题行（项目名、记录状态、决定数、更新时间）、"现在"（状态命令的数据）、主线、树、选中节点的详情（理由、依据、来源、取代关系、备注）、键位提示和警告数。不在 `main` 时，标题行带 `[tree 名]`，下面一行说这棵 tree 的来历（见[多棵 tree](#多棵-tree)）。英文界面对应写成 `Now`、`Mainline`、`Adopted`、`Next`。

窗口太矮时，先省掉"现在"一栏，再压缩、省掉详情，让树保住几行；底部的键位提示不让位（行数 ≥ 12 时占两行，否则一行；太窄时先丢不常用的键）。等你批准的状态命令例外：它比详情优先，空间不够时先收起详情；连整条命令加按钮都放不下时，不画按钮，"现在"一栏只剩一行 `有一条状态命令在等你确认；把 pane 拉大后才看得全。`，pane 拉大后才会出现命令和 **Allow**。

状态的符号和颜色：

| status | 中文 | English | 符号 | ASCII 备用 | 颜色 |
|---|---|---|---|---|---|
| `adopted` | 采用 | Adopted | ✓ | `+` | 绿 |
| `rejected` | 否决 | Rejected | ✗ | `x` | 红 |
| `no-diff` | 无差别 | No diff | = | `=` | 灰 |
| `in-progress` | 进行中 | In progress | ◐ | `~` | 强调色 |
| `planned` | 计划 | Planned | ○ | `o` | 强调色 |
| `proposed` | 提议 | Proposed | ◌ | `?` | 强调色，暗 |
| `withdrawn` | 撤回 | Withdrawn | ⊘ | `/` | 暗 |
| `superseded` | 被取代 | Superseded | ⊘ | `/` | 暗 |
| `deferred` | 暂缓 | Deferred | ‖ | `"` | 暗 |

◐ ○ ◌ ⊘ 和框线字符在 Unicode 里是"歧义宽度"，有的终端把它们画成两列。默认按一列算（和 Claude Code 自己的排版一致）；如果你的终端画歪了，在 `config.json` 里设 `display.asciiGlyphs: true`，状态符号、进度条、树的连线改用 ASCII。Ghostty 的情况见[下一节](#ghostty-和其他终端)。

**键盘**（pane 拿到键盘时；`/tree` 或 `ctrl+x` 然后 `Tab` 把键盘交给 pane，Esc 还给 prompt）：

| 键 | 作用 |
|---|---|
| ↑ ↓ / `k` `j` / Tab | 在行之间移动 |
| Enter | 选中；再按一次展开或收起 |
| `a` | 显示全部 |
| `p` | 只看待定（计划、提议、进行中） |
| `h` | 隐藏否决和撤回 |
| `s` | 显示或隐藏"现在"一栏 |
| `e` | 编辑选中节点：状态（九选一）和一句话摘要，提交时写一个 `update` 事件 |
| Esc | 把键盘还给 prompt |

所有截断和换行按**显示宽度**算（CJK 和全角字符两列，组合符号零列，歧义宽度一列），宽度取 pane 实际可画的列数。

## Ghostty 和其他终端

在 Ghostty 里可以用，需要知道三件事。

**1. 宽度。** pane 里每一行都是 mod 自己按"显示宽度"算好再交给 Claude Code 的。终端之间对一小类字符的宽度意见不一致：emoji 后跟变体选择符（❤️）、零宽连接符（👨‍👩‍👧）、肤色修饰符（👍🏽）、国旗（🇨🇳）、keycap（1️⃣），以及比终端宽度表更新的 emoji。Ghostty 默认按 grapheme 聚类算宽度（`grapheme-width-method = unicode`，Unicode 数据较新），Claude Code 自己有一张宽度表，tmux 又是另一套；两边数出来差一格，这一行就会在屏幕边缘折行，把下面整个 pane 冲歪。所以 pane **画出来的文字**先过一遍过滤，变成各种算法数出来一样宽的形式：

| 原文 | pane 里画成 |
|---|---|
| ❤️ ⚠️（带变体选择符）、1️⃣ | ❤ ⚠ 1（去掉选择符和 keycap 符号） |
| 👨‍👩‍👧 👩‍💻（连接符） | 👨👩👧 👩💻（拆成单个） |
| 👍🏽（肤色） | 👍 |
| 🇨🇳（国旗） | `CN`（国家代码） |
| Unicode 12 以后新增的 emoji（🫠 🥹 🪄 🛜 …） | `?` |
| 不可见字符（零宽空格、软连字符、方向标记、标签字符）、被截断的半个 emoji | 去掉 |

汉字、全角标点、拉丁字母加组合符号（é）、韩文、✅ ❌ ⭐ 🚀 🔥 🟢 这类老 emoji 不受影响。**只影响画出来的样子**：`events/` 和 `tree.json` 里是原文，给模型的 prompt 和 `decision_tree` 工具的输出也是原文。印度系文字、泰文 SARA AM 这类"占位组合符"没有处理，可能差一格。

`grapheme-width-method` 设成 `unicode`（默认）或 `legacy` 对 pane 都没有影响，过滤之后两种算法数出来一样。

**2. 字形。** 状态符号 ✓ ✗ ◐ ○ ◌ ⊘ ‖、进度条 █ ░、树的连线 ├ └ │ ─ 都是"歧义宽度"字符，Ghostty 按一列算，和 mod 一致。框线和方块字符 Ghostty 自己画；几何形状（◐ ○ ◌ ⊘）取决于字体，缺字形时 Ghostty 退到别的字体，可能显得偏大或偏小。这时二选一：

- 在 `config.json` 里设 `display.asciiGlyphs: true`，全部换成 ASCII；
- 或者给这几个码点指定一个有它们的等宽字体。Ghostty 配置里：

  ```
  font-codepoint-map = U+25CB-U+25D1=DejaVu Sans Mono
  font-codepoint-map = U+2298=DejaVu Sans Mono
  ```

  语法是 `码点=字体名`，码点可以是单个或 `U+起-U+止` 的范围；字体名换成你机器上有的。

**3. 从 Ghostty ssh 到远程服务器。** Ghostty 的 `TERM` 是 `xterm-ghostty`，多数服务器没有它的 terminfo；症状是 `claude`、`tmux` 报 `missing or unsuitable terminal: xterm-ghostty`，或者颜色、按键不对。三种办法（来自 Ghostty 文档）：

- 让 Ghostty 自动处理，在 Ghostty 配置里写 `shell-integration-features = ssh-env,ssh-terminfo`。`ssh-terminfo` 在 ssh 到一台新机器时把 terminfo 装过去，`ssh-env` 转发环境变量；装不上时退回 `TERM=xterm-256color`。它们包装的是本机交互式 shell 里的 `ssh`，要在那个 shell 里启用 Ghostty 的 shell integration；
- 手动装一次：`infocmp -x xterm-ghostty | ssh 你的服务器 -- tic -x -`；
- 不装：在 `~/.ssh/config` 里对这台机器写 `SetEnv TERM=xterm-256color`（OpenSSH 8.7 以上，只对没有 terminfo 的机器用）。

在 tmux 或 screen 里，宽度会被多路复用器再数一遍，上面的过滤同样有效。

## 给模型的工具

模型看到的名字是 `mcp__decision-tree__<name>`。

| 工具 | 何时可见 | 作用 |
|---|---|---|
| `decision_log_start` | 未开启时 | 开启这个项目的记录（`title`，可选 `rootTitle`、`statusArgv`） |
| `decision_record` | 开启后 | 新增一个决定；返回 id 和挂在哪个节点下 |
| `decision_update` | 开启后 | 改状态、摘要、理由，追加依据和来源，标记被谁取代 |
| `decision_note` | 开启后 | 给节点追加一条备注 |
| `decision_tree` | 开启后 | 读树：默认返回主线加最近 20 个节点的紧凑文本；给 `id` 时返回该节点详情，给 `query` 时按 id 或标题里的一段文字找；`trees: true` 列出所有 tree 和各自的来历；`log: N` 给出当前 tree 最近 N 个事件的编号（`#N` 就是 `decision_new_tree` 的 `at`）。记录前用来找对父节点、避免重复 |
| `decision_new_tree` | 开启后 | 新开一棵 tree：`name`，可选 `at`（版本）、`from`、`empty`、`title`、`stay`，含义同 `/decide new`。**只在你明确要求时**调用 |
| `decision_use_tree` | 开启后 | 切到项目里另一棵 tree：`name`。同上，只在你要求时调用 |

每次调用：校验输入 → 写事件文件 → 重建 `tree.json` → 更新界面 → 返回一行回执（例：`Recorded v22-adopted (under dbpool-adopted, Adopted)`；中文输入下是"已记录 …"）。输入不合法时返回模型能据以修正的说明（`deny`），不写任何东西。

工具说明里写了记录规则：

- **记**：你明确拍板的（采用、否决、撤回、改规则、定下一步）；按事先定好的规则自动得出的结论（"闸"，英文 gate：规则放行或跳过某一步，`decidedBy: "gate"`）；你接受的计划（`planned`）；提出了但还没定的（`proposed`）。
- **不记**：讨论中、你没同意的想法不记成 `adopted`；单纯的进度和日志不记（那是"现在"一栏的事）。
- 依据写关键数字和区间，run 名放 `evidence.run`，报告路径放 `evidence.source`；状态跟着结果走：`planned → in-progress → adopted / rejected`；被新决定取代时，对旧节点 `supersededBy` 并把状态改 `superseded`；一件事一个节点（同一件事的第二个 seed 是追加依据，不是新节点）；拿不准父节点先调用 `decision_tree`。

开启后 system prompt 里多一段（`scope: session`，约 1,500 字符以内）：规则缩写、当前主线（id 和标题）、最近 10 个节点（id · 状态 · 标题），模型多数时候不用先查树就能挂对父节点。在不是 `main` 的 tree 里还有一行 `Current tree: …`，说明记的是哪一棵、从哪里开出来。

## 数据格式

```
<项目根>/.claude/decisions/
  config.json        项目级配置：标题、开始时间、是否在记录、当前记录到哪棵 tree、状态命令、显示选项
  events/*.json      main 的事件文件，不可变，唯一的数据源
  tree.json          main 的派生快照，给外部工具读，随时可以重建
  trees/<名字>/      其他 tree，每棵有自己的 events/ 和 tree.json（没新开过 tree 就没有这个文件夹）
```

**项目根**按顺序找：从 session 的工作目录往上第一个含有 `.claude/decisions/config.json` 的目录（所以在子目录里启动也能接上）；否则 `git rev-parse --show-toplevel`；否则工作目录。

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

`status` 可省略（没有"现在"一栏）；`intervalSec` 取 5–3600、`timeoutSec` 取 1–120。`display.language` 为 `"zh"` 或 `"en"` 时固定，`"auto"` 跟随你的输入。`tree` 也可省略（上面的例子里没有）：整个项目现在记录到哪棵 tree，没有就是 `main`；`/decide new`、`/decide use` 改它，见[多棵 tree](#多棵-tree)。名字不合规的当作没有这个键。mod 改这个文件时只动它要改的那个键，其余的键（包括不认识的）原样保留，只是整个文件按 2 空格缩进重新写出。这个文件应该进 git。

### 事件文件

每次写入新建一个文件，永远不改旧文件：`events/<ts>_<session>_<seq>.json`，其中 `ts` 是 UTC 时间 `YYYYMMDDTHHMMSSmmmZ`，`session` 是 session id 的前 6 位，`seq` 是这个进程内的 4 位序号。**文件名的字典序就是事件的顺序**，同一毫秒由 session 和 seq 打破平局。写入时文件名里的时间取"本机时钟"和"已经读到的最新事件的时间 + 1 毫秒"中较晚的那个，所以哪怕这台机器的时钟比别的机器慢，它写的事件也排在它已经看到的事件之后（读到比本机时钟晚一天以上的时间当作别处的时钟错误，不跟随）。

```ts
type DecisionEvent = {
  v: 1
  op: 'start' | 'add' | 'update' | 'note' | 'move' | 'retract' | 'fork'
  id?: string                  // 目标节点（start、fork 没有）
  ts: string                   // ISO 8601，带时区
  session: string
  actor: 'user' | 'model' | 'gate' | 'import'
  node?: NodeFields            // add：完整字段
  patch?: Partial<NodeFields> & {
    addEvidence?: Evidence[]   // 追加，不覆盖
    addSources?: string[]
  }                            // update
  text?: string                // note：一条备注；fork：这棵 tree 的说明（--title）
  parent?: string | null       // move：改挂到哪里
  reason?: string              // retract：这条记错了，撤掉
  base?: {                     // fork：这棵 tree 是从哪里开出来的
    tree: string               //   来源 tree 的名字
    at: string | null          //   复制的最后一个事件的文件名；空白 tree 是 null
    count: number              //   复制了几个事件；空白 tree 是 0
  }
}

type NodeFields = {
  title: string                // 一行，界面上最多约 40 列
  parent: string | null        // 挂在哪个决定下面；null 是根
  status: 'adopted' | 'rejected' | 'no-diff' | 'in-progress' | 'planned'
        | 'proposed' | 'withdrawn' | 'superseded' | 'deferred'
  kind: 'decision' | 'protocol' | 'design' | 'milestone'
  trunk?: boolean              // 主线上的决定
  summary?: string             // 一句话结论
  rationale?: string           // 理由，可以多行
  evidence?: Evidence[]
  sources?: string[]           // 报告、文档的路径，相对项目根
  decidedBy?: 'user' | 'gate' | 'model'
  decidedAt?: string           // 决定生效的时间，可以早于记录的时间
  supersededBy?: string        // 被哪个决定取代
  tags?: string[]
}

type Evidence = {
  label: string                // 例："预热后 P99，suite 内"
  value?: string               // 例："−12.6%"
  ci?: string                  // 例："[−15.1, −10.4]"
  run?: string                 // 例："v22_db_pool_cap s0"
  note?: string
  source?: string              // 报告路径
}
```

**外部脚本也可以直接写事件文件**（比如 gate 检查点的脚本写 `actor: "gate"` 的 `add` / `update`）：按上面的文件名和 JSON 格式新建一个文件即可，不要修改已有文件。所有打开着的 session 在 5 秒内会读到并更新界面。先写临时文件再 `mv` 成最终文件名最稳妥；万一读到写了一半的文件，mod 会再读几次，之后才把它记成警告。

一个最小的例子：

```json
{
  "v": 1,
  "op": "add",
  "id": "probe-s1-gate",
  "ts": "2026-10-10T06:15:00-04:00",
  "session": "gate01",
  "actor": "gate",
  "node": {
    "title": "闸门：probe s1 通过",
    "parent": "design-v2",
    "status": "adopted",
    "kind": "decision",
    "decidedBy": "gate",
    "evidence": [{ "label": "val loss", "value": "0.412", "run": "ablate_wide s1" }]
  }
}
```

### 重放规则

- 按文件名顺序读全部事件。
- `start`：标记日志已开启（只认第一条）。
- `add`：建节点；id 已存在则忽略这条并计一个警告。
- `update`：逐字段覆盖；`addEvidence`、`addSources` 追加并去重。
- `move`：改 parent；会成环的拒绝并计警告。
- `retract`：节点标为已撤销，默认不显示，可以在过滤里打开。
- `fork`：只认第一条（一棵 tree 只开一次）。它不是决定，不出现在树里，也不占版本编号，只记下这棵 tree 的来历（`base`、说明、谁开的、什么时候）。`base` 不合格的计一个警告，当作没有。
- `note`：追加到节点的备注列表。
- 解析失败、版本不认识、op 不认识的文件跳过，计警告，底栏显示警告数。
- 冲突：两个 session 改同一个字段，文件名靠后的生效。

### 节点 id

优先用模型给的可读 slug（kebab-case，例如 `v22-adopted`），要求匹配 `^[a-z0-9][a-z0-9-]{2,47}$` 且唯一，重复时加后缀 `-2`、`-3`；没给就由标题生成，标题里没有可用字符时（比如全是中文）用 `d-<base36 时间戳>`。命令和工具引用节点时，也接受标题里唯一匹配的一段文字。

### tree.json

本 session 每写一次事件就重建一次：`{ generatedAt, project, tree, fork?, nodes, warnings }`，`tree` 是这份快照属于哪棵 tree（`main` 的在 `.claude/decisions/tree.json`，其他的在各自的 `trees/<名字>/tree.json`），`fork` 只有开出来的 tree 才有（同事件里的 `base` 加上说明、谁开的、什么时候），节点是重放后的完整字段（另有 `createdAt`、`createdBy`、`updatedAt`、`notes`、`addedBy` 这些派生字段）。它是派生物，**从不当数据源读**，给外部工具（比如网页版的实验树）用。别的进程（或脚本）只追加事件文件时，`tree.json` 要等某个 session 下一次写入才更新。

### 规模和 git

一个事件文件通常小于 2 KB，几百上千个都没问题；读取是增量的（只读新出现的文件名）。`.claude/decisions/` 应该进 git，纯文本，不走 LFS；每个事件是独立的新文件，`events/` 里的合并不会冲突。会冲突的只有整个文件重写的两个：`config.json`（两边都改了才会，比如同时切了 tree）和 `tree.json`（派生的，冲突时留哪一边都行，下次写入会重建）。新开一棵 tree 会复制它的 base 之前的所有事件文件，每个文件很小，所以复制本身不是负担。

### 导入种子数据

`/decide import <文件>` 读项目里的一个 JSON 文件：节点数组（也接受 `{ "nodes": [...] }`），每个节点是 `NodeFields` 加一个 `id`，写成 `actor: "import"` 的 `add` 事件。`parent` 写文件里的 id（可以指向文件里更靠后的节点），也可以指向树里已有的节点。不合格的节点被跳过，回执里说明导入了几个、跳过了几个。

## "现在"一栏和状态命令

在 `config.json` 里配置 `status.argv`，mod 就会在项目根下运行它，读 stdout 的 JSON，每 `intervalSec` 秒（默认 30）刷新一次，画在树的上方。

### 输出契约

```json
{
  "updatedAt": "2026-10-10T00:20:00-04:00",
  "lanes": [
    { "name": "ZETA",   "run": "gateway s0",     "state": "running", "step": 3400, "total": 4000, "eta": "23:50", "note": "预热中" },
    { "name": "BETA-0", "run": "ablate_wide s0", "state": "running", "step": 420,  "total": 4000, "eta": "09:10" }
  ],
  "next": [ { "text": "闸 → probe s1", "eta": "06:15" } ],
  "warnings": [ "GAMMA 空闲" ]
}
```

- `state` 取值：`running`、`queued`、`done`、`failed`、`idle`；`step`/`total`、`eta`、`note`、`run` 都可省略。
- 进度条宽 10 格，用 `█` 和 `░`（ASCII 模式下用 `#` 和 `.`）。
- 命令失败（退出码非 0、超时、输出不是合法 JSON）：保留上一次成功的数据，标"stale N min"，并在下面显示错误的第一行。

### 安全：第一次要你确认

状态命令是任意 shell 命令。在某个项目里第一次运行前，"现在"一栏先显示 argv 和一个 **Allow** 按钮，你确认后才运行；确认记录是"项目根 + argv"的哈希，存在 `$.store`（每台机器自己的，不进 git）。argv 一改就要重新确认。因此别人 clone 下来的项目不会在你没看过的情况下运行里面的命令。

- **批准的是命令行本身，不包括脚本里写了什么**：`["bash", "scripts/decision_status.sh"]` 批准之后，脚本文件再被改（比如 `git pull` 带来别人的新版本），不会再问一次，和你在 shell 里跑这个脚本是同样的信任。
- **看到的就是将要运行的**：pane 里逐词显示那条 argv；含空格或 shell 特殊字符的词加单引号（`~/x.sh` 这种开头的 `~` 也加，因为 shell 会展开它），控制字符、不可见字符和 pane 会画成别的样子的字符写成 `<U+200B>` 这样的形式。命令太长、pane 放不下时不提供 **Allow**（见[界面](#界面)）。
- **按下 Allow 的那一刻**，mod 会再读一次 `config.json`：命令在这期间已经变了，就什么都不批准，提示你先看新的命令；运行之前还会核对一次，pane 上显示的、`config.json` 里的和你批准过的三者逐字相同。命令跑着的时候 `config.json` 里的命令换了，那条命令的结果丢掉，不会盖住"等你批准"的新命令。

命令只在 pane **显示着**的时候运行（不显示就不跑，省得无谓地占用机器）。`/tree` 和你按 Allow 的那一下会马上跑一次，之后按 `intervalSec` 的节奏。命令用 argv 直接启动（不经 shell），所以要用管道、重定向时自己包一层脚本，例如 `["bash", "scripts/decision_status.sh"]`。

## 语言

- 技术名词（run 名、`db_pool_cap`、`P99`、`seed`、命令名…）永远保留英文。
- 界面固定文字、命令和工具的回执跟随你**最近一次的输入**：含 CJK 字符就是中文，有至少 6 个英文字母且没有中文就是英文；以 `/` 开头的输入和太短的输入不改变语言。只有你自己的话才算数：来自通知、定时任务、另一个 session 或另一个插件的 prompt（`/decide init` 交给 Claude 的那个任务也算）说明不了你用什么语言写作。结果按项目存进 `$.store`，下次打开这个项目时先用上次的，再没有就用英文。
- `config.json` 里 `display.language` 为 `"zh"` 或 `"en"` 时固定，不跟随输入（`/decide lang zh|en|auto`）。
- 模型写进决定的标题、摘要、理由跟随你的输入语言；**已记录的节点内容永远不翻译**。
- 给模型看的 system prompt 那一段是英文的（模型读的），其中写明了上一条规则。

## 需要知道的行为

- **prompt 缓存**：system prompt 里那一段会随决定变化，而 session 级的段落变化会让从这里往后的缓存失效。所以 mod 只在**每个 turn 开始时**刷新一次这一段，同一个 turn 里不变。别的 session 刚写下的决定，要到本 session 的下一个 turn 才出现在模型的简报里（pane 在 5 秒内就会更新）。开启、暂停、恢复、切换 tree 这几件会让整段内容都变的事例外，立即重写。
- **多 session**：session 之间不直接通信，只通过磁盘上的事件文件和 `config.json`。每个 session 对事件只新建文件、从不修改旧文件，所以并发安全。界面状态（选中、展开、过滤）是每个 session 自己的；记录到哪棵 tree 是整个项目共用的（见[多棵 tree](#多棵-tree)）。
- **`/clear` 和 resume**：`/clear` 会清掉 session 的界面状态值，mod 会在下一次触碰时自动恢复（pane 不会变成"未记录"）；5 秒轮询跨 `/clear` 和 resume 继续。
- **窄终端**：你自己 `/tree` 打开的 pane，≥ 110 列时停靠在右侧；更窄时以带边框的形式画在输入框上方，空间小，树优先显示，"现在"和详情等按剩余空间取舍。想看全貌就把终端拉宽，或者让模型调用 `decision_tree` 读文本版。屏幕完全不画 pane 时（比如不支持 pane 的界面），`/tree` 直接把树以文本返回。
- **手机界面**（`mobile` surface）没有输入框和下拉，pane 是只读的：能看树，不能编辑。
- **开启之后** `decision_log_start` 在已经开启过的 session 里仍然在工具列表里（工具注册之后不能撤销），再调用只会回答"已经开启"；新 session 在已开启的项目里只看到另外六个工具。
- **重复导入**：同一个文件再 `/decide import` 一次不会重复加：id 和标题都已经在树里的节点原样保留，回执说有几个已经在了；文件里新增的节点才会被加进来。
- **磁盘卡住**：mod 的读写（工具调用、命令、5 秒轮询）排成一条队，一个接一个做。一个操作 30 秒没有回应（比如网络盘停住了）就放弃，这次调用得到一句说明（"记录可能已改也可能没改，先调用 `decision_tree` 看一眼再重试"），排在后面的照常往下走；新开 tree 要复制很多文件，给 120 秒。事件文件夹读不出来时，pane 保持上次读到的样子，弹一次提示，读得出来了再弹一次。
- **`config.json` 暂时读不到**（网络盘、正在被替换）：一次读失败不改变已知的状态，记录照常；文件"不见了"要连续两次 5 秒轮询都找不到才当真，所以 `git checkout`、编辑器保存造成的一瞬间的消失不会让记录停下。暂停、恢复、改语言、改自动打开这几个命令要改的是文件当前的样子，读不到时会拒绝并说明，什么都不写。
- **ASCII 模式**（`asciiGlyphs: true`）改的是 mod 自己画的东西（状态符号、进度条、树连线）；Claude Code 自己的边框、关闭按钮等不受影响。
- **未验证**：Windows 终端；2.1.296 以外的 Claude Code 版本（见下）。

## 开发和测试

```bash
claude plugin validate  <folder>     # 清单、marketplace、hooks 模块
tsc -p <folder>                      # 类型检查（mod 加载过一次后，.claude-plugin/types 才会生成）
claude plugin test      <folder>     # 355 个测试：单元、pane（terminal/desktop/vscode/mobile 四种界面）、引擎级连线
```

代码结构：

```
hooks/register.tsx     只做注册：session.start / session.end / tool.call / command.run /
                       turn.start / prompt.compose / prompt.submit / ui.render / ui.focus
lib/project.ts         找项目根       lib/events.ts   事件文件名、校验、id、tree 名
lib/journal.ts         增量读写事件（每棵 tree 一个 Journal）   lib/replay.ts   重放成树
lib/config.ts          config.json 的读和局部修改   lib/io.ts   文件读写的接口
lib/tree.ts            排序、过滤、主线  lib/ops.ts   一次写入 = 校验 + 事件（工具和命令共用），
                       新开 tree、切换、列出、看日志也在这里
lib/versions.ts        "版本"怎么写、怎么解析（#N、时间、节点）
lib/tools.ts           工具的 schema   lib/commands.ts /decide 的解析
lib/prompt.ts          system prompt 那一段   lib/init.ts   /decide init 交给模型的任务
lib/status.ts          状态命令输出的解析、过期判断、批准时命令的显示
lib/width.ts spans.ts glyphs.ts layout.ts  显示宽度、截断换行、符号、pane 的版面（纯函数）
lib/i18n.ts            中英文文案
lib/view.tsx           把版面画成元素（Box/Text/Button/Select/Input）
lib/runtime.ts         把以上串起来：轮询、状态、命令、工具
lib/port.ts state.ts   Port：runtime 需要的 `$` 的最小接口；`$.state` 的初值
types/index.d.ts       PluginState 契约
tests/                 内存里的 FakeEngine + 引擎级测试
```

为什么有 `Port`：引擎不允许把 `$` 传过 import 边界（`$` 只能流向同一个文件里的函数），所以 `register.tsx` 把用到的 `$` 方法包成一个普通对象 `Port`，`lib/` 只认 `Port`。好处是 `lib/` 可以在内存里的假引擎上完整测试。

## 接入你自己的项目

一个典型的接入流程：

1. **开启**：在项目的 Claude Code 里运行 `/decide init <项目名>`，让 Claude 从项目本身找出起点（[从项目本身建立起点](#从项目本身建立起点)）；或者说"从现在开始记录决定"，或用 `/decide start <项目名>`，得到一棵空树。
2. **种子数据（可选）**：已经做过的决定，另外整理成一个节点数组（格式见[导入种子数据](#导入种子数据)，每个节点加 `id`），放进项目（比如 `docs/decision_seed.json`），用 `/decide import docs/decision_seed.json` 导入。
3. **状态命令（可选）**：写一个脚本（比如 `scripts/decision_status.sh`），读你的任务队列、日志里的步数等，按上面的[输出契约](#输出契约)往 stdout 打印 JSON；让 Claude Code 帮你写也行。然后在 `config.json` 里加：

   ```json
   "status": { "argv": ["bash", "scripts/decision_status.sh"], "intervalSec": 30, "timeoutSec": 15 }
   ```

   或者开启时让模型传 `statusArgv`。第一次显示时在 pane 里按 **Allow**。
4. `git add .claude/decisions` 并提交。
5. 之后想试另一条路线，不要把原来的记录弄乱：`/decide log` 看事件编号，`/decide new <名字> --at #17 --title "说明"` 开一棵新的接着记，`/decide use main` 随时切回去，见[多棵 tree](#多棵-tree)。提醒：切换对**整个项目**生效，无人值守的 session 也会跟着记到新 tree 里；想让它们继续记原来的 tree，用 `--stay` 新开，等它们空下来再 `/decide use <名字>`。

## 实现取舍与假设

最初的设计说明（代码注释里的 `spec 9.2` 这类编号指它的章节号；说明本身没有放进这个仓库）逐条实现了，以下是说明没规定、或实现时做了取舍的地方：

- **API 版本**：按 2.1.296 写；换了版本先跑 `validate` 和 `test`（见[前提](#前提)）。
- **prompt 刷新时机**：每个 turn 开始时刷新一次，而不是每次请求（见上，为了保住 prompt 缓存）。
- **状态命令只在 pane 显示着时运行**。
- **"主线"** 取 `trunk: true` 的节点，按树的顺序列出（标题截断）。
- **暂停期间**，只有模型的写工具被挡；你自己的命令和 pane 编辑照常。
- **斜杠命令**（以 `/` 开头的输入）不参与语言判断，不是你自己写的 prompt（通知、定时任务、别的 session、别的插件）也不参与。
- **`/decide init` 用 `$.prompt.submit` 交出它的任务**，作为你自己的话（`asUser`）。引擎会检查这个调用：在 `command.run` 钩子里调用会被拒绝（钩子占着那个 prompt 要等的 turn），文本以 `/` 开头也会被拒绝（会被当成命令执行）；所以任务的措辞不以 `/` 开头，并且在命令结束 250 毫秒后才提交；被拒绝时 1 秒后、再 3 秒后重试，仍然失败，或者另一个插件的钩子把它丢掉了，就弹一次提示。这个调用在它开启的那个 turn 开始时才返回，所以没有任何地方在等它。任务本身是无状态的：第一步读树，树里已经有决定就停，这也覆盖了连着运行两次 `/decide init` 的情况。
- **额外的东西**：`decision_tree` 工具支持 `id` 取详情；`/decide lang`、`/decide autoopen`；`/decide import` 也接受 `{ "nodes": [...] }`；键位提示里 `k`/`j` 也能上下移动；选中行用 `❯` 标记。
- **节点 id**：模型或命令没给 id 时，先由标题生成可读的 slug（`Use SQLite for cache` → `use-sqlite-for-cache`），标题里没有可用字符（比如全是中文）时才用 `d-<base36 时间戳>`；重复时加 `-2`、`-3`。这样 `/decide status <id> …` 手打起来更方便。
- **事件序号**每个进程从 `0000` 开始；写文件前会检查同名文件是否存在，存在则序号加一。
- **多棵 tree 是在最初的设计之外加的功能**。取舍：
  - "版本"理解成 tree 的**事件历史上的一个点**（当前、第 N 个事件、某个时间点、记下某个节点的那一刻），不是打了标签的快照；
  - 新开 tree 是复制一份事件文件再写一个 `fork` 事件（像 git 开分支），不是给节点加一个"属于哪棵 tree"的字段；原来那棵不会多任何文件；
  - "当前记录到哪棵 tree"是 `config.json` 里**整个项目共用**的一个指针（所有 session 一起切，包括无人值守的），不是每个 session 各一个；每个 session 各有指针的做法留作以后的选项；
  - 新开 tree 时不复制 `fork` 事件，所以从 fork 出来的 tree 再开新 tree，只带一个 `fork`，记的是直接的来源；
  - 没有核对 tree 里实际有的事件数和 `fork.count` 是否相符：git 只带来一部分文件时，这棵 tree 会少几个节点，不会因此报错（后面引用那些节点的 `update`、`note` 事件会计成警告）。
- **Ghostty**：pane 画出来的文字会过一遍过滤（emoji 序列、新 emoji、不可见字符），只影响画出来的样子，存的和给模型的仍是原文；见[Ghostty 和其他终端](#ghostty-和其他终端)。
- **`display.autoOpen` 放在 `config.json` 里**（最初的设计里，用户偏好放 `$.store`，但 `config.json` 的示例里又有它）：这样一个项目在各台机器上行为一致，`/decide autoopen` 直接改它。**默认过滤不保存**：每个 session 打开时是默认视图，`a`/`p`/`h` 只管这个 session。
- **事件时间戳有一个下限**：写入时取"本机时钟"和"已读到的最新事件 + 1 毫秒"中较晚的，见[数据格式](#数据格式)。多台机器、复制来的 tree 里，时钟慢的一方写的事件也不会排到它已经看到的事件前面。
- **状态命令的批准只覆盖命令行**，不覆盖脚本内容，见["现在"一栏和状态命令](#现在一栏和状态命令)。

## 作者

- [Xiaowen Zhang](https://github.com/xwzhang98)：作者和维护者。
- 与 [Claude](https://claude.com/claude-code)（Anthropic）在 Claude Code session 里一起写成。

## License

[MIT](LICENSE) © 2026 Xiaowen Zhang
