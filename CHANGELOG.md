# Changelog

## 0.2.0 — 2026-10-07

A dashboard in place of the plain list.

- On the desktop app, VS Code and mobile the dashboard is drawn as one SVG with its own dark palette and monospace type, sized to the pane; filters and settings are native buttons above it. The terminal keeps a text layout.

- Header with the count of sessions running, waiting, idle and ended.
- One card per session: status badge, folder, how long it has been so, a callout when it waits for you, and its subagents beside it with their badge, elapsed time and current activity. Cards fold (`▴`).
- Sidebar from 104 columns: filters (`1`–`5`), settings that change `/config` in place (`l` language, `n` notifications, `s` status line), shortcuts (`r` refresh) and version. Narrower panes get the filters as one row.
- Footer with the refresh rate, notifications and the running / waiting loop count.
- Subagents show how long they ran, from their spawn time.

## 0.1.0 — 2026-10-07

First release.

- `/agent-watch` opens a pane listing every Claude Code session on the machine, from Claude Code's own session registry, whether or not it loads the mod.
- Each session shows as running, waiting for you (permission dialog, question, plan approval) or idle, with how long it has been so.
- Subagents of every session, read from their transcripts: running, quiet on a long tool call, or finished (kept 10 minutes).
- Sessions that load the mod add the tool in use and the exact reason they wait.
- Status line count of running and waiting loops; a notification when another session starts waiting for you.
- English and French (`language` option).
