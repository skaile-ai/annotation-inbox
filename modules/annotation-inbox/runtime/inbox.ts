import { AGENTATION_STORAGE_KEY, INBOX_BASES_KEY, INBOX_POLL_MS, INBOX_SESSION_KEY, inboxRoutes } from '../contract'
import type { InboxAnnotation, InboxItem, InboxPayload } from '../contract'

/**
 * Everything the toolbar has to be *told* so its notes reach the working copy
 * instead of dying with the tab: where to mirror its store, and what a
 * component chain should say.
 *
 * The library exports three hooks and this file is nothing but their
 * arguments — a storage adapter, a component detector, and its own markdown
 * formatter used on the way out. Deliberately no fork and no patch: a fork of
 * a PolyForm Shield package is a fork nobody upgrades.
 *
 * The package is never named here. It is handed in (`InboxDeps`) by the one
 * file allowed to import it, `mount.ts`, which is what keeps a second importer
 * from appearing (`test/locks.spec.ts`).
 */

/**
 * The workspace root, substituted as a literal by the inbox's Vite plugin
 * under the name `__ANNOTATION_INBOX_ROOT__`. Absent when something else loads
 * this file, hence the `typeof` guard at the one place it is read: without a
 * root, SFC paths stay absolute rather than the whole detector failing.
 */
declare const __ANNOTATION_INBOX_ROOT__: string

/** One component instance, as much of it as a chain segment needs. */
interface ChainInstance {
  type?: { name?: string, __name?: string, __file?: string }
  parent?: ChainInstance | null
}

export interface InboxDeps {
  setAnnotationStorage(adapter: { getItem(key: string): string | null, setItem(key: string, value: string): void }): void
  setVueDetector(detector: (el: Element) => string | undefined): void
  formatAnnotations(annotations: InboxAnnotation[], detail: 'standard', pageUrl: string): string
  findTraceFromElement(el?: Element | null): { fullpath: string } | undefined
  /**
   * The library's own removal, so a note an agent answered can leave the tab.
   * Removing triggers the library's save, which republishes the session
   * without the note — the acknowledgement the server is waiting for.
   */
  removeAnnotation(id: string): unknown
}

/**
 * Where a host says which inbox a note belongs to: given the page a note was
 * made on, the list route of the inbox that should hold it, or `undefined` for
 * the module's own.
 */
export type AnnotationInboxBaseResolver = (pageUrl: string) => string | undefined

let baseResolver: AnnotationInboxBaseResolver | null = null

/**
 * Registers (or, with `null`, removes) the host's base resolver. Module-level
 * and read lazily by the publisher, so a host plugin may call it before or
 * after the toolbar mounts — and a host that never calls it gets one inbox,
 * the module's `base`, exactly as before.
 *
 * It lives in this file, reachable as `@ecsplico/annotation-inbox/mount`, and
 * nothing here names the toolbar library, so a host plugin importing it adds a
 * few lines to a reader who is never allowed to annotate and none of the
 * toolbar.
 */
export function setAnnotationInboxBaseResolver(resolve: AnnotationInboxBaseResolver | null): void {
  baseResolver = resolve
}

export function installAnnotationInbox(deps: InboxDeps, options: { base?: string } = {}): void {
  const routes = inboxRoutes(options.base)
  /**
   * This tab's identity, for the life of this tab. `sessionStorage` is exactly
   * the right lifetime: a reload keeps the id, so a reloaded tab still owns
   * the notes it published, while a second tab gets its own and the two cannot
   * overwrite each other — which is what the per-origin file used to do.
   *
   * `crypto.randomUUID` is secure-context-only: a review deployment reached
   * over plain `http://` on anything but `localhost` (a Tailscale hostname,
   * say) sees it as `undefined` and would otherwise throw here before the
   * toolbar ever mounts. `crypto.getRandomValues` carries no such
   * restriction, so it is the fallback rather than a second dependency.
   */
  const sessionId = (() => {
    const existing = sessionStorage.getItem(INBOX_SESSION_KEY)
    if (existing && /^[a-z0-9]{6,32}$/.test(existing)) return existing
    const fresh = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(INBOX_SESSION_KEY, fresh)
    return fresh
  })()

  /**
   * The tab's notes by the list route each belongs to. Without a resolver that
   * is one group holding all of them, empty or not, under the module's base —
   * the single request this has always been. With one, each note goes where
   * `resolve(note.url ?? location.href)` says, and a note it declines for
   * (`undefined`, or an exception) goes to the module's base like every note
   * did before a resolver existed.
   *
   * Read at call time, never captured: a host plugin may register the resolver
   * before or after this runs, and may replace it while the tab lives.
   */
  function groupByBase(annotations: InboxAnnotation[]): Map<string, InboxAnnotation[]> {
    const resolve = baseResolver
    if (!resolve) return new Map([[routes.list, annotations]])

    const groups = new Map<string, InboxAnnotation[]>()
    for (const annotation of annotations) {
      let base: string | undefined
      try {
        base = resolve(annotation.url ?? location.href)
      } catch {
        base = undefined
      }
      const key = base ?? routes.list
      const group = groups.get(key)
      if (group) group.push(annotation)
      else groups.set(key, [annotation])
    }
    return groups
  }

  /** The bases this tab last published at least one note to. */
  function publishedBases(): string[] {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(INBOX_BASES_KEY) ?? '[]') as unknown
      return Array.isArray(parsed) ? parsed.filter((base): base is string => typeof base === 'string') : []
    } catch {
      return []
    }
  }

  /**
   * One POST per base per change, each carrying the whole session as far as
   * that base is concerned: the notes that resolve to it, and nothing else.
   * Without a resolver there is exactly one base and this is the single POST
   * of old.
   *
   * A base that held notes of this tab at the last publish and holds none now
   * gets an empty session, the same message a tab sends when its last note is
   * deleted — without it a note the reader deleted, or one whose page now
   * resolves elsewhere, would stay in the first base's inbox for ever.
   *
   * Fire and forget. The `sessionStorage` write the library just made is the
   * authoritative copy as far as the toolbar is concerned; the file is a
   * mirror, and a mirror that fails to update must not take the toolbar down
   * with it — a developer annotating against a dev server that has just
   * restarted should notice nothing.
   */
  function post(raw: string): void {
    let annotations: InboxAnnotation[] = []
    try {
      // The library keys its store by origin (`domain-port` scope), so this
      // tab's notes are one entry of an object that may also hold another
      // origin's from an earlier visit.
      annotations = (JSON.parse(raw) as Record<string, InboxAnnotation[]>)[location.origin] ?? []
    } catch {
      annotations = []
    }

    const groups = groupByBase(annotations)
    const holding: string[] = []
    for (const base of new Set([...groups.keys(), ...publishedBases()])) {
      const notes = groups.get(base) ?? []
      if (notes.length > 0) holding.push(base)
      publish(base, notes)
    }
    sessionStorage.setItem(INBOX_BASES_KEY, JSON.stringify(holding))
  }

  function publish(base: string, annotations: InboxAnnotation[]): void {
    const payload: InboxPayload = {
      sessionId,
      origin: location.origin,
      url: location.href,
      annotations,
      // The same text the Copy button produces, so what an agent reads and
      // what a human pastes are the same artefact. Not computed for an empty
      // session: that POST only tells the server this tab holds nothing.
      markdown: annotations.length > 0 ? deps.formatAnnotations(annotations, 'standard', location.href) : '',
    }

    void fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {
      console.warn(`[annotation-inbox] could not reach ${base}; the annotation is still in this tab`)
    })
  }

  deps.setAnnotationStorage({
    getItem: key => sessionStorage.getItem(key),
    setItem(key, value) {
      sessionStorage.setItem(key, value)
      if (key === AGENTATION_STORAGE_KEY) post(value)
    },
  })

  // Once on load, before anything is annotated. Two things depend on it: a
  // reloaded tab re-publishes notes the server may have lost to a restart, and
  // a fresh tab publishes its empty session, which clears what that same
  // session id owned before. Another tab's notes are untouched — they are its
  // own session's, not this origin's.
  post(sessionStorage.getItem(AGENTATION_STORAGE_KEY) ?? '{}')

  /**
   * What an agent's answer looks like from the human's side: the note simply
   * goes away. Both closing statuses count — a rejection is an answer, and its
   * reason belongs in the listing, not in a marker the human has to dismiss.
   *
   * Polling, not a socket: the inbox is a handful of notes and the answer
   * arrives whenever an agent gets round to it, so a request every ten seconds
   * on a visible tab with notes in it costs nothing worth a transport. A tab
   * with no notes asks nothing at all.
   */
  async function poll(): Promise<void> {
    if (document.visibilityState !== 'visible') return

    let mine: InboxAnnotation[] = []
    try {
      mine = (JSON.parse(sessionStorage.getItem(AGENTATION_STORAGE_KEY) ?? '{}') as Record<string, InboxAnnotation[]>)[location.origin] ?? []
    } catch {
      return
    }
    if (mine.length === 0) return

    // Only the bases that hold a note of this tab are asked, and each on its
    // own: one that is down must not keep the others' answers from arriving.
    await Promise.all([...groupByBase(mine).keys()].map(async (base) => {
      try {
        const response = await fetch(`${base}?session=${sessionId}&status=closed`)
        if (!response.ok) return
        const { items } = await response.json() as { items: InboxItem[] }
        for (const item of items) {
          // `item.id` is the tab's own counter, which restarts at 1 once every note
          // has been answered or after a reload, while the server keeps the answered
          // item for the reviewer. Matching on the id alone would take the *new*
          // note that reused it off the page; the note's `timestamp` is what stays
          // fixed from creation, as the server's `publish` also relies on.
          if (mine.some(note => note.id === item.id && note.timestamp === item.timestamp)) deps.removeAnnotation(item.id)
        }
      } catch {
        // The next tick retries. A dev server that has just restarted must not
        // turn into a console full of failures.
      }
    }))
  }

  setInterval(() => void poll(), INBOX_POLL_MS)

  deps.setVueDetector((el) => {
    const segments: string[] = []
    const root = typeof __ANNOTATION_INBOX_ROOT__ === 'string' ? __ANNOTATION_INBOX_ROOT__ : ''

    let instance = instanceFor(el)
    for (let depth = 0; instance && depth < 20; depth++) {
      const type = instance.type
      // `__file` is absolute in a Vite dev server (`@vitejs/plugin-vue` writes
      // the resolved id) — which is a path no agent can paste, so it is made
      // workspace-relative here rather than at the reading end.
      const absolute = type?.__file ?? ''
      const file = root && absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : absolute
      const name = type?.name ?? type?.__name ?? file.split('/').pop()?.replace(/\.vue$/, '') ?? ''

      // `_`-prefixed names are the library's own filter for the anonymous
      // wrappers a framework stacks up; they name no file anybody can open.
      if (name && !name.startsWith('_')) segments.unshift(file ? `${name} (${file})` : name)
      instance = instance.parent ?? undefined
    }

    // The last segment is the point of the whole line: not which component the
    // element belongs to, but where in that component's template it is
    // written. `vite-plugin-vue-tracer` recorded it against the same workspace
    // root, so it is already workspace-relative.
    const trace = deps.findTraceFromElement(el)?.fullpath
    if (trace) segments.push(trace)

    return segments.length > 0 ? segments.join(' > ') : undefined
  })
}

/**
 * The component instance an element belongs to — its own, or the nearest
 * ancestor's, because plain DOM inside a template carries no instance of its
 * own. Stops at `<body>`, the same bound the library's default detector uses.
 */
function instanceFor(el: Element): ChainInstance | undefined {
  let current: Element | null = el
  while (current && current !== document.body) {
    const instance = (current as Element & { __vueParentComponent?: ChainInstance }).__vueParentComponent
    if (instance) return instance
    current = current.parentElement
  }
  return undefined
}
