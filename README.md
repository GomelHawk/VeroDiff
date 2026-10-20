<p align="center">
  <img src="https://raw.githubusercontent.com/GomelHawk/VeroDiff/main/assets/horizontal-logo.png"
       alt="VeroDiff - One turn, one diff."
       width="600">
</p>

<p align="center">
  <a href="https://github.com/GomelHawk/VeroDiff/actions/workflows/ci.yml"><img src="https://github.com/GomelHawk/VeroDiff/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/GomelHawk/VeroDiff/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT licence"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-8a63d2.svg" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/requires-git%20%2B%20bash-555.svg" alt="Requires git and bash">
</p>

You ask Claude Code to change something, and it edits a handful of files. Which lines did
that one request touch? Claude Code's own `/diff` shows everything you have not committed
yet, all mixed together. VeroDiff shows the changes of **each request on its own**, as a
side-by-side comparison in a panel next to the chat, and lets you undo a request with one
click. It keeps its records outside your project, so nothing in your folder changes.

## What you get

- **A panel beside the chat** with the changes of each request, newest first, in colour:
  green for added lines, red for removed ones.
- **Undo**: put one file, or every file of a request, back as it was before, after a quick
  Yes or No.
- **Ask about this** under any change adds its location to your prompt, so you can ask
  Claude why it did that.
- **A one-line summary above the prompt** - `VeroDiff turn 3 · 2 files · +5 −1` - even
  when the panel is closed.
- **Claude can look too.** Ask "what did you change two requests ago?" and Claude reads the
  same record.

## Install

Two commands, typed inside Claude Code. Type the first, press Enter and wait for
`✔ Successfully added marketplace: vero-plugins`, then type the second:

```
/plugin marketplace add GomelHawk/VeroPlugins
```

```
/plugin install vero-diff@vero-plugins
```

Then restart Claude Code. If you already added VeroPlugins for another Vero plugin, only
the second command is needed. There is nothing to configure and no API key involved.

> Type each line on its own. If a panel appears asking for a `marketplace source`, it
> wants only `GomelHawk/VeroPlugins` and nothing else on the line.

Prefer a terminal? The same two commands work there, back to back:

```bash
claude plugin marketplace add GomelHawk/VeroPlugins
claude plugin install vero-diff@vero-plugins
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then
**Plugins**, **Add marketplace** with `GomelHawk/VeroPlugins`, then **Add plugin**.

To check it took, type `/vero-diff`: the command is in the list, and running it opens the
VeroDiff panel.

**Only from VeroPlugins.** VeroDiff works only when installed from VeroPlugins. A copy
installed from anywhere else pauses and shows, above the prompt, four buttons that move
it here: press them one after another, pressing Enter after each, then restart Claude
Code. Your history of changes is still there afterwards.

<details>
<summary>Installing from a copy of this repository</summary>

```bash
git clone https://github.com/GomelHawk/VeroDiff
cd VeroDiff
./install.sh                                    # for you, in every project
./install.sh --scope project ~/work/our-app     # for everyone who works in our-app
```

`install.sh` checks the plugin and installs it from VeroPlugins. `--scope project DIR`
writes VeroDiff into `DIR/.claude/settings.json` - VeroPlugins and the plugin, never the
path of your copy - so once that file is committed, everyone who trusts the folder gets
VeroDiff without installing anything themselves. `--scope local DIR` does the same in
`DIR/.claude/settings.local.json`, for you alone. Without a copy of the repository, the
same team install is two commands run inside that project:

```bash
claude plugin marketplace add GomelHawk/VeroPlugins --scope project
claude plugin install vero-diff@vero-plugins --scope project
```
</details>

## Using it

### Your first comparison

1. Open Claude Code in any folder that is a git repository.
2. Ask it to change a file.
3. When Claude finishes, the VeroDiff panel shows what changed. If the panel is not open,
   type **`/vero-diff`**.
4. Type **`/vero-diff last`** to print the same comparison into the chat instead.

VeroDiff only records requests made after it is installed, so the first one it shows is
the next thing you ask for. It reads your files and writes nothing into your project.

### The commands

| Command | What it does |
| :-- | :-- |
| `/vero-diff` | Opens the panel: this session's requests, newest first, each with its full comparison |
| `/vero-diff last` | Prints the latest request's summary and comparison into the chat |
| `/vero-diff last 2` | Same, for the request before it - numbered as the panel numbers them |
| `/vero-diff band` | Brings back the summary line above the prompt after you closed it |
| `/vero-diff purge` | Deletes this project's saved history, every session's |

### The panel

The panel is a native part of Claude Code: a sidebar beside the chat in the terminal, a
panel in the desktop app. A header names the request and the prompt that produced it, and
each changed file follows with its comparison, coloured the way Claude Code colours its
own. When a request touched more than one file, it opens with a list of them and their
`+`/`−` counts: click a name to jump to its comparison, and **↑ Files** at the end of each
one takes you back up to the list.

Click a file's name to fold it once you have read it: the comparison closes to one line,
and the file gets a `✓` in the list, so after an interruption you see at a glance which
files are left. Folds belong to the request on screen only: showing another one, or a new
request arriving, clears them.

| Button | Key | What it does |
| :-- | :-- | :-- |
| **Older** | `p` | the request before this one |
| **Newer** | `n` | the request after this one |
| **Latest** | `l` | back to the newest request |
| **Refresh** | `r` | read the records again |
| **Hide** | `h` | close the panel (terminal only - the desktop app has its own close button) |

The keys work once the panel has the focus: click it, or press `Ctrl+x` then `Tab`. Scroll
a long comparison with the mouse wheel. When a request finishes, the panel moves to it by
itself. A closed panel stays closed, in later sessions too, until you press **Show diff**
above the prompt or type `/vero-diff` again. In the terminal the panel opens by itself
only in a window at least 144 columns wide; `/vero-diff` opens it at any width.

### Undoing a request

**Revert** beside a file's name puts that file back as it was before the request. It asks
first - *Revert to before this turn?* **Yes** / **No** - and the file then shows
`↺ reverted`. A file the request created is deleted, a renamed one gets its old name back.
It is offered on the newest request only, and not while Claude is still working: an older
request's files may have been changed again since. A file that was edited after the
request, by you or by the next request, is left alone and marked `changed since - not
reverted`, so an undo never throws an edit away. The undo is an edit like any other: the
next request records it as `edits outside a turn`.

**Revert all files of this turn**, after the last file, does the same for every file of
the request not yet reverted, after the same Yes / No. It is all or nothing: if even one of
those files was edited since, none is touched, and the panel names the one that stopped
it - `Not reverted: src/fetch.ts changed since this turn.` - so a request is never left
half undone. Revert that file on its own, or put it back first, and try again.

### Asking about a change

**Ask about this** under each change adds where it is to your prompt -
`About src/fetch.ts lines 10–29 (changed in turn 7): ` - for you to finish with a
question. Nothing is sent until you press Enter.

A long file shows its first changes, about one screenful; **Show more** under them draws
the next ones.

### The line above the prompt

The newest request also sits in one line above the prompt -
`VeroDiff turn 3 · 2 files · +5 −1` - so you see what the last request did even with the
panel closed. While the panel is closed, that line also has **Show diff**, which opens it
again. Its **×** closes the line itself, in this and later sessions; `/vero-diff band`
brings it back. Other plugins' lines above the prompt stay visible beneath it.

### What a turn is

Requests are described the way you would describe them out loud:

```
turn 3  "add a random word to a.txt"
edits outside a turn
turn 2  "rename the helper"
```

A **turn** is one exchange: everything that changed between you pressing Enter and Claude
finishing. Turns are numbered from the start of the session, so `turn 3` stays `turn 3`
even as newer ones push it down the list. **Edits outside a turn** are changes that were
already on disk before a turn ran - your own edits, typically - so they are not blamed on
any prompt. A turn that changed nothing is not listed.

Claude can read these comparisons too: `/vero-diff last` puts one into the conversation,
and VeroDiff gives Claude a tool, `turn_diff`, so it can look up what an earlier turn
changed by itself - ask "what did you change two turns ago?". Very long comparisons are
cut there, to save room in the conversation; the panel has more of each file.

## Updating

Nothing updates by itself, and Claude Code will not tell you a new version exists. New
versions are announced at
[github.com/GomelHawk/VeroDiff/releases](https://github.com/GomelHawk/VeroDiff/releases);
watch the repository if you want an email.

Inside Claude Code, one command at a time, same as installing:

```
/plugin marketplace update vero-plugins
```

```
/plugin update vero-diff@vero-plugins
```

Then restart Claude Code. From a terminal, where you can run them back to back:

```bash
claude plugin marketplace update vero-plugins
claude plugin update vero-diff@vero-plugins
```

`claude plugin list` shows which version you have.

## Turning it off and uninstalling

- **For one project only**: `claude plugin disable vero-diff@vero-plugins --scope local`
  in that project (`enable` to undo), or the switch in the `/plugin` menu.
- **Everywhere**: `claude plugin disable vero-diff@vero-plugins`. Takes effect after a
  restart or `/reload-plugins`. Your saved history stays.

To remove it:

```bash
./uninstall.sh                                  # removes the plugin, keeps the history
./uninstall.sh --scope project ~/work/our-app   # removes a project install
./uninstall.sh --purge                          # also deletes every project's history
```

or `/plugin uninstall vero-diff@vero-plugins` inside Claude Code. `--purge` lists the
history folders it found and asks before deleting them (`-y` skips the question). It
deletes only what VeroDiff made, never anything else in that folder. The VeroPlugins
marketplace stays, because other Vero plugins use it.

## Good to know

**Where the history is kept.** Not in your project. VeroDiff keeps a record of your files
before and after each request in its own folder under `~/.cache/verodiff/`, one record
per project. Your project's `.git`, `git status`, `git log` and `git push` are untouched.
Files your project tells git to ignore (`.gitignore`, `.git/info/exclude`) are left out,
and files your project keeps encrypted with a git filter (git-crypt, transcrypt) are
stored encrypted. Keep large generated files - a local database, a dataset - in
`.gitignore`, or each request that touches one stores another copy. You can move the
folder with the `VERODIFF_DIR` environment variable.

**How long it is kept.** Once a day, sessions untouched for 30 days are dropped.
`/vero-diff purge` clears the whole project at once.

**Two Claude Code windows in one folder.** Each session keeps its own list of requests, so
two windows in one project do not mix up each other's history. What they cannot avoid is
sharing the same files: if both edit during the same request, both sets of edits appear
in the comparison. When another window has changed this folder in the last 15 minutes, the
panel says so at the top - `⚠  Another session is also editing this folder (last change
14:29)` - and the line above the prompt shows `⚠  another session here`. For real
separation, give each window its own `git worktree`.

**Submodules.** A repository nested inside your project is recorded the way git records
it: as the commit it points to. Its uncommitted edits cannot be shown, so a request that
changed them says `Changes inside submodule libs/ui are not shown.` instead. Look inside
with `git -C libs/ui diff`.

**Privacy.** Everything stays on your computer. VeroDiff sends nothing anywhere.

## Troubleshooting

| What you see | What it means |
| :-- | :-- |
| `No changes in this session yet.` | No request of this session has changed a file. Ask for an edit; it appears when Claude finishes. |
| `/vero-diff` is not in the command list | Claude Code was not restarted after installing, or the plugin is disabled. Check `/plugin`. A dim `vero-diff: ...` line in the chat names a part that failed to load. |
| `Not a git repository.` | VeroDiff compares files in a git repository; outside one there is nothing to record, and the panel does not open by itself. |
| The panel does not open by itself | You closed it once, and that is remembered: press **Show diff** above the prompt, or type `/vero-diff`. In the terminal it also waits for a window at least 144 columns wide. |
| `VeroDiff is paused` above the prompt | This copy was not installed from VeroPlugins, or an older copy is still installed. Press the buttons in that line one after another, then restart Claude Code. |
| `VeroDiff: can't scroll here (...)` | Clicking a file name could not scroll the panel to that file. The text after the colon is the reason Claude Code gave; please report it with the name in the brackets. |
| `n` / `p` do nothing | The keys belong to the panel once it has the focus: click it, or `Ctrl+x` then `Tab`. The buttons always work. |
| A request shows edits you did not ask for | Either you changed files yourself between requests - those appear as `edits outside a turn` - or a second window shares this folder. See [Good to know](#good-to-know). |
| A request you expected is missing | A request that changed nothing is not listed, by design. |
| `Changes inside submodule ... are not shown.` | The request changed uncommitted work inside a submodule, which cannot be shown. See [Good to know](#good-to-know). |
| No colours inside the code in the desktop app | The desktop app colours a comparison by added and removed lines only; the terminal also highlights the code. That is Claude Code's drawing, not a setting. |
| A comparison is cut short | The panel draws a long file a screenful at a time: press **Show more**. A single change longer than about 9,000 characters, or a file past 200,000, is cut, and `/vero-diff last` stops at 60,000 in all. Run `git diff` yourself for the rest. |
| `changed since - not reverted` | The file was edited after the request, so undoing it would lose that edit. Undo it by hand, or with git. |
| The history is taking up space | `/vero-diff purge` clears this project, `./uninstall.sh --purge` every project. Large files that are not ignored are copied on every request that changes them; ignore them (see [Good to know](#good-to-know)). |

## Requirements

Claude Code with plugin support (the terminal, or the desktop app's Code tab), git 2.22
or newer, and bash - including the bash that macOS ships. Nothing else needs installing.

## Contributing

How to test changes, what CI checks and how releases reach users are in
[CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
