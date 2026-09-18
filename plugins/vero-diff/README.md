<p align="center">
  <img src="https://raw.githubusercontent.com/GomelHawk/VeroDiff/main/assets/promo.png"
       alt="VeroDiff - see exactly what changed in each turn. A Claude Code plugin that shows the real diff for every turn."
       width="900">
</p>

<p align="center">
  <a href="https://github.com/GomelHawk/VeroDiff/actions/workflows/ci.yml"><img src="https://github.com/GomelHawk/VeroDiff/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/GomelHawk/VeroDiff/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-8a63d2.svg" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/requires-git%20%2B%20bash-555.svg" alt="Requires git and bash">
</p>

A Claude Code plugin that lets you review **what changed on each turn**, as a real diff
with syntax highlighting, instead of one undifferentiated pile of uncommitted work.

The built-in `/diff` shows everything uncommitted at once, because it has no notion of
"where this turn started". VeroDiff creates that boundary: it snapshots the working tree
when you submit a prompt and again when Claude finishes, so the diff of a turn is just
`git diff` between two snapshots.

Snapshots are stored outside your project. Your `.git` is never written to.

## Install

Two lines, typed inside Claude Code:

```
/plugin marketplace add GomelHawk/VeroDiff
/plugin install vero-diff@verodiff-marketplace
```

Then restart Claude Code. That is the whole install - there is nothing to configure and
no API key involved.

To confirm it took, run `/hooks`: you should see two `snapshot.sh` entries, one under
`UserPromptSubmit` and one under `Stop`. Those are the two boundaries of a turn.

<details>
<summary>Installing from a clone instead</summary>

```bash
git clone https://github.com/GomelHawk/VeroDiff
cd VeroDiff
./install.sh                    # or: ./install.sh --scope project, to share it with a team
```

`--scope project` writes the plugin into the repository's `.claude/settings.json`, so
everyone who trusts that folder gets VeroDiff without installing anything themselves.
</details>

## Your first diff

1. Open Claude Code in any git repository.
2. Ask it to change a file.
3. Run **`/vero-diff:lastdiff`** - the diff of that one turn is printed into the chat.
4. Run **`/vero-diff:steps`** - a pane opens beside you and redraws after every turn.

VeroDiff only sees turns that happen after it is installed, so your first recorded turn is
the next thing you ask for. It reads your working tree and writes nothing into your
project - see [Where snapshots live](#where-snapshots-live).

## Use

| Command | What it does |
| :-- | :-- |
| `/vero-diff:steps` | Opens a side pane that redraws the diff after every turn |
| `/vero-diff:lastdiff` | Prints the latest turn's summary and its full diff into the chat |
| `/vero-diff:lastdiff 2` | Same, for the step two turns back |
| `/vero-diff:purge` | Deletes this project's snapshot history |

The pane is a full-screen browser: the diff fills the window, a header names the step and
the prompt that produced it, and a key bar sits on the last row at all times.

Steps are described the way you would describe them out loud:

```
  0  2 minutes ago   turn 3  "add a random word to a.txt"
                     a.txt
  1  6 minutes ago   edits outside a turn
                     a.txt
  2  9 minutes ago   session baseline
                     a.txt, notes.md
```

A **turn** is one exchange: everything that changed between you pressing enter and Claude
finishing. Turns are numbered from the start of the session, so `turn 3` stays `turn 3`
even as newer steps push it down the list. **Edits outside a turn** are changes that were
already on disk before a turn ran - your own edits, or a turn that was interrupted before
it finished - so they are not attributed to any prompt. The **session baseline** is the
tree as it stood when the session began.

| Key | Action |
| :-- | :-- |
| `j` / `k` or arrows | scroll a line |
| `space` / `b` | scroll a page |
| `g` / `G` | jump to top / bottom |
| `n` / `p` | previous / next step, without leaving the window |
| `r` | reload the step list |
| `q` | quit |

While you sit on the newest step, a turn that lands is picked up automatically. While you
are browsing older steps, it isn't - the key bar shows `* new step, press r` instead, so
scrolling through history is never yanked out from under you. `--follow` always jumps to
the newest turn.

`q` or `Ctrl+C` closes the viewer and restores your terminal.

Only one viewer runs per project. If one is already open, `/vero-diff:steps` says so and
reuses it rather than opening a second window - in tmux it focuses that pane for you.

### Moving between the pane and Claude

VeroDiff only asks your terminal for a split. Moving focus, resizing and closing that pane
stay your terminal's job, so the keys are its keys, not the plugin's. These are the shipped
defaults - if you have remapped them, yours win.

| Terminal | Move focus | Resize | Close the pane |
| :-- | :-- | :-- | :-- |
| **tmux** | `Ctrl+b` then an arrow (`Ctrl+b o` cycles, `Ctrl+b q` numbers them) | `Ctrl+b` then `Ctrl`+arrow for one cell, or `Alt`+arrow for five | `Ctrl+b x` |
| **Windows Terminal** (including WSL) | `Alt`+arrow | `Alt+Shift`+arrow | `Ctrl+Shift+W` |
| **WezTerm** | `Ctrl+Shift`+arrow | `Ctrl+Shift+Alt`+arrow | `Ctrl+Shift+W` |
| **kitty** | `Ctrl+Shift+[` and `Ctrl+Shift+]` | `Ctrl+Shift+R`, then arrows, `Esc` to finish | `Ctrl+Shift+W` |
| **macOS Terminal** | a separate window: `Cmd+` `` ` `` cycles windows | drag the window edge | close the window |
| **Any other Linux terminal** | a separate window: your window manager, usually `Alt+Tab` | drag the window edge | close the window |

In every one of them, `q` inside the viewer also closes it, which is usually quicker than
reaching for the terminal's own binding.

Two tmux extras worth knowing, since the pane is often narrower than a diff: `Ctrl+b z`
zooms it to fill the whole window and again to put it back, and with `set -g mouse on` you
can drag the border between panes.

### How wide the pane opens

Set `VERODIFF_PANE_SIZE` to a percentage of the window before starting Claude Code:

```bash
export VERODIFF_PANE_SIZE=35     # default 50, clamped to 10-90; "35%" works too
claude
```

tmux, Windows Terminal and WezTerm honour it. kitty, macOS Terminal and the generic Linux
fallback open a separate window instead of a split, so they ignore it - size those the way
you size any other window.

It picks up `delta` automatically if you have it installed, and renders on an alternate
screen so your shell scrollback survives.

The same viewer works from any terminal, since the plugin's `bin/` is on the Bash tool's
PATH while the plugin is enabled:

```
verodiff              browser
verodiff --follow     browser that jumps to each new turn
verodiff -l           list steps
verodiff -n 3         diff of step 3
verodiff --sessions   list sessions that have snapshots
verodiff --where      where snapshots live, and how big they are
verodiff --purge-all  delete every snapshot cache
```

## Where snapshots live

Not in your project. Each project gets its own bare repository under `~/.cache/verodiff/`,
and the hook points `GIT_DIR` there while pointing `GIT_WORK_TREE` at your project. Git
reads your files and honours `.gitignore`, but writes every object into the cache. Your
`.git`, `git status`, `git log --all` and `git push` are untouched.

Override the location with `VERODIFF_DIR`.

## Concurrent sessions

Each session gets its own ref (`refs/verodiff/session/<id>`), its own index file and its
own label file, so two terminals in one repository don't corrupt each other's step
history. What they can't avoid is sharing a working tree: if both sessions edit files in
the same checkout during the same turn, both sets of edits appear in the diff. For real
isolation, give each session its own `git worktree`.

## Develop and test locally

Run the test suite first. It needs nothing but git and bash - no Claude Code, no network,
no credentials - and it is the same script CI runs:

```bash
tests/smoke.sh
```

It asserts the promises the plugin makes: that a snapshot never adds an object to the
project's own `.git`, that `.gitignore` is honoured, that every `verodiff` mode exits 0
(a non-zero exit aborts a skill invocation), and that no internal `[pre]`/`[post]` marker
leaks into what a user reads.

Then validate the structure. The two runs check different things - the marketplace
catalog, and the plugin's own manifest, hooks and component directories:

```bash
claude plugin validate .                    # marketplace.json
claude plugin validate ./plugins/vero-diff  # plugin.json, hooks.json, skills
claude plugin validate . --strict           # treat warnings as errors, for CI
```

Then load the plugin for one session, with no install and no marketplace:

```bash
cd /some/test/repo
claude --plugin-dir /path/to/verodiff/plugins/vero-diff
```

Inside that session: `/hooks` should list the two snapshot hooks, and `/plugin` should
show VeroDiff as loaded. Send any prompt that edits a file, then run `/vero-diff:steps`.
After editing plugin files, run `/reload-plugins` instead of restarting.

A `--plugin-dir` plugin shadows an installed plugin of the same name for that session, so
you can test changes without uninstalling the released copy.

If anything behaves oddly under `--plugin-dir`, fall back to the full path, which also
exercises the marketplace layout:

```
/plugin marketplace add /path/to/VeroDiff
/plugin install vero-diff@verodiff-marketplace
```

A local-directory marketplace loads the plugin **in place** rather than copying it into
the cache, so your edits apply at the next `/reload-plugins` with no version bump.

### What CI checks

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Checks |
| :-- | :-- |
| **Plugin manifests** | all three `claude plugin validate` runs, `--strict` included |
| **Shell lint** | `bash -n` and ShellCheck (`-S warning`) over every script |
| **Smoke** | `tests/smoke.sh` on Linux *and* macOS - macOS matters, because `snapshot.sh` takes its `md5 -q` branch there rather than `md5sum` |
| **Line endings** | re-clones with `core.autocrlf=true`, the Windows default, and proves the scripts still have LF endings, are executable, and run |

## Share it

VeroDiff is already a marketplace repository, so publishing is just pushing it:

```bash
git init && git add . && git commit -m "VeroDiff 0.1.0"
git remote add origin https://github.com/GomelHawk/VeroDiff
git push -u origin main
```

Users then need two lines:

```
/plugin marketplace add GomelHawk/VeroDiff
/plugin install vero-diff@verodiff-marketplace
```

Any git host works - GitLab, Bitbucket, self-hosted - with the full URL instead of the
`owner/repo` shorthand.

Forking this for your own plugin? The fields to change are `owner.name` in
`.claude-plugin/marketplace.json`, `author.name`, `homepage` and `repository` in
`plugins/vero-diff/.claude-plugin/plugin.json`, and the copyright line in `LICENSE`.

### Releasing updates

`version` in `plugin.json` pins the plugin: users keep their cached copy until that string
changes, so bump it on every release. Never set `version` in both `plugin.json` and the
marketplace entry - `plugin.json` silently wins.

Never change the plugin's `name` without adding a `renames` entry to `marketplace.json`;
the name is what users' `enabledPlugins` keys on.

A useful CI step is `claude plugin validate . --strict` on every push.

### Other distribution routes

- **Teams**: commit `extraKnownMarketplaces` and `enabledPlugins` to a repo's
  `.claude/settings.json`, and everyone who trusts that folder gets VeroDiff with no
  separate prompt.
- **Wider audience**: list it in a community marketplace catalog, or submit to Anthropic's
  official directory. Review there looks at documentation quality and security boundaries,
  not just whether the JSON validates.
- **No git on the user's machine**: publish a zip and list it with an `archive` source
  plus a `sha256` pin.

Reserved marketplace names (`claude-plugins-official`, `anthropic-plugins`, and similar)
can't be used, which is why this catalog is called `verodiff-marketplace`.

## Uninstall

```bash
./uninstall.sh            # removes hooks and skills, keeps snapshots
./uninstall.sh --purge    # also deletes every snapshot cache
```

`claude plugin uninstall` removes the hooks and skills on its own - there is no settings
file to clean up by hand.

## Troubleshooting

| What you see | What it means |
| :-- | :-- |
| `No snapshots yet` | The hooks have not run. Check `/hooks` lists two `snapshot.sh` entries, then send one prompt. |
| `/hooks` lists nothing for VeroDiff | Claude Code was not restarted after installing. Restart it, or run `/reload-plugins`. |
| `not a git repository - nothing to show` | VeroDiff diffs a git working tree; there is nothing to snapshot outside one. |
| The pane never opens | No supported terminal was detected. Run `verodiff` yourself in a second terminal - it is the same viewer. |
| `verodiff: command not found` | The plugin's `bin/` is on `PATH` only while the plugin is enabled. Check `/plugin`. |
| A turn shows edits you did not ask for | Either you changed files yourself between turns - those appear as `edits outside a turn` - or a second session shares this working tree. See [Concurrent sessions](#concurrent-sessions). |
| The pane is stuck on an older turn | You are browsing history, so new turns do not yank the view. The key bar says `* new step, press r`; press `r`. |
| A turn you expected is missing | A turn that changed nothing records no step, by design. |
| Snapshots are taking up space | `verodiff --where` shows the location and size, `/vero-diff:purge` clears this project, `verodiff --purge-all` clears every project. |

## Requirements

git, bash, and optionally `delta` for nicer diffs and `tmux`, WezTerm, kitty or Windows
Terminal for the side pane. Under WSL the pane opens through `wsl.exe`, so Windows
Terminal can reach your Linux working directory. Without any of them the viewer still
runs - `verodiff` in a second terminal does the same job. See
[Moving between the pane and Claude](#moving-between-the-pane-and-claude) for the keys
each terminal uses to switch and resize. `jq` or `python3` is used to read the prompt text out of the
hook payload; without either, steps are still recorded but unlabeled.

## Note for organization distribution

claude.ai rejects plugins that ship a top-level `bin/` directory. If you distribute this
through **Organization settings > Plugins**, move `bin/verodiff` and `bin/verodiff-pane`
into `scripts/` and update the skills to call `${CLAUDE_PLUGIN_ROOT}/scripts/<name>`
instead of the bare command.

## License

MIT
