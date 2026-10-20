import { describe, expect, test } from 'claude-code/testing'

import {
  HOME_MARKETPLACE,
  HOME_REPO,
  MOVE_LABELS,
  REMOVE_LABELS,
  REPLACE_NO,
  REPLACE_QUESTION,
  REPLACE_YES,
  RESTART_NOTE,
  fillRefusedToast,
  legacyBand,
  legacyCopies,
  legacyMarkdown,
  legacyToast,
  marketplaceOf,
  moveSteps,
  removeSteps,
  sourceOf,
  stoppedBand,
  stoppedMarkdown,
  stoppedToast,
} from '../hooks/source-check'

// The canonical table for the source check. Each plugin carries a byte-identical copy as
// tests/source-check.test.ts, with the import pointing at ../hooks/source-check.

const HOME_LINUX = '/home/me/.claude/plugins/cache/vero-plugins/vero-diff/2.0.0'
const HOME_MAC = '/Users/me/.claude/plugins/cache/vero-plugins/vero-dotto/1.0.0'
const HOME_WIN = 'C:\\Users\\me\\.claude\\plugins\\cache\\vero-plugins\\vero-runto\\1.0.0'
const OLD = '/home/me/.claude/plugins/cache/old-marketplace/vero-diff/1.2.0'

describe('the catalog', () => {
  test('is named once and for all', () => {
    expect(HOME_MARKETPLACE).toBe('vero-plugins')
    expect(HOME_REPO).toBe('GomelHawk/VeroPlugins')
  })
})

describe('marketplaceOf', () => {
  test('reads the segment after plugins/cache on every platform', () => {
    expect(marketplaceOf(HOME_LINUX)).toBe('vero-plugins')
    expect(marketplaceOf(HOME_MAC)).toBe('vero-plugins')
    expect(marketplaceOf(HOME_WIN)).toBe('vero-plugins')
    expect(marketplaceOf(OLD)).toBe('old-marketplace')
  })
  test('does not care where the config dir is, or how the path is written', () => {
    expect(marketplaceOf('/srv/cc-config/plugins/cache/a-fork/vero-diff/2.0.0')).toBe('a-fork')
    expect(marketplaceOf('C:/Users/me/.claude/plugins\\cache/vero-plugins/vero-diff/2.0.0')).toBe('vero-plugins')
    expect(marketplaceOf(HOME_LINUX + '/')).toBe('vero-plugins')
    expect(marketplaceOf('//home//me//.claude//plugins//cache//mirror//vero-diff//2.0.0')).toBe('mirror')
  })
  test('a marketplace literally named plugins or cache is still read right', () => {
    expect(marketplaceOf('/h/.claude/plugins/cache/plugins/vero-diff/2.0.0')).toBe('plugins')
    expect(marketplaceOf('/h/.claude/plugins/cache/cache/vero-diff/2.0.0')).toBe('cache')
  })
  test('a root with no plugins/cache segment is no marketplace', () => {
    expect(marketplaceOf('/home/me/VeroDiff/plugins/vero-diff')).toBeUndefined()
    expect(marketplaceOf('/tmp/plugin-test-abc/vero-diff')).toBeUndefined()
    expect(marketplaceOf('/home/me/plugins/vero-diff')).toBeUndefined()
    expect(marketplaceOf('/home/me/cache/plugins/vero-diff')).toBeUndefined()
    expect(marketplaceOf('/home/me/plugins/cache')).toBeUndefined()
    expect(marketplaceOf('/home/me/plugins/cache/')).toBeUndefined()
    expect(marketplaceOf('')).toBeUndefined()
  })
})

describe('sourceOf', () => {
  test('a copy under plugins/cache/vero-plugins is home', () => {
    for (const root of [HOME_LINUX, HOME_MAC, HOME_WIN]) expect(sourceOf(root)).toEqual({ kind: 'home' })
  })
  test('a copy under any other marketplace is foreign, and names it', () => {
    expect(sourceOf(OLD)).toEqual({ kind: 'foreign', marketplace: 'old-marketplace' })
    expect(sourceOf('/h/.claude/plugins/cache/someones-fork/vero-diff/2.0.0')).toEqual({ kind: 'foreign', marketplace: 'someones-fork' })
    expect(sourceOf('/h/.claude/plugins/cache/local-folder/vero-diff/2.0.0')).toEqual({ kind: 'foreign', marketplace: 'local-folder' })
  })
  test('a development copy is dev', () => {
    expect(sourceOf('/home/me/VeroDiff/plugins/vero-diff')).toEqual({ kind: 'dev' })
    expect(sourceOf('D:\\work\\VeroDotto\\plugins\\vero-dotto')).toEqual({ kind: 'dev' })
    expect(sourceOf('/tmp/plugin-test-abc/vero-runto')).toEqual({ kind: 'dev' })
  })
  test('provenance decides when it is given', () => {
    expect(sourceOf('/anywhere', 'vero-diff@vero-plugins')).toEqual({ kind: 'home' })
    expect(sourceOf('/anywhere', 'vero-diff@inline')).toEqual({ kind: 'dev' })
    expect(sourceOf('/anywhere', 'vero-diff@other')).toEqual({ kind: 'foreign', marketplace: 'other' })
  })
  test('provenance wins over the path', () => {
    expect(sourceOf(OLD, 'vero-diff@vero-plugins')).toEqual({ kind: 'home' })
    expect(sourceOf(HOME_LINUX, 'vero-diff@old-marketplace')).toEqual({ kind: 'foreign', marketplace: 'old-marketplace' })
    expect(sourceOf(HOME_LINUX, 'vero-diff@inline')).toEqual({ kind: 'dev' })
  })
  test('a provenance with no marketplace in it falls back to the path', () => {
    expect(sourceOf(HOME_LINUX, 'vero-diff')).toEqual({ kind: 'home' })
    expect(sourceOf(HOME_LINUX, 'vero-diff@')).toEqual({ kind: 'home' })
    expect(sourceOf(OLD, '@x')).toEqual({ kind: 'foreign', marketplace: 'old-marketplace' })
    expect(sourceOf(OLD, '')).toEqual({ kind: 'foreign', marketplace: 'old-marketplace' })
  })
})

describe('the move', () => {
  test('is four commands, in order', () => {
    expect(moveSteps('vero-diff', 'old-marketplace')).toEqual([
      '/plugin marketplace add GomelHawk/VeroPlugins',
      '/plugin install vero-diff@vero-plugins',
      '/plugin uninstall vero-diff@old-marketplace',
      '/plugin marketplace remove old-marketplace',
    ])
    expect(moveSteps('vero-runto', 'a-fork').slice(2)).toEqual(['/plugin uninstall vero-runto@a-fork', '/plugin marketplace remove a-fork'])
  })
  test('an old copy is removed at the scope it was enabled in, then its marketplace everywhere', () => {
    expect(removeSteps('vero-diff', { marketplace: 'old-marketplace', scope: 'user' })).toEqual([
      '/plugin uninstall vero-diff@old-marketplace',
      '/plugin marketplace remove old-marketplace',
    ])
    expect(removeSteps('vero-diff', { marketplace: 'old-marketplace', scope: 'project' })).toEqual([
      '/plugin uninstall vero-diff@old-marketplace --scope project',
      '/plugin marketplace remove old-marketplace',
    ])
    expect(removeSteps('vero-dotto', { marketplace: 'mirror', scope: 'local' })[0]).toBe('/plugin uninstall vero-dotto@mirror --scope local')
  })
})

describe('the texts', () => {
  test('the stopped band', () => {
    expect(stoppedBand('VeroDiff', 'old-marketplace')).toBe(
      '⛔ VeroDiff is paused - it was installed from old-marketplace. Vero plugins install only from VeroPlugins.',
    )
  })
  test('the legacy band', () => {
    expect(legacyBand('VeroDiff', { marketplace: 'old-marketplace', scope: 'user' })).toBe(
      '⛔ VeroDiff is paused - an old copy from old-marketplace is still installed. Remove it, then restart.',
    )
  })
  test('the buttons and the notes', () => {
    expect([...MOVE_LABELS]).toEqual(['1 ↓ Add VeroPlugins', '2 ↓ Install from VeroPlugins', '3 ↓ Remove this copy', '4 ↓ Remove the old marketplace'])
    expect([...REMOVE_LABELS]).toEqual(['1 ↓ Remove the old copy', '2 ↓ Remove the old marketplace'])
    expect(RESTART_NOTE).toBe('then restart Claude Code')
    expect([REPLACE_QUESTION, REPLACE_YES, REPLACE_NO]).toEqual(['Replace your draft?', 'Replace', 'Cancel'])
    expect(fillRefusedToast('VeroRunto')).toBe('VeroRunto: close the dialog and press the button again.')
  })
  test('the legacy toast', () => {
    expect(legacyToast('VeroDiff', { marketplace: 'old-marketplace', scope: 'user' })).toBe(
      'VeroDiff is paused: an old copy from old-marketplace is still installed. See the band above the prompt.',
    )
  })
  test('the toast', () => {
    expect(stoppedToast('VeroDotto', 'other-marketplace')).toBe(
      'VeroDotto is paused: installed from other-marketplace. See the band above the prompt to move it to VeroPlugins.',
    )
  })
  test('the stopped message, with data to keep', () => {
    expect(stoppedMarkdown('VeroDiff', 'vero-diff', 'old-marketplace', "VeroDiff's snapshot history lives in ~/.cache/verodiff")).toBe(
      [
        '**VeroDiff is paused.** It was installed from `old-marketplace`; Vero plugins are',
        'installed only from VeroPlugins. Run these in Claude Code, then restart it:',
        '',
        '    /plugin marketplace add GomelHawk/VeroPlugins',
        '    /plugin install vero-diff@vero-plugins',
        '    /plugin uninstall vero-diff@old-marketplace',
        '    /plugin marketplace remove old-marketplace',
        '',
        "Your data is kept (VeroDiff's snapshot history lives in ~/.cache/verodiff).",
      ].join('\n'),
    )
  })
  test('the stopped message, with nothing to keep', () => {
    expect(stoppedMarkdown('VeroRunto', 'vero-runto', 'a-fork')).toBe(
      [
        '**VeroRunto is paused.** It was installed from `a-fork`; Vero plugins are',
        'installed only from VeroPlugins. Run these in Claude Code, then restart it:',
        '',
        '    /plugin marketplace add GomelHawk/VeroPlugins',
        '    /plugin install vero-runto@vero-plugins',
        '    /plugin uninstall vero-runto@a-fork',
        '    /plugin marketplace remove a-fork',
      ].join('\n'),
    )
  })
  test('the legacy message', () => {
    expect(legacyMarkdown('VeroDiff', 'vero-diff', { marketplace: 'old-marketplace', scope: 'project' })).toBe(
      [
        '**VeroDiff is paused.** An old copy from `old-marketplace` is still installed, and two',
        'copies must never act together. Run these in Claude Code, then restart it:',
        '',
        '    /plugin uninstall vero-diff@old-marketplace --scope project',
        '    /plugin marketplace remove old-marketplace',
      ].join('\n'),
    )
  })
})

describe('legacyCopies', () => {
  const user = (settings: unknown) => ({ scope: 'user' as const, settings })
  const project = (settings: unknown) => ({ scope: 'project' as const, settings })
  const local = (settings: unknown) => ({ scope: 'local' as const, settings })
  const settings = (enabled: Record<string, unknown>) => ({ model: 'opus', enabledPlugins: enabled, extraKnownMarketplaces: {} })

  test('finds an enabled old copy in any scope, with its scope', () => {
    expect(legacyCopies('vero-diff', [user(settings({ 'vero-diff@old-marketplace': true }))])).toEqual([
      { marketplace: 'old-marketplace', scope: 'user' },
    ])
    expect(legacyCopies('vero-diff', [user({}), project(settings({ 'vero-diff@a-fork': true }))])).toEqual([
      { marketplace: 'a-fork', scope: 'project' },
    ])
    expect(legacyCopies('vero-diff', [local(settings({ 'vero-diff@mirror': true }))])).toEqual([
      { marketplace: 'mirror', scope: 'local' },
    ])
  })
  test('finds every old copy, once each', () => {
    expect(
      legacyCopies('vero-diff', [
        user(settings({ 'vero-diff@old-marketplace': true, 'vero-diff@a-fork': true })),
        project(settings({ 'vero-diff@old-marketplace': true })),
      ]),
    ).toEqual([
      { marketplace: 'old-marketplace', scope: 'user' },
      { marketplace: 'a-fork', scope: 'user' },
      { marketplace: 'old-marketplace', scope: 'project' },
    ])
  })
  test('ignores the vero-plugins copy itself, disabled entries and other plugins', () => {
    expect(
      legacyCopies('vero-diff', [
        user(
          settings({
            'vero-diff@vero-plugins': true,
            'vero-diff@old-marketplace': false,
            'vero-dotto@other-marketplace': true,
            'pohuy@pohuy': true,
            'vero-diff-extra@somewhere': true,
          }),
        ),
      ]),
    ).toEqual([])
  })
  test('ignores a scope with no settings, and settings that are not an object', () => {
    expect(legacyCopies('vero-diff', [user(undefined), project(undefined), local(undefined)])).toEqual([])
    expect(legacyCopies('vero-diff', [user({}), project({ enabledPlugins: null }), local({ enabledPlugins: 'x' })])).toEqual([])
    expect(legacyCopies('vero-diff', [user([]), project(null), local(42), user('{"enabledPlugins":{}}')])).toEqual([])
  })
  test('ignores malformed keys', () => {
    expect(legacyCopies('vero-diff', [user(settings({ 'vero-diff': true, '@x': true, 'vero-diff@': true }))])).toEqual([])
  })
  test('the real shape of a settings file', () => {
    const real = {
      enabledPlugins: { 'pohuy@pohuy': true, 'vero-diff@old-marketplace': true },
      extraKnownMarketplaces: { 'old-marketplace': { source: { source: 'github', repo: 'someone/VeroDiff' } } },
    }
    expect(legacyCopies('vero-diff', [user(real)])).toEqual([{ marketplace: 'old-marketplace', scope: 'user' }])
    expect(legacyCopies('vero-dotto', [user(real)])).toEqual([])
  })
})
