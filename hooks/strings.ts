import type { LoopState } from '../types'

/** Every word the mod shows, per language. */
export type Strings = {
  state: Record<LoopState, string>
  badge: Record<LoopState, string>
  filterName: Record<LoopState, string>
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
  noMatch: string
  isWaitingForYou: (who: string) => string
  statusRunning: (n: number) => string
  statusWaiting: (n: number) => string
  commandDescription: string
  paneOpened: string
  paneTitle: string
  subtitle: string
  autoRefresh: string
  since: (ago: string) => string
  endedAgo: (ago: string) => string
  inputRequired: string
  waitingForYourResponse: string
  waitingForNextMessage: string
  noAgents: string
  filters: string
  allSessions: string
  settings: string
  language: string
  languageName: string
  notifications: string
  statusLine: string
  on: string
  off: string
  shortcuts: string
  refresh: string
  filterKeys: string
  focusKeys: string
  closeKeys: string
  openSource: string
  footerRefresh: string
  footerNotifications: (isOn: boolean) => string
}

export const STRINGS: Record<'en' | 'fr', Strings> = {
  en: {
    state: { running: 'running', waiting: 'waiting for you', idle: 'idle', ended: 'ended' },
    badge: { running: 'RUNNING', waiting: 'WAITING', idle: 'IDLE', ended: 'ENDED' },
    filterName: { running: 'Running', waiting: 'Waiting', idle: 'Idle', ended: 'Ended' },
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
    noMatch: 'No session matches this filter.',
    isWaitingForYou: who => `${who} is waiting for you`,
    statusRunning: n => `▶ ${n} running`,
    statusWaiting: n => `◆ ${n} waiting`,
    commandDescription: 'Open the panel of every session and subagent, running or waiting',
    paneOpened: 'Agent Watch opened.',
    paneTitle: 'Agent Watch',
    subtitle: 'Monitor your Claude Code agents in real time',
    autoRefresh: 'Auto refresh',
    since: ago => `since ${ago}`,
    endedAgo: ago => `ended ${ago} ago`,
    inputRequired: 'Permission / input required',
    waitingForYourResponse: 'Claude is waiting for your response',
    waitingForNextMessage: 'Turn over, waiting for your next message',
    noAgents: 'No subagents',
    filters: 'FILTERS',
    allSessions: 'All sessions',
    settings: 'SETTINGS',
    language: 'Language',
    languageName: 'English',
    notifications: 'Notifications',
    statusLine: 'Status line',
    on: 'On',
    off: 'Off',
    shortcuts: 'SHORTCUTS',
    refresh: 'Refresh',
    filterKeys: 'Filters',
    focusKeys: 'Focus the pane',
    closeKeys: 'Close',
    openSource: 'Open source · MIT License',
    footerRefresh: 'Auto refresh: 3s',
    footerNotifications: isOn => `Notifications: ${isOn ? 'enabled' : 'disabled'}`,
  },
  fr: {
    state: { running: 'en cours', waiting: 'attend ta réponse', idle: 'inactif', ended: 'terminé' },
    badge: { running: 'EN COURS', waiting: 'EN ATTENTE', idle: 'INACTIF', ended: 'TERMINÉ' },
    filterName: { running: 'En cours', waiting: 'En attente', idle: 'Inactif', ended: 'Terminé' },
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
    noMatch: 'Aucune session pour ce filtre.',
    isWaitingForYou: who => `${who} attend ta réponse`,
    statusRunning: n => `▶ ${n} en cours`,
    statusWaiting: n => `◆ ${n} en attente`,
    commandDescription: 'Ouvre le panneau de toutes les sessions et sous-agents, en cours ou en attente',
    paneOpened: 'Agent Watch ouvert.',
    paneTitle: 'Agent Watch',
    subtitle: 'Surveille tes agents Claude Code en temps réel',
    autoRefresh: 'Actualisation',
    since: ago => `depuis ${ago}`,
    endedAgo: ago => `terminé il y a ${ago}`,
    inputRequired: 'Permission / réponse requise',
    waitingForYourResponse: 'Claude attend ta réponse',
    waitingForNextMessage: 'Tour terminé, attend ton prochain message',
    noAgents: 'Aucun sous-agent',
    filters: 'FILTRES',
    allSessions: 'Toutes les sessions',
    settings: 'RÉGLAGES',
    language: 'Langue',
    languageName: 'Français',
    notifications: 'Notifications',
    statusLine: 'Ligne d’état',
    on: 'Oui',
    off: 'Non',
    shortcuts: 'RACCOURCIS',
    refresh: 'Actualiser',
    filterKeys: 'Filtres',
    focusKeys: 'Activer le panneau',
    closeKeys: 'Fermer',
    openSource: 'Open source · Licence MIT',
    footerRefresh: 'Actualisation : 3 s',
    footerNotifications: isOn => `Notifications : ${isOn ? 'activées' : 'désactivées'}`,
  },
}
