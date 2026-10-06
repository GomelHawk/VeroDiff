import { describe, expect, test } from 'claude-code/testing'

import { fenceFor, fitHunks, isShadowPath, languageOf, parseLog, promptLabel, splitFiles, stepSummary } from '../hooks/steps'

// The log as `git log LOG_FORMAT` prints it, newest first: hash, parent, age, subject.
const LOG = [
  'c4\tc3\t1 minute ago\t[post] second turn',
  'c3\tc2\t3 minutes ago\t[pre] second turn',
  'c2\tc1\t5 minutes ago\t[post] first turn',
  'c1\t\t9 minutes ago\t[pre] first turn',
].join('\n')

// Two files: a text edit (with a CRLF line) and a binary.
const DIFF = [
  'diff --git a/a.txt b/a.txt',
  'index 1..2 100644',
  '--- a/a.txt',
  '+++ b/a.txt',
  '@@ -1,2 +1,3 @@',
  ' alpha',
  ' beta',
  '+gamma\r',
  'diff --git a/logo.png b/logo.png',
  'Binary files a/logo.png and b/logo.png differ',
  '',
].join('\n')

describe('parseLog', () => {
  test('numbers turns from the start of the session', () => {
    const titles = parseLog(LOG).map(step => step.title)
    expect(titles).toEqual(['turn 2  "second turn"', 'edits outside a turn', 'turn 1  "first turn"'])
  })

  test('the oldest snapshot, which has no parent, is no step', () => {
    expect(parseLog(LOG).map(step => step.sha)).toEqual(['c4', 'c3', 'c2'])
  })

  test('no snapshot kind leaks into a title', () => {
    for (const step of parseLog(LOG)) expect(/\[(pre|post)\]/.test(step.title)).toBe(false)
  })

  test('a finished turn carries its number, edits outside a turn none', () => {
    expect(parseLog(LOG).map(step => step.turn)).toEqual([2, undefined, 1])
  })

  test('a session with only its first snapshot has no steps', () => {
    expect(parseLog('c1\t\tnow\t[pre] hello\n')).toEqual([])
  })
})

describe('splitFiles', () => {

  test('one entry per file, hunks only, no carriage returns', () => {
    const [text, image] = splitFiles(DIFF)
    expect(text?.path).toBe('a.txt')
    expect(text?.hunks).toBe('@@ -1,2 +1,3 @@\n alpha\n beta\n+gamma')
    expect(image?.path).toBe('logo.png')
    expect(image?.hunks).toBe('')
  })

  test('counts added and removed lines per file, not the --- / +++ headers', () => {
    const diff = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n--old\n+new\n keep\n'
    const [file] = splitFiles(diff)
    expect([file?.adds, file?.dels]).toEqual([1, 1])
    expect(splitFiles(DIFF).map(f => [f.adds, f.dels])).toEqual([[1, 0], [0, 0]])
  })

  test('a file too long for one Code element still parses as hunks', () => {
    const hunk = (n: number) => `@@ -${n},1 +${n},2 @@\n ctx\n${'+line\n'.repeat(40)}`
    const long = `diff --git a/big b/big\n${Array.from({ length: 60 }, (_, i) => hunk(i * 10 + 1)).join('')}`
    const [file] = splitFiles(long)
    expect(file?.isCut).toBe(true)
    expect((file?.hunks.length ?? 0) <= 9000).toBe(true)
    expect(file?.adds).toBe(60 * 40)
    // whole hunks only: the last one kept ends with its own last line
    expect(file?.hunks.endsWith('+line')).toBe(true)
    expect((file?.hunks.split('\n').length ?? 0) % 42).toBe(0) // a header, ctx, 40 lines
  })
})

describe('fitHunks', () => {
  test('keeps whole hunks while they fit', () => {
    const two = '@@ -1,1 +1,1 @@\n-a\n+b\n@@ -9,1 +9,1 @@\n-c\n+d'
    expect(fitHunks(two, 22)).toBe('@@ -1,1 +1,1 @@\n-a\n+b')
    expect(fitHunks(two, 1000)).toBe(two)
  })

  test('cuts a single oversized hunk and rewrites its header to match', () => {
    const one = `@@ -5,3 +5,203 @@ fn\n ctx\n${'+added line\n'.repeat(200)} tail\n-gone`
    const fitted = fitHunks(one, 600)
    const lines = fitted.split('\n')
    const body = lines.slice(1)
    const olds = body.filter(l => !l.startsWith('+')).length
    const news = body.filter(l => !l.startsWith('-')).length
    expect(fitted.length <= 600).toBe(true)
    expect(lines[0]).toBe(`@@ -5,${olds} +5,${news} @@ fn`)
  })
})

describe('fenceFor', () => {
  test('outlasts every backtick run in the text', () => {
    expect(fenceFor('plain')).toBe('```')
    expect(fenceFor('+```bash')).toBe('````')
  })
})

describe('stepSummary', () => {
  test('sums the newest step\'s files', () => {
    const [turn2] = parseLog(LOG)
    expect(stepSummary(turn2, splitFiles(DIFF))).toEqual({ what: 'turn 2', count: '2 files', adds: 1, dels: 0 })
  })

  test('names edits outside a turn, and is nothing without a step', () => {
    const outside = parseLog(LOG)[1]
    expect(stepSummary(outside, splitFiles(DIFF).slice(0, 1))?.what).toBe('edits outside a turn')
    expect(stepSummary(outside, splitFiles(DIFF).slice(0, 1))?.count).toBe('1 file')
    expect(stepSummary(undefined, [])).toBe(undefined)
  })
})

describe('promptLabel', () => {
  test('cuts by characters, never through a multi-byte one', () => {
    const russian = 'хорошо. давай сделаем некоторые изменения '.repeat(5)
    const label = promptLabel(russian)
    expect([...label].length).toBe(100)
    expect(label).toBe([...russian.trim()].slice(0, 100).join(''))
    expect(promptLabel('🙂'.repeat(150))).toBe('🙂'.repeat(100))
  })

  test('folds a multi-line prompt onto one line', () => {
    expect(promptLabel('fix\n\nthe\tbug\r\n')).toBe('fix the bug')
  })
})

describe('languageOf', () => {
  test('names the language by extension, whatever the folder or case', () => {
    expect(languageOf('plugins/vero-diff/hooks/register.tsx')).toBe('typescript')
    expect(languageOf('tests/smoke.sh')).toBe('bash')
    expect(languageOf('README.MD')).toBe('markdown')
  })

  test('names nothing it does not know, so path still decides', () => {
    expect(languageOf('Makefile')).toBe(undefined)
    expect(languageOf('.gitignore')).toBe(undefined)
    expect(languageOf('notes.weird')).toBe(undefined)
  })
})

describe('isShadowPath', () => {
  test('accepts the layout snapshot.sh writes', () => {
    expect(isShadowPath('/home/me/.cache/verodiff/VeroDiff-634c87915f70.git')).toBe(true)
    expect(isShadowPath('/tmp/x/cache/project-1234567890.git')).toBe(true)
  })

  test('refuses anything else', () => {
    for (const path of ['', '/', '/.git', '-1.git', 'relative/p-1.git', '/home/me', '/home/me/.cache/verodiff'])
      expect(isShadowPath(path)).toBe(false)
  })
})
