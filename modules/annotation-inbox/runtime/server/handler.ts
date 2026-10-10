import {
  defineEventHandler,
  getHeader,
  getRequestURL,
  readRawBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'
// `nitropack/runtime` rather than `#imports`: this file is compiled into the
// Nitro server, whose auto-import alias is not the app's.
import { useNitroApp, useRuntimeConfig, useStorage } from 'nitropack/runtime'
import { INBOX_ROUTE, INBOX_STORAGE_MOUNT } from '../../contract'
import { bearerToken, createInbox, handleInboxRequest } from '../../inbox'
import { ANONYMOUS_REVIEWER, DEV_PRINCIPAL, tokenAgent } from '../../principal'
import type { H3Event } from 'h3'
import type { HumanPrincipal, Principal } from '../../principal'

/** The payload of the `annotation-inbox:authorize` hook. */
interface AuthorizeDecision {
  event: H3Event
  allowed: boolean
  principal?: HumanPrincipal
}

async function authenticate(event: H3Event): Promise<Principal | null> {
  const config = useRuntimeConfig(event).annotationInbox as { token?: string, authorize?: 'dev' | 'hook' } | undefined
  const token = config?.token
  if (token && bearerToken(getHeader(event, 'authorization')) === token) {
    return tokenAgent(getHeader(event, 'x-agent-label'))
  }
  // `authorize: 'hook'` opts a dev server out of the open door, so a host can
  // exercise its own gate under `nuxt dev`.
  if (import.meta.dev && config?.authorize !== 'hook') return DEV_PRINCIPAL

  const decision: AuthorizeDecision = { event, allowed: false }
  await useNitroApp().hooks.callHook('annotation-inbox:authorize', decision)
  if (!decision.allowed) return null
  return decision.principal ?? ANONYMOUS_REVIEWER
}

/**
 * The inbox on the application server — the half that exists in a deployed
 * build, where there is no Vite dev server to answer `/__annotations`.
 *
 * It decides nothing about annotations: `inbox.ts` owns the route table, the
 * storage layout and the validation, and this file only translates an `H3Event`
 * into that and back. The one thing it does own is *who is allowed in*, because
 * that is the only question whose answer differs between a developer's laptop
 * and a public origin.
 *
 * Three answers, in order, and the order is the point:
 *
 *  1. A bearer token equal to the configured one — an agent, which is how a
 *     process with no browser session reaches the inbox from outside.
 *  2. `import.meta.dev` — a dev server is somebody's own machine, so it never
 *     asks anyone. Without this a developer would have to configure a token to
 *     annotate their own app. The module option `authorize: 'hook'` turns this
 *     off for a host that wants its gate exercised in development too.
 *  3. The host's `annotation-inbox:authorize` hook, which is the seam an
 *     application uses to say "this request carries a session I trust". The
 *     package cannot know what that means; it can only ask. A host that also
 *     sets `decision.principal` names the human, and resolutions are then
 *     attributed to its `name ?? id`.
 *
 * Each answer is a `Principal`. Anything else is refused — except `/access`, which answers `{ allowed }`
 * precisely so an ordinary reader's page load is not a failed request.
 */
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const base = (useRuntimeConfig(event).public.annotationInbox as { base?: string } | undefined)?.base ?? INBOX_ROUTE

  // Per request: unstorage's mount lookup is a map read, and holding an inbox
  // across requests would pin a mount the host may still be installing.
  const inbox = createInbox(useStorage(INBOX_STORAGE_MOUNT))
  const response = await handleInboxRequest(
    inbox,
    {
      method: event.method,
      url: url.pathname + url.search,
      principal: await authenticate(event),
      body: async () => (await readRawBody(event, 'utf8')) ?? '',
    },
    { base },
  )

  setResponseStatus(event, response.status)
  for (const [name, value] of Object.entries(response.headers)) {
    setResponseHeader(event, name, value)
  }
  return response.status === 204 ? null : response.body
})
