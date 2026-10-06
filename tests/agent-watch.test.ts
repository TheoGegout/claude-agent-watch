import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = 'C:/Users/me'
const FOLDER = `${HOME}/.claude/agent-watch`
const REGISTRY = `${HOME}/.claude/sessions`
const ME = 'me-session'
const NOW = 1_000_000_000

// The engine hands paths on in the platform's spelling.
const slash = (path: string) => path.replace(/\\/g, '/')

// A file system in memory standing for ~/.claude, plus the engine nouns the
// mod reaches beneath it.
function world(on: On, now: () => number) {
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const toasts: string[] = []
  const status: (string | undefined)[] = []
  mock.env(on, { USERPROFILE: HOME })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: ME }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }) as never)
  on('agent.list', () => ({
    value: [{ id: 'a1', description: 'find the tests', type: 'Explore', status: 'running' as const }],
  }))
  on('fs.write', (_$, e) => {
    files.set(slash(e.path), { text: e.text, mtimeMs: now() })
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    const file = files.get(slash(e.path))
    if (!file) throw new Error(`ENOENT ${e.path}`)
    return { value: file.text }
  })
  on('fs.list', (_$, e) => {
    const dir = `${slash(e.path)}/`
    return {
      value: [...files.entries()]
        .filter(([path]) => path.startsWith(dir) && !path.slice(dir.length).includes('/'))
        .map(([path, f]) => ({
          name: path.slice(dir.length),
          kind: 'file' as const,
          size: f.text.length,
          mtimeMs: f.mtimeMs,
          isLink: false,
        })),
    }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    status.push(e.text)
    return { value: undefined }
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.PermissionRequest', () => ({}))
  const put = (path: string, value: unknown, mtimeMs = now()) =>
    files.set(path, { text: typeof value === 'string' ? value : JSON.stringify(value), mtimeMs })
  const own = () => JSON.parse(files.get(`${FOLDER}/${ME}.json`)?.text ?? '{}')
  return { files, toasts, status, put, own }
}

const PANE = {
  plugin: 'agent-watch',
  component: 'Pane',
  requestId: 'agent-watch',
  props: {
    title: 'Agents',
    isFocused: true,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  } as never,
} as const

const assistant = (message: unknown) => `${JSON.stringify({ type: 'assistant', message })}\n`

test('sessions without the mod show from the registry, with their subagents', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)

  w.put(`${REGISTRY}/7344.json`, { sessionId: ME, cwd: 'D:\\', name: 'Release notes', status: 'busy' })
  // Another session, no mod, a permission dialog open.
  w.put(`${REGISTRY}/24292.json`, {
    sessionId: 'other',
    cwd: 'D:\\Dev\\webshop',
    name: 'Checkout flow',
    status: 'busy',
    waitingFor: 'permission Bash',
    statusUpdatedAt: NOW - 60_000,
  })
  const subs = `${HOME}/.claude/projects/D--Dev-webshop/other/subagents`
  // One writing right now, one on a long tool call, one done, one long gone.
  w.put(`${subs}/agent-live.jsonl`, '{"type":"user"}\n')
  w.put(`${subs}/agent-live.meta.json`, { agentType: 'general-purpose', description: 'Run the e2e suite' })
  w.put(
    `${subs}/agent-long.jsonl`,
    assistant({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'Bash', input: { description: 'build the app' } }],
    }),
    NOW - 90_000,
  )
  w.put(`${subs}/agent-long.meta.json`, { agentType: 'Plan', description: 'Build the bundle' })
  w.put(
    `${subs}/agent-done.jsonl`,
    assistant({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }),
    NOW - 120_000,
  )
  w.put(`${subs}/agent-done.meta.json`, { agentType: 'Explore', description: 'Find the handlers' })
  w.put(`${subs}/agent-old.jsonl`, '{}\n', NOW - 60 * 60_000)

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  expect(w.own().state).toBe('idle')
  expect(w.toasts.some(t => t.includes('Checkout flow') && t.includes('is waiting for you'))).toBe(true)

  await $.turn.start({ text: 'write the release notes', turnId: 't1' })
  expect(w.own().state).toBe('running')

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect(w.own().waiting).toBe('permission Bash')

  await $.turn.complete({ reason: 'answer', turnId: 't1', isAborted: false } as never)
  expect(w.own().state).toBe('idle')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ text: /Checkout flow — webshop/ })).toBeDefined()
    expect(await ui.find({ text: /permission Bash/ })).toBeDefined()
    expect(await ui.find({ text: /general-purpose · Run the e2e suite/ })).toBeDefined()
    expect(await ui.find({ text: /Bash · build the app/ })).toBeDefined()
    expect(await ui.find({ text: /Explore · Find the handlers/ })).toBeDefined()
    expect(await ui.find({ text: /Explore · find the tests/ })).toBeDefined()
    expect(await ui.find({ text: /agent · old/ })).toBeUndefined()
    await ui.unmount()
  }
  // Mine (busy in the registry, its Explore a1), and the other's two live agents; one waits.
  expect(w.status.at(-1)).toBe('agents ▶ 4 running · ◆ 1 waiting')
})

test('a session that reported but left the registry shows as ended', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(
    `${FOLDER}/gone.json`,
    {
      sessionId: 'gone',
      cwd: 'D:/old',
      title: 'old work',
      state: 'running',
      since: NOW - 100_000,
      updatedAt: NOW - 40_000,
      agents: [],
    },
    NOW - 40_000,
  )

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /old work/ })).toBeDefined()
  expect(await ui.find({ text: /ended/ })).toBeDefined()
})

test('speaks French when asked', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, {
    sessionId: 'other',
    cwd: 'D:\\Dev\\webshop',
    name: 'Checkout flow',
    status: 'busy',
    waitingFor: 'dialog open',
  })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  expect(w.toasts.some(t => t.includes('attend ta réponse'))).toBe(true)
  expect(w.status.at(-1)).toBe('agents ▶ 1 en cours · ◆ 1 en attente')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /attend ta réponse/ })).toBeDefined()
  expect(await ui.find({ text: /dialog open/ })).toBeDefined()
})

test('the notification and the status line can be turned off', { options: { notifyWaiting: false, statusLine: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\x', status: 'busy', waitingFor: 'dialog open' })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  expect(w.toasts).toEqual([])
  expect(w.status).toEqual([])
})
