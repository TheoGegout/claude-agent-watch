import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, AgentDetail, Board, Filter, LoopState, Route, SelfStatus, SessionCard, SessionConvo, Tokens } from '../types'
import { STRINGS } from './strings'
import type { Strings } from './strings'
import { agentState, clock, drawApp, drawText, liveState, sessionLink } from './view'
import type { Actions, Kit, ViewModel } from './view'

const PANE = 'agent-watch'
const COMMAND = 'agent-watch'
const VERSION = '0.2.0'
// The board is read again every second: what the registry says, as it says it.
const TICK_MS = 1000
// A busy conversation is read again at most this often (its transcript can be large).
const CONVO_MS = 4000
// A session that has not written for this long is closed (or its app is).
const STALE_MS = 20_000
// Ended sessions stay on the board this long, then drop off.
const KEEP_ENDED_MS = 10 * 60_000

const self = atom({ plugin: 'agent-watch', key: 'self' } as const, {
  title: '',
  state: 'idle',
  since: 0,
  agentTools: {},
  agentWaiting: {},
})
const board = atom({ plugin: 'agent-watch', key: 'board' } as const, { now: 0, sessions: [] })
const filter = atom({ plugin: 'agent-watch', key: 'filter' } as const, 'all')
const collapsed = atom({ plugin: 'agent-watch', key: 'collapsed' } as const, [])
const route = atom({ plugin: 'agent-watch', key: 'route' } as const, { view: 'list' } as Route)
const detail = atom({ plugin: 'agent-watch', key: 'detail' } as const, null as AgentDetail | null)
const convo = atom({ plugin: 'agent-watch', key: 'convo' } as const, null as SessionConvo | null)

// The words shown, set from the `language` option at load.
let t: Strings = STRINGS.en
let language: 'en' | 'fr' = 'en'
let notifyWaiting = true
let showStatusLine = true

// Tools whose whole run is the person answering.
function askingReason(tool: string): string | undefined {
  if (tool === 'AskUserQuestion') return t.question
  if (tool === 'ExitPlanMode') return t.planApproval
  return undefined
}

const short = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

const describeTool = (e: { tool: string; [argument: string]: unknown }) => {
  const pick = (key: string) => (typeof e[key] === 'string' ? (e[key] as string) : '')
  const detail =
    pick('description') ||
    (pick('file_path') && baseName(pick('file_path'))) ||
    pick('pattern') ||
    pick('command') ||
    pick('url')
  return detail ? `${e.tool} · ${short(detail, 40)}` : e.tool
}

let folder = ''
let home = ''
let sessionId = ''
let cwd = ''
let wasWaiting = new Set<string>()
// Which transcript the conversation was last read from, at what modification, when.
let convoRead = { path: '', mtimeMs: 0, at: 0 }

function setSelf($: EngineInterface, fn: (s: SelfStatus) => SelfStatus) {
  return update($, self, fn)
}

async function setLoop($: EngineInterface, state: LoopState, extra: Partial<SelfStatus> = {}) {
  const now = await $.clock.now()
  await setSelf($, s => ({
    ...s,
    ...extra,
    state,
    since: s.state === state ? s.since : now,
  }))
}

async function writeOwn($: EngineInterface) {
  if (!folder || !sessionId) return
  const me = await read($, self)
  const now = await $.clock.now()
  const agents: AgentCard[] = (await $.agent.list().catch(() => [])).map(a => ({
    id: a.id,
    label: a.name ?? a.description,
    type: a.type,
    status: a.status,
    tool: me.agentTools[a.id],
    waiting: me.agentWaiting[a.id],
    parentId: a.parentId,
  }))
  const card: SessionCard = {
    sessionId,
    cwd,
    title: me.title,
    state: me.state,
    waiting: me.waiting,
    tool: me.tool,
    toolSince: me.toolSince,
    since: me.since,
    updatedAt: now,
    agents,
  }
  await $.fs.write(`${folder}/${sessionId}.json`, JSON.stringify(card))
}

// Claude Code's own registry of live sessions, one file per process: every
// session is there, whether it loads this mod or not.
type Registered = {
  sessionId: string
  cwd: string
  name?: string
  status?: string
  waitingFor?: string
  startedAt?: number
  updatedAt?: number
  statusUpdatedAt?: number
  hostSessionId?: string
}
type Verdict = { state: LoopState; tool?: string; toolSince?: number; tokens?: Tokens }

const metaCache = new Map<string, { agentType?: string; description?: string }>()
const tailCache = new Map<string, { mtimeMs: number; readAt: number; verdict: Verdict }>()

// A subagent writing to its transcript this recently is at work.
const ACTIVE_MS = 30_000
// A transcript that keeps changing is read again at most this often.
const REREAD_MS = 5_000
// A finished subagent stays on the board this long.
const KEEP_AGENT_MS = 10 * 60_000
// What one $.fs.read may copy.
const READ_LIMIT = 4 * 1024 * 1024 - 64 * 1024

const projectDir = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-')

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
type Row = {
  type?: string
  uuid?: string
  timestamp?: string
  message?: { id?: string; stop_reason?: string | null; content?: unknown; usage?: Usage }
}

/**
 * What a subagent's transcript says about it: where it stands from its last
 * rows, the tool it is in and since when, and its tokens (generated in all
 * when `isWhole`, the transcript read from its first line; its context's size).
 */
function classifyLines(lines: string[], isWhole: boolean): Verdict {
  const seen = new Set<string>()
  let out = 0
  let ctx: number | undefined
  let last: Row | undefined
  for (const line of lines) {
    let row: Row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'assistant' && row.type !== 'user') continue
    last = row
    const usage = row.type === 'assistant' ? row.message?.usage : undefined
    if (usage) {
      // One response is written as one row per content block, all with its usage.
      const id = row.message?.id ?? row.uuid ?? line
      if (!seen.has(id)) {
        seen.add(id)
        out += usage.output_tokens ?? 0
      }
      ctx = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
  }
  const tokens: Tokens | undefined = ctx === undefined ? undefined : { out: isWhole ? out : undefined, ctx }
  if (last?.type === 'assistant') {
    const content = Array.isArray(last.message?.content) ? last.message.content : []
    const call = content.find((c: { type?: string }) => c && c.type === 'tool_use') as
      | { name?: string; input?: Record<string, unknown> }
      | undefined
    if (call?.name) {
      const since = last.timestamp ? Date.parse(last.timestamp) : NaN
      return {
        state: 'running',
        tool: describeTool({ tool: call.name, ...(call.input ?? {}) }),
        toolSince: Number.isNaN(since) ? undefined : since,
        tokens,
      }
    }
    return { state: last.message?.stop_reason === 'end_turn' ? 'ended' : 'running', tokens }
  }
  return { state: 'running', tokens }
}

async function scanAgents($: EngineInterface, card: Registered, now: number): Promise<AgentCard[]> {
  const dir = `${home}/.claude/projects/${projectDir(card.cwd)}/${card.sessionId}/subagents`
  const entries = await $.fs.list(dir).catch(() => [])
  // A subagent's meta file is written once, when it is spawned.
  const spawned = new Map(entries.filter(e => e.name.endsWith('.meta.json')).map(e => [e.name, e.mtimeMs]))
  const agents: AgentCard[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.startsWith('agent-') || !entry.name.endsWith('.jsonl')) continue
    const quiet = now - entry.mtimeMs
    if (quiet > KEEP_AGENT_MS) continue
    const id = entry.name.slice('agent-'.length, -'.jsonl'.length)
    const path = `${dir}/${entry.name}`

    let meta = metaCache.get(path)
    if (!meta) {
      meta = ((await readJson($, `${dir}/agent-${id}.meta.json`)) ?? {}) as typeof meta & object
      metaCache.set(path, meta)
    }

    let verdict: Verdict
    const cached = tailCache.get(path)
    if (cached && (cached.mtimeMs === entry.mtimeMs || now - cached.readAt < REREAD_MS)) {
      verdict = cached.verdict
    } else {
      const isWhole = entry.size <= READ_LIMIT
      const lines = await tailOf($, path, entry.size, isWhole ? Number.MAX_SAFE_INTEGER : 2000).catch(() => [] as string[])
      verdict = lines.length > 0 ? classifyLines(lines, isWhole) : { state: quiet < 5 * 60_000 ? 'running' : 'ended' }
      tailCache.set(path, { mtimeMs: entry.mtimeMs, readAt: now, verdict })
    }
    agents.push({
      id,
      label: meta.description ?? id,
      type: meta.agentType ?? 'agent',
      status: verdict.state === 'running' ? 'running' : 'completed',
      tool: verdict.tool,
      toolSince: verdict.toolSince,
      tokens: verdict.tokens,
      lastActivity: entry.mtimeMs,
      startedAt: spawned.get(`agent-${id}.meta.json`),
      endedAt: verdict.state === 'running' ? undefined : entry.mtimeMs,
    })
  }
  return agents.sort((a, b) => Number(a.status !== 'running') - Number(b.status !== 'running'))
}

async function readAll($: EngineInterface) {
  if (!folder) return
  const now = await $.clock.now()

  // What sessions running this mod wrote: the finer detail (tool, waiting reason).
  const reports = new Map<string, SessionCard>()
  const live = new Set<string>()
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > KEEP_ENDED_MS) continue
    const card = (await readJson($, `${folder}/${entry.name}`)) as SessionCard | undefined
    if (card?.sessionId) {
      reports.set(card.sessionId, card)
      if (now - card.updatedAt < STALE_MS) live.add(card.sessionId)
    }
  }

  const sessions: SessionCard[] = []
  const registry = `${home}/.claude/sessions`
  for (const entry of await $.fs.list(registry).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const reg = (await readJson($, `${registry}/${entry.name}`)) as Registered | undefined
    if (!reg?.sessionId || !reg.cwd) continue
    const report = reports.get(reg.sessionId)
    reports.delete(reg.sessionId)
    const isFresh = report !== undefined && now - report.updatedAt < STALE_MS

    const state: LoopState = reg.waitingFor
      ? 'waiting'
      : reg.status === 'busy'
        ? isFresh && report.state === 'waiting' ? 'waiting' : 'running'
        : 'idle'
    const scanned = await scanAgents($, reg, now)
    const known = isFresh ? report.agents : []
    const agents = [
      ...known.map(k => {
        const found = scanned.find(a => a.id === k.id)
        return found
          ? {
              ...k,
              startedAt: found.startedAt,
              endedAt: found.endedAt,
              lastActivity: found.lastActivity,
              tokens: found.tokens,
              toolSince: found.toolSince,
              tool: k.tool ?? found.tool,
            }
          : k
      }),
      ...scanned.filter(a => !known.some(k => k.id === a.id)),
    ]
    sessions.push({
      sessionId: reg.sessionId,
      hostId: reg.hostSessionId,
      startedAt: reg.startedAt,
      cwd: reg.cwd,
      title: reg.name || report?.title || '',
      state,
      waiting: state === 'waiting' ? (isFresh && report.waiting) || reg.waitingFor || t.waitingFallback : undefined,
      tool: state === 'running' && isFresh ? report.tool : undefined,
      toolSince: state === 'running' && isFresh ? report.toolSince : undefined,
      since: reg.statusUpdatedAt ?? reg.updatedAt ?? reg.startedAt ?? now,
      updatedAt: reg.updatedAt ?? now,
      agents,
    })
  }

  // Of the sessions that run this mod, one notifies: the first by id.
  const notifier = [sessionId, ...live].sort()[0]

  // A session that reported but left the registry has ended.
  for (const card of reports.values()) {
    const isStale = now - card.updatedAt > STALE_MS
    sessions.push(
      isStale || card.state === 'ended'
        ? { ...card, state: 'ended', waiting: undefined, tool: undefined, agents: [] }
        : card,
    )
  }

  const rank: Record<LoopState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }
  sessions.sort((a, b) => rank[liveState(a)] - rank[liveState(b)] || b.since - a.since)
  await update($, board, () => ({ now, sessions }))

  // Status line and a toast when another session starts waiting on the person.
  let running = 0
  let waiting = 0
  const waitingNow = new Set<string>()
  for (const c of sessions) {
    const loops = [c.state, ...c.agents.map(a => agentState(a.status, a.waiting))]
    running += loops.filter(s => s === 'running').length
    const waits = loops.filter(s => s === 'waiting').length
    waiting += waits
    if (waits > 0) waitingNow.add(c.sessionId)
  }
  for (const id of waitingNow) {
    if (notifyWaiting && id !== sessionId && !wasWaiting.has(id)) {
      const c = sessions.find(one => one.sessionId === id)
      if (!c) continue
      const who = `${baseName(c.cwd)} — ${short(c.title || t.newSession, 40)}`
      $.ui.toast(t.isWaitingForYou(who))
      if (notifier === sessionId) void notifySystem($, t.notifyTitle, `${who}${c.waiting ? ` · ${c.waiting}` : ''}`, c.hostId)
    }
  }
  wasWaiting = waitingNow
  if (showStatusLine) {
    const parts = [running && t.statusRunning(running), waiting && t.statusWaiting(waiting)].filter(Boolean)
    $.ui.status(parts.length ? `agents ${parts.join(' · ')}` : undefined)
  }
}

type Entry = { type?: string; timestamp?: string; message?: { content?: unknown } }

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c: { type?: string; text?: unknown }) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c: { text: string }) => c.text)
    .join('\n')
}

/** What a subagent's transcript says: its task, its last tool calls, its last words. */
function readTranscript(first: string, tail: string[]): Omit<AgentDetail, 'agentId' | 'isLoading'> {
  const parse = (line: string): Entry | undefined => {
    try {
      return JSON.parse(line) as Entry
    } catch {
      return undefined
    }
  }
  const opening = parse(first)
  const prompt = opening?.type === 'user' ? textOf(opening.message?.content) : ''
  const tools: AgentDetail['tools'] = []
  let answer = ''
  for (const line of tail) {
    const entry = parse(line)
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
    const at = entry.timestamp ? new Date(entry.timestamp).toTimeString().slice(0, 8) : undefined
    for (const block of entry.message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
      if (block?.type === 'tool_use' && block.name) {
        const full = describeTool({ tool: block.name, ...(block.input ?? {}) })
        tools.push({ name: block.name, detail: full.slice(block.name.length + 3), at })
      }
    }
    const said = textOf(entry.message.content).trim()
    if (said) answer = said
  }
  return {
    prompt: prompt ? short(prompt, 400) : undefined,
    tools: tools.slice(-8),
    answer: answer ? (answer.length > 1500 ? `${answer.slice(0, 1499)}…` : answer) : undefined,
  }
}

async function loadDetail($: EngineInterface, sessionId: string, agentId: string) {
  await update($, detail, () => ({ agentId, isLoading: true, tools: [] }))
  const card = (await read($, board)).sessions.find(c => c.sessionId === sessionId)
  if (!card) return
  const path = `${home}/.claude/projects/${projectDir(card.cwd)}/${sessionId}/subagents/agent-${agentId}.jsonl`
  try {
    const stat = await $.fs.stat(path)
    const lines = await tailOf($, path, stat.size, 120, true)
    const found = readTranscript(lines[0] ?? '', lines.slice(1))
    await update($, detail, () => ({ agentId, isLoading: false, ...found }))
  } catch (err) {
    await update($, detail, () => ({ agentId, isLoading: false, tools: [], error: String(err) }))
  }
}

/** The last lines of a file: whole when one read can hold it, else through the shell. */
async function tailOf($: EngineInterface, path: string, size: number, lines: number, withFirst = false) {
  if (size <= READ_LIMIT) {
    const all = (await $.fs.read(path)).trimEnd().split('\n')
    return withFirst ? [all[0] ?? '', ...all.slice(-lines)] : all.slice(-lines)
  }
  // Too big for one read: a seek to its last megabyte, through the shell (scripts/tail.ps1).
  const run = await $.process.run(
    ['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${$.plugin.root}/scripts/tail.ps1`],
    { env: { AW_PATH: path, AW_BYTES: String(1024 * 1024), ...(withFirst ? { AW_FIRST: '1' } : {}) }, timeoutMs: 15_000 },
  )
  const all = run.stdout.trimEnd().split(/\r?\n/)
  return withFirst ? [all[0] ?? '', ...all.slice(1).slice(-lines)] : all.slice(-lines)
}

const timeOf = (iso?: string) => (iso ? new Date(iso).toTimeString().slice(0, 5) : undefined)

/** A session's last exchange: the person's last message, Claude's last words, its last tools. */
function readConversation(lines: string[]): Omit<SessionConvo, 'sessionId' | 'isLoading'> {
  let prompt: string | undefined
  let promptAt: string | undefined
  let answer: string | undefined
  let answerAt: string | undefined
  const tools: SessionConvo['tools'] = []
  for (const line of lines) {
    let entry: Entry & { isMeta?: boolean; isSidechain?: boolean }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.isSidechain) continue
    if (entry.type === 'user' && !entry.isMeta) {
      const text = textOf(entry.message?.content).trim()
      // Hook and command output arrives as user rows too, wrapped in tags.
      if (text && !text.startsWith('<')) {
        prompt = text
        promptAt = timeOf(entry.timestamp)
      }
    }
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (block?.type === 'tool_use' && block.name) {
          const full = describeTool({ tool: block.name, ...(block.input ?? {}) })
          tools.push({ name: block.name, detail: full.slice(block.name.length + 3), at: timeOf(entry.timestamp) })
        }
      }
      const said = textOf(entry.message.content).trim()
      if (said) {
        answer = said
        answerAt = timeOf(entry.timestamp)
      }
    }
  }
  const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s)
  return { prompt: cut(prompt, 700), promptAt, answer: cut(answer, 2500), answerAt, tools: tools.slice(-8) }
}

/** Reads a session's conversation again when its transcript changed, at most every CONVO_MS. */
async function loadConvo($: EngineInterface, sessionId: string, isForced: boolean) {
  const card = (await read($, board)).sessions.find(c => c.sessionId === sessionId)
  if (!card) return
  const path = `${home}/.claude/projects/${projectDir(card.cwd)}/${sessionId}.jsonl`
  const now = await $.clock.now()
  try {
    const stat = await $.fs.stat(path)
    const isSame = convoRead.path === path && convoRead.mtimeMs === stat.mtimeMs
    if (!isForced && (isSame || now - convoRead.at < CONVO_MS)) return
    convoRead = { path, mtimeMs: stat.mtimeMs, at: now }
    if (isForced) await update($, convo, () => ({ sessionId, isLoading: true, tools: [] }))
    const found = readConversation(await tailOf($, path, stat.size, 400))
    await update($, convo, () => ({ sessionId, isLoading: false, ...found }))
  } catch (err) {
    await update($, convo, () => ({ sessionId, isLoading: false, tools: [], error: String(err) }))
  }
}

/** A notification of the system's own, with its sound; a click opens the session. */
async function notifySystem($: EngineInterface, title: string, body: string, hostId?: string) {
  const link = hostId ? sessionLink(hostId) : ''
  if ((await $.env.get('OS')) === 'Windows_NT') {
    await $.process
      .run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', `${$.plugin.root}/scripts/notify.ps1`], {
        env: { AW_TITLE: title, AW_BODY: body, AW_LINK: link },
        timeoutMs: 15_000,
      })
      .catch(() => {})
  } else if ((await $.env.get('XDG_CURRENT_DESKTOP')) !== undefined) {
    await $.process.run(['notify-send', '-a', 'Agent Watch', title, body], { timeoutMs: 5_000 }).catch(() => {})
  } else {
    await $.process
      .run(['osascript', '-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', '-e', 'end run', title, body], {
        timeoutMs: 5_000,
      })
      .catch(() => {})
  }
}

/** Hands the app's deep link to the system, which gives it back to the app. */
async function openInApp($: EngineInterface, hostId: string) {
  const url = sessionLink(hostId)
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['rundll32', 'url.dll,FileProtocolHandler', url]
    : (await $.env.get('XDG_CURRENT_DESKTOP')) !== undefined
      ? ['xdg-open', url]
      : ['open', url]
  await $.process.run(argv, { timeoutMs: 10_000 }).catch(err => $.ui.toast(`agent-watch: ${err}`))
}

async function tick($: EngineInterface) {
  await writeOwn($).catch(err => $.ui.log(`agent-watch: could not write: ${err}`, { to: 'debug' }))
  await readAll($).catch(err => $.ui.log(`agent-watch: could not read: ${err}`, { to: 'debug' }))
  const at = await read($, route)
  if (at.view === 'session') await loadConvo($, at.sessionId, false).catch(() => {})
}

export const register: Register = (on, options) => {
  language = options.language === 'fr' ? 'fr' : 'en'
  t = STRINGS[language]
  notifyWaiting = options.notifyWaiting !== false
  showStatusLine = options.statusLine !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    folder = `${home}/.claude/agent-watch`
    sessionId = await $.session.id()
    cwd = e.cwd
    const me = await read($, self)
    if (me.since === 0) await setLoop($, 'idle')

    await $.command.register({
      name: COMMAND,
      description: t.commandDescription,
      argumentHint: '[text]',
    })
    $.clock.every(TICK_MS, () => void tick($))
    await tick($)

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    await tick($)
    // Text when asked, or where no surface draws a pane (a `-p` run, the SDK).
    const surfaces = await $.session.surfaces().catch(() => [])
    if (e.args.trim() === 'text' || surfaces.length === 0) {
      const { now, sessions } = await read($, board)
      return { text: drawText({ now, sessions, mine: sessionId, t }) }
    }
    await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })

    return { text: t.paneOpened }
  })

  on('turn.start', async ($, e, next) => {
    const me = await read($, self)
    const title = me.title || (e.text ? short(e.text, 80) : '')
    await setLoop($, 'running', { title, waiting: undefined, tool: undefined })
    await tick($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setLoop($, 'idle', { waiting: undefined, tool: undefined })
      await tick($)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const agent = e.agentId
    const label = describeTool(e)
    const asking = askingReason(e.tool)
    if (agent === undefined) {
      await setLoop($, asking ? 'waiting' : 'running', { tool: label, toolSince: await $.clock.now(), waiting: asking })
    } else {
      await setSelf($, s => ({
        ...s,
        agentTools: { ...s.agentTools, [agent]: label },
        agentWaiting: asking ? { ...s.agentWaiting, [agent]: asking } : s.agentWaiting,
      }))
    }
    if (asking) await tick($)

    try {
      return await next(e)
    } finally {
      if (agent === undefined) {
        const me = await read($, self)
        if (me.state === 'waiting' || me.tool === label) {
          await setLoop($, 'running', { tool: undefined, toolSince: undefined, waiting: undefined })
        }
      } else {
        await setSelf($, s => {
          const { [agent]: _tool, ...agentTools } = s.agentTools
          const { [agent]: _waiting, ...agentWaiting } = s.agentWaiting
          return { ...s, agentTools, agentWaiting }
        })
      }
    }
  })

  // A permission dialog is open: the loop waits on the person until its tool ends.
  on('classic.PermissionRequest', async ($, e, next) => {
    const why = t.permission(e.tool_name)
    const agent = e.agent_id
    if (agent === undefined) {
      await setLoop($, 'waiting', { waiting: why })
    } else {
      await setSelf($, s => ({ ...s, agentWaiting: { ...s.agentWaiting, [agent]: why } }))
    }
    await tick($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await setLoop($, 'ended', { waiting: undefined, tool: undefined })
    await writeOwn($).catch(() => {})

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { now, sessions } = await read($, board)
    const width = Math.max(40, e.props.bodyColumns ?? e.viewport?.columns ?? 80)
    const setOption = (key: string, value: string | boolean) =>
      void $.config.set({ key: `agent-watch.${key}`, value }).catch(() => {})

    const vm: ViewModel = {
      now,
      sessions,
      filter: await read($, filter),
      collapsed: await read($, collapsed),
      route: await read($, route),
      detail: await read($, detail),
      convo: await read($, convo),
      mine: sessionId,
      home,
      width,
      isTerminal: e.surface === 'terminal',
      t,
      version: VERSION,
      notify: notifyWaiting,
      statusLine: showStatusLine,
    }
    const act: Actions = {
      setFilter: (f: Filter) => {
        void update($, route, () => ({ view: 'list' }) as Route)
        void update($, filter, () => f)
      },
      toggle: (id: string) =>
        void update($, collapsed, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id])),
      go: (to: Route) => {
        void update($, route, () => to)
        if (to.view === 'agent') void loadDetail($, to.sessionId, to.agentId)
        if (to.view === 'session') void loadConvo($, to.sessionId, true)
      },
      openSession: (hostId: string) => void openInApp($, hostId),
      refresh: () => void tick($),
      toggleLanguage: () => setOption('language', language === 'fr' ? 'en' : 'fr'),
      toggleNotify: () => setOption('notifyWaiting', !notifyWaiting),
      toggleStatusLine: () => {
        if (showStatusLine) $.ui.status(undefined)
        setOption('statusLine', !showStatusLine)
      },
    }

    return drawApp($.ui.resolve(e) as unknown as Kit, vm, act)
  })
}
