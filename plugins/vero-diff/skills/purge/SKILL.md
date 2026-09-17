---
name: purge
description: Delete the snapshot history this plugin keeps for the current project
disable-model-invocation: true
allowed-tools: Bash(verodiff *)
model: haiku
---

!`verodiff --where`
!`verodiff --clear`

Do not do anything else. Reply with a single line confirming the snapshots were removed.
