<p align="center">
  <img src="https://raw.githubusercontent.com/GomelHawk/VeroDiff/main/assets/promo2.png"
       alt="VeroDiff, now a mod: every turn's diff in a native Claude Code pane - the same pane in the terminal and in the desktop app."
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
when a turn starts and again when Claude finishes, so the diff of a turn is just
`git diff` between two snapshots. Each turn's diff is drawn in a side pane, in the
terminal and in the desktop app's Code tab alike.

Snapshots are stored outside your project. Your `.git` is never written to.

## Install

Two commands, typed inside Claude Code. **Run them one at a time** - the first has to
finish before the second will work.

**1. Add the marketplace.** Type this on its own and press Enter:

```
/plugin marketplace add GomelHawk/VeroDiff
```

Wait for `✔ Successfully added marketplace: verodiff-marketplace`.

**2. Install the plugin.** Now type this one:

```
/plugin install vero-diff@verodiff-marketplace
```

You should see `✓ Installed VeroDiff. Plugin is now active.`

Then restart Claude Code. That is the whole install - there is nothing to configure and
no API key involved.

> Pasting both lines at once does not work. If a panel appears asking you to
> `Enter marketplace source:`, it wants only the repository, `GomelHawk/VeroDiff`, and
> nothing else on the line. Pasting the second command into that box gives you
> `... is not a valid GitHub owner/repo shorthand`.

Prefer your shell? These two take their arguments directly and never open a panel:

```bash
claude plugin marketplace add GomelHawk/VeroDiff
claude plugin install vero-diff@verodiff-marketplace
```

To confirm it took, type `/vero-diff`: the command should be in the list, and running it
opens the VeroDiff pane.

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
3. When the turn ends, the VeroDiff pane shows its diff. If the pane is not open, run
   **`/vero-diff`**.
4. Run **`/vero-diff last`** to print the same diff into the chat instead.

VeroDiff only sees turns that happen after it is installed, so your first recorded turn is
the next thing you ask for. It reads your working tree and writes nothing into your
project - see [Where snapshots live](#where-snapshots-live).

## Use

| Command | What it does |
| :-- | :-- |
| `/vero-diff` | Opens the pane: this session's steps, newest first, each with its full diff |
| `/vero-diff last` | Prints the latest turn's summary and its full diff into the chat |
| `/vero-diff last 2` | Same, for step 2 - the steps are numbered as the pane numbers them |
| `/vero-diff purge` | Deletes this project's snapshot history, every session's |

The pane is a native part of Claude Code: a sidebar beside the transcript in the terminal,
a panel in the desktop app. A header names the step and the prompt that produced it, and
each changed file follows with its diff, highlighted the way Claude Code draws its own.

Steps are described the way you would describe them out loud:

```
turn 3  "add a random word to a.txt"
edits outside a turn
turn 2  "rename the helper"
```

A **turn** is one exchange: everything that changed between you pressing enter and Claude
finishing. Turns are numbered from the start of the session, so `turn 3` stays `turn 3`
even as newer steps push it down the list. **Edits outside a turn** are changes that were
already on disk before a turn ran - your own edits, typically - so they are not attributed
to any prompt. A turn that changed nothing is no step at all.

| Button | Key | Action |
| :-- | :-- | :-- |
| **Older** | `p` | the step before this one |
| **Newer** | `n` | the step after this one |
| **Latest** | `l` | back to the newest step |
| **Refresh** | `r` | read the snapshots again |
| **Hide** | `h` | close the pane (terminal only - the desktop app has its own close button) |

The keys work once the pane has the focus: click it, or press `Ctrl+x` then `Tab`. Scroll
a long diff with the mouse wheel. When a turn ends, the pane moves to it by itself.

A closed pane stays closed, in every later session too, until you run `/vero-diff` again.
In the terminal the pane opens by itself only in a window at least 144 columns wide;
`/vero-diff` opens it at any width.

`/vero-diff last` is also how Claude gets to see a diff: its output is part of the
conversation, so you can follow it with "check what you changed in that turn". Very long
diffs are cut there, to spare the context window; the pane always has the whole of it.

## Updating

Nothing updates itself, and Claude Code will not tell you a new version exists. Releases
are announced at
[github.com/GomelHawk/VeroDiff/releases](https://github.com/GomelHawk/VeroDiff/releases) -
watch the repository if you want an email.

To pull the latest, inside Claude Code, **one command at a time** - same as installing.

**1. Refresh the catalog**, so Claude Code sees that a newer version exists:

```
/plugin marketplace update verodiff-marketplace
```

**2. Update the plugin:**

```
/plugin update vero-diff@verodiff-marketplace
```

then restart Claude Code. Pasting both lines together fails the same way the install does.

The same thing from a shell, where you can run them back to back:

```bash
claude plugin marketplace update verodiff-marketplace
claude plugin update vero-diff@verodiff-marketplace
```

`claude plugin list` shows which version you are on, and `claude plugin update` says so
explicitly when there is nothing newer.

## Where snapshots live

Not in your project. Each project gets its own bare repository under `~/.cache/verodiff/`,
and the snapshot script points `GIT_DIR` there while pointing `GIT_WORK_TREE` at your project. Git
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

There are two suites, and CI runs both. The first needs nothing but git and bash - no
Claude Code, no network, no credentials:

```bash
tests/smoke.sh
```

It asserts the promises `snapshot.sh` makes: that a snapshot never adds an object to the
project's own `.git`, that `.gitignore` is honoured, that a turn which changes nothing
records nothing, and that the hook exits 0 even outside a git repository.

The second runs the pane's TypeScript against Claude Code's own engine - still no account
and no network:

```bash
claude plugin test ./plugins/vero-diff
```

It covers how steps are named and numbered (no internal `[pre]`/`[post]` marker may reach
a user), how a diff is split per file, and which paths `/vero-diff purge` will delete.

Then validate the structure. The two runs check different things - the marketplace
catalog, and the plugin's own manifest, hooks and component directories:

```bash
claude plugin validate .                    # marketplace.json
claude plugin validate ./plugins/vero-diff  # plugin.json, hooks module, state contract
claude plugin validate . --strict           # treat warnings as errors, for CI
```

Then load the plugin for one session, with no install and no marketplace:

```bash
cd /some/test/repo
claude --plugin-dir /path/to/verodiff/plugins/vero-diff
```

Inside that session `/plugin` should show VeroDiff as loaded and `/vero-diff` should
open the pane. Send any prompt that edits a file and watch the step appear. A
`--plugin-dir` folder is watched: saving a plugin file reloads the hooks module, with no
restart. If the module fails to load or a hook fails, a dim `vero-diff: ...` line in the
transcript says why, and `claude --debug` has the details.

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
| **Plugin manifests** | all three `claude plugin validate` runs, `--strict` included, and `claude plugin test` |
| **Shell lint** | `bash -n` and ShellCheck (`-S warning`) over every script |
| **Smoke** | `tests/smoke.sh` on Linux *and* macOS - macOS matters, because `snapshot.sh` takes its `md5 -q` branch there rather than `md5sum` |
| **Line endings** | re-clones with `core.autocrlf=true`, the Windows default, and proves the scripts still have LF endings, are executable, and run |

## Share it

VeroDiff is already a marketplace repository, so publishing is just pushing it:

```bash
git init && git add . && git commit -m "VeroDiff <version>"
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
- **Wider audience**: submit VeroDiff to
  [Anthropic's directory](https://claude.ai/directory), the catalog people browse on
  claude.ai and in Cowork. One listing reaches claude.ai, Cowork and Claude Code, where
  it loads through account sync as `vero-diff@synced`. Submit from the developer portal
  at [claude.ai/directory/manage](https://claude.ai/directory/manage), following
  [Submit a plugin](https://claude.com/docs/plugins/submit#submit-a-plugin). It needs a
  paid claude.ai plan: on Pro and Max you submit from your own account, on Team and
  Enterprise an Owner does (or, on Enterprise, a member the Owner gave the **Directory**
  permission). The portal applies rules of its own on top of `claude plugin validate`,
  so run the
  [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist#run-the-checks-before-you-submit)
  first. VeroDiff is a Claude Code mod, so say in the listing that it works in Claude
  Code only - the terminal and the desktop app's Code tab - and check the
  [component support table](https://claude.com/docs/plugins/platform-support#compare-component-support-by-app)
  for what claude.ai and Cowork load. The official `claude-plugins-official`
  marketplace takes no submissions through the portal; Anthropic decides what goes in
  it, through its partner contacts.
- **No git on the user's machine**: publish a zip and list it with an `archive` source
  plus a `sha256` pin.

Reserved marketplace names (`claude-plugins-official`, `anthropic-plugins`, and similar)
can't be used, which is why this catalog is called `verodiff-marketplace`.

VeroDiff has no top-level `bin/` directory, which claude.ai **organization settings**
distribution would reject, so that route takes it as it is.

## Uninstall

```bash
./uninstall.sh            # removes the plugin, keeps snapshots
./uninstall.sh --purge    # also deletes every snapshot cache
```

`claude plugin uninstall` removes the plugin on its own - there is no settings file to
clean up by hand.

## Troubleshooting

| What you see | What it means |
| :-- | :-- |
| `No changes in this session yet.` | No turn of this session has changed a file. Ask for an edit; the step appears when the turn ends. |
| `/vero-diff` is not in the command list | Claude Code was not restarted after installing, or the plugin is disabled. Check `/plugin`. A dim `vero-diff: ...` line in the transcript names a module that failed to load. |
| `Not a git repository.` | VeroDiff diffs a git working tree; there is nothing to snapshot outside one. The pane does not open by itself there. |
| The pane does not open by itself | You closed it once, and that is remembered: run `/vero-diff`. In the terminal it also waits for a window at least 144 columns wide. |
| `n` / `p` do nothing | The keys belong to the pane once it has the focus: click it, or `Ctrl+x` then `Tab`. The buttons always work. |
| A turn shows edits you did not ask for | Either you changed files yourself between turns - those appear as `edits outside a turn` - or a second session shares this working tree. See [Concurrent sessions](#concurrent-sessions). |
| A turn you expected is missing | A turn that changed nothing records no step, by design. |
| A step is cut short | One file's diff is cut at about 9,000 characters in the pane, and `/vero-diff last` at 60,000 in all. Run `git diff` yourself for the rest. |
| Snapshots are taking up space | `/vero-diff purge` clears this project, `./uninstall.sh --purge` every project. |

## Requirements

A Claude Code release that runs plugin hooks modules - VeroDiff 1.0 was built against
2.1.286 - plus git and bash, including the bash 3.2 that macOS ships, so nothing needs
installing there. `jq` or `python3` is used to read the prompt text for a step's title;
without either, steps are still recorded but unlabeled.

## Upgrading from 0.1.x

1.0 keeps the plugin's name and marketplace, so upgrading is an ordinary update. Nothing
needs uninstalling first, and your snapshots stay where they are.

**1. Update Claude Code itself**, because 1.0 needs a release that runs plugin hooks
modules. In a shell:

```bash
claude update
```

**2. Close the old viewer** if one is open in a tmux pane, a Windows Terminal split or a
separate window. Press `q` in it. 1.0 no longer ships that viewer.

**3. Update the plugin** inside Claude Code, **one command at a time**:

```
/plugin marketplace update verodiff-marketplace
```

```
/plugin update vero-diff@verodiff-marketplace
```

**4. Restart Claude Code.** `claude plugin list` should now show `Version: 1.0.0`, and
`/vero-diff` should be in the command list.

Installed from a clone with `./install.sh`? Run `git pull` in the clone instead of step 3,
then restart.

What changes for you:

| In 0.1.x | In 1.0 |
| :-- | :-- |
| `/vero-diff:steps` | `/vero-diff` - the pane opens by itself, too |
| `/vero-diff:lastdiff [N]` | `/vero-diff last [N]` - step 1 is the newest, as in the pane |
| `/vero-diff:purge` | `/vero-diff purge` |
| `verodiff` in a shell, `--purge-all` | gone; `./uninstall.sh --purge` still deletes every project's snapshots |
| two `snapshot.sh` entries in `/hooks` | none - the plugin's hooks module takes the snapshots |
| `VERODIFF_PANE_SIZE` | ignored; drag the pane's border instead. Remove it from your shell profile if you like |

`VERODIFF_DIR` still works as before. Claude Code may keep the 0.1.x copy in
`~/.claude/plugins/cache/verodiff-marketplace/vero-diff/0.1.1/`. It is unused, and you can
delete it.

## License

MIT
