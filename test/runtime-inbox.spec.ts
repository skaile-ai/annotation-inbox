// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENTATION_STORAGE_KEY, INBOX_BASES_KEY, INBOX_POLL_MS, INBOX_SESSION_KEY } from '../modules/annotation-inbox/contract'
import { installAnnotationInbox, setAnnotationInboxBaseResolver } from '../modules/annotation-inbox/runtime/inbox'
import { setAnnotationInboxBaseResolver as reExported } from '../modules/annotation-inbox/runtime/mount'
import type { InboxAnnotation, InboxItem, InboxPayload } from '../modules/annotation-inbox/contract'
import type { InboxDeps } from '../modules/annotation-inbox/runtime/inbox'

/**
 * What the toolbar's client half promises the page it runs in: with no
 * resolver it makes the one request it always made, and with one each note
 * travels to the inbox its page belongs to — and only that one — while a base
 * that stops holding a note of this tab hears that it is gone.
 *
 * The library behind the toolbar is replaced by `InboxDeps` fakes: this file is
 * about the requests, and `inbox.ts` is by design the part that never names it.
 */

const ORIGIN = 'http://localhost:3040'
const MODULE_BASE = '/__annotations'
const A = '/api/workspaces/a/annotations'
const B = '/api/workspaces/b/annotations'

const note = (id: string, url: string, comment = `note ${id}`): InboxAnnotation => ({
  id,
  comment,
  elementPath: 'body > main > button',
  url,
  timestamp: 1_700_000_000_000,
})

const pageA = `${ORIGIN}/workspace/a`
const pageB = `${ORIGIN}/workspace/b`
const pageOther = `${ORIGIN}/concepts`

/** `/workspace/<id>` pages belong to that workspace's inbox, the rest to the module's. */
const byWorkspace = (pageUrl: string): string | undefined => {
  const match = /\/workspace\/([^/?#]+)/.exec(pageUrl)
  return match ? `/api/workspaces/${match[1]}/annotations` : undefined
}

interface Call { url: string, method: string, payload?: InboxPayload }

let calls: Call[]
let closed: Record<string, InboxItem[]>
let down: Set<string>
let removed: string[]
let write: (annotations: InboxAnnotation[]) => void

const posts = () => calls.filter(call => call.method === 'POST')
const gets = () => calls.filter(call => call.method === 'GET')
const sessionId = () => sessionStorage.getItem(INBOX_SESSION_KEY)!

function closedItem(id: string): InboxItem {
  return {
    ...note(id, pageA),
    inboxId: `${sessionId()}-${id}`,
    sessionId: sessionId(),
    origin: ORIGIN,
    target: { kind: 'route', ref: '/workspace/a', label: '/workspace/a' },
    status: 'implemented',
    receivedAt: '2026-01-01T00:00:00.000Z',
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(pageA)
  calls = []
  closed = {}
  down = new Set()
  removed = []

  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const [url] = input.split('?') as [string]
    const method = init?.method ?? 'GET'
    calls.push({ url: input, method, payload: init?.body ? JSON.parse(init.body as string) as InboxPayload : undefined })
    if (down.has(url)) throw new Error('unreachable')
    return { ok: true, json: async () => ({ status: 'closed', items: closed[url] ?? [] }) }
  }))
})

afterEach(() => {
  setAnnotationInboxBaseResolver(null)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Starts the client half with fake deps and hands back the way the library writes its store. */
function install(options: { base?: string } = {}): void {
  let adapter: Parameters<InboxDeps['setAnnotationStorage']>[0]
  const deps: InboxDeps = {
    setAnnotationStorage: (next) => { adapter = next },
    setVueDetector: () => {},
    formatAnnotations: (annotations, _detail, pageUrl) => `md[${annotations.map(entry => entry.id).join(',')}]@${pageUrl}`,
    findTraceFromElement: () => undefined,
    removeAnnotation: (id) => { removed.push(id) },
  }
  installAnnotationInbox(deps, options)
  write = (annotations) => adapter.setItem(AGENTATION_STORAGE_KEY, JSON.stringify({ [location.origin]: annotations }))
}

const tick = () => vi.advanceTimersByTimeAsync(INBOX_POLL_MS)

describe('without a resolver', () => {
  it('is the one request it always was: a single POST on load, a single POST per change, a single poll', async () => {
    install()

    expect(calls.map(call => [call.method, call.url])).toEqual([['POST', MODULE_BASE]])
    expect(calls[0]!.payload).toEqual({ sessionId: sessionId(), origin: ORIGIN, url: pageA, annotations: [], markdown: '' })

    calls.length = 0
    const notes = [note('1', pageA), note('2', pageB)]
    write(notes)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ method: 'POST', url: MODULE_BASE })
    expect(calls[0]!.payload).toEqual({
      sessionId: sessionId(),
      origin: ORIGIN,
      url: pageA,
      annotations: notes,
      markdown: `md[1,2]@${pageA}`,
    })

    calls.length = 0
    await tick()
    expect(calls.map(call => [call.method, call.url])).toEqual([['GET', `${MODULE_BASE}?session=${sessionId()}&status=closed`]])
  })

  it('posts an empty session to the one base when the last note goes, and a tab with no notes does not poll', async () => {
    install()
    write([note('1', pageA)])
    calls.length = 0

    write([])
    expect(posts().map(call => [call.url, call.payload!.annotations.length])).toEqual([[MODULE_BASE, 0]])

    calls.length = 0
    await tick()
    expect(calls).toEqual([])
  })

  it('uses the base option for the one base', () => {
    install({ base: '/notes' })
    write([note('1', pageA)])
    expect(posts().map(call => call.url)).toEqual(['/notes', '/notes'])
  })

  it('is exported from the mount too, as the same function', () => {
    expect(reExported).toBe(setAnnotationInboxBaseResolver)
  })
})

describe('with a resolver', () => {
  beforeEach(() => setAnnotationInboxBaseResolver(byWorkspace))

  it('posts each base its own notes, with markdown formatted from that group only', () => {
    install()
    calls.length = 0

    write([note('1', pageA), note('2', pageB), note('3', pageA), note('4', pageOther)])

    expect(posts().map(call => call.url)).toEqual([A, B, MODULE_BASE])
    const [toA, toB, toModule] = posts().map(call => call.payload!)
    expect(toA!.annotations.map(entry => entry.id)).toEqual(['1', '3'])
    expect(toB!.annotations.map(entry => entry.id)).toEqual(['2'])
    expect(toModule!.annotations.map(entry => entry.id)).toEqual(['4'])
    expect(toA!.markdown).toBe(`md[1,3]@${pageA}`)
    expect(toB!.markdown).toBe(`md[2]@${pageA}`)
    for (const payload of [toA!, toB!, toModule!]) {
      expect(payload).toMatchObject({ sessionId: sessionId(), origin: ORIGIN, url: pageA })
    }
  })

  it('files a note without a url under the page it was made on', () => {
    install()
    calls.length = 0
    const bare: InboxAnnotation = { id: '1', comment: 'x', elementPath: 'div', timestamp: 1 }
    write([bare])
    expect(posts().map(call => call.url)).toEqual([A])
  })

  it('does not post a base that never held a note, not even on load', () => {
    install()
    expect(calls).toEqual([])
  })

  it('tells a base that lost its last note, once, and stops mentioning it after', () => {
    install()
    write([note('1', pageA), note('2', pageB)])
    calls.length = 0

    write([note('2', pageB)])
    expect(posts().map(call => [call.url, call.payload!.annotations.map(entry => entry.id)])).toEqual([
      [B, ['2']],
      [A, []],
    ])
    expect(posts()[1]!.payload!.markdown).toBe('')

    calls.length = 0
    write([note('2', pageB), note('5', pageB)])
    expect(posts().map(call => call.url)).toEqual([B])

    calls.length = 0
    write([])
    expect(posts().map(call => [call.url, call.payload!.annotations.length])).toEqual([[B, 0]])
    calls.length = 0
    write([])
    expect(calls).toEqual([])
  })

  it('remembers the published bases in sessionStorage', () => {
    install()
    write([note('1', pageA), note('2', pageB)])
    expect(JSON.parse(sessionStorage.getItem(INBOX_BASES_KEY)!)).toEqual([A, B])
    write([note('2', pageB)])
    expect(JSON.parse(sessionStorage.getItem(INBOX_BASES_KEY)!)).toEqual([B])
  })

  it('republishes on load by the same rule: each base its notes, a base from before an empty session', () => {
    sessionStorage.setItem(INBOX_SESSION_KEY, 'abc123def456')
    sessionStorage.setItem(AGENTATION_STORAGE_KEY, JSON.stringify({ [ORIGIN]: [note('1', pageB)] }))
    sessionStorage.setItem(INBOX_BASES_KEY, JSON.stringify([A, B]))

    install()

    expect(posts().map(call => [call.url, call.payload!.sessionId, call.payload!.annotations.map(entry => entry.id)])).toEqual([
      [B, 'abc123def456', ['1']],
      [A, 'abc123def456', []],
    ])
  })

  it('moves a note between bases when its page now resolves elsewhere', () => {
    install()
    write([note('1', pageOther)])
    calls.length = 0

    setAnnotationInboxBaseResolver(() => A)
    write([note('1', pageOther)])

    expect(posts().map(call => [call.url, call.payload!.annotations.length])).toEqual([[A, 1], [MODULE_BASE, 0]])
  })

  it('reads the resolver lazily: registered after the toolbar, replaced, or removed', () => {
    setAnnotationInboxBaseResolver(null)
    install()
    calls.length = 0

    write([note('1', pageA)])
    expect(posts().map(call => call.url)).toEqual([MODULE_BASE])

    setAnnotationInboxBaseResolver(byWorkspace)
    calls.length = 0
    write([note('1', pageA)])
    expect(posts().map(call => call.url)).toEqual([A, MODULE_BASE])

    setAnnotationInboxBaseResolver(null)
    calls.length = 0
    write([note('1', pageA)])
    expect(posts().map(call => [call.url, call.payload!.annotations.length])).toEqual([[MODULE_BASE, 1], [A, 0]])
  })

  it('falls back to the module base when the resolver throws', () => {
    install()
    calls.length = 0
    setAnnotationInboxBaseResolver(() => { throw new Error('workspaces not loaded') })
    write([note('1', pageA)])
    expect(posts().map(call => call.url)).toEqual([MODULE_BASE])
  })

  it('polls only the bases that hold a note, each for this tab\'s closed notes, and removes what they return', async () => {
    install()
    write([note('1', pageA), note('2', pageB)])
    closed[A] = [closedItem('1')]
    calls.length = 0

    await tick()
    expect(gets().map(call => call.url).sort()).toEqual([
      `${A}?session=${sessionId()}&status=closed`,
      `${B}?session=${sessionId()}&status=closed`,
    ])
    expect(removed).toEqual(['1'])

    write([note('2', pageB)])
    calls.length = 0
    removed.length = 0
    await tick()
    expect(gets().map(call => call.url)).toEqual([`${B}?session=${sessionId()}&status=closed`])
  })

  it('lets one base be down without losing the answers of another', async () => {
    install()
    write([note('1', pageA), note('2', pageB)])
    down.add(A)
    closed[B] = [closedItem('2')]

    await tick()
    expect(removed).toEqual(['2'])
  })
})
