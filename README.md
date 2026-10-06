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
./install.sh                                    # for you, in every project
./install.sh --scope project ~/work/our-app     # for everyone who works in our-app
```

`--scope project DIR` writes VeroDiff into `DIR/.claude/settings.json` - the GitHub
marketplace and the plugin, never the path of your clone - so once that file is committed,
everyone who trusts the folder gets VeroDiff without installing anything themselves.
`--scope local DIR` does the same in `DIR/.claude/settings.local.json`, for you alone.

Without the clone, the same team install is two commands run inside that project:

```bash
claude plugin marketplace add GomelHawk/VeroDiff --scope project
claude plugin install vero-diff@verodiff-marketplace --scope project
```
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
| `/vero-diff band` | Brings back the row above the prompt after you closed it |
| `/vero-diff purge` | Deletes this project's snapshot history, every session's |

The pane is a native part of Claude Code: a sidebar beside the transcript in the terminal,
a panel in the desktop app. A header names the step and the prompt that produced it, and
each changed file follows with its diff, highlighted the way Claude Code draws its own.
When a step touched more than one file, it opens with a list of them and their `+`/`−`
counts: click a name to jump to its diff, and **↑ Files** at the end of each diff takes
you back up to the list.

Click a file's name above its diff to fold it once you have read it: the diff closes to
one line, and the file gets a `✓` in the list, so after an interruption you see at a
glance which files are left. Folds belong to the step on screen only - showing another
step, or a new turn arriving, means you are done with this one, and they are cleared.

The newest step also sits in one row above the prompt -
`VeroDiff turn 3 · 2 files · +5 −1` - so you see what the last turn did even with the
pane closed. While the pane is closed, that row also has **Show diff**, which opens it
again. Its **×** closes the row itself, leaving nothing behind, in this and later
sessions; `/vero-diff band` brings it back.

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

A closed pane stays closed, in every later session too, until you press **Show diff** above
the prompt or run `/vero-diff` again.
In the terminal the pane opens by itself only in a window at least 144 columns wide;
`/vero-diff` opens it at any width.

Claude can read these diffs too. `/vero-diff last` puts one into the conversation, and
VeroDiff also gives Claude a tool, `turn_diff`, so it can look up what an earlier turn
changed by itself - ask "what did you change two turns ago?". Very long diffs are cut
there, to spare the context window; the pane has more of each file.

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
reads your files and honours `.gitignore` and `.git/info/exclude`, but writes every object
into the cache. Your `.git`, `git status`, `git log --all` and `git push` are untouched.
Clean filters defined in your repository's config run too, so a file git-crypt or
transcrypt keeps encrypted is stored encrypted. A file whose filter is named in
`.gitattributes` but defined nowhere is left out of snapshots altogether rather than
stored as it sits on disk. A file git cannot read is left out too; the rest of the turn is
still recorded.

Everything git would track is copied, untracked files included. Keep large generated
files, such as a dev database or a dataset, in `.gitignore` or `.git/info/exclude`, or
each turn that touches one stores another copy. Snapshots are packed as they pile up.

Override the location with `VERODIFF_DIR`.

Old history clears itself: once a day, sessions whose newest snapshot is more than 30
days old are dropped, and git reclaims their space two weeks later. `/vero-diff purge`
clears the whole project at once.

## Concurrent sessions

Each session gets its own ref (`refs/verodiff/session/<id>`), its own index file and its
own label file, so two terminals in one repository don't corrupt each other's step
history. What they can't avoid is sharing a working tree: if both sessions edit files in
the same checkout during the same turn, both sets of edits appear in the diff. For real
isolation, give each session its own `git worktree`.

## Submodules

A submodule - or any repository nested inside the project - is recorded the way git
records it in your repository: as the commit it points to. Its uncommitted edits cannot be
shown as a diff, so a step whose turn changed them says so instead:

```
Changes inside submodule libs/ui are not shown.
```

A turn that changed only a submodule is still a step, with that line and no diff. Look
inside with `git -C libs/ui diff`.

## Uninstall

```bash
./uninstall.sh                                  # removes the plugin, keeps snapshots
./uninstall.sh --scope project ~/work/our-app   # removes a project install
./uninstall.sh --purge                          # also deletes every project's snapshots
```

`--purge` lists the snapshot stores it found and asks before deleting them (`-y` skips the
question). It deletes only the stores VeroDiff made, never anything else that shares the
folder `VERODIFF_DIR` points at.

`claude plugin uninstall` removes the plugin on its own - there is no settings file to
clean up by hand.

## Troubleshooting

| What you see | What it means |
| :-- | :-- |
| `No changes in this session yet.` | No turn of this session has changed a file. Ask for an edit; the step appears when the turn ends. |
| `/vero-diff` is not in the command list | Claude Code was not restarted after installing, or the plugin is disabled. Check `/plugin`. A dim `vero-diff: ...` line in the transcript names a module that failed to load. |
| `Not a git repository.` | VeroDiff diffs a git working tree; there is nothing to snapshot outside one. The pane does not open by itself there. |
| The pane does not open by itself | You closed it once, and that is remembered: press **Show diff** above the prompt, or run `/vero-diff`. In the terminal it also waits for a window at least 144 columns wide. |
| `VeroDiff: can't scroll here (...)` | Clicking a file name could not scroll the pane to that file. The text after the colon is the reason Claude Code gave; please report it with the surface name in the brackets. |
| `n` / `p` do nothing | The keys belong to the pane once it has the focus: click it, or `Ctrl+x` then `Tab`. The buttons always work. |
| A turn shows edits you did not ask for | Either you changed files yourself between turns - those appear as `edits outside a turn` - or a second session shares this working tree. See [Concurrent sessions](#concurrent-sessions). |
| A turn you expected is missing | A turn that changed nothing records no step, by design. |
| `Changes inside submodule ... are not shown.` | The turn changed uncommitted work inside a submodule, which no snapshot holds. See [Submodules](#submodules). |
| No syntax colours in the desktop app | The desktop app colours a diff by added and removed lines only; the terminal also highlights the code. That is Claude Code's drawing, not a setting. |
| A step is cut short | One file's diff is cut to whole hunks of about 9,000 characters in the pane, and `/vero-diff last` at 60,000 in all. Run `git diff` yourself for the rest. |
| Snapshots are taking up space | `/vero-diff purge` clears this project, `./uninstall.sh --purge` every project. Large files that are not ignored are copied on every turn that changes them; ignore them (see [Where snapshots live](#where-snapshots-live)). |

## Requirements

A Claude Code release that runs plugin hooks modules - VeroDiff 1.1 is tested against
2.1.288 - plus git 2.22 or newer and bash, including the bash 3.2 that macOS ships.
Nothing else needs installing.

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

## Contributing

How to test changes, what CI checks and how releases reach users are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
