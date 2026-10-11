/**
 * `@ecsplico/annotation-inbox/server` — the route table without a framework.
 *
 * `handleInboxRequest` turns `{ method, url, body, principal }` into
 * `{ status, headers, body }`; a host on Express, Hono, a Worker or plain
 * `node:http` authenticates the caller itself, passes the resulting
 * `Principal` (or `null`) and writes the response out. The Nuxt module and the
 * Vite middleware are two such hosts.
 */
export { bearerToken, createInbox, handleInboxRequest } from './inbox.ts'
export type {
  HandleInboxOptions,
  Inbox,
  InboxEvent,
  InboxListener,
  InboxOptions,
  InboxRequest,
  InboxResponse,
  InboxStore,
} from './inbox.ts'
export { ANONYMOUS_REVIEWER, DEV_PRINCIPAL, principalLabel, tokenAgent } from './principal.ts'
export type { AgentPrincipal, HumanPrincipal, Principal } from './principal.ts'
