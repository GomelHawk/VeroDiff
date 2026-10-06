import { describe, expect, test } from 'claude-code/testing'

import { fenceFor, isShadowPath, parseLog, splitFiles } from '../hooks/steps'

// The log as `git log LOG_FORMAT` prints it, newest first: hash, parent, age, subject.
const LOG = [
  'c4\tc3\t1 minute ago\t[post] second turn',
  'c3\tc2\t3 minutes ago\t[pre] second turn',
  'c2\tc1\t5 minutes ago\t[post] first turn',
  'c1\t\t9 minutes ago\t[pre] first turn',
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

  test('a session with only its first snapshot has no steps', () => {
    expect(parseLog('c1\t\tnow\t[pre] hello\n')).toEqual([])
  })
})

describe('splitFiles', () => {
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

  test('one entry per file, hunks only, no carriage returns', () => {
    const [text, image] = splitFiles(DIFF)
    expect(text?.path).toBe('a.txt')
    expect(text?.hunks).toBe('@@ -1,2 +1,3 @@\n alpha\n beta\n+gamma')
    expect(image?.path).toBe('logo.png')
    expect(image?.hunks).toBe('')
  })

  test('a hunk too long for one Code element is cut on a line boundary', () => {
    const long = `diff --git a/big b/big\n@@ -0,0 +1 @@\n${'+line\n'.repeat(3000)}`
    const [file] = splitFiles(long)
    expect(file?.isCut).toBe(true)
    expect((file?.hunks.length ?? 0) <= 9000).toBe(true)
    expect(file?.hunks.endsWith('+line')).toBe(true)
  })
})

describe('fenceFor', () => {
  test('outlasts every backtick run in the text', () => {
    expect(fenceFor('plain')).toBe('```')
    expect(fenceFor('+```bash')).toBe('````')
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
