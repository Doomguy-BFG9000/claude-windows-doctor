---
name: check
description: Check the Windows setup.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-windows-doctor.mjs" *) Bash(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-windows-doctor.mjs *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/bin/claude-windows-doctor.mjs" *) PowerShell(node ${CLAUDE_PLUGIN_ROOT}/bin/claude-windows-doctor.mjs *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/claude-windows-doctor.mjs" check --project "${CLAUDE_PROJECT_DIR}" --markdown`

At most 10 lines: the shell the Bash tool gets and why in one line, then each problem with its fix. If there are no findings, say so in one line. A finding's id can be explained in a terminal with `claude-windows-doctor explain <id>`. Edit nothing until the user agrees.
