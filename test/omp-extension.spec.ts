import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import annotationInbox, { markSeen } from '../integrations/omp/annotation-inbox'
import { openFileInbox } from '../modules/annotation-inbox/node'
import type { OmpApi, OmpContext } from '../integrations/omp/annotation-inbox'
import type { InboxAnnotation, InboxPayload } from '../modules/annotation-inbox/contract'

/**
 * The extension is driven the way omp drives it — a factory handed `pi`, tools and commands
 * invoked with a `ctx` — against a real inbox directory in a temp project root. Only the host
 * is faked: it records what the extension registers, sends and shows.
 */

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean }
type Tool = { execute: (id: string, params: object, signal: unknown, onUpdate: unknown, ctx: OmpContext) => Promise<ToolResult> }
type Command = { handler: (args: string, ctx: OmpContext) => Promise<void> }
type SentMessage = { text: string; options: { deliverAs?: 'aside'; attribution: 'agent' } }

let root: string
let tools: Map<string, Tool>
let commands: Map<string, Command>
let handlers: Map<string, (event: unknown, ctx: OmpContext) => void>
let sent: SentMessage[]
let notes: string[]
let statuses: (string | undefined)[]
let intervals: (() => unknown)[]
let cleared: unknown[]
let kind: 'main' | 'sub'

function fakePi(): OmpApi {
  return {
    zod: z,
    setLabel: () => {},
    logger: { warn: () => {} },
    sendUserMessage: (text, options) => void sent.push({ text, options }),
    registerTool: tool => void tools.set(String(tool.name), tool as unknown as Tool),
    registerCommand: (name, command) => void commands.set(name, command as unknown as Command),
    on: (event, handler) => void handlers.set(event, handler),
  }
}

function fakeCtx(): OmpContext {
  return {
    cwd: root,
    agent: { kind },
    sessionManager: { getSessionId: () => 'session-1' },
    ui: {
      notify: text => void notes.push(text),
      setStatus: (_key, text) => void statuses.push(text),
    },
    setInterval: fn => {
      intervals.push(fn)
      return { interval: intervals.length }
    },
    clearTimer: timer => void cleared.push(timer),
  }
}

function annotation(id: string, comment: string): InboxAnnotation {
  return {
    id,
    comment,
    elementPath: 'body > main > button',
    vueComponents: 'App > GuidePicker > button:app/components/guide/GuidePicker.vue:52:6',
    url: 'http://localhost:3040/guide/atem',
    timestamp: 1_700_000_000_000,
  }
}

function payload(sessionId: string, annotations: InboxAnnotation[]): InboxPayload {
  return {
    sessionId,
    origin: 'http://localhost:3040',
    url: 'http://localhost:3040/guide/atem',
    annotations,
    markdown: '## Feedback',
  }
}

const seenFile = () => join(root, '.data', 'annotations', '.watch-seen')

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'annotation-inbox-omp-'))
  tools = new Map()
  commands = new Map()
  handlers = new Map()
  sent = []
  notes = []
  statuses = []
  intervals = []
  cleared = []
  kind = 'main'
  annotationInbox(fakePi())
})

afterEach(async () => {
  // Watchers are module state keyed by session; shutting the session down is how they are released.
  handlers.get('session_shutdown')?.({}, fakeCtx())
  await rm(root, { recursive: true, force: true })
})

function tool(name: string): Tool {
  const found = tools.get(name)
  if (!found) throw new Error(`tool ${name} was not registered`)
  return found
}

describe('annotations_list', () => {
  it('lists open notes as markdown, or as JSON on request', async () => {
    await openFileInbox(root).publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))

    const markdown = await tool('annotations_list').execute('t1', {}, undefined, undefined, fakeCtx())
    expect(markdown.content[0]?.text).toContain('Button sitzt zu tief')

    const json = await tool('annotations_list').execute('t2', { format: 'json' }, undefined, undefined, fakeCtx())
    const parsed = JSON.parse(json.content[0]?.text ?? '')
    expect(parsed.status).toBe('open')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({ inboxId: 'a1b2c3d4e5f6-1', comment: 'Button sitzt zu tief' })
  })
})

describe('annotations_resolve', () => {
  it('refuses a rejection without a resolution, and closes the note once it has one', async () => {
    const inbox = openFileInbox(root)
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))
    const resolve = tool('annotations_resolve')

    const refused = await resolve.execute('t1', { ids: ['a1b2c3d4e5f6-1'], status: 'rejected' }, undefined, undefined, fakeCtx())
    expect(refused.isError).toBe(true)
    expect(refused.content[0]?.text).toBe('rejected needs a resolution')
    expect(await inbox.list({ status: 'open' })).toHaveLength(1)

    const accepted = await resolve.execute(
      't2',
      { ids: ['a1b2c3d4e5f6-1'], status: 'rejected', resolution: 'Das Layout ist so gewollt' },
      undefined,
      undefined,
      fakeCtx(),
    )
    expect(accepted.isError).toBe(false)
    expect(await inbox.list({ status: 'open' })).toEqual([])
  })
})

describe('/annotations watch on', () => {
  async function watchOn(): Promise<void> {
    await commands.get('annotations')?.handler('watch on', fakeCtx())
    // The watcher polls once as it starts; its status line is written when that poll is done.
    await vi.waitFor(() => expect(statuses).toContain('1 open · watch'))
  }

  it('wakes the session once per note and records the id in the skill\'s seen file', async () => {
    await openFileInbox(root).publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))

    await watchOn()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.options).toEqual({ deliverAs: 'aside', attribution: 'agent' })
    expect(sent[0]?.text).toContain('New annotations from the running app (1)')
    expect(sent[0]?.text).toContain('Button sitzt zu tief')
    expect(await readFile(seenFile(), 'utf8')).toBe('a1b2c3d4e5f6-1\n')

    expect(intervals).toHaveLength(1)
    await intervals[0]?.()
    await intervals[0]?.()
    expect(sent).toHaveLength(1)
    expect(await readFile(seenFile(), 'utf8')).toBe('a1b2c3d4e5f6-1\n')
  })

  it('never sends a note that is already in the seen file, and picks up one that arrives later', async () => {
    const inbox = openFileInbox(root)
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))
    await markSeen(root, ['a1b2c3d4e5f6-1'])

    await watchOn()
    expect(sent).toEqual([])

    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('2', 'Logo ist unscharf')]))
    await intervals[0]?.()

    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toContain('Logo ist unscharf')
    expect(sent[0]?.text).not.toContain('Button sitzt zu tief')
    expect(await readFile(seenFile(), 'utf8')).toBe('a1b2c3d4e5f6-1\na1b2c3d4e5f6-2\n')
  })

  it('stops polling and clears the status on watch off', async () => {
    await openFileInbox(root).publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))
    await watchOn()

    await commands.get('annotations')?.handler('watch off', fakeCtx())

    expect(cleared).toEqual([{ interval: 1 }])
    expect(statuses.at(-1)).toBeUndefined()
  })
})

describe('session_start', () => {
  const previous = process.env.ANNO_WATCH

  beforeEach(() => {
    process.env.ANNO_WATCH = '1'
  })

  afterEach(() => {
    if (previous === undefined) delete process.env.ANNO_WATCH
    else process.env.ANNO_WATCH = previous
  })

  it('starts no watcher in a subagent', () => {
    kind = 'sub'
    handlers.get('session_start')?.({}, fakeCtx())
    expect(intervals).toEqual([])
  })

  it('starts the watcher in the main session when ANNO_WATCH=1', () => {
    handlers.get('session_start')?.({}, fakeCtx())
    expect(intervals).toHaveLength(1)
  })

  it('starts no watcher without ANNO_WATCH', () => {
    delete process.env.ANNO_WATCH
    handlers.get('session_start')?.({}, fakeCtx())
    expect(intervals).toEqual([])
  })
})
