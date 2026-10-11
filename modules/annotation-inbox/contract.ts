/**
 * What the browser half and the server half have to agree on.
 *
 * Two halves of one feature that never share a module graph — one is bundled
 * into the page, the other runs in a server process — and the only thing tying
 * them together is a route string, a storage mount and the shape of one JSON
 * body. Written down once so a rename cannot break the pair silently: a
 * drifting route is a `404` nobody looks at, and a drifting payload shape is a
 * note with a missing field.
 *
 * Neither this file nor `vite.ts` may name `agentation-vue`. The toolbar's
 * dependency is allowed on exactly one file in this package,
 * `runtime/mount.ts`, and the layer's own `test/locks.spec.ts` holds that
 * rule; the types below are the *inbox's* view of an annotation, not the
 * library's: every field the store carries, and nothing that would make a
 * server module import a PolyForm Shield package.
 */

/**
 * Where the toolbar mirrors its session to. Double-underscore prefixed the
 * way Vite prefixes its own internals: this is an infrastructure route, not an
 * app route, and the prefix keeps it from ever colliding with a page of the
 * application the layer is installed into.
 */
export const INBOX_ROUTE = '/__annotations'

/**
 * The three routes under a base other than the default — the module's `base`
 * option. Client and server both derive theirs from here, so a rename cannot
 * leave one half asking the other for a route it does not serve.
 */
export const inboxRoutes = (base: string = INBOX_ROUTE) => ({
  list: base,
  resolve: `${base}/resolve`,
  access: `${base}/access`,
})

/** Where an agent closes a note it has acted on, or refuses it with a reason. */
export const INBOX_RESOLVE_ROUTE = `${INBOX_ROUTE}/resolve`

/**
 * The only route that answers an unauthorised caller instead of refusing it.
 * The client asks it before mounting, so a reader without access sees no
 * toolbar rather than a toolbar whose every request fails.
 */
export const INBOX_ACCESS_ROUTE = `${INBOX_ROUTE}/access`

/**
 * Relative to the workspace root, and only the default: the filesystem store a
 * dev server falls back to. `.data/` is Nuxt's conventional local-data
 * directory and is already ignored, which is the right lifetime for a mirror
 * of a browser session. A host that wants annotations to outlive a container
 * mounts something else under `INBOX_STORAGE_MOUNT` instead of changing this.
 */
export const INBOX_DIR = '.data/annotations'

/**
 * The unstorage mount point the server half reads and writes through. This is
 * the whole seam between the package and its host: the package never names a
 * driver, and a host that mounts a database here — SQLite, or anything else
 * with an unstorage driver — changes where annotations live without changing
 * a line of this package.
 */
export const INBOX_STORAGE_MOUNT = 'annotation-inbox'

/** `sessionStorage` key holding this tab's session id. */
export const INBOX_SESSION_KEY = 'annotation-inbox-session'

/**
 * `sessionStorage` key holding the list routes this tab has published notes to.
 * Only ever more than the module's own route when the host registered a base
 * resolver; it is how a base that no longer holds a note of this tab hears so.
 */
export const INBOX_BASES_KEY = 'annotation-inbox-bases'

/** Environment variable holding the bearer token that identifies an agent. */
export const INBOX_TOKEN_ENV = 'NUXT_ANNOTATION_INBOX_TOKEN'

/** How often a mounted toolbar asks which of its notes have been resolved. */
export const INBOX_POLL_MS = 10_000

/**
 * The single `sessionStorage` key the toolbar library writes its whole store
 * under — every origin's annotations in one JSON object, keyed by origin.
 * The client half watches writes to this key and forwards them.
 */
export const AGENTATION_STORAGE_KEY = 'agentation-vue-annotations'

/**
 * The toolbar package, named here because the dev server has to keep Vite's
 * dependency optimiser away from it.
 *
 * The library ships `AgentationVue.vue` as a real SFC inside `dist/`, and
 * esbuild cannot compile that — so the optimiser prebundles everything *but*
 * the component and leaves the `.vue` file to `@vitejs/plugin-vue`, which
 * resolves its relative imports on its own. The result is two live copies of
 * the library's module-level state: the prebundled one, which is what the
 * mount's dynamic import hands back, and the component's, which is the one
 * actually rendering. Hooks set on the first are silently ignored — measured:
 * annotations kept the library's default component chain and never reached
 * the inbox on change. Excluding the package from optimisation collapses the
 * two back into one instance, at the price of a handful of extra module
 * requests in a dev server.
 */
export const TOOLBAR_PACKAGE = 'agentation-vue'

/**
 * One annotation as the toolbar serialises it. Only the fields the inbox
 * itself reads are named; the rest (`boundingBox`, `nearbyText`,
 * `computedStyles`, …) travel through untouched into the stored item, which is
 * why this is not an exhaustive mirror of the library's `Annotation`.
 */
export interface InboxAnnotation {
  /** Per-tab counter (`"1"`, `"2"`, …) — unique only within its session. */
  id: string
  comment: string
  elementPath: string
  vueComponents?: string
  url?: string
  timestamp: number
}

/**
 * What the toolbar POSTs on every change: the whole current session of one
 * tab. Not a diff — the store the client reads is itself the whole truth, and
 * a replace cannot desynchronise. What it *does not* replace is server state:
 * a resolution already recorded for a note survives the tab resending it.
 */
export interface InboxPayload {
  /** This tab's session id; makes the library's per-tab ids globally unique. */
  sessionId: string
  /** `location.origin`, e.g. `http://localhost:3040`. */
  origin: string
  /** `location.href` at the time of the change. */
  url: string
  annotations: InboxAnnotation[]
  /** The same markdown the toolbar's Copy button produces. */
  markdown: string
}

/**
 * Where a note stands. Three, not two: an agent that will not do what a note
 * asks owes the reviewer an answer, and `rejected` plus a `resolution` is that
 * answer. Silence, or a note quietly marked done, is not.
 */
export type InboxStatus = 'open' | 'implemented' | 'rejected'

/**
 * What the note is about — never absent.
 *
 * `element` when the toolbar's component chain ended in a source position
 * (`app/components/guide/GuidePicker.vue:52:6`), which is what a dev build
 * gives. A production bundle has no tracer positions, so the note lands on the
 * `route` it was made on: coarser, never missing. `block` is the shape an
 * editor-side note button fills in later — defined now so that feature needs a
 * new producer, not a migration of stored notes.
 */
export interface InboxTarget {
  kind: 'element' | 'block' | 'route'
  /** Source position, block id, or route path, depending on `kind`. */
  ref: string
  /** What to call the target in a listing a human reads. */
  label: string
}

/**
 * One stored annotation: its own key in the store, so a database-backed store
 * holds one row per note and "what is still open" is a query rather than a
 * scan of session blobs.
 */
export interface InboxItem extends InboxAnnotation {
  /** `<sessionId>-<annotation.id>` — unique across tabs. */
  inboxId: string
  sessionId: string
  origin: string
  target: InboxTarget
  status: InboxStatus
  /** ISO 8601, written by the server — the client's clock is not the record's. */
  receivedAt: string
  resolvedAt?: string
  /** Why, in the resolver's words. The point of `rejected`. */
  resolution?: string
  /** `agent`, or the name (else id) of the human who closed it — `principalLabel`. */
  resolvedBy?: string
}

/**
 * One tab's membership list. Deliberately not the items themselves: unstorage
 * treats `:` as a segment separator, so no partial-prefix scan can find a
 * session's items, and this list is the only index that can.
 */
export interface InboxSession {
  sessionId: string
  origin: string
  /** `location.href` of the tab's last publish. */
  url: string
  updatedAt: string
  itemIds: string[]
}

/** What `GET INBOX_ROUTE` answers with. */
export interface InboxListing {
  status: InboxStatus | 'closed' | 'all'
  items: InboxItem[]
}
