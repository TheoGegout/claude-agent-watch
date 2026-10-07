# Changelog

## 0.2.0 — 2026-10-07

A clickable panel in place of the plain list.

- Header with the count of sessions running, waiting, idle and ended; each count filters.
- One card per session: status badge, folder, how long it has been so, a callout when it waits for you, and its subagents with their badge, elapsed time and current activity. Cards fold (`▴`).
- Click a session for its page (folder, state, waiting reason, current tool, subagents); click a subagent for its page (its task, its last tool calls, its last words, read from its transcript). `b` goes back.
- **Open ↗** brings that session up in the Claude desktop app, through the app's `claude://code/continue` link.
- Sidebar from 100 columns: filters (`1`–`5`), settings that change `/config` in place (`l` language, `n` notifications, `s` status line), shortcuts and version. Narrower panes get the filters as one row.
- The pane follows the app's own theme, on every surface.
- Subagents show how long they ran, from their spawn time.

## 0.1.0 — 2026-10-07

First release.

- `/agent-watch` opens a pane listing every Claude Code session on the machine, from Claude Code's own session registry, whether or not it loads the mod.
- Each session shows as running, waiting for you (permission dialog, question, plan approval) or idle, with how long it has been so.
- Subagents of every session, read from their transcripts: running, quiet on a long tool call, or finished (kept 10 minutes).
- Sessions that load the mod add the tool in use and the exact reason they wait.
- Status line count of running and waiting loops; a notification when another session starts waiting for you.
- English and French (`language` option).
