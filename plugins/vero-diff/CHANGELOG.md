# Changelog

## 1.1.1 - 2026-10-06

The newest step now has a row of its own above the prompt, and the pane is one click away.

- **A summary row above the prompt** replaces 1.1.0's status line, which Claude Code drew
  as a warning (`⚠`) with the plugin's name twice. The row reads
  `VeroDiff turn 3 · 2 files · +5 −1`, in colour.
- **Show diff** in that row brings the pane back after you closed it - no need to type
  `/vero-diff`.
- **The row can go away completely**: its **×** removes it, in this and later sessions,
  and `/vero-diff band` brings it back.
- **Clicking a file name in the desktop app jumps to that file**, as it already did in
  the terminal. If a jump is ever refused, the pane now says why in a short message
  instead of doing nothing.

## 1.1.0 - 2026-10-06

Find your way around a turn faster, and let Claude read its own diffs.

### New

- **A list of the files a step touched**, with `+`/`−` counts, at the top of every
  step with more than one file. Click a name to jump to its diff; **↑ Files** at the end
  of each diff takes you back up.
- **Fold a file once you have read it.** Click its name above the diff: it closes to one
  line and gets a `✓` in the list, so after an interruption you see what is left. Folds
  last while you stay on the step; another step or a new turn clears them.
- **A status line** under the prompt - `VeroDiff: turn 3 · 2 files · +5 −1` - so the
  last turn is visible even with the pane closed.
- **Claude can look up a turn's diff by itself** through a new tool, `turn_diff`: ask
  "what did you change two turns ago?".
- **Old snapshots clear themselves.** Once a day, sessions untouched for 30 days are
  dropped; `/vero-diff purge` still clears a project at once.

### Fixed

- A long file's diff keeps its colours and syntax highlighting: it used to be cut in the
  middle of a hunk, which made the pane draw it as plain text.
- A step's title no longer ends in a stray `Ñ` when the prompt is in Cyrillic or any
  other non-Latin script.
- After `/clear` the pane no longer keeps showing the previous conversation's steps.
- If the end of a turn was ever missed, snapshots no longer stop for the rest of the
  session.
- The pane no longer flashes "No changes in this step." while it reloads.

### Changed

- `jq` and `python3` are no longer used: step titles are labelled on every machine.

## 1.0.0 - 2026-10-05

VeroDiff now lives inside Claude Code: each turn's diff is drawn in a native side pane,
in the terminal and in the desktop app's Code tab alike.

### New

- **A built-in pane.** A sidebar beside the transcript in the terminal, a panel in the
  desktop app - no separate terminal window, split or tty needed. It names each step after
  the prompt that produced it and shows every changed file with its highlighted diff.
- **It follows you.** When a turn ends the pane moves to it by itself. **Older**,
  **Newer**, **Latest** and **Refresh** walk the steps, by mouse or with `p`, `n`, `l`,
  `r` once the pane has the focus.
- **It remembers being closed.** Close it - with **Hide** (`h`) in the terminal, or the
  desktop app's own close button - and it stays closed in later sessions until you run
  `/vero-diff`.
- **One command:** `/vero-diff` opens the pane, `/vero-diff last [N]` prints a step's
  summary and full diff into the chat - where Claude can read it too - and
  `/vero-diff purge` deletes this project's snapshots.

### Changed

- The session's first snapshot is no longer listed as a "session baseline" step. Its diff
  was the entire project - no edit, and on a large repository a very large one. It is
  still taken, as the point the first turn is measured from.
- Snapshots are taken when a turn starts and when it ends, by the plugin's hooks module
  rather than by two command hooks, so `/hooks` no longer lists VeroDiff. A turn you
  interrupt now ends a step of its own.
- Organization distribution through claude.ai works as shipped: there is no top-level
  `bin/` any more.

### Removed

- `/vero-diff:steps`, `/vero-diff:lastdiff` and `/vero-diff:purge` - use `/vero-diff`,
  `/vero-diff last [N]` and `/vero-diff purge`.
- The `verodiff` command and its full-screen terminal viewer, the external panes it opened
  in tmux, Windows Terminal, WezTerm and kitty, and `VERODIFF_PANE_SIZE`.
  `./uninstall.sh --purge` still deletes every project's snapshots.

Snapshots taken by 0.1.x stay where they were, in the same format; `VERODIFF_DIR` still
sets where they live. Requires a Claude Code release that runs plugin hooks modules.

## 0.1.1 - 2026-09-18

Repairs a failure that made the viewer unusable on macOS.

- **The viewer works on macOS again.** It used `mapfile`, which needs bash 4, while macOS
  ships bash 3.2 as `/bin/bash`. `verodiff` died with `mapfile: command not found`, so the
  step list, every diff and the pane all came back empty.
- **Arrow keys work on bash 3.2 too.** The escape sequence behind them was read with a
  fractional `read -t` timeout, also bash 4 only, which silently killed the keys rather
  than reporting anything.
- The viewer no longer carries on in the wrong directory when it cannot enter the
  repository root.
- Clearer README: installing and updating are now numbered, one-command-at-a-time steps
  showing the output to expect after each, and there is a troubleshooting table and a
  section explaining how updates reach you.

## 0.1.0 - 2026-09-17

First release.

- Snapshots the working tree on `UserPromptSubmit` and `Stop`, so the diff of a turn is
  `git diff` between two snapshots
- Snapshots live in a shadow repository outside the project: nothing is ever written to
  your `.git`, and `.gitignore` is still honoured
- Per-session ref, index and label files, so concurrent terminals don't share a step
  history
- `/vero-diff:steps` opens a side pane, `/vero-diff:lastdiff [N]` prints a turn's summary
  and full diff into the chat, `/vero-diff:purge` clears this project's snapshots
- Full-screen viewer: `j`/`k` scroll, `space`/`b` page, `g`/`G` ends, `n`/`p` walk steps
  without leaving the diff, `r` reloads, `q` quits. Runs on the alternate screen, uses
  `delta` when it is installed, and picks up new turns while you sit on the newest step
- Steps read as turns - numbered from the start of the session, listing the files each one
  touched - rather than as raw snapshots
- Side panes in tmux, Windows Terminal (including WSL, through `wsl.exe`), WezTerm and
  kitty, with a separate window as a fallback. Only one viewer runs per project; asking
  for another reuses the open one
- `VERODIFF_DIR` sets where snapshots live, `VERODIFF_PANE_SIZE` how wide the pane opens
