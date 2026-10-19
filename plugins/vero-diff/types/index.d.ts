// One step of a session: a snapshot and the parent it is diffed against. `turn` is the
// turn number for a finished turn, absent for edits made outside one. `submodules` names
// the submodules whose uncommitted work changed in the step - work no diff can show.
export type Step = {
  sha: string
  parent: string
  when: string
  title: string
  turn?: number
  submodules?: string[]
}

// One hunk of a file's diff, `@@` header first. `isCut`: it was too long for one Code
// element and keeps only what fits. `oldStart`/`newStart` are the header's line numbers.
export type Hunk = { text: string; isCut: boolean; oldStart: number; newStart: number }

// One file of a step's diff, hunks only: the path is drawn above them. `adds` and
// `dels` count the whole file's changed lines, even when `hunks` was cut. `isCut`: the
// file had more hunks than VeroDiff keeps. `oldPath` is the path before a rename;
// `status` says the step created or deleted the file.
export type FileDiff = {
  path: string
  oldPath?: string
  status?: 'added' | 'deleted'
  hunks: Hunk[]
  isCut: boolean
  adds: number
  dels: number
}

// The newest step at a glance, as the band above the prompt draws it.
export type StepSummary = { what: string; count: string; adds: number; dels: number }

// What the pane draws. `shadow` is empty outside a git repository. `shownSha` is the
// snapshot whose files are loaded; `collapsed`, `pages`, `confirming`, `reverted`,
// `unrevertable`, `isConfirmingAll` and `allNote` hold what was done on that step only,
// and empty the moment another step is shown.
export type View = {
  shadow: string
  steps: Step[]
  index: number
  shownSha: string
  files: FileDiff[]
  collapsed: string[]
  // presses of Show more, by path
  pages: Record<string, number>
  // the path whose Revert waits for Yes or No; '' for none
  confirming: string
  // the paths put back as they were before the step
  reverted: string[]
  // the paths found edited since the step, which Revert would overwrite
  unrevertable: string[]
  // whether Revert all waits for Yes or No
  isConfirmingAll: boolean
  // what the last Revert all did: all reverted, or which file stopped it; '' for nothing
  allNote: string
  // whether a main turn is running: Revert waits for it to end
  isTurnOpen: boolean
  // when another session last changed this working tree, as HH:MM; '' when none lately
  otherSession: string
  // the newest step for the band, whichever step the pane shows; absent with no steps
  latest?: StepSummary
  // whether the pane is on screen, so the band offers to bring it back only when it is not
  isPaneOpen: boolean
  // whether the person closed the band; then it draws nothing until `/vero-diff band`
  isBandHidden: boolean
  // where this copy was installed from: home is VeroPlugins, dev a --plugin-dir folder,
  // foreign any other marketplace - then the plugin is stopped and shows how to move
  source: { kind: 'home' } | { kind: 'dev' } | { kind: 'foreign'; marketplace: string }
  // an older copy of this plugin still enabled under another marketplace; present, the
  // plugin is stopped until it is removed
  legacy?: { marketplace: string; scope: 'user' | 'project' | 'local' }
  // the move command waiting for "Replace your draft?"; '' for none
  confirmingFill: string
  error: string
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vero-diff': { view: View }
  }
}
