# Contributing to VeroDiff

For maintainers and anyone changing the plugin. How to use it is in the
[README](README.md).

## Develop and test locally

There are two suites, and CI runs both. The first needs nothing but git and bash - no
Claude Code, no network, no credentials:

```bash
tests/smoke.sh
```

It asserts the promises `snapshot.sh` makes: that a snapshot never adds an object to the
project's own `.git`, not even with a `GIT_OBJECT_DIRECTORY` inherited from a parent
process; that `.gitignore`, `.git/info/exclude` and the project's clean filters are
honoured, and a file whose filter is defined nowhere left out; that a turn which changed
only a submodule's uncommitted work is a step that names it, without writing to the
submodule's own `.git`; that an unreadable file costs only itself, never the turn; that a
turn which changes nothing records nothing; that pruning drops only stale sessions and
the old files no session owns; and that the script exits 0 even outside a git repository.
It also checks that the plugin's copies of `README.md` and `LICENSE` match the
repository's.

The second runs the pane's TypeScript against Claude Code's own engine - still no account
and no network:

```bash
claude plugin test ./plugins/vero-diff
```

It covers how steps are named and numbered (no internal `[pre]`/`[post]` marker may reach
a user, and numbers hold past one read of 200 snapshots), how a diff is split and cut per
file and how each file's path is read, how a step names a changed submodule, the band
above the prompt, `/vero-diff last [N]` and how it cuts a long diff, Refresh after the
history shrank, what `/vero-diff purge` deletes and what it refuses, and the pane itself,
drawn on both the terminal and the desktop surface: its navigation, the file list, Hide,
and what `/clear` does to it.

Then validate the structure - the plugin's manifest, hooks module and state contract:

```bash
claude plugin validate ./plugins/vero-diff           # plugin.json, hooks module, state contract
claude plugin validate ./plugins/vero-diff --strict  # treat warnings as errors, for CI
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

The two files `plugins/vero-diff/hooks/source-check.ts` and
`plugins/vero-diff/tests/source-check.test.ts` are byte-identical copies of
`VeroPlugins/shared/hooks/source-check.ts` and `VeroPlugins/shared/tests/source-check.test.ts`.
Change them there first, then copy; VeroPlugins' CI fails while a copy differs.

### What CI checks

`.github/workflows/ci.yml` runs on every push and pull request:

| Job | Checks |
| :-- | :-- |
| **Plugin manifests** | all three `claude plugin validate` runs, `--strict` included, and `claude plugin test` |
| **Shell lint** | `bash -n` and ShellCheck (`-S warning`) over every script |
| **Smoke** | `tests/smoke.sh` on Linux *and* macOS - macOS matters, because `snapshot.sh` takes its `md5 -q` branch there rather than `md5sum` |
| **Line endings** | checks out the commit under test - a pull request's own, not `main` - with `core.autocrlf=true`, the Windows default, and proves the scripts still have LF endings, are executable, and run |

## Share it

VeroDiff is listed in [VeroPlugins](https://github.com/GomelHawk/VeroPlugins), the one
marketplace for every Vero plugin, so publishing is pushing `main`: the catalog's entry
follows this repository's `main`. Users then need two lines:

```
/plugin marketplace add GomelHawk/VeroPlugins
/plugin install vero-diff@vero-plugins
```

### Releasing updates

`version` in `plugin.json` pins the plugin: users keep their cached copy until that string
changes, so bump it on every release. The catalog entry in VeroPlugins carries no
version, so nothing changes there for a release; pushing a `v<version>` tag runs
`.github/workflows/release.yml`, which tells VeroPlugins' CI to re-check the entry.

The full release procedure - collecting changes, choosing the number, the changelog and
the GitHub Release - is in `CLAUDE.md` under "Cutting a release".

### Other distribution routes

- **Teams**: commit `extraKnownMarketplaces` (VeroPlugins) and `enabledPlugins`
  (`vero-diff@vero-plugins`) to a repo's `.claude/settings.json` - `./install.sh --scope
  project DIR` writes exactly that - and everyone who trusts that folder gets VeroDiff
  with no separate prompt.

VeroDiff has no top-level `bin/` directory, which claude.ai **organization settings**
distribution would reject. Whatever the route, a copy that does not come from VeroPlugins
pauses and shows how to move, so every route ends at `vero-diff@vero-plugins`.
