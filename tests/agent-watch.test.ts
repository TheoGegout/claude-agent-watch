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
  const opened: string[] = []
  mock.env(on, { USERPROFILE: HOME, OS: 'Windows_NT' })
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
  on('fs.stat', (_$, e) => {
    const file = files.get(slash(e.path))
    if (!file) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('process.run', (_$, e) => {
    opened.push([...e.argv, JSON.stringify(e.init?.env ?? {})].join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
  return { files, toasts, status, opened, put, own }
}

const PANE = {
  plugin: 'agent-watch',
  component: 'Pane',
  requestId: 'agent-watch',
  props: {
    title: 'Agents',
    isFocused: true,
    bodyColumns: 140,
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
    hostSessionId: 'local_abc-123',
  })
  const subs = `${HOME}/.claude/projects/D--Dev-webshop/other/subagents`
  // One writing right now, one on a long tool call, one done, one long gone.
  w.put(`${subs}/agent-live.jsonl`, '{"type":"user"}\n')
  w.put(`${subs}/agent-live.meta.json`, { agentType: 'general-purpose', description: 'Run the e2e suite' })
  w.put(
    `${subs}/agent-long.jsonl`,
    `${JSON.stringify({ type: 'user', message: { content: 'Bundle the app for release' } })}\n` +
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
  w.put(
    `${HOME}/.claude/projects/D--Dev-webshop/other.jsonl`,
    [
      { type: 'user', timestamp: '2026-10-07T10:00:00Z', message: { content: 'Add the coupon field to checkout' } },
      { type: 'user', isMeta: true, message: { content: 'a reminder the person never typed' } },
      { type: 'assistant', timestamp: '2026-10-07T10:01:00Z', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'D:/Dev/webshop/checkout.tsx' } }] } },
      { type: 'assistant', timestamp: '2026-10-07T10:02:00Z', message: { content: [{ type: 'text', text: 'The **coupon field** is in.' }] } },
    ]
      .map(row => JSON.stringify(row))
      .join('\n'),
  )

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  expect(w.own().state).toBe('idle')
  expect(w.toasts.some(t => t.includes('Checkout flow') && t.includes('is waiting for you'))).toBe(true)
  // The system's own notification, once, which opens that session when clicked.
  const notes = w.opened.filter(line => line.includes('notify.ps1'))
  expect(notes.length).toBe(1)
  expect(notes[0]).toContain('claude://code/continue?session=local_abc-123')
  expect(notes[0]).toContain('Checkout flow')

  await $.turn.start({ text: 'write the release notes', turnId: 't1' })
  expect(w.own().state).toBe('running')

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect(w.own().waiting).toBe('permission Bash')

  await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1000, turnId: 't1', isAborted: false })
  expect(w.own().state).toBe('idle')

  {
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: /Checkout flow/ })).toBeDefined()
    expect(await ui.find({ text: /D:\/Dev\/webshop/ })).toBeDefined()
    expect(await ui.find({ text: /Permission \/ input required/ })).toBeDefined()
    expect(await ui.find({ text: /AGENT WATCH/ })).toBeDefined()
    // herdr's layout: projects on the left, one line a session, the waiting one selected.
    expect(await ui.find({ text: /^webshop$/ })).toBeDefined()
    expect(await ui.find({ key: 'session-me-session' })).toBeDefined()
    expect(await ui.find({ key: 'row-agent-other-live' })).toBeDefined()
    expect(await ui.find({ key: 'set-language' })).toBeDefined()
    expect(await ui.find({ text: /permission Bash/ })).toBeDefined()
    expect(await ui.find({ text: /general-purpose · Run the e2e suite/ })).toBeDefined()
    expect(await ui.find({ text: /Bash · build the app/ })).toBeDefined()
    expect(await ui.find({ text: /Explore · Find the handlers/ })).toBeDefined()
    expect(await ui.find({ text: /agent · old/ })).toBeUndefined()
    // j moves the selection to the next session: its page replaces the detail.
    await ui.press({ key: 'next' })
    expect(await ui.find({ text: /Explore · find the tests/ })).toBeDefined()
    await ui.press({ key: 'previous' })
    expect(await ui.find({ text: /Permission \/ input required/ })).toBeDefined()
    await ui.unmount()
  }
  // Clicking through: a session, then one of its agents, then back.
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'open-other' })).toBeDefined()
    await ui.press({ key: 'open-other' })
    expect(w.opened.at(-1)).toContain('claude://code/continue?session=local_abc-123')
    await ui.press({ key: 'session-other' })
    expect(await ui.find({ text: /SUBAGENTS · 3/ })).toBeDefined()
    expect(await ui.find({ text: /Open in the app/ })).toBeDefined()
    expect(await ui.find({ text: /^❯ $/ })).toBeDefined()
    expect(await ui.find({ text: /Add the coupon field to checkout/ })).toBeDefined()
    expect(await ui.find({ text: /a reminder the person never typed/ })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
    expect(await ui.find({ text: /checkout\.tsx/ })).toBeDefined()
    await ui.press({ key: 'agent-other-long' })
    expect(await ui.find({ text: /LAST TOOL CALLS/ })).toBeDefined()
    expect(await ui.find({ text: /Bundle the app for release/ })).toBeDefined()
    expect(await ui.find({ text: /build the app/ })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ text: /SUBAGENTS · 3/ })).toBeDefined()
    expect(await ui.find({ text: /Release notes/ })).toBeDefined()
    await ui.unmount()
  }

  // The filters: only the waiting session is left once pressed.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'count-waiting' })
  expect(await ui.find({ text: /Checkout flow/ })).toBeDefined()
  expect(await ui.find({ text: /Release notes/ })).toBeUndefined()
  await ui.press({ key: 'count-waiting' })
  expect(await ui.find({ text: /Release notes/ })).toBeDefined()
  await ui.unmount()

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
  expect(await ui.find({ text: /Français/ })).toBeDefined()
})

test('the notification and the status line can be turned off', { options: { notifyWaiting: false, statusLine: false } }, async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\x', status: 'busy', waitingFor: 'dialog open' })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  expect(w.toasts).toEqual([])
  expect(w.status).toEqual([])
  expect(w.opened.filter(line => line.includes('notify.ps1'))).toEqual([])
})

test('a narrow pane drops the sidebar for a filter row', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\x', name: 'Narrow', status: 'idle' })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...(PANE.props as object), bodyColumns: 60 } as never })
  expect(await ui.find({ text: /Narrow/ })).toBeDefined()
  // Narrow: the list alone; a session's page opens in its place.
  expect(await ui.find({ text: /^D:\/x$/ })).toBeUndefined()
  await ui.press({ key: 'session-other' })
  expect(await ui.find({ text: /^D:\/x$/ })).toBeDefined()
  await ui.press({ key: 'back' })
  expect(await ui.find({ key: 'session-other' })).toBeDefined()
})

test('tokens, a slow tool, a silent agent, and the board as text', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  const iso = (ms: number) => new Date(ms).toISOString()
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\Dev\\webshop', name: 'Checkout flow', status: 'busy' })
  const subs = `${HOME}/.claude/projects/D--Dev-webshop/other/subagents`
  const usage = (out: number) => ({ input_tokens: 2000, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 0, output_tokens: out })
  // Finished: two responses, the first written as two rows with one usage.
  w.put(
    `${subs}/agent-done.jsonl`,
    [
      { type: 'user', message: { content: 'Read the handlers' } },
      { type: 'assistant', message: { id: 'm1', usage: usage(1200), content: [{ type: 'text', text: 'Looking' }] } },
      { type: 'assistant', message: { id: 'm1', usage: usage(1200), content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { id: 'm2', usage: usage(300), stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done' }] } },
    ].map(r => JSON.stringify(r)).join('\n'),
    NOW - 60_000,
  )
  w.put(`${subs}/agent-done.meta.json`, { agentType: 'Explore', description: 'Read the handlers' })
  // In a tool call for 90 s.
  w.put(
    `${subs}/agent-slow.jsonl`,
    JSON.stringify({ type: 'assistant', timestamp: iso(NOW - 90_000), message: { id: 'm3', content: [{ type: 'tool_use', name: 'Bash', input: { description: 'run the e2e suite' } }] } }),
    NOW - 40_000,
  )
  w.put(`${subs}/agent-slow.meta.json`, { agentType: 'general-purpose', description: 'Test' })
  // Thinking, and nothing written for 150 s.
  w.put(`${subs}/agent-mute.jsonl`, JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), NOW - 150_000)
  w.put(`${subs}/agent-mute.meta.json`, { agentType: 'Plan', description: 'Plan the release' })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /1\.5k out · ctx 52k/ })).toBeDefined()
  expect(await ui.find({ text: /Bash · run the e2e suite · 1m 30s ⚠/ })).toBeDefined()
  expect(await ui.find({ text: /⚠ silent for 2m 30s/ })).toBeDefined()

  const run = await $.command.run({ command: 'agent-watch', args: 'text', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as never)
  expect(run.text).toContain('Agent Watch — ')
  expect(run.text).toContain('Checkout flow — D:/Dev/webshop')
  expect(run.text).toContain('└ ')
  expect(run.text).toContain('1.5k out · ctx 52k')
})

test('a session that finished since you last looked reads as done, until you open it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\Dev\\webshop', name: 'Checkout flow', status: 'busy', statusUpdatedAt: NOW - 5_000 })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] $/ })).toBeDefined()

  // It finishes while you look elsewhere.
  await clock.advance(10_000)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\Dev\\webshop', name: 'Checkout flow', status: 'idle', statusUpdatedAt: NOW + 10_000 })
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ text: /^✓ $/ })).toBeDefined()
  expect(await ui.find({ text: /^done$/ })).toBeDefined()

  // Opening it is looking at it.
  await ui.press({ key: 'session-other' })
  expect(await ui.find({ text: /^✓ $/ })).toBeUndefined()
})

test('herdr touches: the branch, the model and the context, numbered projects', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: 'other', cwd: 'D:\\Dev\\webshop', name: 'Checkout flow', status: 'busy' })
  w.put('D:/Dev/webshop/.git/HEAD', 'ref: refs/heads/feature/coupons\n')
  w.put(
    `${HOME}/.claude/projects/D--Dev-webshop/other.jsonl`,
    JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', usage: { input_tokens: 3000, cache_read_input_tokens: 49_000, cache_creation_input_tokens: 0, output_tokens: 10 }, content: [{ type: 'text', text: 'ok' }] } }),
  )

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ text: /⎇ feature\/coupons/ })).toBeDefined()
  await ui.press({ key: 'project-1' })
  expect(await ui.find({ text: /opus-5-5  ·  ctx 52k/ })).toBeDefined()
})

test('o opens the selected session, never this one', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const w = world(on, clock.now)
  w.put(`${REGISTRY}/1.json`, { sessionId: ME, cwd: 'D:\', name: 'Here', status: 'busy', hostSessionId: 'local_me-1' })
  w.put(`${REGISTRY}/2.json`, { sessionId: 'other', cwd: 'D:\', name: 'Elsewhere', status: 'idle', hostSessionId: 'local_other-2' })

  await $.session.start({ cwd: 'D:/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Selected by default: the first session that is not this one.
  await ui.press({ key: 'open-selected' })
  expect(w.opened.at(-1)).toContain('session=local_other-2')
  expect(w.toasts.at(-1)).toContain('Elsewhere')
  // This session's page offers no opening of itself.
  await ui.press({ key: 'session-me-session' })
  expect(await ui.find({ text: /^this session$/ })).toBeDefined()
  expect(await ui.find({ key: 'open-selected' })).toBeUndefined()
})
