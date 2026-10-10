import { createServer } from 'node:http'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEV_PRINCIPAL } from '../modules/annotation-inbox/principal'
import { createInboxHandler } from '../modules/annotation-inbox/vite'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'

/**
 * The one thing the dev-server adapter decides for itself: how a node request
 * becomes the transport-neutral request the core answers. Everything else it
 * delegates, and `inbox.spec.ts` asserts that over the core directly.
 *
 * Driven through a real `http.createServer` rather than a Vite dev server,
 * because what could plausibly break here is stream and URL handling —
 * connect's stripped mount prefix, a query string, a body that arrives in
 * chunks, a `204` that must carry none — and standing up Vite to ask that
 * would be testing Vite.
 */

const store = createStorage({ driver: memoryDriver() })
let server: Server
let origin: string

beforeAll(async () => {
  const handle = createInboxHandler({ store, authorize: async () => DEV_PRINCIPAL })
  server = createServer((req, res) => {
    void handle(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

describe('the dev-server adapter', () => {
  it('carries a posted session in and a filtered listing back out', async () => {
    const published = await fetch(`${origin}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'a1b2c3d4e5f6',
        origin,
        url: `${origin}/iframe.html?id=guide-picker--default`,
        annotations: [{
          id: '1',
          comment: 'Button sitzt zu tief',
          elementPath: 'body > button',
          vueComponents: 'App > GuidePicker > button:app/components/guide/GuidePicker.vue:52:6',
          url: `${origin}/iframe.html?id=guide-picker--default`,
          timestamp: 1_700_000_000_000,
        }],
        markdown: '## Feedback',
      }),
    })
    expect(published.status).toBe(204)
    expect(await published.text()).toBe('')

    const listing = await fetch(`${origin}/?status=open&format=markdown`)
    expect(listing.headers.get('content-type')).toContain('text/markdown')
    expect(await listing.text()).toContain('### a1b2c3d4e5f6-1')

    const resolved = await fetch(`${origin}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['a1b2c3d4e5f6-1'], status: 'rejected', resolution: 'Widerspricht dem Phone-Frame' }),
    })
    expect(await resolved.json()).toEqual({ resolved: ['a1b2c3d4e5f6-1'], unknown: [] })

    const open = await (await fetch(`${origin}/`)).json()
    expect(open.items).toEqual([])
  })

  it('refuses a path it does not serve and a method it does not allow', async () => {
    expect((await fetch(`${origin}/nirgendwo`)).status).toBe(404)
    expect((await fetch(`${origin}/resolve`)).status).toBe(405)
  })
})
