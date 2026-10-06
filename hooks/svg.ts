import type { AgentCard, Filter, LoopState, SessionCard } from '../types'
import type { ViewModel } from './view'
import { agentState, clock, liveState } from './view'

// The dashboard as one SVG document, for the surfaces that draw one (desktop,
// VS Code, mobile): its own dark palette and monospace type, sized to the pane.

const C = {
  bg: '#0e1117',
  panel: '#131720',
  card: '#151a23',
  line: '#262c38',
  lineSoft: '#1e2430',
  text: '#e6e9ef',
  dim: '#8c94a3',
  faint: '#5d6574',
  accent: '#d97757',
}
const STATE: Record<LoopState, string> = {
  running: '#3fb950',
  waiting: '#f0a020',
  idle: '#8c94a3',
  ended: '#f85149',
}
const FONT = `'JetBrains Mono','Cascadia Code','SF Mono',Consolas,Menlo,monospace`
const CHAR = 0.6 // a monospace glyph's width, in ems

const PAD = 24
const SIDE = 300
const GAP = 16

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `text` cut to fit `px` at `size`, with an ellipsis. */
const fit = (text: string, px: number, size: number) => {
  const max = Math.max(1, Math.floor(px / (size * CHAR)))
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, Math.max(1, max - 1))}…` : line
}
const textWidth = (text: string, size: number) => text.length * size * CHAR

type Attrs = { size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end'; spacing?: number }
const T = (x: number, y: number, s: string, a: Attrs = {}) =>
  `<text x="${x}" y="${y}" font-size="${a.size ?? 14}" fill="${a.fill ?? C.text}"${a.weight ? ` font-weight="${a.weight}"` : ''}${
    a.anchor && a.anchor !== 'start' ? ` text-anchor="${a.anchor}"` : ''
  }${a.spacing ? ` letter-spacing="${a.spacing}"` : ''}>${esc(s)}</text>`
const R = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, extra = '') =>
  `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}${extra}/>`
const dot = (x: number, y: number, r: number, color: string) =>
  `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/><circle cx="${x}" cy="${y}" r="${r + 3}" fill="${color}" opacity="0.18"/>`
const hline = (x1: number, x2: number, y: number, color = C.line) =>
  `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}"/>`

/** A tinted pill with its label; returns the markup and its width. */
const badge = (x: number, y: number, label: string, color: string, size = 11) => {
  const w = textWidth(label, size) + 14
  return {
    w,
    svg:
      R(x, y - size - 4, w, size + 9, 4, color, color, ' fill-opacity="0.14" stroke-opacity="0.45"') +
      T(x + 7, y, label, { size, fill: color, spacing: 0.5 }),
  }
}
const chip = (x: number, y: number, label: string, size = 12) => {
  const w = textWidth(label, size) + 16
  return { w, svg: R(x, y - size - 5, w, size + 11, 5, C.lineSoft, C.line) + T(x + 8, y, label, { size, fill: C.dim }) }
}

const ICON = {
  eye: (x: number, y: number) =>
    `<g transform="translate(${x},${y})" fill="none" stroke="${C.text}" stroke-width="2.2" stroke-linecap="round"><path d="M1 12 C5 4 11 2 16 2 S27 4 31 12 C27 20 21 22 16 22 S5 20 1 12 Z"/><circle cx="16" cy="12" r="5"/></g>`,
  folder: (x: number, y: number) =>
    `<path transform="translate(${x},${y})" d="M0 2 h5 l2 2 h7 v8 h-14 Z" fill="none" stroke="${C.dim}" stroke-width="1.3" stroke-linejoin="round"/>`,
  refresh: (x: number, y: number, color = C.dim) =>
    `<g transform="translate(${x},${y})" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round"><path d="M12 5 A6 6 0 1 0 13 9"/><path d="M12 1 v4 h-4"/></g>`,
  chevron: (x: number, y: number) =>
    `<path transform="translate(${x},${y})" d="M0 0 l4 4 l-4 4" fill="none" stroke="${C.dim}" stroke-width="1.5" stroke-linecap="round"/>`,
}

/** One subagent row inside a card's agent box; returns markup and height. */
function agentRow(a: AgentCard, x: number, y: number, w: number, now: number, t: ViewModel['t']) {
  const state = agentState(a.status, a.waiting)
  const activity = state === 'ended' ? undefined : (a.waiting ?? a.tool)
  const h = activity ? 48 : 36
  const elapsed =
    a.startedAt === undefined ? '' : clock((state === 'ended' ? (a.endedAt ?? now) : now) - a.startedAt)
  const label = t.badge[state] === 'WAITING' || t.badge[state] === 'EN ATTENTE' ? t.filterName.waiting : t.filterName[state]
  const badgeX = x + w - 74 - textWidth(label, 11) - 14
  let svg = dot(x + 12, y + 18, 4.5, STATE[state])
  svg += T(x + 28, y + 23, fit(`${a.type} · ${a.label}`, badgeX - x - 40, 13), { size: 13 })
  svg += badge(badgeX, y + 22, label, STATE[state]).svg
  svg += T(x + w - 10, y + 23, elapsed, { size: 12, fill: C.dim, anchor: 'end' })
  if (activity) svg += T(x + 28, y + 40, fit(`▸ ${activity}`, w - 40, 11), { size: 11, fill: C.faint })
  return { svg, h }
}

/** One session card; returns markup and height. */
function card(c: SessionCard, x: number, y: number, w: number, vm: ViewModel) {
  const { t, now } = vm
  const state = liveState(c)
  const color = STATE[state]
  const isMine = c.sessionId === vm.mine
  const isSplit = w >= 720 && c.agents.length > 0
  const leftW = isSplit ? Math.floor(w * 0.5) - 24 : w - 40
  const path = c.cwd.replace(/\\/g, '/').replace(/\/$/, '') || c.cwd
  const when = c.state === 'ended' ? t.endedAgo(clock(now - c.updatedAt)) : t.since(clock(now - c.since))
  const folderName = (path.split('/').filter(Boolean).at(-1) ?? path).toUpperCase()

  let svg = ''
  // head: dot, folder in capitals, badge; on the right, since and the path
  svg += dot(x + 26, y + 28, 6, color)
  const head = fit(folderName, Math.min(leftW - 120, 320), 15)
  svg += T(x + 44, y + 33, head, { size: 15, weight: 700, spacing: 1 })
  svg += badge(x + 44 + textWidth(head, 15) + 14, y + 32, t.badge[state], color).svg

  const rightEdge = x + w - 20
  const pathText = fit(path, isSplit ? w * 0.5 - 150 : Math.max(60, w - 360), 12)
  const pathW = textWidth(pathText, 12)
  if (w >= 460) {
    svg += T(rightEdge, y + 32, pathText, { size: 12, fill: C.dim, anchor: 'end' })
    svg += ICON.folder(rightEdge - pathW - 22, y + 21)
    svg += T(rightEdge - pathW - 36, y + 32, when, { size: 12, fill: C.dim, anchor: 'end' })
  }

  // title, then chips
  let ly = y + 64
  svg += T(x + 22, ly, fit(c.title || t.newSession, leftW, 15), { size: 15 })
  if (w < 460) {
    ly += 22
    svg += T(x + 22, ly, fit(`${when} · ${path}`, leftW, 12), { size: 12, fill: C.dim })
  }
  ly += 30
  let cx = x + 22
  for (const label of [
    '◈ Claude',
    ...(isMine ? [t.here.trim().replace(/[()]/g, '')] : []),
    ...(c.state === 'running' && c.tool ? [fit(c.tool, Math.max(80, leftW - 160), 12)] : []),
    ...(c.agents.length > 0 ? [`${c.agents.length} agent${c.agents.length > 1 ? 's' : ''}`] : []),
  ]) {
    const one = chip(cx, ly, label)
    if (cx + one.w > x + 22 + leftW) break
    svg += one.svg
    cx += one.w + 10
  }
  ly += 18

  // the callout when it waits for the person; a quiet line when idle
  if (c.state === 'waiting') {
    const bw = leftW
    svg += R(x + 20, ly, bw, 58, 6, STATE.waiting, STATE.waiting, ' fill-opacity="0.08" stroke-opacity="0.55"')
    svg += `<circle cx="${x + 40}" cy="${ly + 21}" r="8" fill="${STATE.waiting}" opacity="0.9"/>`
    svg += T(x + 40, ly + 25, '!', { size: 12, fill: C.bg, weight: 700, anchor: 'middle' })
    svg += T(x + 56, ly + 25, fit(t.inputRequired, bw - 50, 13), { size: 13, fill: STATE.waiting, weight: 600 })
    svg += T(
      x + 56,
      ly + 44,
      fit(c.waiting ? `${c.waiting} · ${t.waitingForYourResponse}` : `${t.waitingForYourResponse}…`, bw - 50, 12),
      { size: 12, fill: C.dim },
    )
    ly += 58 + 4
  } else if (c.state === 'idle' && c.agents.length === 0) {
    svg += T(x + 22, ly + 12, fit(t.waitingForNextMessage, leftW, 12), { size: 12, fill: C.faint })
    ly += 18
  }
  let bottom = ly + 18

  // the agent box: beside the text when wide, under it otherwise
  if (c.agents.length > 0) {
    const bx = isSplit ? x + Math.floor(w * 0.5) : x + 20
    const bw = isSplit ? w - Math.floor(w * 0.5) - 20 : w - 40
    let by = isSplit ? y + 50 : ly + 4
    const rows = c.agents.map(a => {
      const row = agentRow(a, bx + 6, by + 6, bw - 12, now, t)
      by += row.h
      return row
    })
    const boxH = rows.reduce((sum, r) => sum + r.h, 0) + 12
    const top = by - boxH + 12
    svg += R(bx, top - 6, bw, boxH, 6, C.bg, C.lineSoft)
    let ry = top
    rows.forEach((r, i) => {
      if (i > 0) svg += hline(bx + 10, bx + bw - 10, ry, C.lineSoft)
      ry += r.h
    })
    svg += rows.map(r => r.svg).join('')
    bottom = Math.max(bottom, top - 6 + boxH + 18)
  }

  const h = bottom - y
  const frame =
    state === 'waiting'
      ? R(x, y, w, h, 8, C.card, STATE.waiting, ' stroke-width="1.5"') +
        `<rect x="${x}" y="${y + 8}" width="3" height="${h - 16}" fill="${STATE.waiting}"/>`
      : R(x, y, w, h, 8, C.card, C.line)
  return { svg: frame + svg, h }
}

function sidebar(x: number, y: number, vm: ViewModel, counts: Record<LoopState, number>) {
  const { t } = vm
  let svg = ''
  let cy = y + 30
  const section = (title: string) => {
    svg += T(x, cy, title, { size: 12, fill: C.dim, spacing: 1.5 })
    cy += 16
  }

  section(t.filters)
  const filters: Filter[] = ['all', 'running', 'waiting', 'idle', 'ended']
  filters.forEach((f, i) => {
    const isOn = vm.filter === f
    const n = f === 'all' ? vm.sessions.length : counts[f]
    if (isOn) svg += R(x - 4, cy, SIDE - 16, 38, 6, '#1b2130', '#2f3646')
    if (f === 'all') {
      svg += R(x + 8, cy + 11, 16, 16, 3, 'none', C.text, ' stroke-width="1.4"')
      svg += T(x + 16, cy + 23, String(i + 1), { size: 9, fill: C.text, anchor: 'middle' })
    } else {
      svg += dot(x + 16, cy + 19, 5, STATE[f])
    }
    svg += T(x + 40, cy + 24, f === 'all' ? t.allSessions : t.filterName[f], { size: 14, fill: isOn ? C.text : C.dim })
    svg += T(x + SIDE - 30, cy + 24, String(n), { size: 13, fill: isOn ? C.text : C.dim, anchor: 'end' })
    cy += 40
  })

  cy += 14
  svg += hline(x - 4, x + SIDE - 20, cy)
  cy += 26
  section(t.settings)
  const settings: [string, string][] = [
    [t.language, t.languageName],
    [t.notifications, vm.notify ? t.on : t.off],
    [t.statusLine, vm.statusLine ? t.on : t.off],
  ]
  for (const [label, value] of settings) {
    svg += `<circle cx="${x + 12}" cy="${cy + 18}" r="7" fill="none" stroke="${C.dim}" stroke-width="1.3"/>`
    svg += T(x + 32, cy + 23, label, { size: 14, fill: C.text })
    svg += T(x + SIDE - 44, cy + 23, value, { size: 13, fill: C.text, anchor: 'end' })
    svg += ICON.chevron(x + SIDE - 34, cy + 14)
    cy += 40
  }

  cy += 14
  svg += hline(x - 4, x + SIDE - 20, cy)
  cy += 26
  section(t.shortcuts)
  const keys: [string, string][] = [
    ['R', t.refresh],
    ['N', `${t.notifications} on/off`],
    ['L', t.language],
    ['1-5', t.filterKeys],
  ]
  for (const [key, label] of keys) {
    const kw = Math.max(26, textWidth(key, 12) + 14)
    svg += R(x + 2, cy + 6, kw, 26, 4, C.panel, C.line)
    svg += T(x + 2 + kw / 2, cy + 23, key, { size: 12, fill: C.text, anchor: 'middle' })
    svg += T(x + kw + 16, cy + 23, label, { size: 13, fill: C.dim })
    cy += 38
  }

  cy += 22
  const boxH = 118
  svg += R(x - 4, cy, SIDE - 16, boxH, 8, C.panel, C.line)
  svg += `<circle cx="${x + 16}" cy="${cy + 26}" r="8" fill="none" stroke="${C.text}" stroke-width="1.3"/>`
  svg += T(x + 16, cy + 30, 'i', { size: 11, fill: C.text, anchor: 'middle' })
  svg += T(x + 34, cy + 31, 'Agent Watch', { size: 15, weight: 600 })
  svg += T(x + 12, cy + 56, `v${vm.version}`, { size: 12, fill: C.dim })
  svg += T(x + 12, cy + 78, t.openSource, { size: 11, fill: C.dim })
  svg += T(x + 12, cy + 100, 'github.com/TheoGegout/claude-agent-watch', { size: 10.5, fill: C.dim })
  cy += boxH

  return { svg, bottom: cy + 20 }
}

export function renderSvg(vm: ViewModel, widthPx: number) {
  const { t } = vm
  const W = Math.round(Math.min(1600, Math.max(360, widthPx)))
  const hasSide = W >= 1000
  const mainW = W - PAD * 2 - (hasSide ? SIDE + PAD : 0)

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

  // ── header ──
  let svg = ''
  svg += ICON.eye(PAD, 22)
  svg += T(PAD + 46, 38, 'AGENT WATCH', { size: 20, weight: 700, spacing: 1.5 })
  svg += T(PAD + 46, 58, fit(t.subtitle, W - PAD * 2 - 46, 12), { size: 12, fill: C.dim })
  const tally = (['running', 'waiting', 'idle', 'ended'] as const).map(s => ({
    s,
    label: `${counts[s]} ${t.filterName[s].toLowerCase()}`,
  }))
  const tallyW = tally.reduce((sum, one) => sum + textWidth(one.label, 14) + 44, 0)
  const refreshLabel = `${t.autoRefresh}`
  const refreshW = textWidth(refreshLabel, 12) + 70
  const isOneRow = W - PAD * 2 - 330 >= tallyW + refreshW
  let headH = 82
  let tx = isOneRow ? W - PAD - refreshW - tallyW : PAD
  const ty = isOneRow ? 46 : 92
  if (!isOneRow) headH = 112
  tally.forEach((one, i) => {
    const color = STATE[one.s]
    if (one.s === 'ended') svg += R(tx, ty - 10, 10, 10, 2, color)
    else svg += `<circle cx="${tx + 5}" cy="${ty - 5}" r="5" fill="${color}"/>`
    svg += T(tx + 18, ty, one.label, { size: 14, fill: one.s === 'running' || one.s === 'waiting' ? color : C.text })
    tx += textWidth(one.label, 14) + 30
    if (i < tally.length - 1) svg += `<line x1="${tx - 6}" y1="${ty - 14}" x2="${tx - 6}" y2="${ty + 4}" stroke="${C.line}"/>`
    tx += 14
  })
  if (isOneRow || W >= 560) {
    const rx = isOneRow ? W - PAD - refreshW + 20 : W - PAD - refreshW + 20
    const ry = isOneRow ? ty : 46
    svg += ICON.refresh(rx, ry - 12)
    svg += T(rx + 22, ry, refreshLabel, { size: 12, fill: C.dim })
    const sx = rx + 22 + textWidth(refreshLabel, 12) + 10
    svg += R(sx, ry - 14, 30, 20, 4, C.panel, C.line)
    svg += T(sx + 15, ry, '3s', { size: 12, fill: C.text, anchor: 'middle' })
  }
  svg += hline(0, W, headH)

  // ── cards ──
  let y = headH + 20
  if (vm.sessions.length === 0 || shown.length === 0) {
    svg += T(PAD, y + 24, vm.sessions.length === 0 ? t.noSessions : t.noMatch, { size: 14, fill: C.dim })
    y += 48
  }
  for (const c of shown) {
    const one = card(c, PAD, y, mainW, vm)
    svg += one.svg
    y += one.h + GAP
  }
  let bodyBottom = y + 4

  // ── sidebar ──
  if (hasSide) {
    const sx = W - PAD - SIDE + 16
    svg += `<line x1="${sx - 26}" y1="${headH}" x2="${sx - 26}" y2="${Math.max(bodyBottom, 760)}" stroke="${C.line}"/>`
    const side = sidebar(sx, headH, vm, counts)
    svg += side.svg
    bodyBottom = Math.max(bodyBottom, side.bottom)
  }

  // ── footer ──
  const fy = bodyBottom + 4
  svg += R(0, fy, W, 44, 0, C.panel)
  svg += hline(0, W, fy)
  svg += `<circle cx="${PAD + 5}" cy="${fy + 22}" r="4.5" fill="${STATE.running}"/>`
  svg += T(PAD + 18, fy + 27, t.footerRefresh, { size: 11.5, fill: C.dim })
  if (W >= 560) {
    const nx = PAD + 18 + textWidth(t.footerRefresh, 11.5) + 24
    svg += `<line x1="${nx - 12}" y1="${fy + 14}" x2="${nx - 12}" y2="${fy + 30}" stroke="${C.line}"/>`
    svg += T(nx, fy + 27, t.footerNotifications(vm.notify), { size: 11.5, fill: C.dim })
  }
  const runLabel = `${loopsRunning} ${t.filterName.running.toLowerCase()}`
  const waitLabel = `${loopsWaiting} ${t.filterName.waiting.toLowerCase()}`
  const endX = W - PAD
  svg += T(endX, fy + 27, waitLabel, { size: 11.5, fill: STATE.waiting, anchor: 'end' })
  const wx = endX - textWidth(waitLabel, 11.5)
  svg += T(wx - 10, fy + 27, '·', { size: 11.5, fill: C.dim, anchor: 'end' })
  svg += T(wx - 26, fy + 27, runLabel, { size: 11.5, fill: C.dim, anchor: 'end' })
  svg += `<circle cx="${wx - 26 - textWidth(runLabel, 11.5) - 10}" cy="${fy + 23}" r="4" fill="${STATE.running}"/>`

  const H = fy + 44
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(FONT)}">` +
    R(0, 0, W, H, 10, C.bg) +
    svg +
    '</svg>'
  return { source, width: W, height: H, alt: `Agent Watch: ${loopsRunning} running, ${loopsWaiting} waiting` }
}
