// Pure text work on git's output: no `$`, so the tests can drive it directly.

import type { FileDiff, Step, StepSummary } from '../types'

export const MAX_HUNK_CHARS = 9000 // a Code element holds at most 10000

// The format `parseLog` reads, one snapshot per line, newest first.
export const LOG_FORMAT = '--format=%H%x09%P%x09%ar%x09%s'

// Snapshot kinds never reach the person. A `post` is a turn, numbered from the start of
// the session so "turn 3" keeps its name as newer steps arrive. A `pre` with a parent is
// edits that happened outside a turn, between two of them: typically the person's own. The
// oldest snapshot has no parent, so its diff would be the whole tree - no edit, and on a
// big project a huge one - so it is no step at all, only the point turn 1 starts from.
export function parseLog(log: string): Step[] {
  const rows = log
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha = '', parents = '', when = '', subject = ''] = line.split('\t')
      return { sha, parent: parents.split(' ')[0] ?? '', when, subject }
    })
  const turnOf = new Map<string, number>()
  let turn = 0
  for (const row of [...rows].reverse()) {
    if (row.subject.startsWith('[post] ')) turnOf.set(row.sha, ++turn)
  }

  return rows
    .filter(row => row.parent !== '')
    .map(row => {
      const turn = turnOf.get(row.sha)
      const step: Step = { sha: row.sha, parent: row.parent, when: row.when, title: row.subject || 'snapshot' }
      if (turn !== undefined) {
        step.turn = turn
        step.title = `turn ${turn}  "${row.subject.slice(7)}"`
      } else if (row.subject.startsWith('[pre] ')) {
        step.title = 'edits outside a turn'
      }
      return step
    })
}

// Code accepts tab and newline as its only control characters.
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')

// A step's `git diff`, one entry per file, cut to what one Code element can hold.
export function splitFiles(diff: string): FileDiff[] {
  return diff
    .split(/^(?=diff --git )/m)
    .filter(chunk => chunk.startsWith('diff --git '))
    .map(chunk => {
      const head = chunk.slice(0, chunk.indexOf('\n'))
      const path = head.replace(/^diff --git a\/.* b\//, '')
      const at = chunk.indexOf('\n@@')
      let hunks = at < 0 ? '' : clean(chunk.slice(at + 1)).replace(/\n$/, '')
      // Counted before any cut, from the hunks alone: the `---`/`+++` header lines
      // come before the first `@@`, so a deleted line that reads `--x` still counts.
      let adds = 0
      let dels = 0
      for (const line of hunks.split('\n')) {
        if (line.startsWith('+')) adds++
        else if (line.startsWith('-')) dels++
      }
      const isCut = hunks.length > MAX_HUNK_CHARS
      if (isCut) hunks = fitHunks(hunks, MAX_HUNK_CHARS)
      return { path, hunks, isCut, adds, dels }
    })
}

// Cuts hunks to `limit` characters so that they still parse. Code reads its source as
// hunks only while every `@@ -a,b +c,d @@` header matches the lines under it: a diff cut
// mid-hunk is drawn as plain text, its colouring and syntax highlighting gone. So keep
// whole hunks while they fit, and when not even the first one does, keep the lines of it
// that fit and rewrite its header to count exactly those.
export function fitHunks(hunks: string, limit: number): string {
  if (hunks.length <= limit) return hunks
  const starts = [...hunks.matchAll(/^@@ /gm)].map(match => match.index ?? 0)
  const whole = starts.filter(start => start > 0 && start - 1 <= limit).pop()
  if (whole !== undefined) return hunks.slice(0, whole - 1)

  const lines = hunks.split('\n')
  const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(lines[0] ?? '')
  if (!header) return hunks.slice(0, hunks.lastIndexOf('\n', limit))
  const kept: string[] = []
  let size = (lines[0] ?? '').length + 40 // room for the rewritten header
  let olds = 0
  let news = 0
  for (const line of lines.slice(1)) {
    if (line.startsWith('@@') || size + line.length + 1 > limit) break
    kept.push(line)
    size += line.length + 1
    if (line.startsWith('-')) olds++
    else if (line.startsWith('+')) news++
    else if (!line.startsWith('\\')) {
      olds++
      news++
    }
  }
  const [, oldStart, newStart, rest] = header
  return [`@@ -${oldStart},${olds} +${newStart},${news} @@${rest}`, ...kept].join('\n')
}

// A diff of a markdown file holds code fences of its own: outlast the longest run.
export function fenceFor(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map(run => run.length))
  return '`'.repeat(longest + 1)
}

// Purge deletes only a path shaped the way snapshot.sh names a shadow repository,
// <cache>/<project>-<key>.git under some absolute directory - never `/`, a relative
// path, or what an empty variable would leave. The caller also checks it is a bare repo.
export const isShadowPath = (path: string) => /^\/[^\n]*[^/\n]\/[^/\n]+-[0-9a-f]+\.git$/.test(path)

// The band above the prompt: the newest step at a glance, for when the pane is closed or
// narrow - `turn 3 · 2 files · +5 −1`, drawn with its own colours.
export function stepSummary(step: Step | undefined, files: readonly FileDiff[]): StepSummary | undefined {
  if (!step) return undefined
  return {
    what: step.turn === undefined ? 'edits outside a turn' : `turn ${step.turn}`,
    count: files.length === 1 ? '1 file' : `${files.length} files`,
    adds: files.reduce((sum, file) => sum + file.adds, 0),
    dels: files.reduce((sum, file) => sum + file.dels, 0),
  }
}

// A prompt as a step's title: one line, at most `limit` characters - characters, not
// bytes, so a Cyrillic or emoji prompt is never cut through the middle of one (which is
// how `cut -c` in bash, counting bytes, used to leave a stray `Ñ` behind).
export function promptLabel(text: string, limit = 100): string {
  const line = text.replace(/[\r\n\t]+/g, ' ').trim()
  return [...line].slice(0, limit).join('')
}

// The highlighter language for a file, named outright rather than left to `path`. It was
// added to find out why the desktop app drew diffs with no syntax colours: it did not
// help - the desktop colours a diff by added and removed lines only, while the terminal
// highlights its tokens either way. Kept, as harmless and explicit. Unknown extensions
// name nothing, and `path` still has its say.
const LANGUAGES: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cs: 'csharp', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', swift: 'swift',
  php: 'php', css: 'css', scss: 'scss', html: 'html', xml: 'xml', sql: 'sql',
  yml: 'yaml', yaml: 'yaml', toml: 'toml',
}

export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? LANGUAGES[name.slice(dot + 1)] : undefined
}
