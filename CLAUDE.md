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
├── uninstall.sh                           plugin uninstall (+ --purge for snapshots)
├── CLAUDE.md                              this file
├── README.md                              user-facing docs
└── plugins/vero-diff/                     the plugin, name "vero-diff"
    ├── .claude-plugin/plugin.json         manifest: version, "types" contract
    ├── hooks/hooks.json                   { "modules": ["./register.tsx"] }, nothing else
    ├── hooks/register.tsx                 the mod: snapshots, /vero-diff, the pane
    ├── hooks/steps.ts                     pure parsing of git output (no `$`), tested
    ├── types/index.d.ts                   $.state contract: PluginState['vero-diff']
    ├── tests/steps.test.ts                `claude plugin test` suite for steps.ts
    └── scripts/snapshot.sh                takes one snapshot; called by the module
```

## How it works

**Snapshot mechanism.** `scripts/snapshot.sh` takes one snapshot. It sets `GIT_DIR` to a
bare repo in the cache and `GIT_WORK_TREE` to the project, stages everything into a
private index with `git add -A`, writes a tree, and chains it onto a ref with
`git commit-tree` + `git update-ref`. No object ever lands in the project's `.git`;
`.gitignore` is still honoured because git reads it from the work tree. If the tree is
unchanged from the parent snapshot, no commit is made. It reads the same stdin JSON a
command hook would (`prompt`, `session_id`) and always exits 0.

**Who calls it.** The hooks module, through `$.process.run(['bash', snapshot.sh, kind])`
with `cwd` and `CLAUDE_PROJECT_DIR` set to `$.session.root()`: `pre` on `turn.start`
(with the prompt), `post` on `turn.complete` of the main agent, then the pane reloads.
There are no command hooks any more, so `/hooks` lists nothing for VeroDiff.

**Storage.** `~/.cache/verodiff/<basename>-<md5-of-abspath>.git`, one bare repo per
project. Override with `VERODIFF_DIR`. Deliberately *not* `${CLAUDE_PLUGIN_DATA}`, so the
location does not depend on how the plugin was loaded. `claude plugin uninstall` does not
remove snapshots; `/vero-diff purge` (this project) and `uninstall.sh --purge` (all) do.
The module computes the path with the same shell lines as `snapshot.sh` (`SHADOW_SCRIPT`)
so the two can never disagree.

**Per-session isolation.** Each session gets `refs/verodiff/session/<session_id>`, its own
index file and its own label file, so two sessions in one repo never race on
`index.lock` or corrupt each other's step list. The module passes `$.session.id()`. The
pane shows the current session only - by the owner's decision there is no session
picker: other sessions' edits would only confuse.

**Known limitation.** Two sessions sharing one working tree will see each other's edits in
their turn diffs. A snapshot is of the whole tree and cannot attribute changes. The answer
is a separate `git worktree` per session; do not try to solve this with refs.

**The pane.** `ui.render` on `{ component: 'Pane', requestId: 'vero-diff' }`. State is one
atom, `view` (`$.state`, typed by `types/index.d.ts`); the drawing only reads it, the
handlers and events write it. Each file is a `<Code format="diff">`. Buttons Older /
Newer / Latest / Refresh, plus Hide on `e.surface === 'terminal'` only (the desktop has
its own close mark). Whether the person closed it is `$.store` key `isPaneHidden`.

**The command.** `/vero-diff` opens the pane, `/vero-diff last [N]` answers `command.run`
with `{ text }` - markdown the model reads too - and `/vero-diff purge` deletes the
project's shadow repo. Everything is English only, by the owner's decision.

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
- **The mod API is early access.** The engine's own declaration says the surface may
  change between releases. Re-run `claude plugin validate` and `claude plugin test` against
  each new Claude Code release before cutting one of ours.

**Turns and snapshots**

- **Snapshot on `turn.start`, never on `prompt.submit`.** A prompt typed while a turn
  runs fires `prompt.submit` at Enter, mid-turn, which would split that turn in two.
- **Guard against subagent turns.** `isTurnOpen` is set at a main turn's start and
  cleared at its `turn.complete` (`e.agentId === undefined`), so a subagent's turn never
  takes a `pre` snapshot inside the main one.
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
  control characters. `splitFiles()` cuts each file at 9,000 on a line boundary and
  strips the rest (a CRLF file's `\r` would otherwise get the whole tree refused).
- **A diff of a markdown file contains fences of its own.** `/vero-diff last` wraps the
  diff in a fence one backtick longer than the longest run inside it (`fenceFor()`).
- **A pane opened unasked waits for 144 terminal columns.** `/vero-diff` (asked) places it
  at any width. On a surface where it cannot dock, `$.ui.open` says `isPlaced: false`.
- **`$.store` is per plugin, not per project**, so hiding the pane hides it everywhere.
- **Hotkeys need the pane to hold the focus** (a click, or `Ctrl+x Tab`); from the prompt
  they would eat typed letters, so the engine never routes them there.

**Shell and portability**

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
tests/smoke.sh                              # snapshot.sh: 30 assertions, git + bash only
claude plugin test ./plugins/vero-diff      # hooks/steps.ts against the engine itself

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

The test kit runs with no fs, network or process, so only `$`-free code is unit-tested.
Keep parsing and rules in `hooks/steps.ts` and add a case to `tests/steps.test.ts` for
anything you fix there; add a case to `tests/smoke.sh` for anything in `snapshot.sh`.

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

Manual snapshot invocation, useful for fixtures - the same payload the module sends:

```bash
export CLAUDE_PROJECT_DIR=$PWD
echo '{"prompt":"step 1","session_id":"sess-A"}' | .../scripts/snapshot.sh pre
# ...edit files...
echo '{"session_id":"sess-A"}' | .../scripts/snapshot.sh post
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

The project is 0.x, so:

| What changed | Bump |
| :-- | :-- |
| a command, flag, key or output format removed or renamed | minor - `0.2.0` |
| a new command, flag, terminal, or capability | minor |
| fixes, wording, docs, CI, tests only | patch - `0.1.1` |

After 1.0 this becomes ordinary semver, breaking changes taking the major.

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

- Horizontal scrolling in the pane for very wide diffs (currently truncated or wrapped).
- Per-file navigation inside a step: click a file in a `--stat` header to jump to it.
- Pruning old snapshots: nothing expires them today except `/vero-diff purge`.
- A `session.end` hook that drops a session's ref once its snapshots are stale.
- Filtering a step's diff by path, for monorepos.
- A tool (`$.tool`) the model can call to read a turn's diff without the person typing
  `/vero-diff last`.
- `claude plugin eval` cases; none exist yet.
