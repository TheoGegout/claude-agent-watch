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
  /** When its transcript last changed. */
  lastActivity?: number
  /** When the tool call it is in started. */
  toolSince?: number
  /** Its tokens: generated (when the whole transcript was read) and its context's size. */
  tokens?: Tokens
}

/** What a loop's requests cost: `out` generated in all, `ctx` the last request's input. */
export type Tokens = { out?: number; ctx?: number }

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
  /** When the main loop's tool call started, where the session reports it. */
  toolSince?: number
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

/** A session's conversation, read from the end of its transcript. */
export type SessionConvo = {
  sessionId: string
  isLoading: boolean
  /** The person's last message, and when. */
  prompt?: string
  promptAt?: string
  /** Claude's last words, and when. */
  answer?: string
  answerAt?: string
  /** Its last tool calls, newest last. */
  tools: { name: string; detail: string; at?: string }[]
  error?: string
}

/** This session's own loop, kept across reloads. */
export type SelfStatus = {
  title: string
  state: LoopState
  waiting?: string
  tool?: string
  toolSince?: number
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
      convo: SessionConvo | null
      /** When each session was last looked at, to tell a finished one you have not seen. */
      seen: Record<string, number>
    }
  }
}
