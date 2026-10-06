// One step of a session: a snapshot and the parent it is diffed against. `turn` is the
// turn number for a finished turn, absent for edits made outside one.
export type Step = {
  sha: string
  parent: string
  when: string
  title: string
  turn?: number
}

// One file of a step's diff, hunks only: the path is drawn above them. `adds` and
// `dels` count the whole file's changed lines, even when `hunks` was cut.
export type FileDiff = { path: string; hunks: string; isCut: boolean; adds: number; dels: number }

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
  error: string
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vero-diff': { view: View }
  }
}
