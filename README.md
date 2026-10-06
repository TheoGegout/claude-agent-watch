# Agent Watch

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B%20mod-d97757.svg)](https://claude.com/blog/claude-code-mods)

**A Claude Code mod that shows every session on your machine and its subagents in one pane**: which ones are working, which ones are waiting for your answer, and which ones are idle. Run five sessions in parallel and know at a glance which one needs you.

```
◆ Fix the checkout flow — webshop
   waiting for you · permission Bash (1 min)
  ├ ● general-purpose · Run the e2e suite
  │    running · Bash · npx playwright test
  └ × Explore · Find the payment handlers
       ended

● Write the release notes (here) — docs
   running · Edit · CHANGELOG.md (12s)

○ Refactor the parser — compiler
   idle · waiting for your message for 25 min
```

## Install

Inside Claude Code (2.1.287 or later):

```
/plugin marketplace add TheoGegout/claude-agent-watch
/plugin install agent-watch@claude-agent-watch
/reload-plugins
/agent-watch
```

<details>
<summary><strong>From the terminal, or from a clone</strong></summary>

```sh
claude plugin marketplace add TheoGegout/claude-agent-watch
claude plugin install agent-watch@claude-agent-watch
```

Or load it straight from a clone, for one session:

```sh
git clone https://github.com/TheoGegout/claude-agent-watch
claude --plugin-dir ./claude-agent-watch
```

</details>

Mods are an early-access Claude Code feature and their API can change between releases. If something breaks, see [Troubleshooting](#troubleshooting).

## What you see

```
◉ AGENT WATCH                                  ● 2 running  ● 1 waiting  ● 1 idle  ■ 0 ended  ⟳ Auto refresh 3s
  Monitor your Claude Code agents in real time
──────────────────────────────────────────────────────────────────────────────────────────────────────────────
╭──────────────────────────────────────────────────────────────────────╮    FILTERS
│ ● Fix the checkout flow   WAITING                 since 2m 14s   ▴   │   ▌▣ 1: All sessions           4
│ ▢ ~/projects/webshop                                                 │    ● 2: Running                2
│ ╭──────────────────────────────╮  ╭──────────────────────────────╮   │    ● 3: Waiting                1
│ │ ⚠ Permission / input required│  │ ● general-purpose · e2e  RUNNING │    ● 4: Idle                   1
│ │ permission Bash · Claude is …│  │   ▸ Bash · npx playwright test │    ● 5: Ended                  0
│ ╰──────────────────────────────╯  ╰──────────────────────────────╯   │
╰──────────────────────────────────────────────────────────────────────╯    SETTINGS
                                                                             ◍ Language     l: English ›
                                                                             ◔ Notifications     n: On ›
```

| Part | Shows |
| --- | --- |
| **header** | how many sessions are running, waiting for you, idle or ended |
| **cards** | one per session, the ones that need you first: a status badge, its folder, for how long; a callout when it waits for you (permission, question, plan approval); its subagents beside it with their badge, elapsed time and what they are doing. `▴` folds a card |
| **sidebar** | from 104 columns: filters, settings that change `/config` in place, shortcuts, version. Narrower panes get the filters as one row |
| **footer** | refresh rate, notifications, and the count of running and waiting loops across sessions |

| Mark | State | Means |
| --- | --- | --- |
| `●` amber, `WAITING` | **waiting for you** | a permission dialog, a question (`AskUserQuestion`) or a plan to approve is open |
| `●` green, `RUNNING` | **running** | the session or a subagent is working; the tool in use when known |
| `●` grey, `IDLE` | **idle** | the turn is over, the session waits for your next message |
| `●` red, `ENDED` | **ended** | the subagent finished (kept 10 minutes), or the session closed |

A subagent quiet on a long tool call shows `quiet for 2m 10s` rather than vanishing. The status line counts every running and waiting loop across sessions (`agents ▶ 3 running · ◆ 1 waiting`), and a notification pops when **another** session starts waiting for you.

## Use

| Command | Does |
| --- | --- |
| `/agent-watch` | open the pane |

Focus the pane with `ctrl+x tab` (or click it), then:

| Key | Does |
| --- | --- |
| click a session / an agent | open its page |
| `b` | back |
| `1` … `5` | filter: all, running, waiting, idle, ended |
| `r` | refresh now |
| `l` | switch language (English / French) |
| `n` | notifications on / off |
| `s` | status line on / off |
| `esc` | close |

The pane refreshes every 3 seconds.

## Where the data comes from

The mod only needs to be installed; the other sessions do not need it.

| It reads | For |
| --- | --- |
| `~/.claude/sessions/*.json` | Claude Code's registry of live sessions: name, folder, `busy` / `idle`, and what a session waits for |
| `~/.claude/projects/<project>/<session>/subagents/` | each subagent's type and task (`*.meta.json`) and, from the end of its transcript, whether it is running or done |
| `~/.claude/agent-watch/*.json` | what sessions that load the mod report: the tool in use, the exact waiting reason |

Each session that loads the mod writes one small file to `~/.claude/agent-watch/<session-id>.json`: its state, its current tool (a name plus a short path or description) and its subagents' names. Nothing else is written, nothing leaves your machine, and it makes no network requests and calls no model.

It runs a process in two cases only, both when you click: **Open ↗** hands the app's `claude://code/continue?session=…` link to the system (`rundll32 url.dll,FileProtocolHandler` on Windows, `open` on macOS, `xdg-open` on Linux), and a subagent's page reads the first and last lines of a transcript over 4 MiB with PowerShell's `Get-Content`. `claude plugin validate .` prints exactly what it hooks and calls.

**What is inferred, not measured.** The session registry and the subagent transcripts are Claude Code internals, not a public API: a Claude Code update can change them, and the pane would then show less until the mod is updated. A subagent counts as running while it writes to its transcript, and is classified from its transcript's last entries once quiet for 30 seconds; a transcript over 4 MiB cannot be read by a mod, so it is judged by when it was last written.

## Configure

In `/config`, or under `pluginConfigs["agent-watch"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `language` | `en` | `en` or `fr` |
| `notifyWaiting` | `true` | notify when another session starts waiting for you |
| `statusLine` | `true` | show the running / waiting count in the status line |

## Troubleshooting

**The pane doesn't appear.** Check `claude --version` is 2.1.287 or later, then run `/reload-plugins` and `/agent-watch`. Look in the transcript for a dim line starting `agent-watch:`: it names the hook that failed.

**A session is missing.** Only sessions on this machine, running now, are listed. If a session crashed, its registry file may linger and show it as running until Claude Code cleans it up.

**A subagent shows as running long after it finished.** Its transcript is over 4 MiB, so the mod judges it by its last write; it moves to ended 5 minutes after the last one.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

Loading the mod once (`claude --plugin-dir .`) writes the API types to `.claude-plugin/types/`, after which `tsc -p .` type-checks it.

## License

[MIT](LICENSE)
