---
name: lastdiff
description: Show the diff of the latest turn in this session (or step N) inline in chat
argument-hint: "[step number]"
arguments: step
disable-model-invocation: true
allowed-tools: Bash(verodiff *)
model: haiku
---

Show the user what changed on one turn of this session, in full, in your reply.

Only your reply is visible to them - shell output is collapsed behind "Ran N shell
commands" - so the diff has to end up in the message you write.

The step to show is `$step`. If that is blank, use `0`.

Run both of these with the Bash tool, exactly as written, replacing `STEP` with that number:

    verodiff -S ${CLAUDE_SESSION_ID} -s STEP
    verodiff -S ${CLAUDE_SESSION_ID} -n STEP

Then write your reply as exactly this, and nothing else:

1. The first line of the `-s` output, which names the turn, followed by its `--stat` lines.
2. The **complete** output of the `-n` command inside a ```diff fenced block.

Copy the diff character for character, every line of it, however long it is. Do not
truncate it, do not abbreviate the middle, do not drop context lines, do not re-indent or
re-wrap anything, and do not add line numbers or commentary of your own. If the command
printed a message instead of a diff, such as "no such step", just show that message.

Do not analyse the changes, do not suggest improvements, and do not edit any files.
