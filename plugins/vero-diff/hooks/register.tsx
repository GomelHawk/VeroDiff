import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { LOG_FORMAT, clean, fenceFor, isShadowPath, parseLog, splitFiles } from './steps'

// VeroDiff: snapshot the working tree at both ends of a turn (scripts/snapshot.sh) and
// draw the diff of each turn in a pane. Snapshots live in a bare repository outside the
// project; nothing is ever written to its .git.

const PANE = 'vero-diff'
const COMMAND = 'vero-diff'
// Whether the person closed the pane, kept across sessions: a closed pane stays closed
// until the command opens it again.
const HIDDEN_KEY = 'isPaneHidden'
const LIMIT = 200
const MAX_FILES = 40
const MAX_INLINE_CHARS = 60000 // `last` lands in the model's context too
const SNAPSHOT_TIMEOUT_MS = 20000

const INITIAL: View = { shadow: '', steps: [], index: 0, files: [], error: '', isLoading: true }
const view = atom({ plugin: 'vero-diff', key: 'view' } as const, INITIAL)

// The path snapshot.sh writes to, computed by the same lines, so the two always agree.
const SHADOW_SCRIPT = `
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
CACHE="\${VERODIFF_DIR:-\${XDG_CACHE_HOME:-$HOME/.cache}/verodiff}"
if command -v md5sum >/dev/null 2>&1;  then key="$(printf '%s' "$TOP" | md5sum | cut -c1-12)"
elif command -v md5 >/dev/null 2>&1;   then key="$(printf '%s' "$TOP" | md5 -q | cut -c1-12)"
else key="$(printf '%s' "$TOP" | cksum | cut -d' ' -f1)"; fi
printf '%s' "$CACHE/$(basename "$TOP")-$key.git"
`

async function shadowOf($: EngineInterface): Promise<string> {
  const cwd = await $.session.root()
  const out = await $.process.run(['bash', '-c', SHADOW_SCRIPT], { cwd })
  return out.stdout.trim()
}

async function git($: EngineInterface, shadow: string, args: string[]) {
  return $.process.run(['git', ...args], { env: { GIT_DIR: shadow } })
}

// One snapshot. snapshot.sh reads the same JSON a command hook would get on stdin, and
// exits 0 whatever happens, so a failed snapshot never gets in the way of a turn.
async function snapshot($: EngineInterface, kind: 'pre' | 'post', prompt = '') {
  try {
    const cwd = await $.session.root()
    const session_id = await $.session.id()
    const payload = kind === 'pre' ? { prompt, session_id } : { session_id }
    await $.process.run(['bash', `${$.plugin.root}/scripts/snapshot.sh`, kind], {
      cwd,
      stdin: JSON.stringify(payload),
      env: { CLAUDE_PROJECT_DIR: cwd },
      timeoutMs: SNAPSHOT_TIMEOUT_MS,
    })
  } catch {
    // a snapshot that timed out is one missing step, not a broken turn
  }
}

async function loadStep($: EngineInterface, index: number) {
  const v = await read($, view)
  const step = v.steps[index]
  if (!step) return
  const out = await git($, v.shadow, ['diff', '--no-color', '--no-ext-diff', '-M', step.parent, step.sha])
  await update($, view, cur => ({ ...cur, index, files: splitFiles(out.stdout) }))
}

async function reload($: EngineInterface, jumpToLatest: boolean) {
  try {
    const shadow = await shadowOf($)
    if (!shadow) {
      await update($, view, cur => ({ ...cur, shadow, isLoading: false, error: 'Not a git repository.' }))
      return
    }
    const sid = await $.session.id()
    const log = await git($, shadow, ['log', `--max-count=${LIMIT}`, LOG_FORMAT, `refs/verodiff/session/${sid}`])
    const steps = log.exitCode === 0 ? parseLog(log.stdout) : []
    const prev = await read($, view)
    const index = jumpToLatest ? 0 : Math.min(prev.index, Math.max(0, steps.length - 1))
    await update($, view, cur => ({ ...cur, shadow, steps, files: [], isLoading: false, error: '' }))
    await loadStep($, index)
  } catch (err) {
    await update($, view, cur => ({ ...cur, isLoading: false, error: String(err) }))
  }
}

// `/vero-diff last [N]`: one step's diff as a transcript row, which the model reads as
// well. N counts as the pane does: 1 is the newest step.
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
  await update($, view, cur => ({ ...cur, steps: [], files: [], index: 0, error: '' }))

  return `Snapshots removed: ${shadow} (${size.stdout.split('\t')[0] || 'size unknown'}).`
}

export const register: Register = on => {
  // The module's own variable: true from a main turn's start to its end, so a subagent's
  // turn, which starts inside it, never takes a snapshot that would split the turn.
  let isTurnOpen = false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'VeroDiff: what changed on each turn (pane, last [N], purge)',
      argumentHint: '[last [N] | purge]',
    })
    await reload($, true)
    const isGitRepo = (await read($, view)).shadow !== ''
    if (isGitRepo && (await $.store.get(HIDDEN_KEY)) !== true) {
      void $.ui.open({ id: PANE, title: 'VeroDiff' })
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (!isTurnOpen) {
      isTurnOpen = true
      await snapshot($, 'pre', e.text)
    }

    return next(e)
  })

  // An interrupted turn completes too, so what it did before the interrupt is its own
  // step rather than being folded into the next one.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      isTurnOpen = false
      await snapshot($, 'post')
      await reload($, true)
    }

    return done
  })

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
  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind !== 'unload') await $.store.set(HIDDEN_KEY, true)

    return next(e)
  })

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
    const go = (to: number) => () => void loadStep($, to)
    const shown = v.files.slice(0, MAX_FILES)

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

        {shown.map(file => (
          <Box flexDirection="column">
            <Text bold color="cyan">{file.path}</Text>
            {file.hunks ? (
              <Code source={file.hunks} format="diff" path={file.path} />
            ) : (
              <Text dimColor>(binary or mode change)</Text>
            )}
            {file.isCut && <Text dimColor>... cut: too long for one view</Text>}
          </Box>
        ))}
        {v.files.length > MAX_FILES && <Text dimColor>+{v.files.length - MAX_FILES} more files</Text>}
      </Box>
    )
  })
}
