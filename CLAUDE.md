# VeroDiff - working notes

Context for continuing work on this repository. The current version is whatever
`plugins/vero-diff/.claude-plugin/plugin.json` says; no other file states one.

## Working rules

- **A question gets an answer, nothing else.** When the owner asks for information -
  "how does X work", "what about Y", "why is Z" - reply with the information and change
  no files. Do not edit, stage, create or delete anything as a side effect of answering.
- **Ask before changing anything that was not asked for.** If you spot something worth
  changing - wrong documentation, a bug, a stale reference, an obvious improvement - say
  what it is and why it should change, then wait for a yes. Noticing a problem while
  doing something else is a reason to report it, not a licence to fix it. Approval for
  one change never extends to the next thing you notice.
- **Never commit.** Do not run `git commit`, `git push`, `git tag`, `git rebase` or
  anything else that writes history - not even when the work is finished, the tree is
  clean and the change is obviously correct. Editing files and staging them is fine;
  creating a commit is the repo owner's call, always.
- **Finish with a really short commit description.** When an implementation is done, hand
  back a one-line commit message for the owner to use. One line, no body, no explanation
  wrapped around it.

## What this is

A Claude Code plugin that lets you review **what changed on each turn**. Since 1.0 it is a
**mod**: one hooks module (TypeScript, function hooks) that takes a snapshot at each end of
a turn and draws the diff of each turn in a native pane - a sidebar in the terminal, a
panel in the desktop app's Code tab. The diff of a turn is `git diff` between two
snapshots.

The problem it solves: built-in `/diff` shows all uncommitted work at once because it has
no notion of where a turn started.

## Repository layout

```
verodiff/                                  marketplace repo root
├── .claude-plugin/marketplace.json        catalog: name "verodiff-marketplace"
├── .gitattributes                         forces LF: snapshot.sh and the scripts are bash
├── .github/workflows/ci.yml               manifests + plugin test, shell lint, smoke, endings
├── .github/dependabot.yml                 watches the CI actions; there are no deps
├── assets/                                promo2.png (README hero), promo.png (0.1.x), logos
├── tests/smoke.sh                         snapshot.sh's suite: git + bash only
├── install.sh                             validate -> marketplace add -> plugin install
│                                          (--scope project|local DIR for a project)
├── uninstall.sh                           plugin uninstall (+ --scope, --purge)
├── CLAUDE.md                              this file
├── CONTRIBUTING.md                        testing, CI, publishing: for maintainers
├── README.md                              user-facing docs
└── plugins/vero-diff/                     the plugin, name "vero-diff"
    ├── .claude-plugin/plugin.json         manifest: version, "types" contract
    ├── hooks/hooks.json                   { "modules": ["./register.tsx"] }, nothing else
    ├── hooks/register.tsx                 the mod: snapshots, /vero-diff, the pane
    ├── hooks/steps.ts                     pure parsing of git output (no `$`), tested
    ├── types/index.d.ts                   $.state contract: PluginState['vero-diff']
    ├── tests/steps.test.ts                `claude plugin test`: steps.ts
    ├── tests/pane.test.ts                 `claude plugin test`: the pane, both surfaces
    └── scripts/snapshot.sh                snapshot / where / prune; called by the module
```

## How it works

**Snapshot mechanism.** `scripts/snapshot.sh pre|post` takes one snapshot. It sets `GIT_DIR` to a
bare repo in the cache and `GIT_WORK_TREE` to the project, stages everything into a
private index with `git add -A`, writes a tree, and chains it onto a ref with
`git commit-tree` + `git update-ref`. No object ever lands in the project's `.git`;
`.gitignore` is still honoured because git reads it from the work tree. What git would read
from the project's own `.git` instead is carried over by hand: `info/exclude` is copied into
the shadow on every run (`info/attributes` too), and the project's `filter.*` entries go
to `git add` as `-c` - read from every scope, not `--local`, which misses `include.path`
and `config.worktree`. A file whose filter is named but has no `clean`/`process` anywhere
is taken off the session's index and excluded; that `check-attr` walk runs only when some
attributes file mentions `filter`. It first unsets every variable `git rev-parse --local-env-vars` lists, so nothing
inherited can point it elsewhere. `git add --ignore-errors` skips a file it cannot read
rather than aborting; a still-`fatal` add takes no snapshot. If the tree is unchanged from
the parent snapshot, no commit is made; after one is, `git gc --auto` packs the loose
objects once there are enough of them. Its input is the environment -
`VERODIFF_SESSION_ID`, `VERODIFF_PROMPT`, `CLAUDE_PROJECT_DIR` - so it needs no JSON
parser, and it always exits 0. `snapshot.sh where` prints the shadow repo's path and is
the only place the cache layout is computed; `snapshot.sh prune DAYS` drops sessions whose
newest snapshot is older than DAYS (never the asking session), and index or label files
with no ref that are DAYS old themselves, and runs
`git gc --prune=2.weeks.ago`, so a snapshot another session is writing cannot lose an
object.

**Who calls it.** The hooks module, through `$.process.run(['bash', snapshot.sh, ...])`
(`script()` in `register.tsx`) with `cwd` and `CLAUDE_PROJECT_DIR` set to
`$.session.root()`: `pre` on `turn.start` (with the prompt, cut to 100 characters by
`promptLabel()`), `post` on `turn.complete` of the main agent, then the pane reloads and
the band above the prompt follows. `prune 30` runs from `session.start` in the background, at most
once a day (`$.store` key `prunedAt`). There are no command hooks, so `/hooks` lists
nothing for VeroDiff.

**Storage.** `~/.cache/verodiff/<basename>-<md5-of-abspath>.git`, one bare repo per
project. Override with `VERODIFF_DIR`. Deliberately *not* `${CLAUDE_PLUGIN_DATA}`, so the
location does not depend on how the plugin was loaded. `claude plugin uninstall` does not
remove snapshots; `/vero-diff purge` (this project), `uninstall.sh --purge` (all) and the
daily prune (sessions idle 30 days) do. The module asks `snapshot.sh where` for the path
rather than computing it, so the two can never disagree.

**Per-session isolation.** Each session gets `refs/verodiff/session/<session_id>`, its own
index file and its own label file, so two sessions in one repo never race on
`index.lock` or corrupt each other's step list. The module passes `$.session.id()`. The
pane shows the current session only - by the owner's decision there is no session
picker: other sessions' edits would only confuse.

**Known limitation.** Two sessions sharing one working tree will see each other's edits in
their turn diffs. A snapshot is of the whole tree and cannot attribute changes. The answer
is a separate `git worktree` per session; do not try to solve this with refs.

**Submodules.** `git add -A` records a submodule (or any nested repository) as a gitlink,
the commit it points to, so its uncommitted work is in no tree. Each dirty one gets a
fingerprint - `cksum` of `git diff HEAD` and its untracked files, read with
`GIT_OPTIONAL_LOCKS=0` so its own `.git` is never written - kept as a `submodule-state`
trailer. When the set differs from the parent snapshot's, the commit is made even with an
unchanged tree and names each one in a `submodule-changed` trailer; `LOG_FORMAT` reads
those as a field, and the pane, the band and `last` say "Changes inside submodule X are
not shown." Showing the diff itself would mean a shadow per submodule; nobody has asked.

**The pane.** `ui.render` on `{ component: 'Pane', requestId: 'vero-diff' }`. State is one
atom, `view` (`$.state`, typed by `types/index.d.ts`); the drawing only reads it, the
handlers and events write it. `reload()` reads the log and the shown step's diff first and
writes steps, index and files in one `update` (`showing()`), so the pane never draws a new
step's title over the old step's files. Turn numbers past one read of `LIMIT` (200)
snapshots continue from `turnsBefore()`, a `rev-list --count` of the older `[post]`s. Each file is a `<Code format="diff">`. Buttons Older /
Newer / Latest / Refresh, plus Hide on `e.surface === 'terminal'` only (the desktop has
its own close mark). With more than one file the step opens with a list (`summary`):
each name jumps to its file (`file:<path>` key, `$.ui.scroll`) and each file ends with
**↑ Files** (`top:<path>`) back up. Each file's name (`fold:<path>`) folds it to one line
and ticks it in the list. Folds are `view.collapsed`, kept only while `view.shownSha`
stays the same: by the owner's decision, showing any other step or a new turn landing
means the step was accepted, so `loadStep()` drops them; re-reading the same step
(Refresh, `last`, the tool) keeps them. Nothing about folds is remembered beyond that.
Whether the person closed the pane is `$.store` key
`isPaneHidden`.

**The band.** One row above the prompt (`ui.render` on `AbovePrompt`): the newest step
(`view.latest`, from `stepSummary()` in `steps.ts`, kept for step 1 whichever step the pane
shows) and, while `view.isPaneOpen` is false, **Show diff**, which opens the pane as the
command does. Its **×** (`hide-band`) removes it entirely - the hook returns `next(e)`, so
no row is left - and `$.store` key `isBandHidden` keeps it gone across sessions until
`/vero-diff band`. It steps aside for a survey and draws nothing with no steps. It
replaced `$.ui.status` in 1.1.1 - see the gotcha below.

**The command and the tool.** `/vero-diff` opens the pane, `/vero-diff last [N]` answers
`command.run` with `{ text }` - markdown the model reads too - and `/vero-diff purge`
deletes the project's shadow repo. The model has the same diff as the tool
`mcp__vero-diff__turn_diff` (`{ step? }`), registered in `session.start` and served by a
`tool.call` hook. Everything is English only, by the owner's decision.

## Gotchas discovered the hard way

Re-deriving these costs an afternoon each. The 0.1.x gotchas about skills, `` !`cmd` ``
injection and the bash viewer's panes are in git history (CLAUDE.md before 1.0.0), should
any of that come back.

**Plugin and distribution**

- **Never declare `hooks` in `plugin.json`.** `hooks/hooks.json` is auto-discovered;
  naming it in the manifest loads it twice and the entire plugin fails to load.
- **`hooks.json` names the module and nothing else.** A command hook beside `modules`
  passes `claude plugin validate` but would take every snapshot twice. `tests/smoke.sh`
  asserts the exact content.
- **Never add a top-level `bin/`.** claude.ai rejects a plugin with one when distributed
  through Organization settings. 1.0 removed it; the smoke test guards it.
- **`version` in `plugin.json` pins the plugin.** Users keep the cached copy until the
  string changes. Bump it on every release, and never set `version` in both `plugin.json`
  and the marketplace entry - the manifest silently wins.
- **`name` is the user-visible key** in `enabledPlugins`. Renaming without a `renames`
  entry in `marketplace.json` breaks every existing install.
- **Reserved marketplace names** (`claude-plugins-official`, `anthropic-plugins`, and
  similar) cannot be used.
- **A `tool.call` matcher must be a literal string.** A template literal
  (`` `mcp__vero-diff__${TOOL}` ``) validates but the validator reads it as `tool=?`.
- **Give a gating hook a `.catch`.** `claude plugin validate` flags `ui.close` and
  `tool.call` hooks without one: a hook that throws there would keep the pane open or
  fail the model's call. Fire-and-forget calls (`$.ui.scroll`) get `.catch` too, or a
  refusal becomes an unhandled rejection.
- **`--scope project|local` writes to the current directory's `.claude/`.** Both
  `claude plugin marketplace add` and `claude plugin install` take `--scope`, and both
  write where they run. So `install.sh --scope project` takes the project's DIR and runs
  there, and declares the GitHub marketplace, not the clone's path, which no teammate has.
- **The mod API is early access.** The engine's own declaration says the surface may
  change between releases. Re-run `claude plugin validate` and `claude plugin test` against
  each new Claude Code release before cutting one of ours.

**Turns and snapshots**

- **Snapshot on `turn.start`, never on `prompt.submit`.** A prompt typed while a turn
  runs fires `prompt.submit` at Enter, mid-turn, which would split that turn in two.
- **Guard against subagent turns, but not forever.** `openTurnAt` is set at a main turn's
  start and cleared at its `turn.complete` (`e.agentId === undefined`), so a subagent's
  turn never takes a `pre` snapshot inside the main one. `turn.start` carries no agent id,
  so the guard is all there is - and a `turn.complete` that never arrived would stop
  snapshots for the rest of the session. Hence the reset in `session.start` and
  `session.end`, and the 6-hour staleness limit (`STALE_TURN_MS`).
- **`/clear` fires `session.end` (`reason: 'clear'`) and no `session.start`.** The process
  goes on under a new session id, so the pane would keep showing the old session's steps;
  the `session.end` hook empties it.
- **A message sent mid-turn ends the turn.** The steps since it land when the
  continuation finishes; until then the pane shows the last finished step. Not a bug, but
  it reads like one.
- **`turn.complete` fires for an interrupted turn too** (`reason: 'aborted'`), so an
  interrupted turn is its own step - unlike 0.1.x, whose `Stop` hook did not fire.
- **`$.process.run` time does not count against a hook's budget**, which is what makes
  awaiting `git add -A` inside `turn.start` safe. Its own default timeout is 30 s; the
  module passes 20 s, as the old command hook's `timeout` did.

**What the person sees**

- **Never show `[pre]` / `[post]` to a user.** They are snapshot kinds, not turns. A
  `post` snapshot is a turn and is numbered; a `pre` snapshot only becomes a step when the
  tree moved without a turn finishing (`edits outside a turn`), and labelling it with the
  prompt that follows it would claim that prompt caused changes that predate it.
  `parseLog()` in `hooks/steps.ts` owns this vocabulary, and its test asserts it.
- **The oldest snapshot of a session has no parent and is no step.** Its diff is the whole
  tree: no edit, and on a big project a huge one. The owner dropped it in 1.0; it is still
  taken, as the point turn 1 is measured from.
- **Turn numbers are counted from the oldest snapshot forward**, so they stay stable while
  the newest-first step index shifts with every new turn.
- **A `Code` element holds at most 10,000 characters**, and only tab and newline as
  control characters. `clean()` strips the rest (a CRLF file's `\r` would otherwise get
  the whole tree refused).
- **A diff cut mid-hunk no longer parses** and `Code` draws it as plain text, colouring
  and syntax highlighting gone. `fitHunks()` keeps whole hunks, and when even the first is
  too long, keeps what fits and rewrites its `@@` header to count exactly those lines.
- **Cut text by characters, never with `cut -c`.** GNU `cut` counts bytes, so a Cyrillic
  prompt was split through a character and git showed the stray byte as `Ñ`. The module
  cuts (`promptLabel()`); `snapshot.sh` never shortens the label.
- **Take a file's path from `rename to` / `+++ b/` / `--- a/`, never from the
  `diff --git` header alone.** A path holding ` b/` splits the header in the wrong place,
  a person's `diff.noprefix` or `diff.mnemonicPrefix` changes the prefixes, and `+++`
  ends with a tab when the path holds a space. Every diff runs with `DIFF_OPTIONS`
  (`--src-prefix=a/ --dst-prefix=b/`) and `core.quotePath=false`; `pathOf()` and
  `unquote()` in `steps.ts` read the rest.
- **A diff of a markdown file contains fences of its own.** `/vero-diff last` wraps the
  diff in a fence one backtick longer than the longest run inside it (`fenceFor()`).
- **The desktop app draws a diff without syntax highlighting.** `<Code format="diff">`
  gets token colours in the terminal, but the desktop colours only the added and removed
  lines - with `path`, and with `language` named outright (`languageOf()`) alike, which
  was tried and changed nothing. Nothing in the plugin can fix it; the README says so.
- **Do not use `$.ui.status` for good news.** The engine draws a plugin's status as a
  pinned notice: a `⚠` and the plugin's name in front of the text, neither of which the
  call can turn off. A summary there read as a warning, with the name twice
  (`⚠ vero-diff: VeroDiff: turn 1 ...`). The band draws its own row instead.
- **The desktop scrolls only to a Button's key, not a Box's.** `$.ui.scroll({ to: { key } })`
  at a keyed `Box` worked in the terminal and was refused in the desktop app with
  "no element of its own is drawn under that key" - and it says so only in `{ deny }`,
  which 1.1.0 swallowed. Jumps now aim at Buttons (`fold:<path>` heads each file,
  `goto:<first path>` heads the list), and a refusal is toasted with the surface.
- **The plugin's own `$.ui.close` skips its own `ui.close` hook.** Only a close by the
  person (the desktop's mark) or an unload passes through it, so the terminal's Hide
  left `isPaneOpen` true and Show diff never appeared. `closePane()` records the close
  itself before closing; the hook stays for the person's close.
- **A pane opened unasked waits for 144 terminal columns.** `/vero-diff` (asked) places it
  at any width. On a surface where it cannot dock, `$.ui.open` says `isPlaced: false`.
- **`$.store` is per plugin, not per project**, so hiding the pane hides it everywhere.
- **Hotkeys need the pane to hold the focus** (a click, or `Ctrl+x Tab`); from the prompt
  they would eat typed letters, so the engine never routes them there.

**Shell and portability**

- **git 2.22 is the floor.** `LOG_FORMAT`'s `%(trailers:key=...,valueonly,separator=...)`
  arrived then; an older git prints the placeholder as text and every step would name a
  "submodule". The README's Requirements says so.

- **Clear inherited git variables, in the script and in the module.** A `GIT_DIR` or
  `GIT_OBJECT_DIRECTORY` set by whoever started Claude Code (a git hook, a wrapper) is
  inherited - `$.process.run`'s `env` is laid *over* the host's - and would send writes into
  the project's own `.git`. `snapshot.sh` unsets the `--local-env-vars` list first;
  `git()` in `register.tsx` runs `env -u ... git --git-dir=<shadow>`.
- **One unreadable file aborts `git add -A`**, the index keeps its last state, and
  `write-tree` then records that - a lost turn, or on a new session the empty tree that
  makes turn 1 the whole project. Hence `--ignore-errors`, and no snapshot on `fatal:`.
- **The shadow reads its own `info/exclude` and `config`, not the project's.** Hence the
  copy and the `-c filter.*`; without them a `.env` excluded there was snapshotted and a
  git-crypt file stored in plain text.
- **Never loop in bash over every index entry.** `while read` over `git ls-files -s` cost
  0.3 s on 20,000 files; `tr '\0' '\n' | grep '^160000 '` costs 5 ms. A snapshot of a
  project with no submodules and no filters must stay near what 1.1.1 cost (0.05 s there,
  0.10 s now, all of it fixed process starts).
- **An empty array under `set -u` is "unbound" in bash 3.2.** Expand one that may be
  empty as `${arr[@]+"${arr[@]}"}`.

- **Target bash 3.2, not the bash you have**, in every `.sh` file. macOS still ships 3.2
  as `/bin/bash`, so `mapfile`/`readarray` and a fractional `read -t` are off limits.
  `tests/smoke.sh` greps for both, and the macOS CI job is the only place this is
  genuinely exercised - and the only place `snapshot.sh`'s `md5 -q` branch runs.
- **On macOS `mktemp` says `/var/...` and git says `/private/var/...`.** The shadow repo is
  keyed on git's toplevel, so anything that recomputes the key (the smoke test does) must
  hash `git rev-parse --show-toplevel`, not the path it created.
- **`/vero-diff purge` must not trust the path blindly.** It deletes only a path shaped
  like `<abs dir>/<name>-<hex>.git` (`isShadowPath()`) that git calls a bare repository.
  Do not narrow it to `/verodiff/` in the path - that breaks a legitimate `VERODIFF_DIR`.
- **Do not assert on a count of files in `.git/objects`.** Git repacks loose objects
  whenever it feels like it, so the count legitimately *falls* mid-test. The invariant is
  that VeroDiff never **adds** an object: diff the sorted object lists and require the
  added set to be empty.
- **`.gitattributes` pinning `eol=lf` is load-bearing, not tidiness.** `core.autocrlf=true`
  is the default on Windows installs of git, so a clone without it hands the user a
  `snapshot.sh` that dies with `/usr/bin/env: 'bash\r': No such file or directory`.

## Testing

Three checks, all run by CI, none needing an account or the network:

```bash
tests/smoke.sh                              # snapshot.sh: 62 assertions, git + bash only
claude plugin test ./plugins/vero-diff      # steps.ts and the pane, against the engine

claude plugin validate .                    # marketplace catalog
claude plugin validate ./plugins/vero-diff  # manifest, hooks module, state contract
claude plugin validate . --strict           # for CI
```

`claude plugin validate` reads the module the way the engine will - every hook, every
`$` call, every `$.state` key against `types/index.d.ts` - but it does not type-check.
Loading the plugin once with `--plugin-dir` makes the engine write its declarations into
`plugins/vero-diff/.claude-plugin/types/` (self-ignored) and a `tsconfig.json` beside
`plugin.json` that extends them (in `.gitignore`); after that,
`npx -p typescript tsc -p plugins/vero-diff` type-checks the module. Neither is
committed: the declarations belong to one Claude Code build.

The test kit runs with no fs, network or process. `tests/steps.test.ts` drives the
`$`-free code directly; `tests/pane.test.ts` draws the pane through the engine on
`terminal` and `desktop`, with hooks beneath the plugin standing in for the world
(`fakeWorld()`): `process.run` answers as `snapshot.sh` and git would. Three rules learned
writing it: an *op* beneath the plugin (`command.register`, `ui.open`, `session.id`,
`process.run`, ...) answers `{ value }`, an *event* (`session.start`, `session.end`)
answers its result; every `on(...)` comes before the test's first `$` call, so one world
per test (a loop of cases is a loop of tests); and `ui.scroll` cannot be observed - the kit lays nothing out, so a
key never resolves to an offset. Keep parsing and rules in `hooks/steps.ts`; add a case
for anything you fix; add a case to `tests/smoke.sh` for anything in `snapshot.sh`.

Live, in a scratch repository:

```bash
cd /some/test/repo
claude --plugin-dir /path/to/verodiff/plugins/vero-diff
```

A `--plugin-dir` folder is watched, so saving a plugin file reloads the module with no
restart, and a failing hook leaves a dim `vero-diff: ...` line in the transcript
(`claude --debug` for every occurrence). A `--plugin-dir` plugin shadows an installed one
of the same name for that session. The desktop app takes the same folder through
`CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`'s `env`.

Check in that session: the pane opens (or `/vero-diff` opens it), a prompt that edits a
file adds a step when the turn ends, `p`/`n`/`l`/`r` after `Ctrl+x Tab`, Hide closes it
and it stays closed in a new session until `/vero-diff`, `/vero-diff last` and `last 2`,
and `/vero-diff purge` last of all.

Manual snapshot invocation, useful for fixtures - the same environment the module sets:

```bash
export CLAUDE_PROJECT_DIR=$PWD VERODIFF_SESSION_ID=sess-A
VERODIFF_PROMPT="step 1" .../scripts/snapshot.sh pre
# ...edit files...
.../scripts/snapshot.sh post
.../scripts/snapshot.sh where          # the shadow repo's path
```

**Regression to always re-check after touching `snapshot.sh`:** the project's
`.git/objects` must gain no object (the smoke test's sorted-list comparison).

## Cutting a release

**Trigger.** The owner says "update version", "bump the version", "prepare a release" or
anything equivalent. Run the whole procedure; do not start it unprompted, and do not skip
steps because the change looks small.

### 1. Collect every change since the last release

```bash
# tags in this repo are plain `v<version>`, e.g. v0.1.1 - not the `vero-diff--v*` form
# that `claude plugin tag` produces. A pattern that matches nothing fails silently and
# quietly rebuilds a changelog for work already shipped, so keep these two in step.
LAST="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null)"
# no release tag yet? fall back to the commit that last set the version
[ -n "$LAST" ] || LAST="$(git log -1 --format=%H \
    -S'"version"' -- plugins/vero-diff/.claude-plugin/plugin.json)"

git log --no-merges --format='%h %s' "$LAST..HEAD"
git diff --stat "$LAST..HEAD"
git diff "$LAST..HEAD" -- plugins/vero-diff
```

Read the diff, not only the subjects. Commit messages here are one line by policy, so they
do not say what a user will actually notice. Weigh everything when judging the bump, but
keep CI, tests and internal refactors out of the user-facing notes.

### 2. Propose a number

Ordinary semver, from 1.0 on:

| What changed | Bump |
| :-- | :-- |
| a command, subcommand, key, tool or output format removed or renamed; snapshots an older release cannot read | major - `2.0.0` |
| a new command, subcommand, key, tool, or capability | minor - `1.1.0` |
| fixes, wording, docs, CI, tests only | patch - `1.0.1` |

### 3. Ask before editing anything

Put it to the owner with `AskUserQuestion`: the computed number first, the neighbouring
ones as alternatives, each labelled with why it fits. They may want a different number
entirely - their answer wins over the table above. Never bump without a reply.

### 4. Make the edits

- **`plugins/vero-diff/.claude-plugin/plugin.json`** - `version`. The only place a version
  has any effect, and the only file that *must* change. Never also put `version` in the
  marketplace entry; the manifest silently wins.
- **`plugins/vero-diff/CHANGELOG.md`** - a new `## <version> - <YYYY-MM-DD>` section at the
  top, in the house style: user-facing wording, grouped, never raw commit subjects.
- Anything the release makes untrue in `README.md`, `plugins/vero-diff/README.md` (keep
  those two byte-identical) or this file.
- Then run `tests/smoke.sh` and the three `claude plugin validate` commands, and report
  the result. Do not hand back a release that has not been checked.

### 5. Hand back - never execute

The working rules at the top still apply: no commit, no push, no tag. Stage the edits and
hand the owner three things.

1. The one-line commit message.
2. **Release notes** for the GitHub Release body, ready to paste: the changelog entry as a
   standalone note, opening with one sentence on why anyone should care.
3. The commands to run:

```bash
git add -A && git commit -m "VeroDiff <version>" && git push
git tag v<version> && git push origin v<version>
gh release create v<version> --title "VeroDiff <version>" --notes-file notes.md
```

### What a release actually is

A user's marketplace tracks **`main`**, not tags - `claude plugin marketplace add` has no
ref, tag or branch option, and the stored source is just `{"source":"github","repo":...}`.
So pushing a bumped `version` to `main` **is** the release; the tag and the GitHub Release
only announce it. A pushed tag is *not* a GitHub Release either - the Releases page stays
empty until one is published on top of the tag, so `gh release create` (or **Publish
release**, not **Save draft**, in the web form) is a step of its own. Two consequences
worth remembering:

- a fix pushed to `main` without a version bump reaches nobody - the cache is keyed by the
  version string, at `~/.claude/plugins/cache/verodiff-marketplace/vero-diff/<version>/`
- unfinished work sitting on `main` ships the moment the version changes, so keep it on a
  branch

Users update with `/plugin marketplace update verodiff-marketplace` then
`/plugin update vero-diff@verodiff-marketplace`, and a restart. Nothing auto-updates and
nothing notifies them, which is why the GitHub Release matters.

## Open ideas, not implemented

None at the moment.
