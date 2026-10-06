# Changelog

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
