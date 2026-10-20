// The source check every Vero plugin carries, byte for byte (the canonical copy lives in
// VeroPlugins/shared/hooks/source-check.ts; each plugin's hooks/source-check.ts is a copy, and
// VeroPlugins' CI fails when any copy differs). Pure TypeScript: no `$`, no plugin
// constants - the plugin's names are passed in.
//
// A Vero plugin works only when installed from the vero-plugins marketplace, or loaded
// as a development copy (--plugin-dir, CLAUDE_CODE_PLUGIN_DIRS, claude plugin test). A
// copy from any other marketplace is "foreign": it stops, and shows the person the
// commands that move it. There is no opt-out, by the owner's decision.
//
// The engine loads one hooks module per plugin name: of two enabled copies, the one whose
// `enabledPlugins` key comes first (a managed scope before all) runs and the other is
// skipped. So while an old copy is enabled, the old copy is the one that shows the move;
// the home copy's `legacyCopies` check covers the other order only.

export const HOME_MARKETPLACE = 'vero-plugins'
export const HOME_REPO = 'GomelHawk/VeroPlugins'

export type Source =
  | { kind: 'home' } // installed from vero-plugins: work normally
  | { kind: 'dev' } // --plugin-dir / CLAUDE_CODE_PLUGIN_DIRS / plugin test: work normally
  | { kind: 'foreign'; marketplace: string } // installed from anywhere else: stop

// Where Claude Code keeps a plugin's enable flag: one settings file per scope, read with
// `$.settings.read({ source })`.
export type Scope = 'user' | 'project' | 'local'

// One scope's settings as `$.settings.read` gives them: the parsed object, or whatever
// a failed read left (`undefined`).
export type ScopeSettings = { scope: Scope; settings: unknown }

// Another enabled copy of the same plugin, from another marketplace.
export type LegacyCopy = { marketplace: string; scope: Scope }

// The marketplace an installed copy came from, read off its root:
// `<config dir>/plugins/cache/<marketplace>/<plugin>/<version>`. Only the `plugins/cache`
// segment pair is matched - the config dir moves with CLAUDE_CONFIG_DIR - and both
// separators count, so Windows roots work. `undefined` for a root with no such segment.
export function marketplaceOf(root: string): string | undefined {
  const segments = root.split(/[\\/]+/)
  for (let i = 0; i + 2 < segments.length; i++) {
    if (segments[i] === 'plugins' && segments[i + 1] === 'cache' && segments[i + 2] !== '') {
      return segments[i + 2]
    }
  }
  return undefined
}

// The source of this copy. Provenance - the engine's `<name>@<marketplace>` for the loaded
// plugin, `<name>@inline` for a --plugin-dir copy - wins when given; the root decides
// otherwise.
export function sourceOf(root: string, provenance?: string): Source {
  const at = provenance?.lastIndexOf('@') ?? -1
  if (provenance !== undefined && at > 0 && at < provenance.length - 1) {
    const marketplace = provenance.slice(at + 1)
    if (marketplace === HOME_MARKETPLACE) return { kind: 'home' }
    if (marketplace === 'inline') return { kind: 'dev' }
    return { kind: 'foreign', marketplace }
  }
  const marketplace = marketplaceOf(root)
  if (marketplace === undefined) return { kind: 'dev' }
  if (marketplace === HOME_MARKETPLACE) return { kind: 'home' }
  return { kind: 'foreign', marketplace }
}

// The four commands that move a foreign copy, in the order the person runs them. The new
// copy runs once the third has removed this one and Claude Code has restarted; the fourth
// removes the marketplace this copy came from, so nothing of it stays behind.
export function moveSteps(plugin: string, from: string): string[] {
  return [
    `/plugin marketplace add ${HOME_REPO}`,
    `/plugin install ${plugin}@${HOME_MARKETPLACE}`,
    `/plugin uninstall ${plugin}@${from}`,
    `/plugin marketplace remove ${from}`,
  ]
}

// The two commands that remove an old copy found enabled in the settings, and then its
// marketplace. A copy enabled at project or local scope must be removed at that scope, in
// that project; the marketplace is removed from every scope.
export function removeSteps(plugin: string, copy: LegacyCopy): string[] {
  const scope = copy.scope === 'user' ? '' : ` --scope ${copy.scope}`
  return [`/plugin uninstall ${plugin}@${copy.marketplace}${scope}`, `/plugin marketplace remove ${copy.marketplace}`]
}

// The band's buttons, in `moveSteps` / `removeSteps` order, and the note after them. Keys
// are the plugin's own; these are the labels every plugin draws.
export const MOVE_LABELS = ['1 ↓ Add VeroPlugins', '2 ↓ Install from VeroPlugins', '3 ↓ Remove this copy', '4 ↓ Remove the old marketplace'] as const
export const REMOVE_LABELS = ['1 ↓ Remove the old copy', '2 ↓ Remove the old marketplace'] as const
export const RESTART_NOTE = 'then restart Claude Code'

// The question a button asks before replacing a draft in the prompt box, and its answers.
export const REPLACE_QUESTION = 'Replace your draft?'
export const REPLACE_YES = 'Replace'
export const REPLACE_NO = 'Cancel'

// The toast when the prompt box refused the fill (a dialog is open).
export function fillRefusedToast(displayName: string): string {
  return `${displayName}: close the dialog and press the button again.`
}

// The one toast a home copy paused by an old copy shows, at session start.
export function legacyToast(displayName: string, copy: LegacyCopy): string {
  return `${displayName} is paused: an old copy from ${copy.marketplace} is still installed. See the band above the prompt.`
}

// The stopped band's first line (the buttons below it fill `moveSteps`).
export function stoppedBand(displayName: string, from: string): string {
  return `⛔ ${displayName} is paused - it was installed from ${from}. Vero plugins install only from VeroPlugins.`
}

// The band of a home copy that found an old copy of itself still enabled.
export function legacyBand(displayName: string, copy: LegacyCopy): string {
  return `⛔ ${displayName} is paused - an old copy from ${copy.marketplace} is still installed. Remove it, then restart.`
}

// The one toast a stopped copy shows, at session start.
export function stoppedToast(displayName: string, from: string): string {
  return `${displayName} is paused: installed from ${from}. See the band above the prompt to move it to VeroPlugins.`
}

// The stopped message: the command's answer, the tool's deny, the README's text. `keeps`
// names the data the move leaves in place ("VeroDiff's snapshot history lives in
// ~/.cache/verodiff"); a plugin with nothing to keep passes nothing.
export function stoppedMarkdown(displayName: string, plugin: string, from: string, keeps?: string): string {
  const steps = moveSteps(plugin, from)
    .map(step => `    ${step}`)
    .join('\n')
  const kept = keeps ? `\n\nYour data is kept (${keeps}).` : ''
  return (
    `**${displayName} is paused.** It was installed from \`${from}\`; Vero plugins are\n` +
    `installed only from VeroPlugins. Run these in Claude Code, then restart it:\n\n` +
    `${steps}${kept}`
  )
}

// The message of a home copy paused by an old copy of itself.
export function legacyMarkdown(displayName: string, plugin: string, copy: LegacyCopy): string {
  const steps = removeSteps(plugin, copy)
    .map(step => `    ${step}`)
    .join('\n')
  return (
    `**${displayName} is paused.** An old copy from \`${copy.marketplace}\` is still installed, and two\n` +
    `copies must never act together. Run these in Claude Code, then restart it:\n\n` +
    steps
  )
}

// Other enabled copies of `plugin` in the settings Claude Code keeps: every
// `enabledPlugins` key `<plugin>@<marketplace>` set to true, where the marketplace is not
// vero-plugins. A scope with no settings, settings that are not an object, a `false`
// entry, another plugin, and the vero-plugins key itself all count for nothing. One
// entry per marketplace and scope, in the order given.
export function legacyCopies(plugin: string, sources: readonly ScopeSettings[]): LegacyCopy[] {
  const found: LegacyCopy[] = []
  for (const { scope, settings } of sources) {
    if (settings === null || typeof settings !== 'object') continue
    const enabled = (settings as { enabledPlugins?: unknown }).enabledPlugins
    if (enabled === null || typeof enabled !== 'object') continue
    for (const [key, value] of Object.entries(enabled as Record<string, unknown>)) {
      if (value !== true) continue
      const at = key.lastIndexOf('@')
      if (at <= 0 || key.slice(0, at) !== plugin) continue
      const marketplace = key.slice(at + 1)
      if (marketplace === '' || marketplace === HOME_MARKETPLACE) continue
      if (found.some(c => c.marketplace === marketplace && c.scope === scope)) continue
      found.push({ marketplace, scope })
    }
  }
  return found
}
