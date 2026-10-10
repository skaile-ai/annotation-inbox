import { INBOX_ROUTE, inboxRoutes } from './contract.ts'
import { principalLabel } from './principal.ts'
import type { Storage } from 'unstorage'
import type {
  InboxAnnotation,
  InboxItem,
  InboxListing,
  InboxPayload,
  InboxSession,
  InboxStatus,
  InboxTarget,
} from './contract.ts'
import type { Principal } from './principal.ts'

/**
 * The inbox itself: what an annotation becomes once it leaves the browser, and
 * what may be done to it afterwards.
 *
 * **Framework-neutral on purpose.** This file imports `./contract.ts` and a
 * type from `unstorage`, nothing else — no Vite, no Nitro, no `node:fs`, no
 * `h3`. The same feature has to exist under `nuxt dev`, under `storybook dev`
 * and in the deployed server, and those three share no request object. So the
 * decisions worth testing (what a note is stored as, when a resolution sticks,
 * what a listing says) live here, and each harness contributes only an adapter
 * that turns its own request into `InboxRequest`.
 *
 * **One key per note.** A session's items are not a blob under the session's
 * key: each is its own entry. That is the difference between a store that can
 * answer "what is still open and what was rejected, and why" as a query and
 * one that can only be scanned — and it is what makes a row of a SQLite table
 * exactly one annotation when a host mounts a database here.
 *
 * The cost is that a session has no key prefix of its own to enumerate:
 * unstorage reads `:` as a segment separator, so `getKeys('items:<id>')`
 * matches nothing at all rather than matching that session. `InboxSession.
 * itemIds` is therefore load-bearing, not a convenience — it is the only
 * membership index a session has, and deleting a session's notes means walking
 * it.
 */

/** Everything this core needs of a store; `Storage` itself is far wider. */
export type InboxStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'getKeys'>

export const itemKey = (inboxId: string) => `items:${inboxId}.json`
export const sessionKey = (sessionId: string) => `sessions:${sessionId}.json`
export const markdownKey = (sessionId: string) => `markdown:${sessionId}.md`

/** What a session id may look like — see `parsePayload`. */
const SESSION_ID = /^[a-z0-9]{6,32}$/

/** `app/components/guide/GuidePicker.vue:52:6` — a tracer source position. */
const SOURCE_POSITION = /^(.+):(\d+):(\d+)$/

/**
 * The package's one canonical object guard. This is a standalone package with
 * no shared type-guard module, and everything it reads — a request body, a
 * value out of a store somebody else mounted — is untrusted JSON, so the
 * `unknown → object` step happens here and nowhere else.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const PAYLOAD_EXPECTED =
  'annotation inbox: expected { sessionId, origin: URL, annotations: [], markdown: "" }'

/**
 * A payload from the wire, or `undefined`. Validates only what the server
 * itself depends on — the session id, because it becomes part of a storage
 * key, and the origin, because a listing shows it. The annotations pass
 * through: their extra fields are the library's, and dropping unknown ones
 * would mean this file tracking a dependency it is not allowed to name.
 */
export function parsePayload(value: unknown): InboxPayload | undefined {
  if (!isRecord(value)) return undefined
  const { sessionId, origin, url, annotations, markdown } = value
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return undefined
  if (typeof origin !== 'string' || !URL.canParse(origin)) return undefined
  if (!Array.isArray(annotations)) return undefined
  if (typeof markdown !== 'string') return undefined
  return {
    sessionId,
    origin,
    url: typeof url === 'string' ? url : origin,
    annotations: annotations.filter(isRecord).map(entry => entry as unknown as InboxAnnotation),
    markdown,
  }
}

/**
 * What a note is about. The last chain entry carrying a source position wins —
 * the chain runs outermost to innermost, so the last one is the component the
 * reviewer actually clicked, not the page wrapping it.
 */
export function resolveTarget(annotation: InboxAnnotation): InboxTarget {
  const chain = (annotation.vueComponents ?? '')
    .split('>')
    .map(entry => entry.trim())
    .filter(Boolean)
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const match = SOURCE_POSITION.exec(chain[index]!)
    if (!match) continue
    const file = match[1]!
    const previous = chain[index - 1]
    const label = previous && !SOURCE_POSITION.test(previous)
      ? previous
      : (file.split('/').pop() ?? file)
    return { kind: 'element', ref: chain[index]!, label }
  }
  const pathname = annotation.url && URL.canParse(annotation.url)
    ? new URL(annotation.url).pathname
    : '/'
  return { kind: 'route', ref: pathname, label: pathname }
}

/** `- **Label:** value`, or nothing at all when there is no value. */
const line = (label: string, value: string | undefined) =>
  value ? [`- **${label}:** ${value}`] : []

/**
 * The listing an agent reads. Written for a reader who must be able to act and
 * then say so: every item names the id and the exact request that closes it,
 * because a listing that cannot be answered leaves the reviewer waiting.
 */
export function renderMarkdown(
  items: InboxItem[],
  status: InboxStatus | 'closed' | 'all',
  options: { base?: string } = {},
): string {
  const head = [
    `## Annotation inbox — ${items.length} ${status}`,
    '',
    `Resolve: POST ${inboxRoutes(options.base).resolve} {"ids":["<inboxId>"],"status":"implemented"|"rejected","resolution":"<why>"}`,
  ]
  const body = items.flatMap(item => [
    '',
    `### ${item.inboxId} · ${item.target.label} — ${item.url ?? item.origin}`,
    '',
    ...line('Comment', item.comment),
    `- **Target:** ${item.target.kind} \`${item.target.ref}\``,
    ...line('Components', item.vueComponents),
    ...line('Path', item.elementPath),
    ...line('Context', (item as { nearbyText?: string }).nearbyText),
    ...line('Recorded', item.receivedAt),
    `- **Status:** ${item.status === 'open'
      ? 'open'
      : `${item.status} ${item.resolvedAt ?? ''}`.trim() +
        (item.resolution ? ` — ${item.resolution}` : '')}`,
  ])
  return [...head, ...body, ''].join('\n')
}

/**
 * What happened to an inbox, for hosts that fan it out (push, SSE, a badge).
 * `ids` are inbox ids: after `published`, every note the session now holds
 * (none when the tab cleared it); after `resolved`, the notes just closed.
 * One `resolved` event per session, because a call may close notes of several.
 */
export interface InboxEvent {
  type: 'published' | 'resolved'
  sessionId: string
  ids: string[]
}

export type InboxListener = (event: InboxEvent) => void

/** What a caller may ask of an inbox, whatever store is underneath it. */
export interface Inbox {
  /**
   * Called after `publish` / `resolve` has succeeded. A listener that throws —
   * or returns a promise that rejects — is swallowed: observers must not be
   * able to fail the operation they observe. Returns the unsubscribe.
   */
  subscribe(listener: InboxListener): () => void
  /** Replace one tab's session; resolutions already recorded survive. */
  publish(payload: InboxPayload): Promise<void>
  list(filter: {
    status: InboxStatus | 'closed' | 'all'
    sessionId?: string
  }): Promise<InboxItem[]>
  resolve(
    ids: string[],
    status: 'implemented' | 'rejected',
    resolution: string | undefined,
    by: string,
  ): Promise<{ resolved: string[], unknown: string[] }>
}

export interface InboxOptions {
  /** The clock behind `receivedAt` / `resolvedAt` / `updatedAt`; injectable for tests. */
  now?: () => Date
}

export function createInbox(store: InboxStore, options: InboxOptions = {}): Inbox {
  const now = options.now ?? (() => new Date())
  const listeners = new Set<InboxListener>()

  const emit = (event: InboxEvent): void => {
    for (const listener of [...listeners]) {
      try {
        const result: unknown = listener(event)
        if (result instanceof Promise) result.catch(() => {})
      } catch {
        // An observer's failure is the observer's own.
      }
    }
  }

  const readSession = async (sessionId: string): Promise<InboxSession | undefined> => {
    const value = await store.getItem(sessionKey(sessionId))
    if (!isRecord(value) || !Array.isArray(value.itemIds)) return undefined
    return value as unknown as InboxSession
  }

  const readItem = async (inboxId: string): Promise<InboxItem | undefined> => {
    const value = await store.getItem(itemKey(inboxId))
    return isRecord(value) ? (value as unknown as InboxItem) : undefined
  }

  return {
    subscribe(listener: InboxListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * A tab's whole current session. New notes arrive `open`; notes already
     * here keep everything the server decided about them — that is what makes
     * a resolution stick across the republish a tab does on every change.
     *
     * A note the tab no longer sends is treated by its status, and the
     * distinction is the whole point of the round trip. Still `open` means the
     * human deleted it, and it is gone for good. Already answered means the
     * tab is acknowledging the answer by dropping the marker — the item stays,
     * because the resolution and its reason are what an agent and a reviewer
     * read the listing for. Its id stays in `itemIds` as well, so a later
     * teardown still finds it.
     */
    async publish(payload: InboxPayload): Promise<void> {
      const previous = await readSession(payload.sessionId)
      const stamp = now().toISOString()
      const closed: string[] = []
      for (const inboxId of previous?.itemIds ?? []) {
        const item = await readItem(inboxId)
        if (item && item.status !== 'open') closed.push(inboxId)
      }

      if (payload.annotations.length === 0 && closed.length === 0) {
        for (const inboxId of previous?.itemIds ?? []) await store.removeItem(itemKey(inboxId))
        await store.removeItem(sessionKey(payload.sessionId))
        await store.removeItem(markdownKey(payload.sessionId))
        emit({ type: 'published', sessionId: payload.sessionId, ids: [] })
        return
      }

      const itemIds: string[] = [...closed]
      for (const annotation of payload.annotations) {
        let inboxId = `${payload.sessionId}-${annotation.id}`
        let existing = await readItem(inboxId)
        // The toolbar's per-tab counter (`annotation.id`) is seeded from the notes
        // still in `sessionStorage` at mount time (reload, HMR remount, or every
        // open note resolved back to zero), while `sessionId` lives as long as the
        // tab. A new note can therefore land on an id an already resolved note
        // owns, and inheriting that record's status makes it vanish from `open`
        // unseen. `timestamp` is set once per note and stays fixed across its
        // republishes, so a mismatch tells a reused id from a resent note.
        if (existing && existing.timestamp !== annotation.timestamp) {
          inboxId = `${payload.sessionId}-${annotation.id}-${annotation.timestamp}`
          existing = await readItem(inboxId)
        }
        if (!itemIds.includes(inboxId)) itemIds.push(inboxId)
        await store.setItem(itemKey(inboxId), {
          ...annotation,
          inboxId,
          sessionId: payload.sessionId,
          origin: payload.origin,
          target: resolveTarget(annotation),
          status: existing?.status ?? 'open',
          receivedAt: existing?.receivedAt ?? stamp,
          ...(existing?.resolvedAt ? { resolvedAt: existing.resolvedAt } : {}),
          ...(existing?.resolution ? { resolution: existing.resolution } : {}),
          ...(existing?.resolvedBy ? { resolvedBy: existing.resolvedBy } : {}),
        } satisfies InboxItem)
      }

      for (const inboxId of previous?.itemIds ?? []) {
        if (!itemIds.includes(inboxId)) await store.removeItem(itemKey(inboxId))
      }

      await store.setItem(sessionKey(payload.sessionId), {
        sessionId: payload.sessionId,
        origin: payload.origin,
        url: payload.url,
        updatedAt: stamp,
        itemIds,
      } satisfies InboxSession)
      await store.setItem(markdownKey(payload.sessionId), payload.markdown)
      emit({ type: 'published', sessionId: payload.sessionId, ids: [...itemIds] })
    },

    async list(filter: {
      status: InboxStatus | 'closed' | 'all'
      sessionId?: string
    }): Promise<InboxItem[]> {
      const keys = await store.getKeys('items')
      const items: InboxItem[] = []
      for (const key of keys) {
        const value = await store.getItem(key)
        if (!isRecord(value) || typeof value.inboxId !== 'string') continue
        const item = value as unknown as InboxItem
        if (filter.sessionId && item.sessionId !== filter.sessionId) continue
        const matches = filter.status === 'all'
          ? true
          : filter.status === 'closed'
            ? item.status !== 'open'
            : item.status === filter.status
        if (!matches) continue
        items.push(item)
      }
      return items.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))
    },

    /**
     * Closing notes. Re-resolving an already closed note overwrites it on
     * purpose: an agent that marked something implemented and then found it
     * could not must be able to correct the record.
     */
    async resolve(
      ids: string[],
      status: 'implemented' | 'rejected',
      resolution: string | undefined,
      by: string,
    ): Promise<{ resolved: string[], unknown: string[] }> {
      const resolved: string[] = []
      const missing: string[] = []
      const bySession = new Map<string, string[]>()
      const resolvedAt = now().toISOString()
      for (const id of ids) {
        const item = await readItem(id)
        if (!item) {
          missing.push(id)
          continue
        }
        await store.setItem(itemKey(id), {
          ...item,
          status,
          resolvedAt,
          resolvedBy: by,
          ...(resolution ? { resolution } : {}),
        } satisfies InboxItem)
        resolved.push(id)
        bySession.set(item.sessionId, [...(bySession.get(item.sessionId) ?? []), id])
      }
      for (const [sessionId, ids] of bySession) emit({ type: 'resolved', sessionId, ids })
      return { resolved, unknown: missing }
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Transport-neutral request handling                                          */
/* -------------------------------------------------------------------------- */

/**
 * A request reduced to what the route table branches on. `principal` is the
 * caller as the host already established them — the transport authenticates,
 * this core only decides what that identity may do — and `null` means nobody.
 */
export interface InboxRequest {
  method: string
  /**
   * The request URL, path and query; absolute or origin-relative. The path
   * must sit under `options.base` (default `INBOX_ROUTE`).
   */
  url: string
  /** The raw request body, or a reader for it — only read when a route needs it. */
  body?: string | (() => string | Promise<string>)
  principal: Principal | null
}

export interface InboxResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface HandleInboxOptions {
  /** Where the inbox is mounted; default `INBOX_ROUTE`. */
  base?: string
}

export function bearerToken(authorization: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? '')
  return match ? match[1]!.trim() || undefined : undefined
}

const text = (status: number, body: string): InboxResponse => ({
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body,
})

const json = (status: number, value: unknown): InboxResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(value),
})

const LIST_STATUSES: Record<string, true> = {
  open: true,
  implemented: true,
  rejected: true,
  closed: true,
  all: true,
}

/**
 * The route table, once. `/access` is the only path that answers an
 * unauthorised caller: it is how a client asks whether to show a toolbar at
 * all, and answering that question with a `401` would make every page load of
 * an ordinary reader look like a failed request.
 */
export async function handleInboxRequest(
  inbox: Inbox,
  request: InboxRequest,
  options: HandleInboxOptions = {},
): Promise<InboxResponse> {
  const method = request.method.toUpperCase()
  const base = options.base ?? INBOX_ROUTE
  const url = new URL(request.url, 'http://annotation-inbox.invalid')
  if (!url.pathname.startsWith(base)) return text(404, 'annotation inbox: unknown route')
  const path = url.pathname.slice(base.length).replace(/\/$/, '')
  const query = url.searchParams
  const readBody = async (): Promise<string> =>
    typeof request.body === 'function' ? await request.body() : (request.body ?? '')
  const { principal } = request

  if (path === '/access') {
    if (method !== 'GET') return text(405, 'annotation inbox: GET')
    return json(200, { allowed: principal !== null })
  }

  const known = path === '' || path === '/resolve'
  if (!known) return text(404, 'annotation inbox: unknown route')

  if (path === '' && method !== 'GET' && method !== 'POST') {
    return text(405, 'annotation inbox: GET, POST')
  }
  if (path === '/resolve' && method !== 'POST') {
    return text(405, 'annotation inbox: POST')
  }

  if (!principal) return text(401, 'annotation inbox: unauthorized')

  if (path === '/resolve') {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody())
    } catch {
      parsed = undefined
    }
    if (!isRecord(parsed)) return text(400, 'annotation inbox: expected a JSON object')
    const { ids, status, resolution } = parsed
    if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => typeof id !== 'string')) {
      return text(400, 'annotation inbox: expected { ids: ["<inboxId>"], status }')
    }
    if (status !== 'implemented' && status !== 'rejected') {
      return text(400, 'annotation inbox: status must be "implemented" or "rejected"')
    }
    const reason = typeof resolution === 'string' && resolution.trim() ? resolution.trim() : undefined
    if (status === 'rejected' && !reason) {
      return text(400, 'annotation inbox: rejected needs a resolution — the reason is what a refusal is for')
    }
    const result = await inbox.resolve(
      ids as string[],
      status,
      reason,
      principalLabel(principal),
    )
    return json(200, result)
  }

  if (method === 'POST') {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readBody())
    } catch {
      parsed = undefined
    }
    const payload = parsePayload(parsed)
    if (!payload) return text(400, PAYLOAD_EXPECTED)
    await inbox.publish(payload)
    return { status: 204, headers: {}, body: '' }
  }

  const requested = query.get('status') ?? 'open'
  if (!LIST_STATUSES[requested]) {
    return text(400, 'annotation inbox: status must be one of open, implemented, rejected, closed, all')
  }
  const status = requested as InboxStatus | 'closed' | 'all'
  const sessionId = query.get('session') ?? undefined
  const items = await inbox.list({ status, ...(sessionId ? { sessionId } : {}) })

  if (query.get('format') === 'markdown') {
    return {
      status: 200,
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
      body: renderMarkdown(items, status, { base }),
    }
  }
  return json(200, { status, items } satisfies InboxListing)
}
