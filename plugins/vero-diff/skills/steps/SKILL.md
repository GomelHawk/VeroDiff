---
name: steps
description: Open a side pane showing the diff of each turn in this session
disable-model-invocation: true
allowed-tools: Bash(verodiff-pane *)
model: haiku
---

!`verodiff-pane follow ${CLAUDE_SESSION_ID}`

Do not analyse anything and do not read any files. Reply with a single short line about the result above.
