# VeroDiff - working notes

Context for continuing work on this repository. Everything here is current as of v0.1.0.

## Working rules

- **Never commit.** Do not run `git commit`, `git push`, `git tag`, `git rebase` or
  anything else that writes history - not even when the work is finished, the tree is
  clean and the change is obviously correct. Editing files and staging them is fine;
  creating a commit is the repo owner's call, always.
- **Finish with a really short commit description.** When an implementation is done, hand
  back a one-line commit message for the owner to use. One line, no body, no explanation
  wrapped around it.

## What this is

A Claude Code plugin that lets you review **what changed on each turn**. Two hooks bracket
a turn, a snapshot is taken at each boundary, and the diff of a turn is `git diff` between
two snapshots.

The problem it solves: built-in `/diff` shows all uncommitted work at once because it has
no notion of where a turn started.

## Repository layout

```
verodiff/                                  marketplace repo root
├── .claude-plugin/marketplace.json        catalog: name "verodiff-marketplace"
├── .gitattributes                         forces LF: the scripts are bash
├── install.sh                             validate -> marketplace add -> plugin install
├── uninstall.sh                           plugin uninstall (+ --purge for snapshots)
├── CLAUDE.md                              this file
├── README.md                              user-facing docs
└── plugins/vero-diff/                     the plugin, name "vero-diff"
    ├── .claude-plugin/plugin.json         manifest, version lives here
    ├── hooks/hooks.json                   UserPromptSubmit + Stop, exec form
    ├── scripts/snapshot.sh                the hook: takes one snapshot
    ├── bin/verodiff                       the viewer (browser + one-shot modes)
    ├── bin/verodiff-pane                  opens the viewer in a side pane
    ├── skills/steps/SKILL.md              /vero-diff:steps
    ├── skills/lastdiff/SKILL.md           /vero-diff:lastdiff [N]
    └── skills/purge/SKILL.md              /vero-diff:purge
```

## How it works

**Snapshot mechanism.** `scripts/snapshot.sh` runs on `UserPromptSubmit` (arg `pre`) and
`Stop` (arg `post`). It sets `GIT_DIR` to a bare repo in the cache and `GIT_WORK_TREE` to
the project, stages everything into a private index with `git add -A`, writes a tree, and
chains it onto a ref with `git commit-tree` + `git update-ref`. No object ever lands in
the project's `.git`; `.gitignore` is still honoured because git reads it from the work
tree. If the tree is unchanged from the parent snapshot, no commit is made.

**Storage.** `~/.cache/verodiff/<basename>-<md5-of-abspath>.git`, one bare repo per
project. Override with `VERODIFF_DIR`. Deliberately *not* `${CLAUDE_PLUGIN_DATA}`: that
variable is not exported into the Bash tool's environment, so a manually run `verodiff`
could not find its own snapshots. The trade-off is that `claude plugin uninstall` does not
remove snapshots; `uninstall.sh --purge` and `verodiff --purge-all` do.

**Per-session isolation.** Each session gets `refs/verodiff/session/<session_id>`, its own
index file and its own label file, so two terminals in one repo never race on
`index.lock` or corrupt each other's step list. The session id comes from the hook's stdin
JSON; skills pass `${CLAUDE_SESSION_ID}` to the viewer explicitly.

**Known limitation.** Two sessions sharing one working tree will see each other's edits in
their turn diffs. A snapshot is of the whole tree and cannot attribute changes. The answer
is a separate `git worktree` per session; do not try to solve this with refs.

**Viewer.** `bin/verodiff` is a full-screen browser written in bash: it renders the diff
into a temp file, draws a viewport with `sed -n`, and handles keys itself. `n`/`p` change
step without leaving the window. It runs on the alternate screen and disables line wrap
(`tput rmam`) so viewport arithmetic stays correct. When stdout or stdin is not a tty it
degrades to printing the latest diff as plain text - that is the path the `lastdiff` skill
uses.

## Gotchas discovered the hard way

Re-deriving these costs an afternoon each:

- **Never declare `hooks` in `plugin.json`.** `hooks/hooks.json` is auto-discovered;
  naming it in the manifest loads it twice and the entire plugin fails to load.
- **A non-zero exit from a `` !`cmd` `` injection aborts the whole skill invocation.**
  This is why `verodiff` exits 0 even for "not a git repository" and "no such step".
- **Injected commands never prompt for permission.** If they are not covered by
  `allowed-tools`, the invocation is aborted rather than asked about.
- **`bin/` is on the Bash tool's PATH** while the plugin is enabled, which is why the
  skills call bare `verodiff` / `verodiff-pane`. It is *not* on the PATH of a shell spawned
  into a new pane, so `verodiff-pane` resolves `verodiff` from `$BASH_SOURCE`.
- **claude.ai rejects a plugin with a top-level `bin/`** when distributed through
  Organization settings. That route needs the scripts moved to `scripts/` and the skills
  changed to `${CLAUDE_PLUGIN_ROOT}/scripts/<name>`.
- **`version` in `plugin.json` pins the plugin.** Users keep the cached copy until the
  string changes. Bump it on every release, and never set `version` in both `plugin.json`
  and the marketplace entry - the manifest silently wins.
- **`name` is the user-visible key** in `enabledPlugins`. Renaming without a `renames`
  entry in `marketplace.json` breaks every existing install.
- **Reserved marketplace names** (`claude-plugins-official`, `anthropic-plugins`, and
  similar) cannot be used.
- **A `trap handler EXIT INT TERM` that does not exit swallows the signal.** Bash runs the
  handler and then *resumes* the loop, so `Ctrl+C` left a viewer running with `$BUF`
  already deleted - it looked exactly like "navigation stopped working". Signal traps
  need their own `exit`: `trap 'cleanup; exit 130' INT`.
- **Under WSL, `wt.exe` is always on PATH**, so a `command -v wt.exe` branch with no
  `WT_SESSION` guard hijacks every other terminal. And Windows Terminal cannot `-d` into
  a Linux path, nor run the distro's `bash` - both give 0x8007010b. Go through
  `wsl.exe -d "$WSL_DISTRO_NAME" --cd "$DIR" -- bash -lc ...`.
- **De-duplicate panes by pid file, not by terminal feature.** The viewer writes
  `$SHADOW/viewer-<session>.pid`; `verodiff-pane` reuses a live one. A tmux-title check
  only ever covered tmux, and every other backend multiplied windows.
- **A pane is a fresh login shell**, so anything the viewer needs from the environment
  (`VERODIFF_DIR`) has to be baked into the command string.
- **`` !`cmd` `` output is context, not display.** It is injected into the model's prompt
  and never rendered, so a skill whose job is to *show* something cannot use it - the user
  sees only the model's reply. Run the command through the Bash tool instead; its output
  appears in the transcript. This is what made `lastdiff` look like it worked in headless
  tests ("1 file changed") while showing the user no diff at all.
- **`${CLAUDE_SESSION_ID}` expands in plain skill body text**, not just inside `` !`cmd` ``.
  Baking the literal id into the command string matters, because the Bash permission
  matcher rejects a command containing a shell expansion (`Contains simple_expansion`)
  even when the prefix is covered by `allowed-tools`.
- **`CLAUDE_SESSION_ID` is not in the Bash tool's environment**; the variable there is
  `CLAUDE_CODE_SESSION_ID`, and it does equal the `session_id` the hooks record.
- **Never show `[pre]` / `[post]` to a user.** They are snapshot kinds, not turns. A
  `post` snapshot is a turn and is numbered; a `pre` snapshot only becomes a step when the
  tree moved without a turn finishing, and labelling it with the prompt that follows it
  claims that prompt caused changes that predate it. `describe()` in `bin/verodiff` owns
  this vocabulary - the browser header, `-l` and `-s` all go through it.
- **The oldest snapshot of a session has no parent**, so its diff is the entire tree.
  That is a baseline, not an edit, and it says so.
- **Turn numbers are counted from the oldest snapshot forward**, so they stay stable while
  the newest-first step index shifts with every new turn.
- **`.gitattributes` pinning `eol=lf` is load-bearing, not tidiness.** Every executable
  here is bash, and `core.autocrlf=true` is the default on Windows installs of git, so a
  clone without it hands the user scripts that die with
  `/usr/bin/env: 'bash\r': No such file or directory` (rc 127). Verified by cloning with
  `-c core.autocrlf=true` both ways.

## Testing

```bash
claude plugin validate .                      # marketplace catalog
claude plugin validate ./plugins/vero-diff    # manifest, hooks.json, skills
claude plugin validate . --strict             # for CI

cd /some/test/repo
claude --plugin-dir /path/to/verodiff/plugins/vero-diff
```

In that session: `/hooks` lists two `snapshot.sh` entries, send a prompt that edits a file,
then `/vero-diff:steps`. `/reload-plugins` picks up edits without a restart. A
`--plugin-dir` plugin shadows an installed one of the same name for that session.

The viewer's interactive path needs a tty, so drive it under `script` when testing
non-interactively:

```bash
( printf 'n'; sleep 3; printf 'r'; sleep 1; printf 'q' ) \
  | script -qec "verodiff" /dev/null > /tmp/out
```

Then split `/tmp/out` on `\033[H\033[2J` to inspect each rendered frame.

Two traps when testing this non-interactively:

- **Do not background the viewer to test `Ctrl+C`.** A non-interactive shell sets `SIGINT`
  to `SIG_IGN` for background jobs, and an ignored signal cannot be trapped, so the viewer
  will look broken when it is fine. Run it in the foreground of the pty and write `\003`
  into its stdin. `SIGTERM` is unaffected and can be tested with `kill` on the pid in
  `$SHADOW/viewer-<session>.pid`.
- **Never use `pkill -f verodiff`.** The pattern matches the calling shell's own argv,
  so it kills the test harness. Kill by pid.

To exercise `verodiff-pane` without opening real windows, put stubs for `wt.exe`,
`wsl.exe`, `wezterm`, `kitty` and `x-terminal-emulator` on PATH that just log their argv.

Manual snapshot invocation, useful for fixtures:

```bash
export CLAUDE_PROJECT_DIR=$PWD
echo '{"prompt":"step 1","session_id":"sess-A"}' | .../scripts/snapshot.sh pre
# ...edit files...
echo '{"session_id":"sess-A"}' | .../scripts/snapshot.sh post
```

**Regression to always re-check after touching `snapshot.sh`:** count objects in the test
project's `.git/objects` before and after a snapshot. The number must not change.

## Releasing

Per the working rules above, the owner runs this, not you:

```bash
git add . && git commit -m "VeroDiff 0.1.0" && git push
```

Users need `/plugin marketplace add <owner>/verodiff` then
`/plugin install vero-diff@verodiff-marketplace`. Bump `version` in `plugin.json` and add
a `CHANGELOG.md` entry first.

Placeholders still to fill before publishing: `owner.name` in `marketplace.json`,
`author.name` in `plugin.json`, the copyright line in `LICENSE`, and the clone URL in
`README.md`.

## Open ideas, not implemented

- Horizontal scrolling in the viewer for very wide diffs (currently truncated).
- Per-file navigation inside a step, rather than only line scrolling.
- Pruning old snapshots: nothing expires them today except `--clear` / `--purge-all`.
- A `SessionEnd` hook that drops a session's ref once its snapshots are stale.
- Filtering a step's diff by path, for monorepos.
- `claude plugin eval` cases; none exist yet.
