import type { LoopState } from '../types'

/** Every word the mod shows, per language. */
export type Strings = {
  state: Record<LoopState, string>
  question: string
  planApproval: string
  permission: (tool: string) => string
  waitingFallback: string
  quietFor: (ago: string) => string
  idleFor: (ago: string) => string
  lastSeen: (ago: string) => string
  newSession: string
  here: string
  noSessions: string
  isWaitingForYou: (who: string) => string
  statusRunning: (n: number) => string
  statusWaiting: (n: number) => string
  commandDescription: string
  paneOpened: string
  paneTitle: string
}

export const STRINGS: Record<'en' | 'fr', Strings> = {
  en: {
    state: { running: 'running', waiting: 'waiting for you', idle: 'idle', ended: 'ended' },
    question: 'question',
    planApproval: 'plan approval',
    permission: tool => `permission ${tool}`,
    waitingFallback: 'waiting',
    quietFor: ago => `quiet for ${ago}`,
    idleFor: ago => `waiting for your message for ${ago}`,
    lastSeen: ago => `last seen ${ago} ago`,
    newSession: 'new session',
    here: ' (here)',
    noSessions: 'No sessions found.',
    isWaitingForYou: who => `${who} is waiting for you`,
    statusRunning: n => `▶ ${n} running`,
    statusWaiting: n => `◆ ${n} waiting`,
    commandDescription: 'Open the panel of every session and subagent, running or waiting',
    paneOpened: 'Agent Watch opened.',
    paneTitle: 'Agents',
  },
  fr: {
    state: { running: 'en cours', waiting: 'attend ta réponse', idle: 'inactif', ended: 'terminé' },
    question: 'question',
    planApproval: 'validation du plan',
    permission: tool => `permission ${tool}`,
    waitingFallback: 'en attente',
    quietFor: ago => `silencieux depuis ${ago}`,
    idleFor: ago => `attend ton message depuis ${ago}`,
    lastSeen: ago => `vu il y a ${ago}`,
    newSession: 'nouvelle session',
    here: ' (ici)',
    noSessions: 'Aucune session trouvée.',
    isWaitingForYou: who => `${who} attend ta réponse`,
    statusRunning: n => `▶ ${n} en cours`,
    statusWaiting: n => `◆ ${n} en attente`,
    commandDescription: 'Ouvre le panneau de toutes les sessions et sous-agents, en cours ou en attente',
    paneOpened: 'Agent Watch ouvert.',
    paneTitle: 'Agents',
  },
}
