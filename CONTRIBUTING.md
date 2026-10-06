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
project's own `.git`, that `.gitignore` is honoured, that a turn which changes nothing
records nothing, that pruning drops only stale sessions, and that the script exits 0
even outside a git repository.

The second runs the pane's TypeScript against Claude Code's own engine - still no account
and no network:

```bash
claude plugin test ./plugins/vero-diff
```

It covers how steps are named and numbered (no internal `[pre]`/`[post]` marker may reach
a user), how a diff is split and cut per file, the status line, which paths
`/vero-diff purge` will delete, and the pane itself, drawn on both the terminal and the
desktop surface: its navigation, the file list, Hide, and what `/clear` does to it.

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

VeroDiff is already a marketplace repository, so publishing is pushing `main`. Users then
need two lines:

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

The full release procedure - collecting changes, choosing the number, the changelog and
the GitHub Release - is in `CLAUDE.md` under "Cutting a release".

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
