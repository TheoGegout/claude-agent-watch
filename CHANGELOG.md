# Changelog

## 0.3.0 — 2026-10-07

The pane as a session list, [herdr](https://github.com/herdrdev/herdr)'s way.

- The sessions on the left, grouped by project, one line each with its state; the project rolls up the most urgent. Its running, waiting and freshly finished subagents hang under it.
- Four states: ◆ blocked (waiting for you), ● working, ✓ done (finished since you last looked), ○ idle. Opening a session clears its ✓.
- The selected session's page on the right: its state, its conversation, its subagents. `j` / `k` move the selection, `o` opens it in the app, `b` goes back. Narrow panes show the list alone and open a session in its place.
- The pane opens by itself when a session starts (`openOnStart`, on by default), so it can stand in for the app's own list.
- Settings and keys live in the footer; the header's counts filter the list.
- Projects numbered `1`–`9` (the key jumps to it), each with its git branch; one-word states (`blocked`, `working`, `done`, `idle`) and a spinner while a session or subagent works; an `agents` section gathers every subagent at work across sessions.
- The selected session reads like its own terminal: `❯` your message, `⏺ Tool(detail)` its calls (the live one spinning), Claude's answer, `Working…` with its time while it runs, a permission box while it waits, and a status line with folder, branch, model and context size.

### Fixed (0.3.0)

- A `/clear` or a resume no longer leaves a ghost card running forever: the mod follows the session's new id.
- Generated tokens count each response's final figure, not its first row's.
- The session the wide pane shows by itself loads its conversation and counts as seen.
- A slow read of an earlier pick no longer overwrites the later one; a failed read is tried again.
- One pass of the board at a time; the turn, a permission dialog and a question no longer wait for it.
- No burst of notifications at start for sessions already waiting; every new wait gets one system notification, from one session, even when the sender itself waits.
- Git worktrees and submodules show their own branch; a session listed twice in the registry shows once; a malformed file is skipped instead of freezing the board.
- A subagent stopped mid-call, its session idle, reads as ended; finished subagents leave the board after 10 minutes in every session.
- The agent page refreshes while the agent works; a narrow pane whose session left goes back to the list.
- Clicks no longer need two tries: the pane redraws only when something changed.

## 0.2.0 — 2026-10-07

A clickable panel in place of the plain list.

- Header with the count of sessions running, waiting, idle and ended; each count filters.
- One card per session: status badge, folder, how long it has been so, a callout when it waits for you, and its subagents with their badge, elapsed time and current activity. Cards fold (`▴`).
- Click a session for its page (folder, state, waiting reason, current tool, subagents, and its **conversation**: your last message, Claude's last words in Markdown, its last tool calls, kept current while the page is open); click a subagent for its page (its task, its last tool calls, its last words, read from its transcript). `b` goes back.
- **Open ↗** brings that session up in the Claude desktop app, through the app's `claude://code/continue` link.
- Sidebar from 100 columns: filters (`1`–`5`), settings that change `/config` in place (`l` language, `n` notifications, `s` status line), shortcuts and version. Narrower panes get the filters as one row.
- The pane follows the app's own theme, on every surface.
- The board refreshes every second instead of every three.
- When another session starts waiting for you, a **system notification** with its sound (Windows toast, macOS notification, `notify-send` on Linux); clicking it on Windows opens that session. One session sends it, not each one running the mod.
- Subagents show how long they ran, from their spawn time, and once finished their tokens: generated in all and the context's size, read from their transcripts.
- The tool call an agent (or the session) is in shows how long it has run; past 30 s it is flagged ⚠, and so is a running agent silent for 2 minutes.
- `/agent-watch text` prints the board as text; a run with no pane to draw (`claude -p`, the SDK) gets it by itself.

## 0.1.0 — 2026-10-07

First release.

- `/agent-watch` opens a pane listing every Claude Code session on the machine, from Claude Code's own session registry, whether or not it loads the mod.
- Each session shows as running, waiting for you (permission dialog, question, plan approval) or idle, with how long it has been so.
- Subagents of every session, read from their transcripts: running, quiet on a long tool call, or finished (kept 10 minutes).
- Sessions that load the mod add the tool in use and the exact reason they wait.
- Status line count of running and waiting loops; a notification when another session starts waiting for you.
- English and French (`language` option).
