/** Where a loop stands, as the panel shows it. */
export type LoopState = 'running' | 'waiting' | 'idle' | 'ended'

/** Which sessions the pane lists. */
export type Filter = 'all' | LoopState

/** Which page of the pane is shown. */
export type Route =
  | { view: 'list' }
  | { view: 'session'; sessionId: string }
  | { view: 'agent'; sessionId: string; agentId: string }

/** One subagent or teammate of a session. */
export type AgentCard = {
  id: string
  label: string
  type: string
  status: string
  tool?: string
  waiting?: string
  parentId?: string
  /** When it was spawned, when known. */
  startedAt?: number
  /** When it last wrote, for one that ended. */
  endedAt?: number
}

/** What one session writes to the shared folder, and the panel reads back. */
export type SessionCard = {
  sessionId: string
  /** The desktop app's id of the session (`local_…`), which a deep link opens. */
  hostId?: string
  cwd: string
  title: string
  state: LoopState
  waiting?: string
  tool?: string
  since: number
  startedAt?: number
  updatedAt: number
  agents: AgentCard[]
}

/** A subagent's transcript, read when its page opens. */
export type AgentDetail = {
  agentId: string
  isLoading: boolean
  /** Its task as it was given, cut short. */
  prompt?: string
  /** Its last tool calls, newest last. */
  tools: { name: string; detail: string; at?: string }[]
  /** Its last words. */
  answer?: string
  error?: string
}

/** This session's own loop, kept across reloads. */
export type SelfStatus = {
  title: string
  state: LoopState
  waiting?: string
  tool?: string
  since: number
  agentTools: Record<string, string>
  agentWaiting: Record<string, string>
}

/** What the panel draws: every live session, read on the last tick. */
export type Board = { now: number; sessions: SessionCard[] }

declare module 'claude-code' {
  interface PluginState {
    'agent-watch': {
      self: SelfStatus
      board: Board
      filter: Filter
      collapsed: string[]
      route: Route
      detail: AgentDetail | null
    }
  }
}
