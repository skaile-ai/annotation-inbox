/**
 * `@ecsplico/annotation-inbox` — the framework-free core: the contract types,
 * the inbox over any unstorage `Storage`, the markdown an agent reads, and the
 * principal shape. No Vite, no Nuxt, no `node:*`; importable from a browser, a
 * worker or any server.
 */
export {
  createInbox,
  parsePayload,
  renderMarkdown,
  resolveTarget,
} from './inbox.ts'
export type {
  Inbox,
  InboxEvent,
  InboxListener,
  InboxOptions,
  InboxStore,
} from './inbox.ts'
export {
  INBOX_ACCESS_ROUTE,
  INBOX_DIR,
  INBOX_RESOLVE_ROUTE,
  INBOX_ROUTE,
  INBOX_STORAGE_MOUNT,
  inboxRoutes,
} from './contract.ts'
export type {
  InboxAnnotation,
  InboxItem,
  InboxListing,
  InboxPayload,
  InboxSession,
  InboxStatus,
  InboxTarget,
} from './contract.ts'
export { DEV_PRINCIPAL, principalLabel, tokenAgent } from './principal.ts'
export type { AgentPrincipal, HumanPrincipal, Principal } from './principal.ts'
