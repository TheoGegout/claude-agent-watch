import type { Elements, RenderElement } from 'claude-code'

import type { AgentCard, AgentDetail, Filter, LoopState, Route, SessionCard, SessionConvo, Tokens } from '../types'
import type { Strings } from './strings'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Link' | 'Markdown'>

/** What the pane draws from, gathered by the render hook. */
export type ViewModel = {
  now: number
  sessions: SessionCard[]
  filter: Filter
  collapsed: string[]
  route: Route
  detail: AgentDetail | null
  convo: SessionConvo | null
  seen: Record<string, number>
  mine: string
  home: string
  width: number
  isTerminal: boolean
  t: Strings
  version: string
  notify: boolean
  statusLine: boolean
}

/** What the pane's controls do. */
export type Actions = {
  setFilter: (filter: Filter) => void
  toggle: (sessionId: string) => void
  go: (route: Route) => void
  openOpened: () => void
  openSession: (hostId: string) => void
  refresh: () => void
  toggleLanguage: () => void
  toggleNotify: () => void
  toggleStatusLine: () => void
}

const RANK: Record<LoopState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }
const FILTERS: Filter[] = ['all', 'running', 'waiting', 'idle', 'ended']
// The session list, herdr's way: a column of its own beside the selected session.
const SIDEBAR = 40
// The pane is wide enough for the list beside the selected session from here.
const WIDE = 96

/** Colours by the app's theme keys, so the pane reads as part of it. */
const THEME = {
  running: 'success',
  waiting: 'warning',
  idle: 'inactive',
  ended: 'error',
  accent: 'claude',
  text: undefined,
  dim: 'inactive',
  faint: 'inactive',
  line: 'inactive',
  card: undefined,
  panel: undefined,
}
type Palette = Record<keyof typeof THEME, string | undefined>

export const agentState = (status: string, waiting?: string): LoopState => {
  if (waiting) return 'waiting'
  if (status === 'running' || status === 'pending') return 'running'
  if (status === 'waiting') return 'waiting'
  if (status === 'idle') return 'idle'
  return 'ended'
}

/** The most urgent of a session and its subagents: what its card says. */
export const liveState = (c: SessionCard): LoopState => {
  let best = c.state
  for (const a of c.agents) {
    const s = agentState(a.status, a.waiting)
    if (RANK[s] < RANK[best]) best = s
  }
  return best
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// A tool call running this long, and a running agent silent this long, are flagged.
export const SLOW_TOOL_MS = 30_000
export const SILENT_MS = 120_000
// Under this, a running agent writing nothing is just thinking.
const QUIET_MS = 30_000

/** `12.3k`, `1.2M`. */
export const count = (n: number) =>
  n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`

export const tokensText = (tk: Tokens | undefined, t: Strings) =>
  !tk ? '' : [tk.out !== undefined ? t.tokensOut(count(tk.out)) : '', tk.ctx !== undefined ? t.tokensCtx(count(tk.ctx)) : ''].filter(Boolean).join(' · ')

/** What an agent is doing now, and whether it deserves a look (a slow tool, a long silence). */
export function activityOf(a: AgentCard, now: number, t: Strings): { text?: string; isAlert: boolean } {
  const state = agentState(a.status, a.waiting)
  if (state === 'ended') return { text: tokensText(a.tokens, t) || undefined, isAlert: false }
  if (a.waiting) return { text: a.waiting, isAlert: true }
  if (a.tool) {
    const took = a.toolSince === undefined ? undefined : now - a.toolSince
    const isSlow = took !== undefined && took > SLOW_TOOL_MS
    return { text: `${a.tool}${took !== undefined ? ` · ${clock(took)}` : ''}${isSlow ? ' ⚠' : ''}`, isAlert: isSlow }
  }
  const quiet = a.lastActivity === undefined ? 0 : now - a.lastActivity
  if (quiet > SILENT_MS) return { text: `⚠ ${t.silentFor(clock(quiet))}`, isAlert: true }
  if (quiet > QUIET_MS) return { text: t.quietFor(clock(quiet)), isAlert: false }
  return { isAlert: false }
}

const short = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return max > 1 && line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const prettyPath = (path: string, home: string) => {
  const p = path.replace(/\\/g, '/').replace(/\/$/, '')
  return home && p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p
}

/** The deep link the desktop app answers by opening that session. */
export const sessionLink = (hostId: string) => `claude://code/continue?session=${encodeURIComponent(hostId)}`

export function drawApp(el: Kit, vm: ViewModel, act: Actions) {
  const { Box, Text, Button, Link, Markdown } = el
  const { t, now } = vm
  const P: Palette = THEME
  const isWide = vm.width >= WIDE
  const main = isWide ? vm.width - SIDEBAR - 3 : vm.width
  const route = vm.route

  const counts: Record<LoopState, number> = { running: 0, waiting: 0, idle: 0, ended: 0 }
  for (const c of vm.sessions) counts[liveState(c)] += 1
  let loopsRunning = 0
  let loopsWaiting = 0
  for (const c of vm.sessions) {
    for (const s of [c.state, ...c.agents.map(a => agentState(a.status, a.waiting))]) {
      if (s === 'running') loopsRunning += 1
      if (s === 'waiting') loopsWaiting += 1
    }
  }

  // ── atoms ─────────────────────────────────────────────────────────────
  const badge = (state: LoopState, label: string) =>
    vm.isTerminal ? (
      <Text color={P[state]} inverse>
        {` ${label} `}
      </Text>
    ) : (
      <Text color={P[state]} bold>
        {label}
      </Text>
    )
  const dot = (state: LoopState) => <Text color={P[state]}>● </Text>
  const label = (text: string) => (
    <Text color={P.dim} bold>
      {text}
    </Text>
  )
  // A rule of box-drawing dashes reads only where a cell is a glyph wide: the terminal.
  const rule = () => (vm.isTerminal ? <Text color={P.line}>{'─'.repeat(Math.max(0, Math.min(vm.width, 400)))}</Text> : null)
  const openLink = (c: SessionCard, text: string) => {
    const hostId = c.hostId
    return hostId ? (
      <Button plain key={`open-${c.sessionId}`} label={text} onPress={() => act.openSession(hostId)} />
    ) : null
  }
  const card = (key: string, isAlert: boolean, children: RenderElement) => (
    <Box
      key={key}
      flexDirection="column"
      borderStyle="round"
      borderColor={isAlert ? P.waiting : P.line}
      paddingX={1}
      marginBottom={1}
    >
      {children}
    </Box>
  )
  const back = (to: Route) => <Button key="back" hotkey="b" label={t.back} onPress={() => act.go(to)} />

  // ── header ────────────────────────────────────────────────────────────
  const header = (
    <Box key="header" flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Box flexDirection="column">
          <Text>
            <Text color={P.accent}>◉ </Text>
            <Text bold color={P.text}>
              AGENT WATCH
            </Text>
          </Text>
          <Text color={P.dim}>{t.subtitle}</Text>
        </Box>
        <Box columnGap={2} flexWrap="wrap" alignItems="center">
          {(['running', 'waiting', 'idle', 'ended'] as const).map(s => (
            <Button
              key={`count-${s}`}
              plain
              label={`${s === 'ended' ? '■' : '●'} ${counts[s]} ${t.filterName[s].toLowerCase()}`}
              dimColor={counts[s] === 0}
              onPress={() => act.setFilter(vm.filter === s ? 'all' : s)}
            />
          ))}
          <Button key="refresh-top" plain label={`⟳ ${t.autoRefresh} 1s`} dimColor onPress={act.refresh} />
        </Box>
      </Box>
      {rule()}
    </Box>
  )

  // ── one agent row (clickable) ─────────────────────────────────────────
  const agentRow = (c: SessionCard, a: AgentCard) => {
    const state = agentState(a.status, a.waiting)
    const elapsed =
      a.startedAt === undefined ? '' : clock((state === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)
    const activity = activityOf(a, now, t)
    return (
      <Box key={`a-${a.id}`} flexDirection="column">
        <Box justifyContent="space-between" columnGap={1}>
          <Box flexShrink={1}>
            {dot(state)}
            <Button
              plain
              key={`agent-${c.sessionId}-${a.id}`}
              label={short(`${a.type} · ${a.label}`, 70)}
              onPress={() => act.go({ view: 'agent', sessionId: c.sessionId, agentId: a.id })}
            />
          </Box>
          <Box columnGap={1} flexShrink={0}>
            {badge(state, t.filterName[state])}
            <Text color={P.dim}>{elapsed.padStart(7)}</Text>
          </Box>
        </Box>
        {activity.text && (
          <Text color={activity.isAlert ? P.waiting : P.faint} wrap="truncate-end">
            {`    ${state === 'ended' ? '' : '▸ '}${activity.text}`}
          </Text>
        )}
      </Box>
    )
  }

  const statusBlock = (c: SessionCard) =>
    c.state === 'waiting' ? (
      <Box borderStyle="round" borderColor={P.waiting} paddingX={1} flexDirection="column">
        <Text color={P.waiting} bold wrap="truncate-end">
          {`⚠ ${t.inputRequired}`}
        </Text>
        <Text color={P.dim} wrap="truncate-end">
          {c.waiting ? `${c.waiting} · ${t.waitingForYourResponse}` : t.waitingForYourResponse}
        </Text>
      </Box>
    ) : c.state === 'running' ? (
      <Text wrap="truncate-end">
        <Text color={P.running}>▸ </Text>
        <Text color={c.toolSince !== undefined && now - c.toolSince > SLOW_TOOL_MS ? P.waiting : P.dim}>
          {c.tool
            ? `${c.tool}${c.toolSince !== undefined ? ` · ${clock(now - c.toolSince)}` : ''}${c.toolSince !== undefined && now - c.toolSince > SLOW_TOOL_MS ? ' ⚠' : ''}`
            : t.state.running}
        </Text>
      </Text>
    ) : c.state === 'idle' ? (
      <Text color={P.faint} wrap="truncate-end">
        {`○ ${t.waitingForNextMessage}`}
      </Text>
    ) : (
      <Text color={P.faint} wrap="truncate-end">
        {`× ${t.lastSeen(clock(now - c.updatedAt))}`}
      </Text>
    )

  // ── session page ──────────────────────────────────────────────────────
  const field = (name: string, value: string | null, key: string) =>
    value ? (
      <Box key={key} columnGap={1}>
        <Text color={P.dim}>{`${name.padEnd(12)}`}</Text>
        <Text color={P.text} wrap="truncate-end">
          {value}
        </Text>
      </Box>
    ) : null
  const conversation = (c: SessionCard) => {
    const v = vm.convo && vm.convo.sessionId === c.sessionId ? vm.convo : null
    const who = (name: string, at?: string, color?: string) => (
      <Text>
        <Text bold color={color}>
          {name}
        </Text>
        <Text color={P.faint}>{at ? `  ${at}` : ''}</Text>
      </Text>
    )
    return (
      <Box key="convo" flexDirection="column" marginBottom={1}>
        {label(t.conversation)}
        {!v || (v.isLoading && !v.prompt && !v.answer) ? (
          <Text color={P.dim}>{t.readingConvo}</Text>
        ) : v.error ? (
          <Text color={P.faint}>{t.noConvo}</Text>
        ) : (
          <Box flexDirection="column">
            {v.prompt ? (
              <Box key="you" flexDirection="column" borderStyle="round" borderColor={P.line} paddingX={1} marginBottom={1}>
                {who(t.you, v.promptAt, P.accent)}
                <Text color={P.text}>{v.prompt}</Text>
              </Box>
            ) : null}
            {v.answer ? (
              <Box key="claude" flexDirection="column" borderStyle="round" borderColor={P.line} paddingX={1} marginBottom={1}>
                {who(t.claude, v.answerAt, P.running)}
                <Markdown key="answer" text={v.answer} />
              </Box>
            ) : null}
            {!v.prompt && !v.answer ? <Text color={P.faint}>{t.noConvo}</Text> : null}
            {v.tools.length > 0 ? (
              <Box key="tools" flexDirection="column">
                {label(t.recentTools)}
                {v.tools.map((tool, i) => (
                  <Text key={`ct-${i}`} wrap="truncate-end">
                    <Text color={P.faint}>{tool.at ? `${tool.at}  ` : ''}</Text>
                    <Text color={P.running}>▸ </Text>
                    <Text bold color={P.text}>
                      {tool.name}
                    </Text>
                    <Text color={P.dim}>{tool.detail ? `  ${tool.detail}` : ''}</Text>
                  </Text>
                ))}
              </Box>
            ) : null}
          </Box>
        )}
      </Box>
    )
  }

  const sessionPage = (c: SessionCard) => {
    const state = liveState(c)
    return (
      <Box key="session" flexDirection="column" width={main}>
        <Box justifyContent={isWide ? 'flex-end' : 'space-between'} marginBottom={1}>
          {isWide ? null : back({ view: 'list' })}
          {openLink(c, t.openInApp)}
        </Box>
        {card(
          'session-card',
          state === 'waiting',
          <Box flexDirection="column">
            <Box columnGap={1}>
              {dot(state)}
              <Text bold color={P.text} wrap="truncate-end">
                {c.title || t.newSession}
              </Text>
              {badge(state, t.badge[state])}
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {field(t.folder, prettyPath(c.cwd, vm.home), 'f-folder')}
              {field(t.stateLabel, t.state[c.state], 'f-state')}
              {field(t.duration, clock(now - c.since), 'f-since')}
              {field(t.waitingReason, c.state === 'waiting' ? (c.waiting ?? null) : null, 'f-wait')}
              {field(t.currentTool, c.state === 'running' ? (c.tool ?? null) : null, 'f-tool')}
              {field(t.sessionId, c.sessionId, 'f-id')}
            </Box>
            <Box marginTop={1} flexDirection="column">
              {statusBlock(c)}
            </Box>
          </Box>,
        )}
        {conversation(c)}
        {label(t.agentsTitle(c.agents.length))}
        {c.agents.length === 0 ? (
          <Text color={P.faint}>{t.noAgents}</Text>
        ) : (
          <Box flexDirection="column" borderStyle="round" borderColor={P.line} paddingX={1}>
            {c.agents.map(a => agentRow(c, a))}
          </Box>
        )}
      </Box>
    )
  }

  // ── agent page ────────────────────────────────────────────────────────
  const agentPage = (c: SessionCard, a: AgentCard) => {
    const state = agentState(a.status, a.waiting)
    const d = vm.detail && vm.detail.agentId === a.id ? vm.detail : null
    const elapsed =
      a.startedAt === undefined ? null : clock((state === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)
    return (
      <Box key="agent" flexDirection="column" width={main}>
        <Box justifyContent="space-between" marginBottom={1}>
          {back({ view: 'session', sessionId: c.sessionId })}
          {openLink(c, t.openInApp)}
        </Box>
        {card(
          'agent-card',
          state === 'waiting',
          <Box flexDirection="column">
            <Box columnGap={1}>
              {dot(state)}
              <Text bold color={P.text} wrap="truncate-end">
                {`${a.type} · ${a.label}`}
              </Text>
              {badge(state, t.badge[state])}
            </Box>
            <Box flexDirection="column" marginTop={1}>
              {field(t.sessionId, c.title || c.sessionId, 'g-session')}
              {field(t.duration, elapsed, 'g-elapsed')}
              {field(t.currentTool, state === 'ended' ? null : (activityOf(a, now, t).text ?? null), 'g-tool')}
              {field('Tokens', tokensText(a.tokens, t) || null, 'g-tokens')}
            </Box>
          </Box>,
        )}
        {!d || d.isLoading ? (
          <Text color={P.dim}>{t.loading}</Text>
        ) : d.error ? (
          <Text color={P.ended}>{t.unreadable}</Text>
        ) : (
          <Box flexDirection="column">
            {d.prompt ? (
              <Box flexDirection="column" marginBottom={1}>
                {label(t.task)}
                <Text color={P.text}>{d.prompt}</Text>
              </Box>
            ) : null}
            {label(t.lastTools)}
            <Box flexDirection="column" borderStyle="round" borderColor={P.line} paddingX={1} marginBottom={1}>
              {d.tools.length === 0 ? (
                <Text color={P.faint}>{t.nothingYet}</Text>
              ) : (
                d.tools.map((tool, i) => (
                  <Text key={`tool-${i}`} wrap="truncate-end">
                    <Text color={P.running}>▸ </Text>
                    <Text color={P.text} bold>
                      {tool.name}
                    </Text>
                    <Text color={P.dim}>{tool.detail ? `  ${tool.detail}` : ''}</Text>
                  </Text>
                ))
              )}
            </Box>
            {label(t.lastAnswer)}
            <Text color={d.answer ? P.text : P.faint}>{d.answer ?? t.nothingYet}</Text>
          </Box>
        )}
      </Box>
    )
  }

  // ── the list, herdr's way: by project, one line a session ────────────
  /** Finished, or turned idle, since you last looked at it. */
  const isUnseen = (c: SessionCard) =>
    c.sessionId !== vm.mine &&
    (c.state === 'idle' || c.state === 'ended') &&
    c.since > (vm.seen[c.sessionId] ?? Number.POSITIVE_INFINITY)
  const isAgentUnseen = (c: SessionCard, a: AgentCard) =>
    agentState(a.status, a.waiting) === 'ended' && (a.endedAt ?? 0) > (vm.seen[c.sessionId] ?? Number.POSITIVE_INFINITY)
  type Mark = { glyph: string; color: string | undefined }
  const markOf = (state: LoopState, isDone: boolean): Mark =>
    state === 'waiting'
      ? { glyph: '◆', color: P.waiting }
      : state === 'running'
        ? { glyph: '●', color: P.running }
        : isDone
          ? { glyph: '✓', color: P.accent }
          : { glyph: state === 'ended' ? '×' : '○', color: P.dim }
  const sessionMark = (c: SessionCard) => markOf(liveState(c), isUnseen(c) || c.agents.some(a => isAgentUnseen(c, a)))

  const shown = vm.sessions.filter(c => vm.filter === 'all' || liveState(c) === vm.filter)
  const projectOf = (c: SessionCard) => c.cwd.replace(/\\/g, '/').replace(/\/$/, '').split('/').filter(Boolean).at(-1) ?? c.cwd
  const projects: { name: string; sessions: SessionCard[] }[] = []
  for (const c of shown) {
    const name = projectOf(c)
    const group = projects.find(p => p.name === name)
    if (group) group.sessions.push(c)
    else projects.push({ name, sessions: [c] })
  }
  const ordered = projects.flatMap(p => p.sessions)
  const selectedId =
    route.view !== 'list' ? route.sessionId : isWide ? ordered[0]?.sessionId : undefined
  const selectedAt = ordered.findIndex(c => c.sessionId === selectedId)
  const step = (by: number) => {
    const next = ordered[Math.min(ordered.length - 1, Math.max(0, (selectedAt < 0 ? -1 : selectedAt) + by))]
    if (next) act.go({ view: 'session', sessionId: next.sessionId })
  }

  const listWidth = isWide ? SIDEBAR : vm.width
  const sessionRow = (c: SessionCard) => {
    const mark = sessionMark(c)
    const isOn = c.sessionId === selectedId
    const state = c.state
    const side =
      state === 'waiting'
        ? clock(now - c.since)
        : state === 'running'
          ? c.toolSince !== undefined
            ? clock(now - c.toolSince)
            : clock(now - c.since)
          : isUnseen(c)
            ? t.done
            : clock(now - c.since)
    const liveAgents = c.agents.filter(a => {
      const s = agentState(a.status, a.waiting)
      return s === 'running' || s === 'waiting' || isAgentUnseen(c, a)
    })
    return (
      <Box key={`row-${c.sessionId}`} flexDirection="column">
        <Box justifyContent="space-between" columnGap={1}>
          <Box flexShrink={1}>
            <Text color={P.accent}>{isOn ? '▌' : ' '}</Text>
            <Text color={mark.color}>{`${mark.glyph} `}</Text>
            <Button
              plain
              key={`session-${c.sessionId}`}
              label={short(`${c.title || t.newSession}${c.sessionId === vm.mine ? t.here : ''}`, Math.max(12, listWidth - 14))}
              dimColor={!isOn && state !== 'waiting' && state !== 'running' && !isUnseen(c)}
              onPress={() => act.go({ view: 'session', sessionId: c.sessionId })}
            />
          </Box>
          <Text color={state === 'waiting' ? P.waiting : P.faint} wrap="truncate-end">
            {side}
          </Text>
        </Box>
        {liveAgents.slice(0, 4).map((a, i) => {
          const s = agentState(a.status, a.waiting)
          const am = markOf(s, isAgentUnseen(c, a))
          const branch = i === Math.min(liveAgents.length, 4) - 1 ? '└' : '├'
          const elapsed =
            a.startedAt === undefined ? '' : clock((s === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)
          return (
            <Box key={`row-${c.sessionId}-${a.id}`} justifyContent="space-between" columnGap={1}>
              <Box flexShrink={1}>
                <Text color={P.faint}>{`   ${branch} `}</Text>
                <Text color={am.color}>{`${am.glyph} `}</Text>
                <Button
                  plain
                  dimColor
                  key={`row-agent-${c.sessionId}-${a.id}`}
                  label={short(a.type, Math.max(8, listWidth - 18))}
                  onPress={() => act.go({ view: 'agent', sessionId: c.sessionId, agentId: a.id })}
                />
              </Box>
              <Text color={P.faint}>{s === 'ended' ? t.done : elapsed}</Text>
            </Box>
          )
        })}
        {liveAgents.length > 4 ? <Text color={P.faint}>{`     +${liveAgents.length - 4}`}</Text> : null}
      </Box>
    )
  }
  const projectRollup = (sessions: SessionCard[]) => {
    const all = sessions.map(sessionMark)
    return (
      all.find(m => m.glyph === '◆') ??
      all.find(m => m.glyph === '●') ??
      all.find(m => m.glyph === '✓') ??
      all[0] ?? { glyph: '○', color: P.dim }
    )
  }
  const list = (
    <Box key="list" flexDirection="column" width={listWidth} flexShrink={0}>
      {vm.sessions.length === 0 ? (
        <Text color={P.dim}>{t.noSessions}</Text>
      ) : shown.length === 0 ? (
        <Text color={P.dim}>{t.noMatch}</Text>
      ) : (
        projects.map(p => {
          const roll = projectRollup(p.sessions)
          return (
            <Box key={`p-${p.name}`} flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Text bold color={P.text} wrap="truncate-end">
                  {p.name}
                </Text>
                <Text color={roll.color}>{roll.glyph}</Text>
              </Box>
              {p.sessions.map(sessionRow)}
            </Box>
          )
        })
      )}
    </Box>
  )

  // ── the selected session, or agent ────────────────────────────────────
  const routed = selectedId ? vm.sessions.find(c => c.sessionId === selectedId) : undefined
  const routedAgent = route.view === 'agent' && routed ? routed.agents.find(a => a.id === route.agentId) : undefined
  const detail =
    routed && routedAgent ? agentPage(routed, routedAgent) : routed ? sessionPage(routed) : <Text color={P.faint}>{t.pickOne}</Text>

  // ── footer: keys, settings, counts ────────────────────────────────────
  const footer = (
    <Box key="footer" flexDirection="column" marginTop={1}>
      {rule()}
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Box columnGap={2} flexWrap="wrap">
          <Button plain key="next" hotkey="j" label={t.next} dimColor onPress={() => step(1)} />
          <Button plain key="previous" hotkey="k" label={t.previous} dimColor onPress={() => step(-1)} />
          {routed?.hostId ? <Button plain key="open-selected" hotkey="o" label={t.open} dimColor onPress={act.openOpened} /> : null}
          <Button plain key="refresh" hotkey="r" label={`⟳ ${t.refresh}`} dimColor onPress={act.refresh} />
          <Button plain key="set-language" hotkey="l" label={`◍ ${t.languageName}`} dimColor onPress={act.toggleLanguage} />
          <Button
            plain
            key="set-notify"
            hotkey="n"
            label={`◔ ${t.notifications} ${vm.notify ? t.on : t.off}`}
            dimColor
            onPress={act.toggleNotify}
          />
        </Box>
        <Text>
          <Text color={P.running}>{`● ${loopsRunning} `}</Text>
          <Text color={P.dim}>{t.filterName.running.toLowerCase()}</Text>
          <Text color={P.dim}>{'  ·  '}</Text>
          <Text color={P.waiting}>{`${loopsWaiting} `}</Text>
          <Text color={P.dim}>{t.filterName.waiting.toLowerCase()}</Text>
          <Text color={P.faint}>{`   v${vm.version}`}</Text>
        </Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" width={vm.width}>
      {header}
      {isWide ? (
        <Box key="body" columnGap={3} marginTop={1}>
          {list}
          <Box key="detail" flexDirection="column" width={main}>
            {detail}
          </Box>
        </Box>
      ) : (
        <Box key="body" flexDirection="column" marginTop={1}>
          {route.view === 'list' ? list : detail}
        </Box>
      )}
      {footer}
    </Box>
  )
}

/** The board as plain text: `/agent-watch text`, and wherever no pane can be drawn. */
export function drawText(vm: Pick<ViewModel, 'now' | 'sessions' | 'mine' | 't'>): string {
  const { t, now } = vm
  const counts: Record<LoopState, number> = { running: 0, waiting: 0, idle: 0, ended: 0 }
  for (const c of vm.sessions) counts[liveState(c)] += 1
  const mark: Record<LoopState, string> = { running: '●', waiting: '◆', idle: '○', ended: '×' }
  const lines = [t.textHeader(counts.running, counts.waiting, counts.idle), '']
  if (vm.sessions.length === 0) lines.push(t.noSessions)
  for (const c of vm.sessions) {
    const state = liveState(c)
    const when = c.state === 'ended' ? t.endedAgo(clock(now - c.updatedAt)) : t.since(clock(now - c.since))
    const where = c.cwd.replace(/\\/g, '/')
    lines.push(`${mark[state]} ${c.title || t.newSession}${c.sessionId === vm.mine ? t.here : ''} — ${where}   ${t.badge[state]} · ${when}`)
    if (c.state === 'waiting') lines.push(`    ${t.inputRequired}${c.waiting ? `: ${c.waiting}` : ''}`)
    else if (c.state === 'running' && c.tool) {
      const took = c.toolSince === undefined ? '' : ` · ${clock(now - c.toolSince)}`
      lines.push(`    ▸ ${c.tool}${took}`)
    }
    c.agents.forEach((a, i) => {
      const s = agentState(a.status, a.waiting)
      const branch = i === c.agents.length - 1 ? '└' : '├'
      const elapsed = a.startedAt === undefined ? '' : ` · ${clock((s === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)}`
      const activity = activityOf(a, now, t).text
      lines.push(`  ${branch} ${mark[s]} ${a.type} · ${a.label}   ${t.badge[s]}${elapsed}${activity ? `   ${activity}` : ''}`)
    })
  }
  return lines.join('\n')
}
