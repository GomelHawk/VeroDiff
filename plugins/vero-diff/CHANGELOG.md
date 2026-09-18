# Changelog

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
