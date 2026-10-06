# Changelog

## 0.1.0 — 2026-10-07

First release.

- `/agent-watch` opens a pane listing every Claude Code session on the machine, from Claude Code's own session registry, whether or not it loads the mod.
- Each session shows as running, waiting for you (permission dialog, question, plan approval) or idle, with how long it has been so.
- Subagents of every session, read from their transcripts: running, quiet on a long tool call, or finished (kept 10 minutes).
- Sessions that load the mod add the tool in use and the exact reason they wait.
- Status line count of running and waiting loops; a notification when another session starts waiting for you.
- English and French (`language` option).
