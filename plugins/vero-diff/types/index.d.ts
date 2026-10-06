// One step of a session: a snapshot and the parent it is diffed against.
export type Step = {
  sha: string
  parent: string
  when: string
  title: string
}

// One file of a step's diff, hunks only: the path is drawn above them.
export type FileDiff = { path: string; hunks: string; isCut: boolean }

// What the pane draws. `shadow` is empty outside a git repository.
export type View = {
  shadow: string
  steps: Step[]
  index: number
  files: FileDiff[]
  error: string
  isLoading: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'vero-diff': { view: View }
  }
}
