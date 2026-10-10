import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { beforeEach, describe, expect, it } from 'vitest'
import { createInbox, handleInboxRequest, markdownKey, sessionKey } from '../modules/annotation-inbox/inbox'
import type { Storage } from 'unstorage'
import type { Inbox, InboxRequest } from '../modules/annotation-inbox/inbox'
import type { InboxAnnotation, InboxItem, InboxPayload, InboxRole } from '../modules/annotation-inbox/contract'

/**
 * What the inbox promises the two people who use it: a reviewer, who clicks
 * something and expects the note to survive until it is answered, and an agent,
 * who has to be able to find open notes, act, and say what it did.
 *
 * Driven against the core over an in-memory store rather than through a dev
 * server: every decision worth asserting here — what a note is stored as, when
 * a resolution sticks, what leaves a listing — is made in `inbox.ts`, and the
 * transports are adapters over exactly this. The store is the real unstorage
 * one, because the key layout is part of the contract: one entry per note is
 * what lets a database-backed mount hold one row per note.
 */

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
 * A request as a transport hands it over, with the role the authorizer will
 * answer. `role` has no default on purpose: a default would swallow the
 * `undefined` that means "nobody", and the refusal cases would silently test
 * an authorised caller.
 */
async function request(
  init: Partial<InboxRequest> & { path: string },
  role: InboxRole | undefined,
  body?: unknown,
) {
  const query = init.query ?? new URLSearchParams()
  return handleInboxRequest(
    inbox,
    {
      method: init.method ?? 'GET',
      path: init.path,
      query,
      body: async () => (body === undefined ? '' : JSON.stringify(body)),
    },
    async () => role,
  )
}

describe('publishing a session', () => {
  it('stores one entry per note, keyed so that sessions cannot collide', async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief'), annotation('2', 'Text zu lang')]))
    await inbox.publish(payload('ffee00112233', [annotation('1', 'Anderer Tab')]))

    expect(await store.getKeys('items')).toEqual([
      'items:a1b2c3d4e5f6-1.json',
      'items:a1b2c3d4e5f6-2.json',
      'items:ffee00112233-1.json',
    ])

    const items = await inbox.list({ status: 'open' })
    expect(items.map(item => item.comment)).toContain('Button sitzt zu tief')
    expect(items.every(item => item.status === 'open')).toBe(true)
    expect(items.every(item => typeof item.receivedAt === 'string' && item.receivedAt.length > 0)).toBe(true)
    expect(await store.getItem(markdownKey('a1b2c3d4e5f6'))).toBe('## Feedback')
  })

  it('gives a note the element it was made on, and the route when there is no source position', async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [
      annotation('1', 'mit Tracer'),
      annotation('2', 'ohne Tracer', { vueComponents: 'App > GuidePicker' }),
      annotation('3', 'ganz ohne', { vueComponents: undefined }),
    ]))

    const byId = Object.fromEntries((await inbox.list({ status: 'all' })).map(item => [item.inboxId, item]))
    expect(byId['a1b2c3d4e5f6-1']!.target).toEqual({
      kind: 'element',
      ref: 'button:app/components/guide/GuidePicker.vue:52:6',
      label: 'GuidePicker',
    })
    expect(byId['a1b2c3d4e5f6-2']!.target).toEqual({ kind: 'route', ref: '/guide/atem', label: '/guide/atem' })
    expect(byId['a1b2c3d4e5f6-3']!.target.kind).toBe('route')
  })
})

describe('resolving notes', () => {
  beforeEach(async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'umsetzbar'), annotation('2', 'nicht umsetzbar')]))
  })

  it('answers which ids it closed and which it never had, and records the refusal', async () => {
    const result = await inbox.resolve(
      ['a1b2c3d4e5f6-2', 'nie-dagewesen'],
      'rejected',
      'Widerspricht dem Phone-Frame',
      'agent',
    )
    expect(result).toEqual({ resolved: ['a1b2c3d4e5f6-2'], unknown: ['nie-dagewesen'] })

    const [rejected] = await inbox.list({ status: 'rejected' })
    expect(rejected).toMatchObject({
      inboxId: 'a1b2c3d4e5f6-2',
      status: 'rejected',
      resolution: 'Widerspricht dem Phone-Frame',
      resolvedBy: 'agent',
    })
    expect(rejected!.resolvedAt).toBeTypeOf('string')
  })

  it('takes closed notes out of the default listing and shows them under closed', async () => {
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', undefined, 'agent')

    expect((await inbox.list({ status: 'open' })).map(item => item.inboxId)).toEqual(['a1b2c3d4e5f6-2'])
    expect((await inbox.list({ status: 'closed' })).map(item => item.inboxId)).toEqual(['a1b2c3d4e5f6-1'])
    expect((await inbox.list({ status: 'all' })).length).toBe(2)
  })

  it('keeps a resolution when the same tab publishes the note again', async () => {
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'umsetzbar'), annotation('2', 'nicht umsetzbar')]))

    const [closed] = await inbox.list({ status: 'closed' })
    expect(closed).toMatchObject({ inboxId: 'a1b2c3d4e5f6-1', status: 'implemented', resolution: 'erledigt' })
  })

  it('treats a reused local id as a new note once the toolbar counter resets', async () => {
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
    await inbox.publish(payload('a1b2c3d4e5f6', [
      annotation('1', 'neuer Hinweis', { timestamp: 1_700_000_500_000 }),
      annotation('2', 'nicht umsetzbar'),
    ]))

    const open = await inbox.list({ status: 'open' })
    expect(open.find(item => item.comment === 'neuer Hinweis')).toMatchObject({ status: 'open' })
    const closed = await inbox.list({ status: 'closed' })
    expect(closed).toMatchObject([
      { inboxId: 'a1b2c3d4e5f6-1', status: 'implemented', resolution: 'erledigt', comment: 'umsetzbar' },
    ])

    await inbox.publish(payload('a1b2c3d4e5f6', [
      annotation('1', 'neuer Hinweis', { timestamp: 1_700_000_500_000 }),
      annotation('2', 'nicht umsetzbar'),
    ]))
    expect((await inbox.list({ status: 'open' })).filter(item => item.comment === 'neuer Hinweis')).toHaveLength(1)
  })

  it('lets an agent correct a note it closed too early', async () => {
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'rejected', 'doch nicht machbar', 'agent')

    expect((await inbox.list({ status: 'implemented' })).length).toBe(0)
    expect((await inbox.list({ status: 'rejected' }))[0]).toMatchObject({ resolution: 'doch nicht machbar' })
  })

  it('refuses a status that does not close a note, and a request without ids', async () => {
    const wrongStatus = await request({ method: 'POST', path: '/resolve' }, 'agent', {
      ids: ['a1b2c3d4e5f6-1'],
      status: 'open',
    })
    expect(wrongStatus.status).toBe(400)
    expect(wrongStatus.body).toContain('implemented')

    const noIds = await request({ method: 'POST', path: '/resolve' }, 'agent', { ids: [], status: 'implemented' })
    expect(noIds.status).toBe(400)
    expect((await inbox.list({ status: 'open' })).length).toBe(2)
  })
})

describe('a tab taking its notes back', () => {
  beforeEach(async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste'), annotation('2', 'zweite')]))
    await inbox.publish(payload('ffee00112233', [annotation('1', 'fremde Sitzung')]))
  })

  it('deletes a note the human withdrew while it was still open', async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('2', 'zweite')]))

    expect((await inbox.list({ status: 'all' })).map(item => item.inboxId)).toEqual([
      'a1b2c3d4e5f6-2',
      'ffee00112233-1',
    ])
  })

  it('keeps an answered note when the tab drops its marker', async () => {
    // The tab dropping a closed note *is* the acknowledgement, and it is the
    // only signal the server gets that the human saw the answer. Deleting the
    // item here would take the reason with it, which is the one thing a
    // rejection exists to leave behind.
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'rejected', 'Widerspricht dem Phone-Frame', 'agent')
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('2', 'zweite')]))

    expect((await inbox.list({ status: 'closed' })).map(item => [item.inboxId, item.resolution])).toEqual([
      ['a1b2c3d4e5f6-1', 'Widerspricht dem Phone-Frame'],
    ])
  })

  it('clears everything it owns when it publishes nothing, and nothing another tab owns', async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [], ''))

    expect(await store.getItem(sessionKey('a1b2c3d4e5f6'))).toBeNull()
    expect(await store.getItem(markdownKey('a1b2c3d4e5f6'))).toBeNull()
    expect((await inbox.list({ status: 'all' })).map(item => item.inboxId)).toEqual(['ffee00112233-1'])
    expect(await store.getItem(markdownKey('ffee00112233'))).toBe('## Feedback')
  })

  it('keeps answered notes when an emptied tab publishes nothing', async () => {
    await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
    await inbox.publish(payload('a1b2c3d4e5f6', [], ''))

    expect((await inbox.list({ status: 'all', sessionId: 'a1b2c3d4e5f6' })).map(item => item.inboxId))
      .toEqual(['a1b2c3d4e5f6-1'])
  })
})

describe('the HTTP surface', () => {
  beforeEach(async () => {
    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))
  })

  it('renders a listing an agent can act on', async () => {
    const response = await request({ path: '', query: new URLSearchParams({ format: 'markdown' }) }, 'agent')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/markdown')
    expect(response.body).toContain('### a1b2c3d4e5f6-1')
    expect(response.body).toContain('app/components/guide/GuidePicker.vue:52:6')
    expect(response.body).toContain('POST /__annotations/resolve')
  })

  it('refuses a caller who is neither agent nor reviewer, but still answers the access probe', async () => {
    expect((await request({ path: '' }, undefined)).status).toBe(401)
    expect((await request({ method: 'POST', path: '' }, undefined, payload('a1b2c3d4e5f6', []))).status).toBe(401)

    const denied = await request({ path: '/access' }, undefined)
    expect(denied.status).toBe(200)
    expect(JSON.parse(denied.body)).toEqual({ allowed: false })

    const granted = await request({ path: '/access' }, 'reviewer')
    expect(JSON.parse(granted.body)).toEqual({ allowed: true })
  })

  it('names what it expected when a payload cannot be a session', async () => {
    const noSession = await request({ method: 'POST', path: '' }, 'reviewer', {
      origin: 'http://localhost:3040',
      annotations: [],
      markdown: '',
    })
    expect(noSession.status).toBe(400)
    expect(noSession.body).toContain('sessionId')

    const badOrigin = await request({ method: 'POST', path: '' }, 'reviewer', {
      ...payload('a1b2c3d4e5f6', []),
      origin: 'nicht-mal-eine-url',
    })
    expect(badOrigin.status).toBe(400)
    expect(badOrigin.body).toContain('origin')

    const listed: InboxItem[] = await inbox.list({ status: 'all' })
    expect(listed.length).toBe(1)
  })
})
