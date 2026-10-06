import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

// The pane drawn through the engine on both surfaces it lives on. The test has no
// processes, so a hook beneath the plugin answers `$.process.run` the way snapshot.sh
// and git would for a session with two finished turns.

const SHADOW = '/cache/repo-0123456789ab.git'
const LOG = [
  'c3\tc2\t1 minute ago\t\t[post] rename the helper',
  'c2\tc1\t4 minutes ago\t\t[post] add a word to a.txt',
  'c1\t\t9 minutes ago\t\t[pre] add a word to a.txt',
].join('\n')
const DIFFS: Record<string, string> = {
  c3: [
    'diff --git a/a.txt b/a.txt',
    '@@ -1,1 +1,1 @@',
    '-helper',
    '+assist',
    'diff --git a/notes.md b/notes.md',
    '@@ -0,0 +1,2 @@',
    '+# Notes',
    '+one',
    '',
  ].join('\n'),
  c2: ['diff --git a/a.txt b/a.txt', '@@ -1,1 +1,2 @@', ' helper', '+thicket', ''].join('\n'),
}

const ok = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// How the world differs from a plain session with two turns: what `snapshot.sh where`
// says, what git says of that path, the log it holds, and how many turns came before it.
// Read on every call, so a test can change it between two reads.
type World = {
  shadow?: string
  bare?: 'true' | 'false' | 'missing'
  log?: string
  diffs?: Record<string, string>
  turnsBefore?: number
}

// Everything beneath the plugin that a session would answer, from memory. Returns what
// the plugin asked of the world: the panes it opened, the toasts it showed, the commands
// it ran.
function fakeWorld(on: On, store: Record<string, unknown> = {}, world: World = {}) {
  const seen = { opened: [] as string[], toasts: [] as string[], ran: [] as string[][] }
  const shadow = world.shadow ?? SHADOW
  mock.store(on, store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__vero-diff__${e.name}` } }))
  on('ui.open', ($, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'S1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', ($, e) => {
    seen.ran.push([...e.argv])
    const [cmd, , kind] = e.argv
    if (cmd === 'bash') return ok(kind === 'where' ? `${shadow}\n` : '')
    if (cmd === 'du') return ok(`12K\t${shadow}\n`)
    // git runs as `env -u ... git --git-dir=<shadow> -c core.quotePath=false <subcommand> ...`
    const git = e.argv.slice(e.argv.indexOf('git') + 1)
    const sub = git.find(arg => ['log', 'diff', 'rev-list', 'rev-parse'].includes(arg))
    if (sub === 'log') return ok(`${world.log ?? LOG}\n`)
    if (sub === 'diff') return ok((world.diffs ?? DIFFS)[git[git.length - 1] ?? ''] ?? '')
    if (sub === 'rev-list') return ok(`${world.turnsBefore ?? 0}\n`)
    if (sub === 'rev-parse') {
      const bare = world.bare ?? 'true'
      return bare === 'missing' ? ok('', 128) : ok(`${bare}\n`)
    }
    return ok('')
  })
  return seen
}

const run = ($: Parameters<TestBody>[0], args: string) =>
  $.command.run({
    command: 'vero-diff',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 120 },
  })

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 3,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 3 },
  view: {},
} as const

const PROPS = {
  title: 'VeroDiff',
  isFocused: false,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

for (const surface of ['terminal', 'desktop'] as const) {
  describe(`pane on ${surface}`, () => {
    test('shows the newest turn, its files and their counts', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      expect(await ui.find({ type: 'Text', text: /^turn 2 {2}"rename the helper"$/ })).toBeDefined()
      expect(await ui.find({ key: 'goto:notes.md' })).toBeDefined()
      expect(await ui.find({ key: 'file:a.txt' })).toBeDefined()
      expect((await ui.findAll({ type: 'Code' })).length).toBe(2)
      // the language goes by name, and the surface accepts it
      expect((await ui.findAll({ type: 'Code' })).map(c => c.props.language)).toEqual([undefined, 'markdown'])
    })

    test('each file jumps from the list and back up to it', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      // the kit lays nothing out, so a scroll has nowhere to land: what can be held to
      // is that every file has both ends of the trip, and that pressing them is safe
      for (const path of ['a.txt', 'notes.md']) {
        expect(await ui.find({ key: `goto:${path}` })).toBeDefined()
        expect(await ui.find({ key: `top:${path}` })).toBeDefined()
        await ui.press({ key: `goto:${path}` })
        await ui.press({ key: `top:${path}` })
      }
    })

    test('a folded file keeps its header, loses its diff, and is ticked in the list', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      await ui.press({ key: 'fold:a.txt' })
      expect((await ui.findAll({ type: 'Code' })).length).toBe(1)
      expect((await ui.find({ key: 'fold:a.txt' }))?.text).toBe('\u25b8 a.txt')
      expect((await ui.find({ key: 'goto:a.txt' }))?.text).toBe('\u2713 a.txt')
      expect(await ui.find({ key: 'top:a.txt' })).toBeUndefined()

      // Refresh reads the same step again: the review goes on, the fold stays
      await ui.press({ key: 'refresh' })
      expect((await ui.findAll({ type: 'Code' })).length).toBe(1)

      // picking it from the list opens it again
      await ui.press({ key: 'goto:a.txt' })
      expect((await ui.findAll({ type: 'Code' })).length).toBe(2)
    })

    test('showing another step drops every fold', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      await ui.press({ key: 'fold:a.txt' })
      await ui.press({ key: 'fold:notes.md' })
      expect((await ui.findAll({ type: 'Code' })).length).toBe(0)
      await ui.press({ key: 'older' })
      await ui.press({ key: 'newer' })
      expect((await ui.findAll({ type: 'Code' })).length).toBe(2)
    })

    test('Older walks back to the first turn', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      await ui.press({ key: 'older' })
      expect(await ui.find({ type: 'Text', text: /^turn 1 {2}"add a word to a.txt"$/ })).toBeDefined()
      // one file: no list to jump from or back to, the diff alone
      expect(await ui.find({ key: 'summary' })).toBeUndefined()
      expect(await ui.find({ key: 'top:a.txt' })).toBeUndefined()
    })

    test('a /clear empties the pane: the new session has no steps yet', async ($, on) => {
      fakeWorld(on)
      on('session.end', ($, e) => ({ sessionId: e.sessionId }))
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      await $.session.end({ reason: 'clear', sessionId: 'S1', resume: { id: 'S1' } })
      expect(await ui.find({ type: 'Text', text: 'No changes in this session yet.' })).toBeDefined()
    })

    test('a scroll that does not happen says why in a toast', async ($, on) => {
      // the kit lays nothing out, so every scroll fails here: exactly the case to report
      const seen = fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      await ui.press({ key: 'goto:notes.md' })
      expect(seen.toasts.length).toBe(1)
      expect(seen.toasts[0]?.startsWith(`VeroDiff: can't scroll here (${surface}): `)).toBe(true)
    })

    test('the band shows the newest step, and Show diff only while the pane is closed', async ($, on) => {
      // closed in an earlier session, so it does not open by itself
      const seen = fakeWorld(on, { isPaneHidden: true })
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const band = await $.ui.mount({
        plugin: 'vero-diff',
        surface,
        component: 'AbovePrompt',
        props: BAND,
      })

      expect(await band.find({ type: 'Text', text: 'turn 2' })).toBeDefined()
      expect(await band.find({ type: 'Text', text: '+3' })).toBeDefined() // +assist, +# Notes, +one
      expect(await band.find({ type: 'Text', text: '\u22121' })).toBeDefined()
      expect(seen.opened).toEqual([])
      await band.press({ key: 'show-diff' })
      expect(seen.opened).toEqual(['vero-diff'])
      expect(await band.find({ key: 'show-diff' })).toBeUndefined()
    })

    // The desktop closes the pane with its own mark, which the kit cannot press; that close
    // passes through the plugin's ui.close hook. Hide does not, hence this test.
    if (surface === 'terminal') {
      test('Hide brings Show diff to the band', async ($, on) => {
        fakeWorld(on)
        on('ui.close', () => ({ value: undefined }))
        await $.session.start({ cwd: '/repo', surface, isInteractive: true })
        const pane = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })
        const band = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'AbovePrompt', props: BAND })
        expect(await band.find({ key: 'show-diff' })).toBeUndefined()

        await pane.press({ key: 'hide' })
        expect(await band.find({ key: 'show-diff' })).toBeDefined()
      })
    }

    test('the band closes without a trace, and /vero-diff band brings it back', async ($, on) => {
      const seen = fakeWorld(on)
      // what the engine draws above the prompt when no plugin does: an empty row
      on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const band = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'AbovePrompt', props: BAND })

      await band.press({ key: 'hide-band' })
      expect(await band.find({ type: 'Text', text: 'turn 2' })).toBeUndefined()
      expect(await band.find({ key: 'hide-band' })).toBeUndefined()

      const shown = await run($, 'band')
      expect(shown.text?.startsWith('VeroDiff row above the prompt is back')).toBe(true)
      expect(await band.find({ type: 'Text', text: 'turn 2' })).toBeDefined()
      expect(seen.toasts).toEqual([])
    })

    test('/vero-diff last [N] prints a step, counting as the pane does', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })

      const newest = (await run($, 'last')).text ?? ''
      expect(newest.startsWith('**turn 2  "rename the helper"**  ·  step 1 of 2')).toBe(true)
      expect(newest.includes('+assist')).toBe(true)
      expect((await run($, 'last 2')).text?.startsWith('**turn 1  "add a word to a.txt"**  ·  step 2 of 2')).toBe(true)
      expect((await run($, 'last 3')).text).toBe('No such step: 3 (this session has 2).')
      expect((await run($, 'last x')).text).toBe('No such step: x (this session has 2).')
      expect((await run($, 'last 0')).text).toBe('No such step: 0 (this session has 2).')
    })

    test('/vero-diff last cuts a long diff on a line, says so, and still closes its fence', async ($, on) => {
      const lines = Array.from({ length: 3000 }, (_, i) => `+line ${i} ${'x'.repeat(30)}`)
      const big = ['diff --git a/big.txt b/big.txt', '@@ -0,0 +1,3000 @@', ...lines, ''].join('\n')
      fakeWorld(on, {}, { log: 'b2\tb1\tnow\t\t[post] write a big file\nb1\t\tnow\t\t[pre] write a big file', diffs: { b2: big } })
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })

      const text = (await run($, 'last')).text ?? ''
      expect(big.length > 60000).toBe(true)
      expect(text.endsWith('```\n\n_Cut: the rest of this diff is in the pane._')).toBe(true)
      const body = text.slice(text.indexOf('```diff\n') + 8, text.lastIndexOf('\n```'))
      expect(body.length <= 60000).toBe(true)
      // cut between lines, never through one
      expect(/^\+line \d+ x{30}$/.test(body.split('\n').pop() ?? '')).toBe(true)
    })

    test('Refresh after the history shrank shows the step that is left', async ($, on) => {
      const world: World = {}
      fakeWorld(on, {}, world)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })
      await ui.press({ key: 'older' })
      expect(await ui.find({ type: 'Text', text: /^step 2 of 2/ })).toBeDefined()

      // only the newest turn is left (another session's purge, say)
      world.log = 'c3\tc2\t1 minute ago\t\t[post] rename the helper\nc2\t\t4 minutes ago\t\t[pre] rename the helper'
      await ui.press({ key: 'refresh' })
      expect(await ui.find({ type: 'Text', text: /^step 1 of 1/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^turn 1 {2}"rename the helper"$/ })).toBeDefined()
      expect((await ui.findAll({ type: 'Code' })).length).toBe(2)
    })

    test('a step that changed only a submodule says so, in the pane, the band and last', async ($, on) => {
      const log = 'd2\td1\tnow\tsub\t[post] edit inside the submodule\nd1\t\tnow\t\t[pre] edit inside the submodule'
      fakeWorld(on, {}, { log, diffs: {} })
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })
      const band = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'AbovePrompt', props: BAND })

      expect(await ui.find({ type: 'Text', text: 'Changes inside submodule sub are not shown.' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'No changes in this step.' })).toBeUndefined()
      expect(await band.find({ type: 'Text', text: '\u00b7 1 submodule \u00b7' })).toBeDefined()
      const text = (await run($, 'last')).text ?? ''
      expect(text.includes('_Changes inside submodule sub are not shown._')).toBe(true)
      expect(text.includes('No changes in this step.')).toBe(false)
    })

    test('git never sees an inherited GIT_* variable, nor the person\'s own path quoting', async ($, on) => {
      const seen = fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })

      const gits = seen.ran.filter(argv => argv[0] === 'env')
      expect(gits.length > 0).toBe(true)
      for (const argv of gits) {
        expect(argv.includes('GIT_OBJECT_DIRECTORY')).toBe(true)
        expect(argv.includes(`--git-dir=${SHADOW}`)).toBe(true)
        expect(argv.includes('core.quotePath=false')).toBe(true)
      }
      expect(seen.ran.some(argv => argv[0] === 'git')).toBe(false)
    })

    test('turns older than one read keep their numbers', async ($, on) => {
      // a full read: 200 snapshots, every one a turn, the oldest still with a parent
      const log = Array.from({ length: 200 }, (_, i) => `s${200 - i}\ts${199 - i}\tnow\t\t[post] turn text`).join('\n')
      fakeWorld(on, {}, { log, turnsBefore: 7 })
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      expect(await ui.find({ type: 'Text', text: /^turn 207 {2}"turn text"$/ })).toBeDefined()
    })

    test('purge deletes a snapshot store and empties the pane', async ($, on) => {
      const seen = fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      expect((await run($, 'purge')).text).toBe(`Snapshots removed: ${SHADOW} (12K).`)
      expect(seen.ran.some(argv => argv[0] === 'rm' && argv[2] === SHADOW)).toBe(true)
      expect(await ui.find({ type: 'Text', text: 'No changes in this session yet.' })).toBeDefined()
    })

    for (const [what, world, answer] of [
      ['the root', { shadow: '/' }, 'Refusing to delete /: not a snapshot store.'],
      ['a home folder', { shadow: '/home/me' }, 'Refusing to delete /home/me: not a snapshot store.'],
      ['a repository that is not bare', { bare: 'false' }, `Refusing to delete ${SHADOW}: not a snapshot store.`],
      ['a path with no repository', { bare: 'missing' }, 'No snapshots for this project.'],
    ] as const) {
      test(`purge refuses ${what}`, async ($, on) => {
        const seen = fakeWorld(on, {}, world)
        await $.session.start({ cwd: '/repo', surface, isInteractive: true })

        expect((await run($, 'purge')).text).toBe(answer)
        expect(seen.ran.some(argv => argv[0] === 'rm')).toBe(false)
      })
    }

    test('Hide is drawn on the terminal only', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      const hide = await ui.find({ key: 'hide' })
      expect(hide !== undefined).toBe(surface === 'terminal')
    })
  })
}
