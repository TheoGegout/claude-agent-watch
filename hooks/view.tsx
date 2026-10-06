import type { Elements } from 'claude-code'

import type { AgentCard, Filter, LoopState, SessionCard } from '../types'
import type { Strings } from './strings'

export type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

/** What the pane draws from, gathered by the render hook. */
export type ViewModel = {
  now: number
  sessions: SessionCard[]
  filter: Filter
  collapsed: string[]
  mine: string
  home: string
  width: number
  t: Strings
  version: string
  notify: boolean
  statusLine: boolean
}

/** What the pane's controls do. */
export type Actions = {
  setFilter: (filter: Filter) => void
  toggle: (sessionId: string) => void
  refresh: () => void
  toggleLanguage: () => void
  toggleNotify: () => void
  toggleStatusLine: () => void
}

export const COLOR: Record<LoopState, string> = {
  running: 'success',
  waiting: 'warning',
  idle: 'inactive',
  ended: 'error',
}

const RANK: Record<LoopState, number> = { waiting: 0, running: 1, idle: 2, ended: 3 }
const FILTERS: Filter[] = ['all', 'running', 'waiting', 'idle', 'ended']
const SIDEBAR = 32
// The pane is wide enough for the sidebar beside the cards from here.
const WIDE = 104

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

const short = (text: string, max: number) => {
  const line = text.replace(/\s+/g, ' ').trim()
  return max > 1 && line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const prettyPath = (path: string, home: string) => {
  const p = path.replace(/\\/g, '/').replace(/\/$/, '')
  return home && p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p
}

export function drawBoard(el: Kit, vm: ViewModel, act: Actions) {
  const { Box, Text, Button } = el
  const { t, now } = vm
  const isWide = vm.width >= WIDE
  const main = isWide ? vm.width - SIDEBAR - 2 : vm.width

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
  const shown = vm.sessions.filter(c => vm.filter === 'all' || liveState(c) === vm.filter)

  const badge = (state: LoopState, label: string) => (
    <Text color={COLOR[state]} inverse>
      {` ${label} `}
    </Text>
  )
  const rule = (width: number) => <Text dimColor>{'─'.repeat(Math.max(0, width))}</Text>

  // ── header ────────────────────────────────────────────────────────────
  const tally = (
    <Box gap={2} flexWrap="wrap">
      {(['running', 'waiting', 'idle', 'ended'] as const).map(s => (
        <Text key={`n-${s}`}>
          <Text color={COLOR[s]}>{s === 'ended' ? '■' : '●'}</Text>
          <Text color={s === 'running' || s === 'waiting' ? COLOR[s] : undefined} dimColor={counts[s] === 0}>
            {` ${counts[s]} ${t.state[s] === t.state.waiting ? t.badge.waiting.toLowerCase() : t.state[s]}`}
          </Text>
        </Text>
      ))}
      <Text dimColor>{`⟳ ${t.autoRefresh} 3s`}</Text>
    </Box>
  )
  const header = (
    <Box key="header" flexDirection="column">
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Box flexDirection="column">
          <Text>
            <Text color="claude">◉ </Text>
            <Text bold>AGENT WATCH</Text>
          </Text>
          <Text dimColor>{`  ${t.subtitle}`}</Text>
        </Box>
        {tally}
      </Box>
      {rule(vm.width)}
    </Box>
  )

  // ── one agent ─────────────────────────────────────────────────────────
  const agentRow = (a: AgentCard, width: number) => {
    const state = agentState(a.status, a.waiting)
    const elapsed =
      a.startedAt === undefined
        ? ''
        : clock((state === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)
    const activity = state === 'ended' ? undefined : (a.waiting ?? a.tool)
    const name = short(`${a.type} · ${a.label}`, Math.max(80, width))
    return (
      <Box key={a.id} flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color={COLOR[state]}>● </Text>
            {name}
          </Text>
          <Box gap={1}>
            {badge(state, t.badge[state])}
            <Text dimColor>{elapsed.padStart(7)}</Text>
          </Box>
        </Box>
        {activity && (
          <Text dimColor wrap="truncate-end">
            {`  ▸ ${activity}`}
          </Text>
        )}
      </Box>
    )
  }

  // ── one session ───────────────────────────────────────────────────────
  const card = (c: SessionCard) => {
    const state = liveState(c)
    const isMine = c.sessionId === vm.mine
    const isFolded = vm.collapsed.includes(c.sessionId)
    const when = c.state === 'ended' ? t.endedAgo(clock(now - c.updatedAt)) : t.since(clock(now - c.since))
    const inner = main - 4
    const isSplit = inner >= 84 && c.agents.length > 0 && !isFolded
    const left = isSplit ? Math.floor(inner * 0.42) : inner
    const right = inner - left - 2

    const about = (
      <Box flexDirection="column" width={isSplit ? left : undefined}>
        {c.state === 'waiting' ? (
          <Box borderStyle="round" borderColor="warning" paddingX={1} flexDirection="column">
            <Text color="warning" bold wrap="truncate-end">
              {`⚠ ${t.inputRequired}`}
            </Text>
            <Text dimColor wrap="truncate-end">
              {c.waiting ? `${c.waiting} · ${t.waitingForYourResponse}` : t.waitingForYourResponse}
            </Text>
          </Box>
        ) : c.state === 'running' ? (
          <Text wrap="truncate-end">
            <Text color="success">▸ </Text>
            <Text dimColor>{c.tool ?? t.state.running}</Text>
          </Text>
        ) : c.state === 'idle' ? (
          <Text dimColor wrap="truncate-end">
            {`○ ${t.waitingForNextMessage}`}
          </Text>
        ) : (
          <Text dimColor wrap="truncate-end">
            {`× ${t.lastSeen(clock(now - c.updatedAt))}`}
          </Text>
        )}
      </Box>
    )

    const agents =
      c.agents.length === 0 || isFolded ? null : (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="inactive"
          paddingX={1}
          width={isSplit ? right : undefined}
          marginTop={isSplit ? 0 : 1}
        >
          {c.agents.map(a => agentRow(a, (isSplit ? right : inner) - 4))}
        </Box>
      )

    return (
      <Box
        key={`s-${c.sessionId}`}
        flexDirection="column"
        borderStyle="round"
        borderColor={state === 'waiting' ? 'warning' : 'inactive'}
        paddingX={1}
        marginBottom={1}
      >
        <Box justifyContent="space-between" columnGap={2}>
          <Text wrap="truncate-end">
            <Text color={COLOR[state]}>● </Text>
            <Text bold>{short(c.title || t.newSession, Math.max(12, inner - 46))}</Text>
            {isMine ? <Text dimColor>{t.here}</Text> : ''}
            {'  '}
            {badge(state, t.badge[state])}
          </Text>
          <Box gap={2}>
            <Text dimColor>{when}</Text>
            {c.agents.length > 0 && (
              <Button
                plain
                key={`fold-${c.sessionId}`}
                label={isFolded ? `▾ ${c.agents.length}` : '▴'}
                dimColor
                onPress={() => act.toggle(c.sessionId)}
              />
            )}
          </Box>
        </Box>
        <Text dimColor wrap="truncate-start">
          {`▢ ${prettyPath(c.cwd, vm.home)}`}
        </Text>
        <Box flexDirection={isSplit ? 'row' : 'column'} columnGap={2} marginTop={1}>
          {about}
          {agents}
        </Box>
      </Box>
    )
  }

  const list = (
    <Box key="list" flexDirection="column" width={main}>
      {vm.sessions.length === 0 ? (
        <Text dimColor>{t.noSessions}</Text>
      ) : shown.length === 0 ? (
        <Text dimColor>{t.noMatch}</Text>
      ) : (
        shown.map(card)
      )}
    </Box>
  )

  // ── sidebar ───────────────────────────────────────────────────────────
  const filterName = (f: Filter) => (f === 'all' ? t.allSessions : t.filterName[f])
  const filterRow = (f: Filter, i: number) => {
    const isOn = vm.filter === f
    const n = f === 'all' ? vm.sessions.length : counts[f]
    return (
      <Box key={`f-${f}`} justifyContent="space-between">
        <Box>
          <Text color="claude">{isOn ? '▌' : ' '}</Text>
          <Text color={f === 'all' ? 'claude' : COLOR[f]}>{f === 'all' ? '▣ ' : '● '}</Text>
          <Button plain key={`filter-${f}`} hotkey={String(i + 1)} label={filterName(f)} dimColor={!isOn} onPress={() => act.setFilter(f)} />
        </Box>
        <Text dimColor={!isOn} bold={isOn}>
          {String(n)}
        </Text>
      </Box>
    )
  }
  const setting = (key: string, icon: string, label: string, value: string, hotkey: string, onPress: () => void) => (
    <Box key={key} justifyContent="space-between">
      <Text>{`${icon} ${label}`}</Text>
      <Button plain key={key} hotkey={hotkey} label={`${value} ›`} onPress={onPress} />
    </Box>
  )
  const shortcut = (keys: string, label: string) => (
    <Text key={`k-${keys}`}>
      <Text inverse>{` ${keys} `}</Text>
      <Text dimColor>{` ${label}`}</Text>
    </Text>
  )
  const sidebar = (
    <Box key="side" flexDirection="column" width={SIDEBAR} gap={1}>
      <Box flexDirection="column">
        <Text dimColor bold>
          {t.filters}
        </Text>
        {FILTERS.map(filterRow)}
      </Box>
      <Box flexDirection="column">
        <Text dimColor bold>
          {t.settings}
        </Text>
        {setting('set-language', '◍', t.language, t.languageName, 'l', act.toggleLanguage)}
        {setting('set-notify', '◔', t.notifications, vm.notify ? t.on : t.off, 'n', act.toggleNotify)}
        {setting('set-status', '≡', t.statusLine, vm.statusLine ? t.on : t.off, 's', act.toggleStatusLine)}
      </Box>
      <Box flexDirection="column">
        <Text dimColor bold>
          {t.shortcuts}
        </Text>
        <Button plain key="refresh" hotkey="r" label={t.refresh} onPress={act.refresh} />
        {shortcut('1-5', t.filterKeys)}
        {shortcut('ctrl+x tab', t.focusKeys)}
        {shortcut('esc', t.closeKeys)}
      </Box>
      <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
        <Text bold>ⓘ Agent Watch</Text>
        <Text dimColor>{`v${vm.version}`}</Text>
        <Text dimColor>{t.openSource}</Text>
        <Text color="claude" wrap="truncate-end">
          github.com/TheoGegout/claude-agent-watch
        </Text>
      </Box>
    </Box>
  )

  // Narrow: the filters as one row under the header, no sidebar.
  const filterBar = (
    <Box key="filters" flexWrap="wrap" columnGap={2} marginBottom={1}>
      {FILTERS.map((f, i) => (
        <Box key={`fb-${f}`}>
          <Text color={f === 'all' ? 'claude' : COLOR[f]}>{vm.filter === f ? '▌' : ' '}</Text>
          <Button
            plain
            key={`filter-${f}`}
            hotkey={String(i + 1)}
            label={`${filterName(f)} ${f === 'all' ? vm.sessions.length : counts[f]}`}
            dimColor={vm.filter !== f}
            onPress={() => act.setFilter(f)}
          />
        </Box>
      ))}
      <Button plain key="refresh" hotkey="r" label={`⟳ ${t.refresh}`} dimColor onPress={act.refresh} />
    </Box>
  )

  // ── footer ────────────────────────────────────────────────────────────
  const footer = (
    <Box key="footer" flexDirection="column">
      {rule(vm.width)}
      <Box justifyContent="space-between" flexWrap="wrap" columnGap={2}>
        <Text dimColor>
          <Text color="success">● </Text>
          {`${t.footerRefresh}  │  ◔ ${t.footerNotifications(vm.notify)}`}
        </Text>
        <Text>
          <Text color="success">{`● ${loopsRunning} `}</Text>
          <Text dimColor>{t.state.running}</Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color="warning">{`${loopsWaiting} `}</Text>
          <Text dimColor>{t.badge.waiting.toLowerCase()}</Text>
        </Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column" width={vm.width}>
      {header}
      {isWide ? (
        <Box key="body" columnGap={2}>
          {list}
          {sidebar}
        </Box>
      ) : (
        <Box key="body" flexDirection="column">
          {filterBar}
          {list}
        </Box>
      )}
      {footer}
    </Box>
  )
}
