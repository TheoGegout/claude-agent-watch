// Agent Watch's full dashboard: a small local web server, started by the mod.
//
// It listens on 127.0.0.1 only, serves index.html, the board the mod writes to
// ~/.claude/agent-watch/_board.json, a subagent's transcript summary on demand,
// and one action: opening a session in the Claude desktop app through its own
// claude://code/continue link. No dependencies; Node 18 or newer.

import { createServer } from 'node:http'
import { readFile, open, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.argv[2] ?? 47311)
const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const BOARD = join(HOME, '.claude', 'agent-watch', '_board.json')
const HOST_ID = /^local_[A-Za-z0-9-]{1,64}$/
const ID = /^[A-Za-z0-9_-]{1,128}$/
// The server leaves on its own once nobody has asked anything for this long.
const IDLE_MS = 30 * 60_000

let lastHit = Date.now()
setInterval(() => {
  if (Date.now() - lastHit > IDLE_MS) process.exit(0)
}, 60_000).unref()

const projectDir = path => path.replace(/[^A-Za-z0-9]/g, '-')

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

/** The first line of a file and up to `bytes` of its end, as lines. */
async function headAndTail(path, bytes = 768 * 1024) {
  const file = await open(path, 'r')
  try {
    const { size } = await file.stat()
    const headBuf = Buffer.alloc(Math.min(size, 256 * 1024))
    await file.read(headBuf, 0, headBuf.length, 0)
    const head = headBuf.toString('utf8').split('\n')[0] ?? ''
    const start = Math.max(0, size - bytes)
    const tailBuf = Buffer.alloc(size - start)
    await file.read(tailBuf, 0, tailBuf.length, start)
    const lines = tailBuf.toString('utf8').split('\n')
    if (start > 0) lines.shift() // cut mid-line
    return { head, lines: lines.filter(Boolean) }
  } finally {
    await file.close()
  }
}

const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n')
      : ''

const describe = input => {
  if (!input || typeof input !== 'object') return ''
  for (const key of ['description', 'file_path', 'pattern', 'command', 'url', 'prompt']) {
    if (typeof input[key] === 'string' && input[key]) {
      const value = key === 'file_path' ? input[key].split(/[\\/]/).pop() : input[key]
      return value.replace(/\s+/g, ' ').slice(0, 140)
    }
  }
  return ''
}

async function agentDetail(sessionId, agentId) {
  const board = JSON.parse(await readFile(BOARD, 'utf8'))
  const session = board.sessions.find(s => s.sessionId === sessionId)
  if (!session) return { error: 'unknown session' }
  const path = join(HOME, '.claude', 'projects', projectDir(session.cwd), sessionId, 'subagents', `agent-${agentId}.jsonl`)
  const { head, lines } = await headAndTail(path)
  const parse = line => {
    try {
      return JSON.parse(line)
    } catch {
      return undefined
    }
  }
  const opening = parse(head)
  const prompt = opening?.type === 'user' ? textOf(opening.message?.content) : ''
  const tools = []
  let answer = ''
  for (const line of lines) {
    const entry = parse(line)
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
    for (const block of entry.message.content) {
      if (block?.type === 'tool_use' && block.name) {
        tools.push({ name: block.name, detail: describe(block.input), at: entry.timestamp })
      }
    }
    const said = textOf(entry.message.content).trim()
    if (said) answer = said
  }
  return {
    prompt: prompt.slice(0, 2000),
    tools: tools.slice(-20),
    answer: answer.slice(0, 6000),
    size: (await stat(path)).size,
  }
}

function openInApp(hostId) {
  const url = `claude://code/continue?session=${hostId}`
  const [cmd, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

const server = createServer(async (req, res) => {
  lastHit = Date.now()
  // Only this machine, by its own name: a page elsewhere cannot rebind to us.
  const host = req.headers.host ?? ''
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return send(res, 403, { error: 'host' })
  const url = new URL(req.url ?? '/', `http://${host}`)

  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return send(res, 200, await readFile(join(HERE, 'index.html')), 'text/html; charset=utf-8')
    }
    if (req.method === 'GET' && url.pathname === '/api/ping') {
      return send(res, 200, { app: 'agent-watch' })
    }
    if (req.method === 'GET' && url.pathname === '/api/board') {
      const board = JSON.parse(await readFile(BOARD, 'utf8'))
      return send(res, 200, { ...board, served: Date.now() })
    }
    if (req.method === 'GET' && url.pathname === '/api/agent') {
      const sessionId = url.searchParams.get('session') ?? ''
      const agentId = url.searchParams.get('agent') ?? ''
      if (!ID.test(sessionId) || !ID.test(agentId)) return send(res, 400, { error: 'ids' })
      return send(res, 200, await agentDetail(sessionId, agentId))
    }
    if (req.method === 'POST' && url.pathname === '/api/open') {
      const origin = req.headers.origin
      if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'origin' })
      const hostId = url.searchParams.get('host') ?? ''
      if (!HOST_ID.test(hostId)) return send(res, 400, { error: 'host id' })
      openInApp(hostId)
      return send(res, 200, { ok: true })
    }
    return send(res, 404, { error: 'not found' })
  } catch (err) {
    return send(res, 500, { error: String(err?.message ?? err) })
  }
})

server.on('error', err => {
  // Another session already serves the dashboard on this port.
  if (err.code === 'EADDRINUSE') process.exit(0)
  throw err
})
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`agent-watch dashboard on http://127.0.0.1:${PORT}\n`)
})
