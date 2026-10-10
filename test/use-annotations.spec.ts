import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnnotations } from '../src/vue'
import type { InboxItem } from '../modules/annotation-inbox/contract'
import type { AnnotationsFetch, UseAnnotationsOptions } from '../src/vue'

const item = (id: string, status: InboxItem['status'] = 'open'): InboxItem => ({
  id,
  inboxId: `s1-${id}`,
  sessionId: 's1',
  origin: 'http://localhost:3000',
  comment: `note ${id}`,
  elementPath: 'div > button',
  timestamp: 1,
  target: { kind: 'element', ref: 'app/components/Foo.vue:4:2', label: 'Foo' },
  status,
  receivedAt: '2026-01-01T00:00:00.000Z',
})

interface Call { url: string, init?: Parameters<AnnotationsFetch>[1] }

/** A `$fetch` stand-in answering from a mutable listing, recording every call. */
function fakeFetch(listing: { items: InboxItem[] }) {
  const calls: Call[] = []
  const fetch = (async (url: string, init?: Call['init']) => {
    calls.push({ url, init })
    if (init?.method === 'POST') return { resolved: (init.body as { ids: string[] }).ids, unknown: [] }
    return { status: 'open', items: listing.items }
  }) as AnnotationsFetch
  return { fetch, calls }
}

/** `useAnnotations` inside an effect scope, the way a component's setup runs it. */
function mount(options: UseAnnotationsOptions) {
  const scope = effectScope()
  const api = scope.run(() => useAnnotations(options))!
  return { api, stop: () => scope.stop() }
}

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}

describe('useAnnotations', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads on start and re-reads the listing every pollMs', async () => {
    const listing = { items: [item('1')] }
    const { fetch, calls } = fakeFetch(listing)
    const { api, stop } = mount({ list: '/__annotations', resolve: '/__annotations/resolve', fetch, pollMs: 1000 })

    await settle()
    expect(api.items.value.map(entry => entry.inboxId)).toEqual(['s1-1'])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/__annotations?status=open')

    listing.items = [item('1'), item('2')]
    await vi.advanceTimersByTimeAsync(1000)
    expect(api.items.value.map(entry => entry.inboxId)).toEqual(['s1-1', 's1-2'])
    expect(calls).toHaveLength(2)

    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls).toHaveLength(2)
  })

  it('polls every 10 s by default and never when pollMs is 0', async () => {
    const polling = fakeFetch({ items: [] })
    const first = mount({ list: '/a', resolve: '/a/resolve', fetch: polling.fetch })
    await settle()
    await vi.advanceTimersByTimeAsync(9999)
    expect(polling.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(polling.calls).toHaveLength(2)
    first.stop()

    const still = fakeFetch({ items: [] })
    const second = mount({ list: '/a', resolve: '/a/resolve', fetch: still.fetch, pollMs: 0 })
    await settle()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(still.calls).toHaveLength(1)
    second.stop()
  })

  it('re-queries with the new filter when status changes, and appends to an existing query string', async () => {
    const { fetch, calls } = fakeFetch({ items: [] })
    const { api, stop } = mount({ list: () => '/api/ws/7/annotations?x=1', resolve: '/r', fetch, pollMs: 0 })
    await settle()
    expect(calls[0]!.url).toBe('/api/ws/7/annotations?x=1&status=open')

    api.status.value = 'closed'
    await settle()
    expect(calls[1]!.url).toBe('/api/ws/7/annotations?x=1&status=closed')
    stop()
  })

  it('keeps the last good items and reports the error when a refresh fails', async () => {
    const listing = { items: [item('1')] }
    let fail = false
    const fetch = (async () => {
      if (fail) throw new Error('boom')
      return { status: 'open', items: listing.items }
    }) as AnnotationsFetch
    const { api, stop } = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0 })
    await settle()

    fail = true
    await api.refresh()
    expect(api.error.value?.message).toBe('boom')
    expect(api.items.value).toHaveLength(1)
    expect(api.loading.value).toBe(false)

    fail = false
    await api.refresh()
    expect(api.error.value).toBeNull()
    stop()
  })

  it('refuses a rejection without a resolution before sending anything', async () => {
    const { fetch, calls } = fakeFetch({ items: [item('1')] })
    const { api, stop } = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0 })
    await settle()
    const before = calls.length

    await expect(api.resolve(['s1-1'], 'rejected')).rejects.toThrow(/needs a resolution/)
    await expect(api.resolve(['s1-1'], 'rejected', '   ')).rejects.toThrow(/needs a resolution/)
    expect(calls).toHaveLength(before)
    stop()
  })

  it('posts { ids, status, resolution } to the resolve endpoint and refreshes', async () => {
    const { fetch, calls } = fakeFetch({ items: [item('1')] })
    const { api, stop } = mount({ list: '/l', resolve: '/api/ws/7/annotations/resolve', fetch, pollMs: 0 })
    await settle()

    const result = await api.resolve(['s1-1'], 'rejected', ' too wide ')
    expect(result).toEqual({ resolved: ['s1-1'], unknown: [] })
    const post = calls.find(call => call.init?.method === 'POST')!
    expect(post.url).toBe('/api/ws/7/annotations/resolve')
    expect(post.init!.body).toEqual({ ids: ['s1-1'], status: 'rejected', resolution: 'too wide' })
    // …and re-read the listing afterwards.
    expect(calls.at(-1)!.url).toBe('/l?status=open')

    await api.resolve(['s1-1'], 'implemented')
    expect(calls.filter(call => call.init?.method === 'POST')[1]!.init!.body).toEqual({ ids: ['s1-1'], status: 'implemented' })
    stop()
  })

  it('surfaces a failed resolve as error and rethrows', async () => {
    const fetch = (async (_url: string, init?: Call['init']) => {
      if (init?.method === 'POST') throw new Error('409 conflict')
      return { status: 'open', items: [] }
    }) as AnnotationsFetch
    const { api, stop } = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0 })
    await expect(api.resolve(['x'], 'implemented')).rejects.toThrow('409 conflict')
    expect(api.error.value?.message).toBe('409 conflict')
    stop()
  })

  it('translates through locale and lets messages override single keys', () => {
    const { fetch } = fakeFetch({ items: [] })
    const en = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0 })
    expect(en.api.t('implement')).toBe('Implement')
    en.stop()

    const de = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0, locale: 'de', messages: { reject: 'Verwerfen' } })
    expect(de.api.t('implement')).toBe('Umsetzen')
    expect(de.api.t('reject')).toBe('Verwerfen')
    expect(de.api.t('session', { id: 'abc' })).toBe('Sitzung abc')
    de.stop()
  })

  it('counts open items', async () => {
    const { fetch } = fakeFetch({ items: [item('1'), item('2', 'implemented')] })
    const { api, stop } = mount({ list: '/l', resolve: '/r', fetch, pollMs: 0 })
    await settle()
    expect(api.openCount.value).toBe(1)
    stop()
  })
})
