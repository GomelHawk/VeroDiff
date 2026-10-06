import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// The pane drawn through the engine on both surfaces it lives on. The test has no
// processes, so a hook beneath the plugin answers `$.process.run` the way snapshot.sh
// and git would for a session with two finished turns.

const SHADOW = '/cache/repo-0123456789ab.git'
const LOG = [
  'c3\tc2\t1 minute ago\t[post] rename the helper',
  'c2\tc1\t4 minutes ago\t[post] add a word to a.txt',
  'c1\t\t9 minutes ago\t[pre] add a word to a.txt',
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

const ok = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

// Everything beneath the plugin that a session would answer, from memory.
function fakeWorld(on: On) {
  mock.store(on)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__vero-diff__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'S1' }))
  on('session.root', () => ({ value: '/repo' }))
  on('process.run', ($, e) => {
    const [cmd, , kind] = e.argv
    if (cmd === 'bash') return ok(kind === 'where' ? `${SHADOW}\n` : '')
    if (e.argv[1] === 'log') return ok(`${LOG}\n`)
    if (e.argv[1] === 'diff') return ok(DIFFS[e.argv[e.argv.length - 1] ?? ''] ?? '')
    return ok('')
  })
}

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

    test('Hide is drawn on the terminal only', async ($, on) => {
      fakeWorld(on)
      await $.session.start({ cwd: '/repo', surface, isInteractive: true })
      const ui = await $.ui.mount({ plugin: 'vero-diff', surface, component: 'Pane', props: PROPS, requestId: 'vero-diff' })

      const hide = await ui.find({ key: 'hide' })
      expect(hide !== undefined).toBe(surface === 'terminal')
    })
  })
}
