import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { LOG_FORMAT, clean, fenceFor, isShadowPath, parseLog, promptLabel, splitFiles, statusLine } from './steps'

// VeroDiff: snapshot the working tree at both ends of a turn (scripts/snapshot.sh) and
// draw the diff of each turn in a pane. Snapshots live in a bare repository outside the
// project; nothing is ever written to its .git.

const PANE = 'vero-diff'
const COMMAND = 'vero-diff'
const TOOL = 'turn_diff'
// Whether the person closed the pane, kept across sessions: a closed pane stays closed
// until the command opens it again.
const HIDDEN_KEY = 'isPaneHidden'
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

async function git($: EngineInterface, shadow: string, args: string[]) {
  return $.process.run(['git', ...args], { env: { GIT_DIR: shadow } })
}

async function snapshot($: EngineInterface, kind: 'pre' | 'post', prompt = '') {
  try {
    await script($, [kind], { VERODIFF_PROMPT: promptLabel(prompt) })
  } catch {
    // a snapshot that timed out is one missing step, not a broken turn
  }
}

// The status line follows the newest step, whichever step the pane shows.
async function showStatus($: EngineInterface) {
  const v = await read($, view)
  if (v.index === 0) $.ui.status(statusLine(v.steps[0], v.files))
}

async function loadStep($: EngineInterface, index: number) {
  const v = await read($, view)
  const step = v.steps[index]
  if (!step) return
  const out = await git($, v.shadow, ['diff', '--no-color', '--no-ext-diff', '-M', step.parent, step.sha])
  // Folding is for reviewing the step on screen. Showing another step - by Older, Newer,
  // Latest, or a new turn landing - means this one is accepted, so the folds go; the
  // same step read again (Refresh, `last`, the model's tool) keeps them.
  await update($, view, cur => ({
    ...cur,
    index,
    shownSha: step.sha,
    files: splitFiles(out.stdout),
    collapsed: cur.shownSha === step.sha ? cur.collapsed : [],
  }))
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
    const steps = log.exitCode === 0 ? parseLog(log.stdout) : []
    const prev = await read($, view)
    const index = jumpToLatest ? 0 : Math.min(prev.index, Math.max(0, steps.length - 1))
    // The files stay as they are until the step's own arrive: emptying them first
    // would flash "No changes in this step." on every reload.
    await update($, view, cur => ({
      ...cur,
      shadow,
      steps,
      files: steps.length === 0 ? [] : cur.files,
      collapsed: steps.length === 0 ? [] : cur.collapsed,
      isLoading: false,
      error: '',
    }))
    await loadStep($, index)
    if (steps.length === 0) $.ui.status(undefined)
    else await showStatus($)
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
  const stat = await git($, v.shadow, ['diff', '--no-color', '-M', '--stat=100', ...range])
  const out = await git($, v.shadow, ['diff', '--no-color', '--no-ext-diff', '-M', ...range])
  const head = `**${step.title}**  ·  step ${n} of ${v.steps.length}  ·  ${step.when}`
  let diff = clean(out.stdout).replace(/\n$/, '')
  if (!diff) return `${head}\n\nNo changes in this step.`
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
  await update($, view, cur => ({ ...cur, steps: [], files: [], collapsed: [], shownSha: '', index: 0, error: '' }))
  $.ui.status(undefined)

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
      argumentHint: '[last [N] | purge]',
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
    if (isGitRepo && (await $.store.get(HIDDEN_KEY)) !== true) {
      void $.ui.open({ id: PANE, title: 'VeroDiff' })
    }
    if (isGitRepo) void pruneStale($)

    return next(e)
  })

  // A /clear ends the conversation and goes on under a new session id with no
  // session.start: the pane must not keep showing the old session's steps.
  on('session.end', async ($, e, next) => {
    const done = await next(e)
    openTurnAt = undefined
    if (e.reason === 'clear') {
      await update($, view, cur => ({ ...cur, steps: [], files: [], collapsed: [], shownSha: '', index: 0, error: '' }))
      $.ui.status(undefined)
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
    if (sub !== '') return { text: `Unknown: ${sub}. Use /vero-diff, /vero-diff last [N] or /vero-diff purge.` }

    await $.store.set(HIDDEN_KEY, false)
    await reload($, true)
    await $.ui.open({ id: PANE, title: 'VeroDiff' })

    return { text: 'VeroDiff pane opened.' }
  })

  // Closed by the person (the desktop's own close mark) or by the Hide button; an unload
  // is a reload or the session ending, not a choice.
  // A failure to remember must never keep the pane open, hence the catch.
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind !== 'unload') await $.store.set(HIDDEN_KEY, true)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const v = await read($, view)
    // The desktop draws its own close mark on the pane; the terminal needs a button.
    const hide = e.surface === 'terminal' && (
      <Button key="hide" hotkey="h" role="dismiss" onPress={() => void $.ui.close({ id: PANE })}>
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
    const go = (to: number) => () => void loadStep($, to).then(() => showStatus($))
    const shown = v.files.slice(0, MAX_FILES)
    const scrollTo = (key: string) =>
      $.ui.scroll({ to: { key }, in: PANE, block: 'start' }).catch(() => undefined)
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
        scrollTo(`file:${path}`),
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

        {v.files.length === 0 && <Text dimColor>No changes in this step.</Text>}

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
                  <Code source={file.hunks} format="diff" path={file.path} />
                ) : (
                  <Text dimColor>(binary or mode change)</Text>
                )}
                {file.isCut && <Text dimColor>... cut: too long for one view</Text>}
                {hasSummary && (
                  <Button key={`top:${file.path}`} plain dimColor onPress={jump('summary')}>
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
