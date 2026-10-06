import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileDiff, Step, View } from '../types'
import {
  DIFF_OPTIONS,
  LOG_FORMAT,
  clean,
  fenceFor,
  isShadowPath,
  languageOf,
  parentOfOldest,
  parseLog,
  promptLabel,
  splitFiles,
  stepSummary,
  submoduleNote,
} from './steps'

// VeroDiff: snapshot the working tree at both ends of a turn (scripts/snapshot.sh) and
// draw the diff of each turn in a pane. Snapshots live in a bare repository outside the
// project; nothing is ever written to its .git.

const PANE = 'vero-diff'
const COMMAND = 'vero-diff'
const TOOL = 'turn_diff'
// Whether the person closed the pane, kept across sessions: a closed pane stays closed
// until the command opens it again.
const HIDDEN_KEY = 'isPaneHidden'
// Whether the person closed the band above the prompt, kept across sessions the same way;
// `/vero-diff band` brings it back.
const BAND_HIDDEN_KEY = 'isBandHidden'
// When stale sessions were last pruned; pruning runs at most once a day.
const PRUNED_AT_KEY = 'prunedAt'
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000
const KEEP_DAYS = 30
// A main turn left open this long is taken as one whose end never arrived.
const STALE_TURN_MS = 6 * 60 * 60 * 1000
const LIMIT = 200
const MAX_FILES = 40
const MAX_INLINE_CHARS = 60000 // `last` lands in the model's context too
const SNAPSHOT_TIMEOUT_MS = 20000

const INITIAL: View = {
  shadow: '',
  steps: [],
  index: 0,
  shownSha: '',
  files: [],
  collapsed: [],
  isPaneOpen: false,
  isBandHidden: false,
  error: '',
  isLoading: true,
}
const view = atom({ plugin: 'vero-diff', key: 'view' } as const, INITIAL)

// snapshot.sh is the one place that knows the cache layout: `where` prints the path,
// `pre`/`post` take a snapshot, `prune` drops stale sessions. It always exits 0.
async function script($: EngineInterface, args: string[], vars: Record<string, string> = {}) {
  const cwd = await $.session.root()
  const session = await $.session.id()
  return $.process.run(['bash', `${$.plugin.root}/scripts/snapshot.sh`, ...args], {
    cwd,
    env: { CLAUDE_PROJECT_DIR: cwd, VERODIFF_SESSION_ID: session, ...vars },
    timeoutMs: SNAPSHOT_TIMEOUT_MS,
  })
}

async function shadowOf($: EngineInterface): Promise<string> {
  return (await script($, ['where'])).stdout.trim()
}

// The variables `git rev-parse --local-env-vars` lists. The child inherits Claude Code's
// own environment, and one of these set there (by a git hook that started it, say) would
// send these reads to some other repository's objects.
const GIT_LOCAL_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_IMPLICIT_WORK_TREE', 'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE', 'GIT_NO_REPLACE_OBJECTS', 'GIT_REPLACE_REF_BASE', 'GIT_PREFIX',
  'GIT_SHALLOW_FILE', 'GIT_COMMON_DIR',
]

// Paths come back unquoted (core.quotePath=false), so a non-ASCII name reads as itself.
async function git($: EngineInterface, shadow: string, args: string[]) {
  const unset = GIT_LOCAL_VARS.flatMap(name => ['-u', name])
  return $.process.run(['env', ...unset, 'git', `--git-dir=${shadow}`, '-c', 'core.quotePath=false', ...args])
}

async function snapshot($: EngineInterface, kind: 'pre' | 'post', prompt = '') {
  try {
    await script($, [kind], { VERODIFF_PROMPT: promptLabel(prompt) })
  } catch {
    // a snapshot that timed out is one missing step, not a broken turn
  }
}

// The band follows the newest step, whichever step the pane shows.
async function rememberLatest($: EngineInterface) {
  const v = await read($, view)
  if (v.steps.length === 0) await update($, view, cur => ({ ...cur, latest: undefined }))
  else if (v.index === 0) await update($, view, cur => ({ ...cur, latest: stepSummary(cur.steps[0], cur.files) }))
}

// Opens the pane and says so to the band. `asked`: the person did it (the command, the
// band's button), so the pane may seat at any width and the "closed" memory is cleared.
async function openPane($: EngineInterface, asked: boolean) {
  if (asked) await $.store.set(HIDDEN_KEY, false)
  const opened = await $.ui.open({ id: PANE, title: 'VeroDiff' })
  if (opened.isPlaced) await update($, view, cur => ({ ...cur, isPaneOpen: true }))
}

// The plugin's own $.ui.close does not pass through its own ui.close hook, so the Hide
// button records the close itself; the ui.close hook covers the person's close mark.
async function closePane($: EngineInterface) {
  await update($, view, cur => ({ ...cur, isPaneOpen: false }))
  await $.store.set(HIDDEN_KEY, true)
  await $.ui.close({ id: PANE })
}

async function setBandHidden($: EngineInterface, isHidden: boolean) {
  await $.store.set(BAND_HIDDEN_KEY, isHidden)
  await update($, view, cur => ({ ...cur, isBandHidden: isHidden }))
}

async function filesOf($: EngineInterface, shadow: string, step: Step): Promise<FileDiff[]> {
  const out = await git($, shadow, ['diff', ...DIFF_OPTIONS, step.parent, step.sha])
  return splitFiles(out.stdout)
}

// The fields that show one step, as a single write. Folding is for reviewing the step on
// screen. Showing another step - by Older, Newer, Latest, or a new turn landing - means
// this one is accepted, so the folds go; the same step read again (Refresh, `last`, the
// model's tool) keeps them.
function showing(cur: View, index: number, step: Step | undefined, files: FileDiff[]): Partial<View> {
  const sha = step?.sha ?? ''
  return { index, shownSha: sha, files, collapsed: sha !== '' && cur.shownSha === sha ? cur.collapsed : [] }
}

async function loadStep($: EngineInterface, index: number) {
  const v = await read($, view)
  const step = v.steps[index]
  if (!step) return
  const files = await filesOf($, v.shadow, step)
  await update($, view, cur => ({ ...cur, ...showing(cur, index, step, files) }))
}

// Turns older than the newest LIMIT snapshots, so that turn numbers do not shift once a
// session has taken more snapshots than one read holds.
async function turnsBefore($: EngineInterface, shadow: string, log: string): Promise<number> {
  const parent = parentOfOldest(log)
  if (parent === '' || log.split('\n').filter(Boolean).length < LIMIT) return 0
  const count = await git($, shadow, ['rev-list', '--count', '--grep=^\\[post\\] ', parent])
  return count.exitCode === 0 ? Number(count.stdout.trim()) || 0 : 0
}

async function reload($: EngineInterface, jumpToLatest: boolean) {
  try {
    const shadow = await shadowOf($)
    if (!shadow) {
      await update($, view, cur => ({ ...cur, shadow, steps: [], files: [], isLoading: false, error: 'Not a git repository.' }))
      return
    }
    const sid = await $.session.id()
    const log = await git($, shadow, ['log', `--max-count=${LIMIT}`, LOG_FORMAT, `refs/verodiff/session/${sid}`])
    const steps = log.exitCode === 0 ? parseLog(log.stdout, await turnsBefore($, shadow, log.stdout)) : []
    const prev = await read($, view)
    const index = jumpToLatest ? 0 : Math.min(prev.index, Math.max(0, steps.length - 1))
    const step = steps[index]
    const files = step ? await filesOf($, shadow, step) : []
    // One write: the step list, which step is shown and its files arrive together, so the
    // pane never draws a new step's title over the old step's files in between.
    await update($, view, cur => ({ ...cur, shadow, steps, ...showing(cur, index, step, files), isLoading: false, error: '' }))
    await rememberLatest($)
  } catch (err) {
    await update($, view, cur => ({ ...cur, isLoading: false, error: String(err) }))
  }
}

// One step's diff as markdown: what `/vero-diff last [N]` prints and the model's tool
// returns. N counts as the pane does: 1 is the newest step.
async function lastDiff($: EngineInterface, arg: string): Promise<string> {
  await reload($, false)
  const v = await read($, view)
  if (v.error) return v.error
  if (v.steps.length === 0) return 'No changes in this session yet.'
  const n = arg === '' ? 1 : Number(arg)
  if (!Number.isInteger(n) || n < 1 || n > v.steps.length) {
    return `No such step: ${arg} (this session has ${v.steps.length}).`
  }
  const step = v.steps[n - 1]
  if (!step) return `No such step: ${arg}.`
  const range = [step.parent, step.sha]
  const stat = await git($, v.shadow, ['diff', ...DIFF_OPTIONS, '--stat=100', ...range])
  const out = await git($, v.shadow, ['diff', ...DIFF_OPTIONS, ...range])
  const head = [
    `**${step.title}**  ·  step ${n} of ${v.steps.length}  ·  ${step.when}`,
    ...(step.submodules ?? []).map(path => `_${submoduleNote(path)}_`),
  ].join('\n\n')
  let diff = clean(out.stdout).replace(/\n$/, '')
  if (!diff) return step.submodules ? head : `${head}\n\nNo changes in this step.`
  let note = ''
  if (diff.length > MAX_INLINE_CHARS) {
    diff = diff.slice(0, diff.lastIndexOf('\n', MAX_INLINE_CHARS))
    note = '\n\n_Cut: the rest of this diff is in the pane._'
  }
  const fence = fenceFor(diff)

  return [
    head,
    '```\n' + stat.stdout.replace(/\n$/, '') + '\n```',
    `${fence}diff\n${diff}\n${fence}${note}`,
  ].join('\n\n')
}

// `/vero-diff purge`: delete this project's snapshots, every session's. The next prompt
// starts a fresh history.
async function purge($: EngineInterface): Promise<string> {
  const shadow = await shadowOf($)
  if (!shadow) return 'Not a git repository: nothing to purge.'
  if (!isShadowPath(shadow)) return `Refusing to delete ${shadow}: not a snapshot store.`
  const bare = await git($, shadow, ['rev-parse', '--is-bare-repository'])
  if (bare.exitCode !== 0) return 'No snapshots for this project.'
  if (bare.stdout.trim() !== 'true') return `Refusing to delete ${shadow}: not a snapshot store.`
  const size = await $.process.run(['du', '-sh', shadow])
  const rm = await $.process.run(['rm', '-rf', shadow])
  if (rm.exitCode !== 0) return `Could not delete ${shadow}: ${rm.stderr.trim()}`
  await update($, view, cur => ({ ...cur, steps: [], files: [], collapsed: [], shownSha: '', latest: undefined, index: 0, error: '' }))

  return `Snapshots removed: ${shadow} (${size.stdout.split('\t')[0] || 'size unknown'}).`
}

// Sessions untouched for KEEP_DAYS lose their snapshots, at most once a day, in the
// background: a prune never holds up a session's start.
async function pruneStale($: EngineInterface) {
  try {
    const last = Number((await $.store.get(PRUNED_AT_KEY)) ?? 0)
    if (Date.now() - last < PRUNE_EVERY_MS) return
    await $.store.set(PRUNED_AT_KEY, Date.now())
    await script($, ['prune', String(KEEP_DAYS)])
  } catch {
    // a missed prune is tried again tomorrow
  }
}

export const register: Register = on => {
  // The main turn in flight: set at its start, cleared at its end. A subagent's turn
  // starts inside it and must not take a snapshot that would split it. One that never
  // ended (its turn.complete lost) stops counting after STALE_TURN_MS, so snapshots
  // cannot stop for the rest of the session.
  let openTurnAt: number | undefined

  on('session.start', async ($, e, next) => {
    openTurnAt = undefined
    await $.command.register({
      name: COMMAND,
      description: 'VeroDiff: what changed on each turn (pane, last [N], purge)',
      argumentHint: '[last [N] | band | purge]',
    })
    await $.tool.register({
      name: TOOL,
      description:
        'Shows what changed on disk during one step of this session, as recorded by VeroDiff: ' +
        'a summary and the full git diff between the turn\'s start and its end. ' +
        'Step 1 is the newest step, 2 the one before it, and so on. ' +
        'Use it to check exactly what an earlier turn changed.',
      inputSchema: {
        type: 'object',
        properties: { step: { type: 'integer', minimum: 1, description: '1 is the newest step' } },
      },
    })
    await reload($, true)
    const isGitRepo = (await read($, view)).shadow !== ''
    const isBandHidden = (await $.store.get(BAND_HIDDEN_KEY)) === true
    await update($, view, cur => ({ ...cur, isBandHidden }))
    if (isGitRepo && (await $.store.get(HIDDEN_KEY)) !== true) void openPane($, false)
    if (isGitRepo) void pruneStale($)

    return next(e)
  })

  // A /clear ends the conversation and goes on under a new session id with no
  // session.start: the pane must not keep showing the old session's steps.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    openTurnAt = undefined
    if (e.reason === 'clear') {
      await update($, view, cur => ({ ...cur, steps: [], files: [], collapsed: [], shownSha: '', latest: undefined, index: 0, error: '' }))
    }

    return done
  })

  on('turn.start', async ($, e, next) => {
    const isInsideOpenTurn = openTurnAt !== undefined && Date.now() - openTurnAt < STALE_TURN_MS
    if (!isInsideOpenTurn) {
      openTurnAt = Date.now()
      await snapshot($, 'pre', e.text)
    }

    return next(e)
  })

  // An interrupted turn completes too, so what it did before the interrupt is its own
  // step rather than being folded into the next one.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      openTurnAt = undefined
      await snapshot($, 'post')
      await reload($, true)
    }

    return done
  })

  // The matcher is a literal: `mcp__<plugin>__<name>` as $.tool.register lists it.
  on('tool.call', { tool: 'mcp__vero-diff__turn_diff' }, async ($, e) => {
    const step = (e as { step?: unknown }).step
    const text = await lastDiff($, typeof step === 'number' ? String(step) : '')

    return { result: text }
  }).catch(() => ({ deny: 'VeroDiff could not read the snapshots for that step.' }))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const [sub = '', arg = ''] = e.args.trim().split(/\s+/)
    if (sub === 'last') return { text: await lastDiff($, arg) }
    if (sub === 'purge') return { text: await purge($) }
    if (sub === 'band') {
      await setBandHidden($, false)
      return { text: 'VeroDiff row above the prompt is back. Close it again with its \u00d7.' }
    }
    if (sub !== '') {
      return { text: `Unknown: ${sub}. Use /vero-diff, /vero-diff last [N], /vero-diff band or /vero-diff purge.` }
    }

    await reload($, true)
    await openPane($, true)

    return { text: 'VeroDiff pane opened.' }
  })

  // Closed by the person (the desktop's own close mark) or by the Hide button; an unload
  // is a reload or the session ending, not a choice.
  // A failure to remember must never keep the pane open, hence the catch.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, view, cur => ({ ...cur, isPaneOpen: false }))
      if (e.origin.kind !== 'unload') await $.store.set(HIDDEN_KEY, true)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // One row above the prompt: the newest step, and while the pane is closed, a way back to
  // it without typing the command. Out of the way of a survey; nothing with no steps; and
  // once the person closes it with its ×, nothing at all - no row, no trace - until
  // `/vero-diff band`.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    const latest = v.latest
    if (e.props.hasSurvey || v.isBandHidden || latest === undefined) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>VeroDiff</Text>
        <Text>{latest.what}</Text>
        <Text dimColor>· {latest.count} ·</Text>
        <Text color="green">+{latest.adds}</Text>
        <Text color="red">{'\u2212'}{latest.dels}</Text>
        {!v.isPaneOpen && (
          <Button key="show-diff" dimColor onPress={() => void openPane($, true)}>
            Show diff
          </Button>
        )}
        <Button key="hide-band" plain dimColor role="dismiss" onPress={() => void setBandHidden($, true)}>
          {'\u00d7'}
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const v = await read($, view)
    // The desktop draws its own close mark on the pane; the terminal needs a button.
    const hide = e.surface === 'terminal' && (
      <Button key="hide" hotkey="h" role="dismiss" onPress={() => void closePane($)}>
        Hide
      </Button>
    )

    if (v.isLoading) return <Text dimColor>Loading snapshots...</Text>
    if (v.error) return <Text color="red">{v.error}</Text>
    if (v.steps.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>No changes in this session yet.</Text>
          <Text dimColor>A step appears after each turn that edits files.</Text>
          {hide}
        </Box>
      )
    }

    const step = v.steps[v.index]
    if (!step) return <Text dimColor>Loading snapshots...</Text>
    const go = (to: number) => () => void loadStep($, to).then(() => rememberLatest($))
    const shown = v.files.slice(0, MAX_FILES)
    // Scroll targets are Buttons (`fold:` heads each file, `goto:` heads the list): the
    // desktop app scrolls only to an element it can act on, and refused a Box's key with
    // "no element of its own is drawn under that key". A refusal still says why, as a toast.
    const scrollTo = (key: string) =>
      $.ui
        .scroll({ to: { key }, in: PANE, block: 'start' })
        .then(done => {
          if (done.deny) $.ui.toast(`VeroDiff: can't scroll here (${e.surface}): ${done.deny}`)
        })
        .catch((err: unknown) => $.ui.toast(`VeroDiff: can't scroll here (${e.surface}): ${String(err)}`))
    const jump = (key: string) => () => void scrollTo(key)
    const isFolded = (path: string) => v.collapsed.includes(path)
    const fold = (path: string) => () =>
      void update($, view, cur => ({
        ...cur,
        collapsed: cur.collapsed.includes(path) ? cur.collapsed.filter(p => p !== path) : [...cur.collapsed, path],
      }))
    // From the list, a folded file opens again before the pane scrolls to it.
    const open = (path: string) => () =>
      void update($, view, cur => ({ ...cur, collapsed: cur.collapsed.filter(p => p !== path) })).then(() =>
        scrollTo(`fold:${path}`),
      )
    // With more than one file the step opens with a list of them: each name jumps to
    // its diff, and each diff ends with a way back up to the list.
    const hasSummary = shown.length > 1

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{step.title}</Text>
          <Text dimColor>
            step {v.index + 1} of {v.steps.length} (newest first) · {step.when}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="older" hotkey="p" onPress={go(Math.min(v.index + 1, v.steps.length - 1))}>
            Older
          </Button>
          <Button key="newer" hotkey="n" onPress={go(Math.max(v.index - 1, 0))}>
            Newer
          </Button>
          <Button key="latest" hotkey="l" variant="primary" onPress={go(0)}>
            Latest
          </Button>
          <Button key="refresh" hotkey="r" onPress={() => void reload($, false)}>
            Refresh
          </Button>
          {hide}
        </Box>

        {v.files.length === 0 && !step.submodules && <Text dimColor>No changes in this step.</Text>}
        {step.submodules?.map(path => (
          <Text key={`submodule:${path}`} dimColor>
            {submoduleNote(path)}
          </Text>
        ))}

        {hasSummary && (
          <Box key="summary" flexDirection="column">
            {shown.map(file => (
              <Box flexDirection="row" gap={1}>
                <Button key={`goto:${file.path}`} plain dimColor onPress={open(file.path)}>
                  {isFolded(file.path) ? `✓ ${file.path}` : file.path}
                </Button>
                <Text color="green" dimColor={isFolded(file.path)}>+{file.adds}</Text>
                <Text color="red" dimColor={isFolded(file.path)}>{'−'}{file.dels}</Text>
              </Box>
            ))}
          </Box>
        )}

        {shown.map(file => (
          <Box key={`file:${file.path}`} flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Button key={`fold:${file.path}`} plain onPress={fold(file.path)}>
                {`${isFolded(file.path) ? '▸' : '▾'} ${file.path}`}
              </Button>
              <Text color="green" dimColor={isFolded(file.path)}>+{file.adds}</Text>
              <Text color="red" dimColor={isFolded(file.path)}>{'−'}{file.dels}</Text>
            </Box>
            {!isFolded(file.path) && (
              <Box flexDirection="column">
                {file.hunks ? (
                  <Code source={file.hunks} format="diff" path={file.path} language={languageOf(file.path)} />
                ) : (
                  <Text dimColor>(binary or mode change)</Text>
                )}
                {file.isCut && <Text dimColor>... cut: too long for one view</Text>}
                {hasSummary && (
                  <Button key={`top:${file.path}`} plain dimColor onPress={jump(`goto:${shown[0]?.path ?? ''}`)}>
                    {'↑ Files'}
                  </Button>
                )}
              </Box>
            )}
          </Box>
        ))}
        {v.files.length > MAX_FILES && <Text dimColor>+{v.files.length - MAX_FILES} more files</Text>}
      </Box>
    )
  })
}
