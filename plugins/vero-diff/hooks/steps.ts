// Pure text work on git's output: no `$`, so the tests can drive it directly.

import type { FileDiff, Step } from '../types'

const MAX_HUNK_CHARS = 9000 // a Code element holds at most 10000

// The format `parseLog` reads, one snapshot per line, newest first.
export const LOG_FORMAT = '--format=%H%x09%P%x09%ar%x09%s'

// Snapshot kinds never reach the person. A `post` is a turn, numbered from the start of
// the session so "turn 3" keeps its name as newer steps arrive. A `pre` with a parent is
// edits that happened outside a turn: the person's own, or an interrupted turn's. The
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
      let title = row.subject || 'snapshot'
      if (row.subject.startsWith('[post] ')) {
        title = `turn ${turnOf.get(row.sha)}  "${row.subject.slice(7)}"`
      } else if (row.subject.startsWith('[pre] ')) {
        title = 'edits outside a turn'
      }
      return { sha: row.sha, parent: row.parent, when: row.when, title }
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
      let isCut = false
      if (hunks.length > MAX_HUNK_CHARS) {
        hunks = hunks.slice(0, hunks.lastIndexOf('\n', MAX_HUNK_CHARS))
        isCut = true
      }
      return { path, hunks, isCut }
    })
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
