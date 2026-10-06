import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentCard, Board, Filter, LoopState, SelfStatus, SessionCard } from '../types'
import { STRINGS } from './strings'
import type { Strings } from './strings'
import { agentState, clock, drawBoard, liveState } from './view'
import type { Actions, Kit, ViewModel } from './view'
import { renderSvg } from './svg'

const PANE = 'agent-watch'
const COMMAND = 'agent-watch'
const VERSION = '0.2.0'
// A pane column in CSS pixels on the surfaces that draw SVG.
const PX_PER_COLUMN = 7.2
const TICK_MS = 3000
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
}
type Verdict = { state: LoopState; tool?: string }

const metaCache = new Map<string, { agentType?: string; description?: string }>()
const tailCache = new Map<string, { mtimeMs: number; verdict: Verdict }>()

// A subagent writing to its transcript this recently is at work.
const ACTIVE_MS = 30_000
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

// What the last entries of a subagent's transcript say about it.
function classifyTail(text: string): Verdict {
  const lines = text.trimEnd().split('\n').slice(-6).reverse()
  for (const line of lines) {
    let entry: { type?: string; message?: { stop_reason?: string; content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (entry.type === 'assistant') {
      const content = Array.isArray(entry.message?.content) ? entry.message.content : []
      const call = content.find(
        (c: { type?: string }) => c && c.type === 'tool_use',
      ) as { name?: string; input?: Record<string, unknown> } | undefined
      if (call?.name) return { state: 'running', tool: describeTool({ tool: call.name, ...(call.input ?? {}) }) }
      return { state: entry.message?.stop_reason === 'end_turn' ? 'ended' : 'running' }
    }
    if (entry.type === 'user') return { state: 'running' }
  }
  return { state: 'running' }
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
    if (quiet < ACTIVE_MS) {
      verdict = { state: 'running' }
    } else {
      const cached = tailCache.get(path)
      if (cached && cached.mtimeMs === entry.mtimeMs) {
        verdict = cached.verdict
      } else {
        verdict =
          entry.size <= READ_LIMIT
            ? classifyTail(await $.fs.read(path).catch(() => ''))
            : { state: quiet < 5 * 60_000 ? 'running' : 'ended' }
        tailCache.set(path, { mtimeMs: entry.mtimeMs, verdict })
      }
      if (verdict.state === 'running' && !verdict.tool) verdict = { ...verdict, tool: t.quietFor(clock(quiet)) }
    }
    agents.push({
      id,
      label: meta.description ?? id,
      type: meta.agentType ?? 'agent',
      status: verdict.state === 'running' ? 'running' : 'completed',
      tool: verdict.tool,
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
  for (const entry of await $.fs.list(folder).catch(() => [])) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    if (now - entry.mtimeMs > KEEP_ENDED_MS) continue
    const card = (await readJson($, `${folder}/${entry.name}`)) as SessionCard | undefined
    if (card?.sessionId) reports.set(card.sessionId, card)
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
        return found ? { ...k, startedAt: found.startedAt, endedAt: found.endedAt } : k
      }),
      ...scanned.filter(a => !known.some(k => k.id === a.id)),
    ]
    sessions.push({
      sessionId: reg.sessionId,
      cwd: reg.cwd,
      title: reg.name || report?.title || '',
      state,
      waiting: state === 'waiting' ? (isFresh && report.waiting) || reg.waitingFor || t.waitingFallback : undefined,
      tool: state === 'running' && isFresh ? report.tool : undefined,
      since: reg.statusUpdatedAt ?? reg.updatedAt ?? reg.startedAt ?? now,
      updatedAt: reg.updatedAt ?? now,
      agents,
    })
  }

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
      if (c) $.ui.toast(t.isWaitingForYou(`${baseName(c.cwd)} — ${short(c.title || t.newSession, 40)}`))
    }
  }
  wasWaiting = waitingNow
  if (showStatusLine) {
    const parts = [running && t.statusRunning(running), waiting && t.statusWaiting(waiting)].filter(Boolean)
    $.ui.status(parts.length ? `agents ${parts.join(' · ')}` : undefined)
  }
}

async function tick($: EngineInterface) {
  await writeOwn($).catch(err => $.ui.log(`agent-watch: could not write: ${err}`, { to: 'debug' }))
  await readAll($).catch(err => $.ui.log(`agent-watch: could not read: ${err}`, { to: 'debug' }))
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
    })
    $.clock.every(TICK_MS, () => void tick($))
    await tick($)

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    await tick($)
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
      await setLoop($, asking ? 'waiting' : 'running', { tool: label, waiting: asking })
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
          await setLoop($, 'running', { tool: undefined, waiting: undefined })
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
      mine: sessionId,
      home,
      width,
      t,
      version: VERSION,
      notify: notifyWaiting,
      statusLine: showStatusLine,
    }
    const act: Actions = {
      setFilter: (f: Filter) => void update($, filter, () => f),
      toggle: (id: string) =>
        void update($, collapsed, list => (list.includes(id) ? list.filter(one => one !== id) : [...list, id])),
      refresh: () => void tick($),
      toggleLanguage: () => setOption('language', language === 'fr' ? 'en' : 'fr'),
      toggleNotify: () => setOption('notifyWaiting', !notifyWaiting),
      toggleStatusLine: () => {
        if (showStatusLine) $.ui.status(undefined)
        setOption('statusLine', !showStatusLine)
      },
    }

    if (e.surface === 'terminal') {
      return drawBoard($.ui.resolve(e) as unknown as Kit, vm, act)
    }

    // Surfaces that draw SVG get the dashboard as one picture, its controls as
    // native buttons above it (an SVG takes no presses).
    const { Box, Button, Svg } = $.ui.resolve(e)
    const picture = renderSvg(vm, width * PX_PER_COLUMN)
    return (
      <Box flexDirection="column" width="100%">
        <Box flexWrap="wrap" columnGap={1} rowGap={0}>
          {(['all', 'running', 'waiting', 'idle', 'ended'] as const).map((f, i) => (
            <Button
              key={`filter-${f}`}
              hotkey={String(i + 1)}
              variant={vm.filter === f ? 'primary' : 'secondary'}
              label={f === 'all' ? t.allSessions : t.filterName[f]}
              onPress={() => act.setFilter(f)}
            />
          ))}
          <Button key="refresh" hotkey="r" label={`⟳ ${t.refresh}`} onPress={act.refresh} />
          <Button key="set-language" hotkey="l" label={t.languageName} onPress={act.toggleLanguage} />
          <Button
            key="set-notify"
            hotkey="n"
            label={`${t.notifications}: ${notifyWaiting ? t.on : t.off}`}
            onPress={act.toggleNotify}
          />
        </Box>
        <Svg source={picture.source} alt={picture.alt} />
      </Box>
    )
  })
}
