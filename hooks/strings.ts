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
  back: string
  openInApp: string
  open: string
  folder: string
  stateLabel: string
  duration: string
  waitingReason: string
  currentTool: string
  sessionId: string
  agentsTitle: (n: number) => string
  task: string
  lastTools: string
  lastAnswer: string
  loading: string
  nothingYet: string
  unreadable: string
  hint: string
  conversation: string
  you: string
  claude: string
  recentTools: string
  readingConvo: string
  noConvo: string
  notifyTitle: string
  silentFor: (ago: string) => string
  tokensOut: (n: string) => string
  tokensCtx: (n: string) => string
  textHeader: (running: number, waiting: number, idle: number) => string
  done: string
  word: { blocked: string; working: string; done: string; idle: string; ended: string }
  agentsHeader: string
  working: string
  sessionsTitle: string
  keys: string
  next: string
  previous: string
  pickOne: string
  thisSession: string
  opening: (title: string) => string
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
    footerRefresh: 'Auto refresh: 1s',
    footerNotifications: isOn => `Notifications: ${isOn ? 'enabled' : 'disabled'}`,
    back: '← Back',
    openInApp: 'Open in the app ↗',
    open: 'Open ↗',
    folder: 'Folder',
    stateLabel: 'State',
    duration: 'For',
    waitingReason: 'Waiting on',
    currentTool: 'Doing',
    sessionId: 'Session',
    agentsTitle: n => `SUBAGENTS · ${n}`,
    task: 'TASK',
    lastTools: 'LAST TOOL CALLS',
    lastAnswer: 'LAST WORDS',
    loading: 'Reading its transcript…',
    nothingYet: 'Nothing yet.',
    unreadable: 'Its transcript could not be read.',
    hint: 'Click a session for its details, an agent for its activity.',
    conversation: 'CONVERSATION',
    you: 'You',
    claude: 'Claude',
    recentTools: 'RECENT TOOL CALLS',
    readingConvo: 'Reading the conversation…',
    noConvo: 'No conversation yet.',
    notifyTitle: 'A Claude session is waiting for you',
    silentFor: ago => `silent for ${ago}`,
    tokensOut: n => `${n} out`,
    tokensCtx: n => `ctx ${n}`,
    textHeader: (r, w, i) => `Agent Watch — ${r} running · ${w} waiting · ${i} idle`,
    done: 'DONE',
    word: { blocked: 'blocked', working: 'working', done: 'done', idle: 'idle', ended: 'ended' },
    agentsHeader: 'agents',
    working: 'Working…',
    sessionsTitle: 'SESSIONS',
    keys: 'click or j/k to move · o open in the app · b back',
    next: 'j ↓',
    previous: 'k ↑',
    pickOne: 'Pick a session on the left.',
    thisSession: 'this session',
    opening: title => `Opening “${title}” in the app…`,
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
    footerRefresh: 'Actualisation : 1 s',
    footerNotifications: isOn => `Notifications : ${isOn ? 'activées' : 'désactivées'}`,
    back: '← Retour',
    openInApp: 'Ouvrir dans l’app ↗',
    open: 'Ouvrir ↗',
    folder: 'Dossier',
    stateLabel: 'État',
    duration: 'Depuis',
    waitingReason: 'Attend',
    currentTool: 'En train de',
    sessionId: 'Session',
    agentsTitle: n => `SOUS-AGENTS · ${n}`,
    task: 'TÂCHE',
    lastTools: 'DERNIERS OUTILS',
    lastAnswer: 'DERNIERS MOTS',
    loading: 'Lecture du transcript…',
    nothingYet: 'Rien pour l’instant.',
    unreadable: 'Impossible de lire son transcript.',
    hint: 'Clique une session pour ses détails, un agent pour son activité.',
    conversation: 'CONVERSATION',
    you: 'Toi',
    claude: 'Claude',
    recentTools: 'DERNIERS OUTILS',
    readingConvo: 'Lecture de la conversation…',
    noConvo: 'Pas encore de conversation.',
    notifyTitle: 'Une session Claude attend ta réponse',
    silentFor: ago => `silencieux depuis ${ago}`,
    tokensOut: n => `${n} générés`,
    tokensCtx: n => `ctx ${n}`,
    textHeader: (r, w, i) => `Agent Watch — ${r} en cours · ${w} en attente · ${i} inactifs`,
    done: 'FINI',
    word: { blocked: 'bloquée', working: 'en cours', done: 'finie', idle: 'inactive', ended: 'terminée' },
    agentsHeader: 'agents',
    working: 'Au travail…',
    sessionsTitle: 'SESSIONS',
    keys: 'clic ou j/k pour naviguer · o ouvrir dans l’app · b retour',
    next: 'j ↓',
    previous: 'k ↑',
    pickOne: 'Choisis une session à gauche.',
    thisSession: 'cette session',
    opening: title => `Ouverture de « ${title} » dans l’app…`,
  },
}
