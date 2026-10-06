/** Where a loop stands, as the panel shows it. */
export type LoopState = 'running' | 'waiting' | 'idle' | 'ended'

/** One subagent or teammate of a session. */
export type AgentCard = {
  id: string
  label: string
  type: string
  status: string
  tool?: string
  waiting?: string
  parentId?: string
}

/** What one session writes to the shared folder, and the panel reads back. */
export type SessionCard = {
  sessionId: string
  cwd: string
  title: string
  state: LoopState
  waiting?: string
  tool?: string
  since: number
  updatedAt: number
  agents: AgentCard[]
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
    'agent-watch': { self: SelfStatus; board: Board }
  }
}
