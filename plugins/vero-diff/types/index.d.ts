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

// One file of a step's diff, hunks only: the path is drawn above them. `adds` and
// `dels` count the whole file's changed lines, even when `hunks` was cut.
export type FileDiff = { path: string; hunks: string; isCut: boolean; adds: number; dels: number }

// The newest step at a glance, as the band above the prompt draws it.
export type StepSummary = { what: string; count: string; adds: number; dels: number }

// What the pane draws. `shadow` is empty outside a git repository. `shownSha` is the
// snapshot whose files are loaded; `collapsed` holds the paths folded on that step only,
// and empties the moment another step is shown.
export type View = {
  shadow: string
  steps: Step[]
  index: number
  shownSha: string
  files: FileDiff[]
  collapsed: string[]
  // the newest step for the band, whichever step the pane shows; absent with no steps
  latest?: StepSummary
  // whether the pane is on screen, so the band offers to bring it back only when it is not
  isPaneOpen: boolean
  // whether the person closed the band; then it draws nothing until `/vero-diff band`
  isBandHidden: boolean
  error: string
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vero-diff': { view: View }
  }
}
