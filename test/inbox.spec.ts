import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import memoryDriver from 'unstorage/drivers/memory'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createInbox } from '../modules/annotation-inbox/inbox'
import { handleInboxRequest } from '../modules/annotation-inbox/server'
import { storageContractTests } from '../modules/annotation-inbox/testing'
import { ANONYMOUS_REVIEWER, DEV_PRINCIPAL, tokenAgent } from '../modules/annotation-inbox/principal'
import type { Storage } from 'unstorage'
import type { Inbox, InboxEvent, InboxRequest } from '../modules/annotation-inbox/inbox'
import type { InboxAnnotation, InboxItem, InboxPayload } from '../modules/annotation-inbox/contract'
import type { Principal } from '../modules/annotation-inbox/principal'

/**
 * What the inbox promises the two people who use it: a reviewer, who clicks
 * something and expects the note to survive until it is answered, and an agent,
 * who has to be able to find open notes, act, and say what it did.
 *
 * The behaviour that depends on the store — key layout, publish/resolve/take-
 * back semantics — is the `./testing` suite, run here over the two drivers this
 * package ships with (memory and filesystem). What stays here is what the
 * store cannot change: the request surface, principals and change events.
 */

const scratch: string[] = []

storageContractTests('memory', () => createStorage({ driver: memoryDriver() }))
storageContractTests('fs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'annotation-inbox-contract-'))
  scratch.push(dir)
  return createStorage({ driver: fsDriver({ base: dir }) })
})

afterAll(async () => {
  await Promise.all(scratch.map(dir => rm(dir, { recursive: true, force: true })))
})

let store: Storage
let inbox: Inbox

beforeEach(() => {
  store = createStorage({ driver: memoryDriver() })
  inbox = createInbox(store)
})

function annotation(id: string, comment: string, extra: Partial<InboxAnnotation> = {}): InboxAnnotation {
  return {
    id,
    comment,
    elementPath: 'body > main > button',
    vueComponents: 'App > GuidePicker > button:app/components/guide/GuidePicker.vue:52:6',
    url: 'http://localhost:3040/guide/atem',
    timestamp: 1_700_000_000_000,
    ...extra,
  }
}

function payload(sessionId: string, annotations: InboxAnnotation[], markdown = '## Feedback'): InboxPayload {
  return {
    sessionId,
    origin: 'http://localhost:3040',
    url: 'http://localhost:3040/guide/atem',
    annotations,
    markdown,
  }
}

/**
 * A request as a transport hands it over, with the principal the host
 * authenticated. `principal` has no default on purpose: a default would
 * swallow the `null` that means "nobody", and the refusal cases would silently
 * test an authorised caller.
 */
async function request(
  init: { method?: string, path: string, query?: Record<string, string>, base?: string },
  principal: Principal | null,
  body?: unknown,
) {
  const base = init.base ?? '/__annotations'
  const query = init.query ? `?${new URLSearchParams(init.query)}` : ''
  const message: InboxRequest = {
    method: init.method ?? 'GET',
    url: `${base}${init.path}${query}`,
    principal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
  return handleInboxRequest(inbox, message, { base })
}

describe('resolving over the request surface', () => {
  beforeEach(async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'umsetzbar'), annotation('2', 'nicht umsetzbar')]))
  })

  it('refuses a status that does not close a note, and a request without ids', async () => {
    const wrongStatus = await request({ method: 'POST', path: '/resolve' }, tokenAgent(), {
      ids: ['a1b2c3d4e5f6-1'],
      status: 'open',
    })
    expect(wrongStatus.status).toBe(400)
    expect(wrongStatus.body).toContain('implemented')

    const noIds = await request({ method: 'POST', path: '/resolve' }, tokenAgent(), { ids: [], status: 'implemented' })
    expect(noIds.status).toBe(400)
    expect((await inbox.list({ status: 'open' })).length).toBe(2)
  })

  it('refuses a rejection that gives no reason, as the MCP tool does', async () => {
    const bare = await request({ method: 'POST', path: '/resolve' }, tokenAgent(), { ids: ['a1b2c3d4e5f6-1'], status: 'rejected' })
    expect(bare.status).toBe(400)
    expect(bare.body).toContain('resolution')
    const blank = await request({ method: 'POST', path: '/resolve' }, tokenAgent(), {
      ids: ['a1b2c3d4e5f6-1'],
      status: 'rejected',
      resolution: '   ',
    })
    expect(blank.status).toBe(400)
    expect((await inbox.list({ status: 'open' })).length).toBe(2)
  })

  it('attributes a resolution to the principal that made it', async () => {
    const byAgent = await request({ method: 'POST', path: '/resolve' }, tokenAgent('omp'), {
      ids: ['a1b2c3d4e5f6-1'],
      status: 'implemented',
    })
    expect(byAgent.status).toBe(200)

    await request({ method: 'POST', path: '/resolve' }, { kind: 'human', id: 'u-7', name: 'Ada', roles: ['reviewer'] }, {
      ids: ['a1b2c3d4e5f6-2'],
      status: 'rejected',
      resolution: 'nein',
    })

    const closed = Object.fromEntries((await inbox.list({ status: 'closed' })).map(item => [item.inboxId, item]))
    expect(closed['a1b2c3d4e5f6-1']!.resolvedBy).toBe('agent')
    expect(closed['a1b2c3d4e5f6-2']!.resolvedBy).toBe('Ada')
  })

  it('falls back to the id for a human without a name, and to "reviewer" for an unnamed hook approval', async () => {
    await request({ method: 'POST', path: '/resolve' }, { kind: 'human', id: 'u-9' }, {
      ids: ['a1b2c3d4e5f6-1'],
      status: 'implemented',
    })
    await request({ method: 'POST', path: '/resolve' }, ANONYMOUS_REVIEWER, {
      ids: ['a1b2c3d4e5f6-2'],
      status: 'implemented',
    })

    const closed = Object.fromEntries((await inbox.list({ status: 'closed' })).map(item => [item.inboxId, item]))
    expect(closed['a1b2c3d4e5f6-1']!.resolvedBy).toBe('u-9')
    expect(closed['a1b2c3d4e5f6-2']!.resolvedBy).toBe('reviewer')
  })
})

describe('the HTTP surface', () => {
  beforeEach(async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))
  })

  it('renders a listing an agent can act on', async () => {
    const response = await request({ path: '', query: { format: 'markdown' } }, tokenAgent())

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/markdown')
    expect(response.body).toContain('### a1b2c3d4e5f6-1')
    expect(response.body).toContain('app/components/guide/GuidePicker.vue:52:6')
    expect(response.body).toContain('POST /__annotations/resolve')
  })

  it('serves under a configured base and names it in the listing', async () => {
    const response = await request({ base: '/feedback', path: '', query: { format: 'markdown' } }, DEV_PRINCIPAL)
    expect(response.status).toBe(200)
    expect(response.body).toContain('POST /feedback/resolve')

    const outside = await handleInboxRequest(
      inbox,
      { method: 'GET', url: '/__annotations', principal: DEV_PRINCIPAL },
      { base: '/feedback' },
    )
    expect(outside.status).toBe(404)
  })

  it('refuses a caller who is nobody, but still answers the access probe', async () => {
    expect((await request({ path: '' }, null)).status).toBe(401)
    expect((await request({ method: 'POST', path: '' }, null, payload('a1b2c3d4e5f6', []))).status).toBe(401)

    const denied = await request({ path: '/access' }, null)
    expect(denied.status).toBe(200)
    expect(JSON.parse(denied.body)).toEqual({ allowed: false })

    const granted = await request({ path: '/access' }, DEV_PRINCIPAL)
    expect(JSON.parse(granted.body)).toEqual({ allowed: true })
  })

  it('names what it expected when a payload cannot be a session', async () => {
    const noSession = await request({ method: 'POST', path: '' }, DEV_PRINCIPAL, {
      origin: 'http://localhost:3040',
      annotations: [],
      markdown: '',
    })
    expect(noSession.status).toBe(400)
    expect(noSession.body).toContain('sessionId')

    const badOrigin = await request({ method: 'POST', path: '' }, DEV_PRINCIPAL, {
      ...payload('a1b2c3d4e5f6', []),
      origin: 'nicht-mal-eine-url',
    })
    expect(badOrigin.status).toBe(400)
    expect(badOrigin.body).toContain('origin')

    const listed: InboxItem[] = await inbox.list({ status: 'all' })
    expect(listed.length).toBe(1)
  })

  it('reads a lazily supplied body only for the routes that need one', async () => {
    let reads = 0
    const body = async () => {
      reads += 1
      return JSON.stringify(payload('ffee00112233', [annotation('1', 'lazy')]))
    }
    await handleInboxRequest(inbox, { method: 'GET', url: '/__annotations', principal: DEV_PRINCIPAL, body })
    expect(reads).toBe(0)
    const posted = await handleInboxRequest(inbox, { method: 'POST', url: '/__annotations', principal: DEV_PRINCIPAL, body })
    expect(posted.status).toBe(204)
    expect(reads).toBe(1)
  })
})

describe('subscribing to changes', () => {
  it('reports a publish and a resolution, per session, after they succeeded', async () => {
    const events: InboxEvent[] = []
    inbox.subscribe(event => events.push(event))

    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste'), annotation('2', 'zweite')]))
    await inbox.publish(payload('ffee00112233', [annotation('1', 'fremde')]))
    await inbox.resolve(['a1b2c3d4e5f6-1', 'ffee00112233-1', 'nie-dagewesen'], 'implemented', undefined, 'agent')

    expect(events).toEqual([
      { type: 'published', sessionId: 'a1b2c3d4e5f6', ids: ['a1b2c3d4e5f6-1', 'a1b2c3d4e5f6-2'] },
      { type: 'published', sessionId: 'ffee00112233', ids: ['ffee00112233-1'] },
      { type: 'resolved', sessionId: 'a1b2c3d4e5f6', ids: ['a1b2c3d4e5f6-1'] },
      { type: 'resolved', sessionId: 'ffee00112233', ids: ['ffee00112233-1'] },
    ])
  })

  it('reports a tab clearing its session, and nothing for a resolve that closed nothing', async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste')]))
    const events: InboxEvent[] = []
    inbox.subscribe(event => events.push(event))

    await inbox.resolve(['nie-dagewesen'], 'implemented', undefined, 'agent')
    await inbox.publish(payload('a1b2c3d4e5f6', [], ''))

    expect(events).toEqual([{ type: 'published', sessionId: 'a1b2c3d4e5f6', ids: [] }])
  })

  it('stops notifying after unsubscribe', async () => {
    const events: InboxEvent[] = []
    const unsubscribe = inbox.subscribe(event => events.push(event))

    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste')]))
    unsubscribe()
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste'), annotation('2', 'zweite')]))

    expect(events).toHaveLength(1)
  })

  it('does not let a failing listener affect the operation or the other listeners', async () => {
    const seen: InboxEvent[] = []
    inbox.subscribe(() => {
      throw new Error('sync listener failure')
    })
    inbox.subscribe(async () => {
      throw new Error('async listener failure')
    })
    inbox.subscribe(event => seen.push(event))

    await expect(inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste')]))).resolves.toBeUndefined()
    await expect(inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', undefined, 'agent'))
      .resolves.toEqual({ resolved: ['a1b2c3d4e5f6-1'], unknown: [] })

    expect(seen.map(event => event.type)).toEqual(['published', 'resolved'])
    expect(await inbox.list({ status: 'closed' })).toHaveLength(1)
  })

  it('stamps with the injected clock', async () => {
    const fixed = createInbox(store, { now: () => new Date('2026-01-02T03:04:05.000Z') })
    await fixed.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste')]))
    await fixed.resolve(['a1b2c3d4e5f6-1'], 'implemented', undefined, 'agent')

    const [item] = await fixed.list({ status: 'all' })
    expect(item).toMatchObject({ receivedAt: '2026-01-02T03:04:05.000Z', resolvedAt: '2026-01-02T03:04:05.000Z' })
  })
})
