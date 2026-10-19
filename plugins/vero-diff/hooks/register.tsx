import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FileDiff, Hunk, Step, View } from '../types'
import {
  DIFF_OPTIONS,
  LOG_FORMAT,
  askAbout,
  clean,
  fenceFor,
  isShadowPath,
  languageOf,
  otherSessionAt,
  parentOfOldest,
  parseLog,
  promptLabel,
  shownHunks,
  splitFiles,
  stepSummary,
  submoduleNote,
} from './steps'
import {
  MOVE_LABELS,
  REMOVE_LABEL,
  REPLACE_NO,
  REPLACE_QUESTION,
  REPLACE_YES,
  RESTART_NOTE,
  fillRefusedToast,
  legacyBand,
  legacyCopies,
  legacyMarkdown,
  legacyToast,
  moveSteps,
  removeStep,
  sourceOf,
  stoppedBand,
  stoppedMarkdown,
  stoppedToast,
} from './source-check'
import type { LegacyCopy, ScopeSettings, Source } from './source-check'

// VeroDiff: snapshot the working tree at both ends of a turn (scripts/snapshot.sh) and
// draw the diff of each turn in a pane. Snapshots live in a bare repository outside the
// project; nothing is ever written to its .git.

const PANE = 'vero-diff'
const PLUGIN = 'vero-diff'
const DISPLAY = 'VeroDiff'
// What the move leaves in place, named in the stopped message.
const KEEPS = "VeroDiff's snapshot history lives in ~/.cache/verodiff"
// ⚠ is drawn wider than the one cell a terminal gives it and covers the space after it,
// so it is always followed by two.
const WARN = '\u26a0  '
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
// While a copy works, its source is re-read at most this often: another copy appearing
// beside it mid-session is rare, and the band tells the person to restart anyway. A
// stopped copy re-reads on every turn, so the old copy's removal is seen at the next Enter.
const RECHECK_MS = 10_000
let checkedAt = -Infinity

const INITIAL: View = {
  shadow: '',
  steps: [],
  index: 0,
  shownSha: '',
  files: [],
  collapsed: [],
  pages: {},
  confirming: '',
  reverted: [],
  unrevertable: [],
  isConfirmingAll: false,
  allNote: '',
  isTurnOpen: false,
  otherSession: '',
  isPaneOpen: false,
  isBandHidden: false,
  source: { kind: 'dev' },
  confirmingFill: '',
  error: '',
  isLoading: true,
}
const view = atom({ plugin: 'vero-diff', key: 'view' } as const, INITIAL)

// --- the source check ---------------------------------------------------------------
// VeroDiff works only when installed from VeroPlugins (`vero-plugins`), or as a
// development copy. Where this copy came from is read off its root; a home copy also
// looks in the settings for an older copy of itself still enabled under another
// marketplace, so two copies never act at once. While stopped, every hook returns the
// engine's own behaviour, the command and the tool answer the move message, and the
// band holds the buttons that fill the move commands into the prompt box.

// Under `claude plugin test` the root is the plugin's folder, never under plugins/cache.
// A copy that finds itself `dev` reads VERO_TEST_ROOT and takes its source from that path
// instead; only a dev copy consults it, so no installed copy can opt out through it.
async function checkSource($: EngineInterface): Promise<{ source: Source; legacy?: LegacyCopy }> {
  try {
    let source = sourceOf($.plugin.root)
    if (source.kind === 'dev') {
      const testRoot = await $.env.get('VERO_TEST_ROOT')
      if (testRoot) source = sourceOf(testRoot)
    }
    if (source.kind !== 'home') return { source }
    const sources: ScopeSettings[] = []
    for (const scope of ['user', 'project', 'local'] as const) {
      sources.push({ scope, settings: await $.settings.read({ source: scope }).catch(() => undefined) })
    }
    return { source, legacy: legacyCopies(PLUGIN, sources)[0] }
  } catch {
    return { source: { kind: 'dev' } }
  }
}

function isStopped(v: View): boolean {
  return v.source.kind === 'foreign' || v.legacy !== undefined
}

// Reads the source again and keeps the state in step; says whether it is stopped now.
async function refreshSource($: EngineInterface, isForced: boolean): Promise<boolean> {
  const was = isStopped(await read($, view))
  const now = await $.clock.now()
  if (!isForced && !was && now - checkedAt < RECHECK_MS) return false
  checkedAt = now
  const { source, legacy } = await checkSource($)
  await update($, view, cur => ({ ...cur, source, legacy, confirmingFill: '' }))
  const stopped = source.kind === 'foreign' || legacy !== undefined
  if (stopped !== was) $.ui.invalidate('ui.render')
  return stopped
}

// The move message: the command's answer, the tool's deny.
function stoppedMessage(v: View): string {
  if (v.legacy !== undefined) return legacyMarkdown(DISPLAY, PLUGIN, v.legacy)
  if (v.source.kind === 'foreign') return stoppedMarkdown(DISPLAY, PLUGIN, v.source.marketplace, KEEPS)
  return ''
}

// The commands the band's buttons fill, by button key.
function moveCommand(v: View, which: string): string | undefined {
  if (v.legacy !== undefined) return which === 'remove' ? removeStep(PLUGIN, v.legacy) : undefined
  if (v.source.kind !== 'foreign') return undefined
  const n = Number(which)
  return Number.isInteger(n) && n >= 1 && n <= 3 ? moveSteps(PLUGIN, v.source.marketplace)[n - 1] : undefined
}

// Puts one move command into the prompt box, replacing what is there. Nothing runs by
// itself: the person presses Enter.
async function fillMove($: EngineInterface, cmd: string) {
  try {
    const filled = await $.prompt.fill({ text: cmd, mode: 'replace' })
    if (!filled.isFilled) $.ui.toast(fillRefusedToast(DISPLAY))
  } catch {
    $.ui.toast(fillRefusedToast(DISPLAY))
  }
}

// A press: with a draft in the box, ask first; otherwise fill at once.
async function pressMove($: EngineInterface, which: string) {
  const v = await read($, view)
  const cmd = moveCommand(v, which)
  if (cmd === undefined) return
  let draft = ''
  try {
    draft = (await $.prompt.read()).text
  } catch {
    draft = ''
  }
  if (draft.trim() !== '' && draft !== cmd) {
    await update($, view, cur => ({ ...cur, confirmingFill: cmd }))
    return
  }
  await fillMove($, cmd)
}

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

// The fields that show one step, as a single write. Folding, Show more and Revert are
// for reviewing the step on screen. Showing another step - by Older, Newer, Latest, or a
// new turn landing - means this one is accepted, so they go; the same step read again
// (Refresh, `last`, the model's tool) keeps them.
function showing(cur: View, index: number, step: Step | undefined, files: FileDiff[]): Partial<View> {
  const sha = step?.sha ?? ''
  if (sha !== '' && cur.shownSha === sha) return { index, shownSha: sha, files }
  return {
    index,
    shownSha: sha,
    files,
    collapsed: [],
    pages: {},
    confirming: '',
    reverted: [],
    unrevertable: [],
    isConfirmingAll: false,
    allNote: '',
  }
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
    const refs = await git($, shadow, ['for-each-ref', '--format=%(committerdate:unix) %(refname)', 'refs/verodiff/session'])
    const otherSession = otherSessionAt(refs.exitCode === 0 ? refs.stdout : '', sid, Math.floor(Date.now() / 1000))
    const prev = await read($, view)
    const index = jumpToLatest ? 0 : Math.min(prev.index, Math.max(0, steps.length - 1))
    const step = steps[index]
    const files = step ? await filesOf($, shadow, step) : []
    // One write: the step list, which step is shown and its files arrive together, so the
    // pane never draws a new step's title over the old step's files in between.
    await update($, view, cur => ({ ...cur, shadow, steps, otherSession, ...showing(cur, index, step, files), isLoading: false, error: '' }))
    await rememberLatest($)
  } catch (err) {
    await update($, view, cur => ({ ...cur, isLoading: false, error: String(err) }))
  }
}

// Revert puts files of the newest step back as they were before the step, in two
// presses: the first checks they are still as the step left them and asks Yes or No,
// the second (Yes) checks again and writes. Only the newest step, and never while a turn
// runs: an older step's file may have been changed by the steps after it, and a running
// turn may be writing it. A file edited since is left alone and marked so. The revert is
// an edit like any other: the next snapshot records it as edits outside a turn.
// `isAll`: every file of the step not reverted yet, all or nothing - if one of them was
// edited since, none is touched, so a turn is never left half undone.
async function revert($: EngineInterface, files: FileDiff[], isAll: boolean, isConfirmed: boolean) {
  const v = await read($, view)
  const step = v.steps[0]
  if (v.index !== 0 || v.isTurnOpen || !step || step.sha !== v.shownSha || files.length === 0) return
  const paths = files.flatMap(file => (file.oldPath === undefined ? [file.path] : [file.path, file.oldPath]))
  const lines = await script($, ['revert', isConfirmed ? 'apply' : 'check', step.sha, step.parent, ...paths]).then(
    out => out.stdout.split('\n').filter(Boolean),
    () => ['failed'],
  )
  const [said = 'failed', ...edited] = lines
  const names = files.map(file => file.path)
  const idle = { confirming: '', isConfirmingAll: false }
  if (said === 'ok') {
    await update($, view, cur => ({ ...cur, ...idle, allNote: '', ...(isAll ? { isConfirmingAll: true } : { confirming: names[0] ?? '' }) }))
  } else if (said === 'reverted') {
    await update($, view, cur => ({
      ...cur,
      ...idle,
      allNote: isAll ? `\u21ba All files of this ${step.turn === undefined ? 'step' : 'turn'} reverted` : cur.allNote,
      reverted: [...cur.reverted, ...names.filter(path => !cur.reverted.includes(path))],
      collapsed: [...cur.collapsed, ...names.filter(path => !cur.collapsed.includes(path))],
    }))
  } else if (said === 'changed' && isAll) {
    // a rename's source names the file it became
    const named = edited.map(path => files.find(file => file.oldPath === path)?.path ?? path)
    const first = named[0] ?? 'a file'
    const more = named.length > 1 ? ` and ${named.length - 1} more` : ''
    const since = step.turn === undefined ? 'this step' : 'this turn'
    await update($, view, cur => ({ ...cur, ...idle, allNote: `Not reverted: ${first}${more} changed since ${since}.` }))
  } else if (said === 'changed') {
    await update($, view, cur => ({ ...cur, ...idle, unrevertable: [...cur.unrevertable, ...names] }))
  } else {
    await update($, view, cur => ({ ...cur, ...idle }))
    $.ui.toast(isAll ? 'VeroDiff: could not revert the files.' : `VeroDiff: could not revert ${names[0] ?? 'the file'}.`)
  }
}

// Ask about this: where the hunk is, added to the prompt box for the person to finish.
// Nothing is sent.
async function ask($: EngineInterface, file: FileDiff, hunk: Hunk, step: Step) {
  try {
    const box = await $.prompt.read()
    const gap = box.text === '' || /\s$/.test(box.text) ? '' : '\n'
    const filled = await $.prompt.fill({ text: gap + askAbout(file, hunk, step), mode: 'append' })
    if (!filled.isFilled) $.ui.toast('VeroDiff: the prompt box could not take the question.')
  } catch {
    $.ui.toast('VeroDiff: the prompt box could not take the question.')
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
    await update($, view, cur => ({ ...cur, isTurnOpen: false }))
    const stopped = await refreshSource($, true)
    await $.command.register({
      name: COMMAND,
      description: 'VeroDiff: what changed on each turn (pane, last [N], band, purge)',
      argumentHint: '[last [N] | band | purge]',
    })
    if (stopped) {
      // no tool for the model, no snapshots, no prune, no pane: one toast says why
      const v = await read($, view)
      $.ui.toast(v.legacy !== undefined ? legacyToast(DISPLAY, v.legacy) : v.source.kind === 'foreign' ? stoppedToast(DISPLAY, v.source.marketplace) : '')
      return next(e)
    }
    await $.tool.register({
      name: TOOL,
      description:
        'Shows what changed on disk during one step of this session, as recorded by VeroDiff: ' +
        'a heading, a diffstat and the git diff. A step is usually one finished turn, from its start ' +
        'to its end; a step titled "edits outside a turn" holds changes made between two turns, ' +
        'typically by the person. Steps are this session\'s only, numbered newest first. ' +
        'Use it to check exactly what an earlier turn changed. Changes inside a submodule are not ' +
        'shown, edits by another session sharing this working tree cannot be told apart from this ' +
        'one\'s, and a diff longer than 60,000 characters is cut short.',
      inputSchema: {
        type: 'object',
        properties: { step: { type: 'integer', minimum: 1, description: '1 is the newest step, 2 the one before it; omit for the newest' } },
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
    await update($, view, cur => ({ ...cur, isTurnOpen: false, confirmingFill: '' }))
    if (e.reason === 'clear') {
      await update($, view, cur => ({ ...cur, steps: [], files: [], collapsed: [], shownSha: '', latest: undefined, index: 0, error: '' }))
    }

    return done
  })

  on('turn.start', async ($, e, next) => {
    // Re-read each turn, so a copy installed or removed mid-session is seen at once.
    if (await refreshSource($, false)) return next(e)
    const isInsideOpenTurn = openTurnAt !== undefined && Date.now() - openTurnAt < STALE_TURN_MS
    if (!isInsideOpenTurn) {
      openTurnAt = Date.now()
      await update($, view, cur => ({ ...cur, isTurnOpen: true, confirming: '', isConfirmingAll: false }))
      await snapshot($, 'pre', e.text)
    }

    return next(e)
  })

  // An interrupted turn completes too, so what it did before the interrupt is its own
  // step rather than being folded into the next one.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (isStopped(await read($, view))) return done
    if (e.agentId === undefined) {
      openTurnAt = undefined
      await update($, view, cur => ({ ...cur, isTurnOpen: false }))
      await snapshot($, 'post')
      await reload($, true)
    }

    return done
  })

  // The matcher is a literal: `mcp__<plugin>__<name>` as $.tool.register lists it.
  on('tool.call', { tool: 'mcp__vero-diff__turn_diff' }, async ($, e) => {
    const v = await read($, view)
    if (isStopped(v)) return { deny: stoppedMessage(v) }
    const step = (e as { step?: unknown }).step
    const text = await lastDiff($, typeof step === 'number' ? String(step) : '')

    return { result: text }
  }).catch(() => ({ deny: 'VeroDiff could not read the snapshots for that step.' }))

  on('command.run', { command: COMMAND }, async ($, e) => {
    const stoppedView = await read($, view)
    if (isStopped(stoppedView)) return { text: stoppedMessage(stoppedView) }
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

    return { text: '**VeroDiff** - *One turn, one diff.* The pane is open: every turn\'s changes, newest first.' }
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
  // `/vero-diff band`. Other plugins share the band: what the ones beneath draw
  // (VeroDotto's rows, say) stays, under this row, so no plugin hides another's.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey) return next(e)
    // Stopped: the move row, whatever the person chose for the normal row. No ×.
    if (isStopped(v)) {
      const { Box, Text, Button } = $.ui.resolve(e)
      const below = await next(e)
      const line = v.legacy !== undefined ? legacyBand(DISPLAY, v.legacy) : v.source.kind === 'foreign' ? stoppedBand(DISPLAY, v.source.marketplace) : ''
      const buttons = v.legacy !== undefined ? [['remove', REMOVE_LABEL]] : MOVE_LABELS.map((label, i) => [String(i + 1), label])
      return (
        <Box flexDirection="column">
          <Text color="yellow">{line}</Text>
          {v.confirmingFill !== '' ? (
            <Box flexDirection="row" gap={1}>
              <Text>{REPLACE_QUESTION}</Text>
              <Button key={`${PLUGIN}-move:replace`} onPress={() => void fillMove($, v.confirmingFill).then(() => update($, view, cur => ({ ...cur, confirmingFill: '' })))}>
                {REPLACE_YES}
              </Button>
              <Button key={`${PLUGIN}-move:cancel`} onPress={() => void update($, view, cur => ({ ...cur, confirmingFill: '' }))}>
                {REPLACE_NO}
              </Button>
            </Box>
          ) : (
            <Box flexDirection="row" gap={1}>
              {buttons.map(([which, label]) => (
                <Button key={`${PLUGIN}-move:${which}`} onPress={() => void pressMove($, which ?? '')}>
                  {label}
                </Button>
              ))}
              <Text dimColor>{RESTART_NOTE}</Text>
            </Box>
          )}
          {below}
        </Box>
      )
    }
    const latest = v.latest
    if (v.isBandHidden || latest === undefined) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text dimColor>VeroDiff</Text>
          <Text>{latest.what}</Text>
          <Text dimColor>· {latest.count} ·</Text>
          <Text color="green">+{latest.adds}</Text>
          <Text color="red">{'\u2212'}{latest.dels}</Text>
          {v.otherSession !== '' && <Text color="yellow">{WARN}another session here</Text>}
          {!v.isPaneOpen && (
            <Button key="show-diff" dimColor onPress={() => void openPane($, true)}>
              Show diff
            </Button>
          )}
          <Button key="hide-band" plain dimColor role="dismiss" onPress={() => void setBandHidden($, true)}>
            {'\u00d7'}
          </Button>
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const v = await read($, view)
    if (isStopped(v)) return <Box />
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
    const more = (path: string) => () =>
      void update($, view, cur => ({ ...cur, pages: { ...cur.pages, [path]: (cur.pages[path] ?? 0) + 1 } }))
    // Revert is offered on the newest step only, and not while a turn runs.
    const canRevert = v.index === 0 && !v.isTurnOpen
    const before = step.turn === undefined ? 'this step' : 'this turn'
    // After the last file: every file of the step not reverted yet, every one of them,
    // drawn or past MAX_FILES. Offered once at least two are left; one has its own button.
    const left = v.files.filter(file => !v.reverted.includes(file.path))
    const revertAll = () => {
      if (v.isConfirmingAll) {
        return (
          <Box flexDirection="row" gap={1}>
            <Text>
              Revert {left.length} files to before {before}?
            </Text>
            <Button key="revert-all-yes" onPress={() => void revert($, left, true, true)}>
              Yes
            </Button>
            <Button key="revert-all-no" onPress={() => void update($, view, cur => ({ ...cur, isConfirmingAll: false }))}>
              No
            </Button>
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          {v.allNote !== '' && <Text dimColor>{v.allNote}</Text>}
          {left.length > 1 && (
            <Button key="revert-all" onPress={() => void revert($, left, true, false)}>
              Revert all files of {before}
            </Button>
          )}
        </Box>
      )
    }
    const revertControl = (file: FileDiff) => {
      if (v.reverted.includes(file.path)) return <Text dimColor>{'\u21ba'} reverted</Text>
      if (v.unrevertable.includes(file.path)) return <Text dimColor>changed since - not reverted</Text>
      if (v.confirming === file.path) {
        return (
          <Box flexDirection="row" gap={1}>
            <Text>Revert to before {before}?</Text>
            <Button key={`revert-yes:${file.path}`} onPress={() => void revert($, [file], false, true)}>
              Yes
            </Button>
            <Button key={`revert-no:${file.path}`} onPress={() => void update($, view, cur => ({ ...cur, confirming: '' }))}>
              No
            </Button>
          </Box>
        )
      }
      return (
        <Button key={`revert:${file.path}`} onPress={() => void revert($, [file], false, false)}>
          Revert
        </Button>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold>{step.title}</Text>
          <Text dimColor>
            step {v.index + 1} of {v.steps.length} (newest first) · {step.when}
          </Text>
          {v.otherSession !== '' && (
            <Text color="yellow">
              {WARN}Another session is also editing this folder (last change {v.otherSession}) - its edits
              appear in these diffs. Use a git worktree per session.
            </Text>
          )}
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

        {shown.map(file => {
          const count = shownHunks(file.hunks, v.pages[file.path] ?? 0)
          const hidden = file.hunks.length - count
          return (
            <Box key={`file:${file.path}`} flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <Button key={`fold:${file.path}`} plain onPress={fold(file.path)}>
                  {`${isFolded(file.path) ? '▸' : '▾'} ${file.path}`}
                </Button>
                <Text color="green" dimColor={isFolded(file.path)}>+{file.adds}</Text>
                <Text color="red" dimColor={isFolded(file.path)}>{'−'}{file.dels}</Text>
                {canRevert && revertControl(file)}
              </Box>
              {!isFolded(file.path) && (
                <Box flexDirection="column">
                  {file.hunks.length === 0 && <Text dimColor>(binary or mode change)</Text>}
                  {file.hunks.slice(0, count).map((hunk, i) => (
                    <Box key={`hunk:${file.path}:${i}`} flexDirection="column">
                      <Code source={hunk.text} format="diff" path={file.path} language={languageOf(file.path)} />
                      {hunk.isCut && <Text dimColor>... the rest of this hunk is too long to show</Text>}
                      <Button key={`ask:${file.path}:${i}`} onPress={() => void ask($, file, hunk, step)}>
                        Ask about this
                      </Button>
                    </Box>
                  ))}
                  {hidden > 0 && (
                    <Box flexDirection="row" gap={1}>
                      <Text dimColor>{`… ${hidden} more ${hidden === 1 ? 'hunk' : 'hunks'} not shown`}</Text>
                      <Button key={`more:${file.path}`} onPress={more(file.path)}>
                        Show more
                      </Button>
                    </Box>
                  )}
                  {hidden === 0 && file.isCut && <Text dimColor>... the rest is too long to show here</Text>}
                  {hasSummary && (
                    <Button key={`top:${file.path}`} plain dimColor onPress={jump(`goto:${shown[0]?.path ?? ''}`)}>
                      {'↑ Files'}
                    </Button>
                  )}
                </Box>
              )}
            </Box>
          )
        })}
        {v.files.length > MAX_FILES && <Text dimColor>+{v.files.length - MAX_FILES} more files</Text>}
        {canRevert && revertAll()}
      </Box>
    )
  })
}
