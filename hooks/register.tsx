import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, AgentDetail, Board, Filter, LoopState, Route, SelfStatus, SessionCard, SessionConvo, Tokens } from '../types'
import { STRINGS } from './strings'
import type { Strings } from './strings'
import { agentState, clock, drawApp, drawText, liveState, sessionLink } from './view'
import type { Actions, Kit, ViewModel } from './view'

const PANE = 'agent-watch'
const COMMAND = 'agent-watch'
const VERSION = '0.3.1'
// The board is read again every second: what the registry says, as it says it.
const TICK_MS = 1000
// Each redraw replaces the pane's buttons, and a click that spans one is lost: the clocks on the
// board move this often, the rest only when something changed.
const CLOCK_RUNNING_MS = 10_000
const CLOCK_IDLE_MS = 30_000
// A busy conversation is read again at most this often (its transcript can be large).
const CONVO_MS = 4000
// A session that has not written for this long is closed (or its app is).
const STALE_MS = 20_000
// Ended sessions stay on the board this long, then drop off.
const KEEP_ENDED_MS = 10 * 60_000
// A running subagent of an idle session, silent this long, was stopped rather than at work.
const ORPHAN_MS = 3 * 60_000
// Ids are names of files and folders: nothing else gets near a path.
const ID = /^[A-Za-z0-9_-]{1,128}$/

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
const seen = atom({ plugin: 'agent-watch', key: 'seen' } as const, {} as Record<string, number>)

// The words shown, set from the `language` option at load.
let t: Strings = STRINGS.en
let language: 'en' | 'fr' = 'en'
let notifyWaiting = true
let showStatusLine = true
let openOnStart = true

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

/** `Tool · what it works on`; the tool's own name wins over any `tool` field of its input. */
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
const describeCall = (name: string, input: unknown) =>
  describeTool({ ...(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}), tool: name })

let folder = ''
let home = ''
let sessionId = ''
let cwd = ''
let wasWaiting = new Set<string>()
let isFirstRead = true
// The git branch of each folder, read again after a while.
const branchCache = new Map<string, { at: number; branch?: string }>()
// What the open conversation and agent page were last read from, and which one is wanted now:
// a slower read of an earlier pick never overwrites the later one.
let convoRead = { path: '', mtimeMs: 0, at: 0 }
let convoWanted = ''
let detailRead = { path: '', mtimeMs: 0 }
let detailWanted = ''
// The session the wide pane shows without one being picked; drawn by the render hook.
let shownSession: string | undefined

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
  if (!folder || !ID.test(sessionId)) return
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
    notify: notifyWaiting,
  }
  await $.fs.write(`${folder}/${sessionId}.json`, JSON.stringify(card))
}

/** After a /clear or a resume the process goes on under a new id, and no session.start says so. */
async function followSessionId($: EngineInterface) {
  const id = await $.session.id().catch(() => sessionId)
  if (!id || id === sessionId || !ID.test(id)) return
  sessionId = id
  const now = await $.clock.now()
  await setSelf($, () => ({ title: '', state: 'idle', since: now, agentTools: {}, agentWaiting: {} }))
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

// A transcript that keeps changing is read again at most this often.
const REREAD_MS = 5_000
// A finished subagent stays on the board this long.
const KEEP_AGENT_MS = 10 * 60_000
// What one $.fs.read may copy.
const READ_LIMIT = 4 * 1024 * 1024 - 64 * 1024

const projectDir = (path: string) => path.replace(/[^A-Za-z0-9]/g, '-')
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const str = (s: unknown) => (typeof s === 'string' ? s : undefined)
const num = (n: unknown) => (isNum(n) ? n : undefined)

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return undefined
  }
}

/** A registry file as the mod needs it, or nothing when it does not hold one. */
function asRegistered(raw: unknown): Registered | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const id = str(r.sessionId)
  const where = str(r.cwd)
  if (!id || !ID.test(id) || !where) return undefined
  const host = str(r.hostSessionId)
  return {
    sessionId: id,
    cwd: where,
    name: str(r.name),
    status: str(r.status),
    waitingFor: str(r.waitingFor),
    startedAt: num(r.startedAt),
    updatedAt: num(r.updatedAt),
    statusUpdatedAt: num(r.statusUpdatedAt),
    hostSessionId: host && /^local_[A-Za-z0-9-]{1,64}$/.test(host) ? host : undefined,
  }
}

/** A session's own report, when it is whole and of a shape this version reads. */
function asReport(raw: unknown): SessionCard | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Partial<SessionCard>
  if (typeof r.sessionId !== 'string' || !ID.test(r.sessionId)) return undefined
  if (typeof r.cwd !== 'string' || !isNum(r.updatedAt) || !isNum(r.since) || !Array.isArray(r.agents)) return undefined
  const states: LoopState[] = ['running', 'waiting', 'idle', 'ended']
  if (!states.includes(r.state as LoopState)) return undefined
  const agents = r.agents.filter(
    (a): a is AgentCard => !!a && typeof a === 'object' && typeof a.id === 'string' && typeof a.status === 'string',
  )
  return { ...(r as SessionCard), title: typeof r.title === 'string' ? r.title : '', agents }
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
  // One response is written as one row per content block, its output count growing row by row:
  // its last row's count is the response's.
  const outByResponse = new Map<string, number>()
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
      const id = row.message?.id ?? row.uuid ?? line
      outByResponse.set(id, Math.max(outByResponse.get(id) ?? 0, usage.output_tokens ?? 0))
      ctx = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
  }
  const out = [...outByResponse.values()].reduce((sum, n) => sum + n, 0)
  const tokens: Tokens | undefined = ctx === undefined ? undefined : { out: isWhole ? out : undefined, ctx }
  if (last?.type === 'assistant') {
    const content = Array.isArray(last.message?.content) ? last.message.content : []
    const call = content.find((c: { type?: string }) => c && c.type === 'tool_use') as
      | { name?: string; input?: unknown }
      | undefined
    if (call?.name) {
      const since = last.timestamp ? Date.parse(last.timestamp) : NaN
      return {
        state: 'running',
        tool: describeCall(call.name, call.input),
        toolSince: Number.isNaN(since) ? undefined : since,
        tokens,
      }
    }
    return { state: last.message?.stop_reason === 'end_turn' ? 'ended' : 'running', tokens }
  }
  return { state: 'running', tokens }
}

async function scanAgents($: EngineInterface, card: Registered, now: number, visited: Set<string>): Promise<AgentCard[]> {
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
    if (!ID.test(id)) continue
    const path = `${dir}/${entry.name}`
    visited.add(path)

    let meta = metaCache.get(path)
    if (!meta) {
      const read = (await readJson($, `${dir}/agent-${id}.meta.json`)) as { agentType?: string; description?: string } | undefined
      // A meta file not written yet is asked again on the next pass, not remembered empty.
      if (read && (read.agentType || read.description)) metaCache.set(path, read)
      meta = read ?? {}
    }

    let verdict: Verdict
    const cached = tailCache.get(path)
    if (cached && (cached.mtimeMs === entry.mtimeMs || now - cached.readAt < REREAD_MS)) {
      verdict = cached.verdict
    } else {
      const isWhole = entry.size <= READ_LIMIT
      const lines = await tailOf($, path, entry.size, isWhole ? Number.MAX_SAFE_INTEGER : 2000).catch(() => undefined)
      if (lines) {
        verdict = classifyLines(lines, isWhole)
        tailCache.set(path, { mtimeMs: entry.mtimeMs, readAt: now, verdict })
      } else {
        // Unreadable this time: judged by its last write, and asked again next pass.
        verdict = cached?.verdict ?? { state: quiet < 5 * 60_000 ? 'running' : 'ended' }
      }
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

/** The branch a folder's repository is on: its own `.git/HEAD`, a worktree's, or a parent's. */
async function branchOf($: EngineInterface, cwd: string, now: number): Promise<string | undefined> {
  const cached = branchCache.get(cwd)
  if (cached && now - cached.at < 15_000) return cached.branch
  const fromHead = (head: string) => {
    const ref = head.trim().match(/^ref: refs\/heads\/(.+)$/)
    return ref ? ref[1] : head.trim().slice(0, 7)
  }
  let branch: string | undefined
  let dir = cwd.replace(/\\/g, '/').replace(/\/$/, '')
  for (let depth = 0; depth < 6 && dir; depth += 1) {
    const head = await $.fs.read(`${dir}/.git/HEAD`).catch(() => undefined)
    if (head !== undefined) {
      branch = fromHead(head)
      break
    }
    // A worktree or a submodule: `.git` is a file naming the real git folder.
    const pointer = await $.fs.read(`${dir}/.git`).catch(() => undefined)
    const gitdir = pointer?.trim().match(/^gitdir:\s*(.+)$/)?.[1]?.replace(/\\/g, '/')
    if (gitdir) {
      const where = /^([A-Za-z]:)?\//.test(gitdir) ? gitdir : `${dir}/${gitdir}`
      const real = await $.fs.read(`${where}/HEAD`).catch(() => undefined)
      if (real !== undefined) branch = fromHead(real)
      break
    }
    const cut = dir.lastIndexOf('/')
    if (cut <= 0) break
    dir = dir.slice(0, cut)
  }
  branchCache.set(cwd, { at: now, branch })
  return branch
}

async function readAll($: EngineInterface) {
  if (!folder) return
  const now = await $.clock.now()
  const visited = new Set<string>()

  // What sessions running this mod wrote: the finer detail (tool, waiting reason).
  const reports = new Map<string, SessionCard>()
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json') || entry.name.startsWith('_')) continue
    if (now - entry.mtimeMs > KEEP_ENDED_MS) continue
    const card = asReport(await readJson($, `${folder}/${entry.name}`))
    if (card) reports.set(card.sessionId, card)
  }
  const isLiveReport = (r: SessionCard) => r.state !== 'ended' && now - r.updatedAt < STALE_MS
  // The sessions that send system notifications: this one and every live one with them on.
  const senders = [
    ...(notifyWaiting ? [sessionId] : []),
    ...[...reports.values()].filter(r => r.sessionId !== sessionId && isLiveReport(r) && r.notify !== false).map(r => r.sessionId),
  ].sort()

  // The registry, one entry a session: a resumed one can hold two files, the newest wins.
  const registered = new Map<string, Registered>()
  const registry = `${home}/.claude/sessions`
  for (const entry of await $.fs.list(registry).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    const reg = asRegistered(await readJson($, `${registry}/${entry.name}`))
    if (!reg) continue
    const other = registered.get(reg.sessionId)
    if (!other || (reg.updatedAt ?? 0) > (other.updatedAt ?? 0)) registered.set(reg.sessionId, reg)
  }

  const sessions: SessionCard[] = []
  for (const reg of registered.values()) {
    try {
      const report = reports.get(reg.sessionId)
      reports.delete(reg.sessionId)
      const isFresh = report !== undefined && isLiveReport(report)

      // The registry is the authority on whether a session waits; a report only says on what.
      const state: LoopState = reg.waitingFor ? 'waiting' : reg.status === 'busy' ? 'running' : 'idle'
      const scanned = await scanAgents($, reg, now, visited)
      const known = isFresh ? report.agents : []
      const merged = [
        // What the session lists of its own: those still at work, and those its transcripts still show.
        ...known
          .filter(k => {
            const st = agentState(k.status, k.waiting)
            return st === 'running' || st === 'waiting' || scanned.some(a => a.id === k.id)
          })
          .map(k => {
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
      // A subagent left "running" in a session gone idle, silent for minutes, was stopped.
      const agents = merged.map(a =>
        state === 'idle' && a.status === 'running' && !a.waiting && a.lastActivity !== undefined && now - a.lastActivity > ORPHAN_MS
          ? { ...a, status: 'completed', tool: undefined, endedAt: a.lastActivity }
          : a,
      )
      sessions.push({
        sessionId: reg.sessionId,
        hostId: reg.hostSessionId,
        branch: await branchOf($, reg.cwd, now),
        startedAt: reg.startedAt,
        cwd: reg.cwd,
        title: reg.name || report?.title || '',
        state,
        waiting: state === 'waiting' ? (isFresh && report.state === 'waiting' && report.waiting) || reg.waitingFor || t.waitingFallback : undefined,
        tool: state === 'running' && isFresh ? report.tool : undefined,
        toolSince: state === 'running' && isFresh ? report.toolSince : undefined,
        since: reg.statusUpdatedAt ?? reg.updatedAt ?? reg.startedAt ?? now,
        updatedAt: reg.updatedAt ?? now,
        agents,
      })
    } catch (err) {
      $.ui.log(`agent-watch: skipped session ${reg.sessionId}: ${err}`, { to: 'debug' })
    }
  }

  // A session that reported but left the registry has ended.
  for (const card of reports.values()) {
    sessions.push(isLiveReport(card) ? card : { ...card, state: 'ended', waiting: undefined, tool: undefined, agents: [] })
  }

  // Caches keep what this pass met, and nothing else.
  for (const key of [...metaCache.keys()]) if (!visited.has(key)) metaCache.delete(key)
  for (const key of [...tailCache.keys()]) if (!visited.has(key)) tailCache.delete(key)
  for (const key of [...branchCache.keys()]) if (!sessions.some(c => c.cwd === key)) branchCache.delete(key)

  const rank: Record<LoopState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }
  sessions.sort((a, b) => rank[liveState(a)] - rank[liveState(b)] || b.since - a.since)
  const before = await read($, board)
  const isRunning = sessions.some(c => liveState(c) === 'running' || liveState(c) === 'waiting')
  const isChanged = JSON.stringify(before.sessions) !== JSON.stringify(sessions)
  const isClockDue = now - before.now >= (isRunning ? CLOCK_RUNNING_MS : CLOCK_IDLE_MS)
  if (isChanged || isClockDue) await update($, board, () => ({ now, sessions }))
  await update($, seen, marks => {
    const missing = sessions.filter(c => marks[c.sessionId] === undefined)
    const gone = Object.keys(marks).filter(id => !sessions.some(c => c.sessionId === id))
    if (missing.length === 0 && gone.length === 0) return marks
    const kept = Object.fromEntries(Object.entries(marks).filter(([id]) => !gone.includes(id)))
    return { ...kept, ...Object.fromEntries(missing.map(c => [c.sessionId, now])) }
  })

  // Status line and notifications when a session starts waiting on the person.
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
  // For a session that waits, the first of the other senders by id sends it (itself when it is
  // the only one): nobody is left out, nobody sends it twice.
  const senderFor = (id: string) => senders.find(s => s !== id) ?? (senders.includes(id) ? id : undefined)
  // The sessions already waiting when this process first looked are not news.
  if (!isFirstRead) {
    for (const id of waitingNow) {
      if (wasWaiting.has(id)) continue
      const c = sessions.find(one => one.sessionId === id)
      if (!c) continue
      const who = `${baseName(c.cwd)} — ${short(c.title || t.newSession, 40)}`
      if (notifyWaiting && id !== sessionId) $.ui.toast(t.isWaitingForYou(who))
      if (senderFor(id) === sessionId) void notifySystem($, t.notifyTitle, `${who}${c.waiting ? ` · ${c.waiting}` : ''}`, c.hostId)
    }
  }
  isFirstRead = false
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
    for (const block of entry.message.content as { type?: string; name?: string; input?: unknown }[]) {
      if (block?.type === 'tool_use' && block.name) {
        const full = describeCall(block.name, block.input)
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

/** Reads a subagent's page again when its transcript changed; the latest pick wins. */
async function loadDetail($: EngineInterface, sessionId: string, agentId: string, isForced: boolean) {
  const wanted = `${sessionId}/${agentId}`
  detailWanted = wanted
  const card = (await read($, board)).sessions.find(c => c.sessionId === sessionId)
  if (!card) {
    await update($, detail, () => ({ agentId, isLoading: false, tools: [], error: 'session gone' }))
    return
  }
  const path = `${home}/.claude/projects/${projectDir(card.cwd)}/${sessionId}/subagents/agent-${agentId}.jsonl`
  try {
    const stat = await $.fs.stat(path)
    if (!isForced && detailRead.path === path && detailRead.mtimeMs === stat.mtimeMs) return
    if (isForced) await update($, detail, () => ({ agentId, isLoading: true, tools: [] }))
    const lines = await tailOf($, path, stat.size, 120, true)
    if (detailWanted !== wanted) return
    const found = readTranscript(lines[0] ?? '', lines.slice(1))
    detailRead = { path, mtimeMs: stat.mtimeMs }
    await update($, detail, () => ({ agentId, isLoading: false, ...found }))
  } catch (err) {
    if (detailWanted !== wanted) return
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
  const out = run.stdout.trimEnd()
  if (run.exitCode !== 0 || out === '') throw new Error(`tail.ps1 exited ${run.exitCode}: ${run.stderr.trim().slice(0, 200)}`)
  const all = out.split(/\r?\n/)
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
  let ctx: number | undefined
  let model: string | undefined
  for (const line of lines) {
    let entry: Entry & { isMeta?: boolean; isSidechain?: boolean; message?: { model?: string; usage?: Usage } }
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
    if (entry.type === 'assistant' && entry.message?.usage) {
      const u = entry.message.usage
      ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      if (entry.message.model && !entry.message.model.startsWith('<')) model = entry.message.model
    }
    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content as { type?: string; name?: string; input?: unknown }[]) {
        if (block?.type === 'tool_use' && block.name) {
          const full = describeCall(block.name, block.input)
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
  return { prompt: cut(prompt, 700), promptAt, answer: cut(answer, 2500), answerAt, tools: tools.slice(-8), ctx, model }
}

/** Reads a session's conversation again when its transcript changed, at most every CONVO_MS; the latest pick wins. */
async function loadConvo($: EngineInterface, sessionId: string, isForced: boolean) {
  convoWanted = sessionId
  const card = (await read($, board)).sessions.find(c => c.sessionId === sessionId)
  if (!card) return
  const path = `${home}/.claude/projects/${projectDir(card.cwd)}/${sessionId}.jsonl`
  const now = await $.clock.now()
  try {
    const stat = await $.fs.stat(path)
    const isSame = convoRead.path === path && convoRead.mtimeMs === stat.mtimeMs
    if (!isForced && (isSame || (convoRead.path === path && now - convoRead.at < CONVO_MS))) return
    if (isForced) await update($, convo, () => ({ sessionId, isLoading: true, tools: [] }))
    const found = readConversation(await tailOf($, path, stat.size, 400))
    if (convoWanted !== sessionId) return
    convoRead = { path, mtimeMs: stat.mtimeMs, at: now }
    await update($, convo, () => ({ sessionId, isLoading: false, ...found }))
  } catch (err) {
    if (convoWanted !== sessionId) return
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
  const title = (await read($, board)).sessions.find(c => c.hostId === hostId)?.title
  $.ui.toast(t.opening(title || hostId))
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const argv = isWindows
    ? ['rundll32', 'url.dll,FileProtocolHandler', url]
    : (await $.env.get('XDG_CURRENT_DESKTOP')) !== undefined
      ? ['xdg-open', url]
      : ['open', url]
  const run = await $.process.run(argv, { timeoutMs: 10_000 }).catch(err => {
    $.ui.toast(`agent-watch: ${err}`)
    return undefined
  })
  if (run && run.exitCode !== 0) $.ui.toast(`agent-watch: ${argv[0]} exited ${run.exitCode} ${run.stderr.trim()}`.trim())
}

/** The person's own choices, made from the pane: they win over the manifest's defaults. */
async function loadPreferences($: EngineInterface) {
  const kept = (await $.store.get('preferences').catch(() => undefined)) as
    | { notifyWaiting?: boolean; statusLine?: boolean; language?: 'en' | 'fr' }
    | undefined
  if (typeof kept?.notifyWaiting === 'boolean') notifyWaiting = kept.notifyWaiting
  if (typeof kept?.statusLine === 'boolean') showStatusLine = kept.statusLine
  if (kept?.language === 'en' || kept?.language === 'fr') {
    language = kept.language
    t = STRINGS[language]
  }
}

async function savePreferences($: EngineInterface) {
  await $.store
    .set('preferences', { notifyWaiting, statusLine: showStatusLine, language })
    .catch(err => $.ui.log(`agent-watch: could not save preferences: ${err}`, { to: 'debug' }))
  $.ui.invalidate('ui.render')
}

async function tickOnce($: EngineInterface) {
  await followSessionId($).catch(() => {})
  await writeOwn($).catch(err => $.ui.log(`agent-watch: could not write: ${err}`, { to: 'debug' }))
  await readAll($).catch(err => $.ui.log(`agent-watch: could not read: ${err}`, { to: 'debug' }))
  const at = await read($, route)
  // The session on screen: the one picked, or the one the wide pane shows by itself.
  const looking = at.view !== 'list' ? at.sessionId : shownSession
  if (looking) {
    const looked = (await read($, board)).sessions.find(c => c.sessionId === looking)
    const marks = await read($, seen)
    const newest = Math.max(looked?.since ?? 0, ...(looked?.agents.map(a => a.endedAt ?? 0) ?? []))
    if (looked && newest > (marks[looking] ?? 0)) {
      const now = await $.clock.now()
      await update($, seen, all => ({ ...all, [looking]: now }))
    }
    if (at.view !== 'agent') await loadConvo($, looking, false).catch(() => {})
  }
  if (at.view === 'agent') await loadDetail($, at.sessionId, at.agentId, false).catch(() => {})
}

// One pass at a time: a call made while one runs asks for one more pass after it, never a second
// pass at once (which would race the first and write older data over newer).
let ticking: Promise<void> | undefined
let isTickAsked = false
function tick($: EngineInterface): Promise<void> {
  if (ticking) {
    isTickAsked = true
    return ticking
  }
  ticking = (async () => {
    do {
      isTickAsked = false
      // A pass that fails (the module unloading under it, a file gone) is logged, never thrown at
      // a caller that did not wait for it.
      await tickOnce($).catch(err => $.ui.log(`agent-watch: a pass failed: ${err}`, { to: 'debug' }))
    } while (isTickAsked)
  })().finally(() => {
    ticking = undefined
  })
  return ticking
}

export const register: Register = (on, options) => {
  language = options.language === 'fr' ? 'fr' : 'en'
  t = STRINGS[language]
  notifyWaiting = options.notifyWaiting !== false
  showStatusLine = options.statusLine !== false
  openOnStart = options.openOnStart !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadPreferences($)
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
    // The pane as the session list: opened by itself, where the surface seats it beside the transcript.
    if (openOnStart && e.isInteractive) void $.ui.open({ id: PANE, title: t.paneTitle }).catch(() => {})

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

  // The hooks below sit on the turn's path: they note what changed and let the next pass read the
  // board, never holding the turn, a dialog or a question for it.
  on('turn.start', async ($, e, next) => {
    const me = await read($, self)
    const title = me.title || (e.text ? short(e.text, 80) : '')
    await setLoop($, 'running', { title, waiting: undefined, tool: undefined })
    void tick($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await setLoop($, 'idle', { waiting: undefined, tool: undefined })
      void tick($)
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
    if (asking) void tick($)

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
    void tick($)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // The ending session's card says so; after a /clear or a resume the process goes on, and the
    // next pass follows it under its new id.
    await setLoop($, 'ended', { waiting: undefined, tool: undefined })
    await writeOwn($).catch(() => {})

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { now, sessions } = await read($, board)
    const width = Math.max(40, e.props.bodyColumns ?? e.viewport?.columns ?? 80)

    const vm: ViewModel = {
      now,
      sessions,
      filter: await read($, filter),
      collapsed: await read($, collapsed),
      route: await read($, route),
      detail: await read($, detail),
      convo: await read($, convo),
      seen: await read($, seen),
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
      go: (to: Route, focusKey?: string) => {
        void update($, route, () => to).then(() =>
          focusKey ? $.ui.focus({ requestId: PANE, key: focusKey }).catch(() => undefined) : undefined,
        )
        if (to.view !== 'list') void $.clock.now().then(now => update($, seen, marks => ({ ...marks, [to.sessionId]: now })))
        if (to.view === 'agent') void loadDetail($, to.sessionId, to.agentId, true)
        if (to.view === 'session') void loadConvo($, to.sessionId, true)
      },
      showing: (id: string | undefined) => {
        // Drawn without a pick: the next pass loads its conversation and marks it seen.
        if (id !== shownSession) {
          shownSession = id
          void tick($)
        }
      },
      openSession: (hostId: string) => void openInApp($, hostId),
      refresh: () => void tick($),
      toggleLanguage: () => {
        language = language === 'fr' ? 'en' : 'fr'
        t = STRINGS[language]
        $.ui.toast(t.languageIs)
        void savePreferences($)
      },
      toggleNotify: () => {
        notifyWaiting = !notifyWaiting
        $.ui.toast(t.notifyIs(notifyWaiting))
        void savePreferences($)
      },
      toggleStatusLine: () => {
        showStatusLine = !showStatusLine
        if (!showStatusLine) $.ui.status(undefined)
        void savePreferences($)
      },
    }

    return drawApp($.ui.resolve(e) as unknown as Kit, vm, act)
  })
}
