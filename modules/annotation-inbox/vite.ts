import { join } from 'node:path'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { searchForWorkspaceRoot } from 'vite'
// With its extension, because `.storybook/main.ts` imports this file and
// Storybook's own bundler warns about extensionless imports in that graph —
// the same thing Vite's native config loader asks of `vitest.config.ts`.
import { INBOX_DIR, INBOX_ROUTE, INBOX_TOKEN_ENV, TOOLBAR_PACKAGE } from './contract.ts'
import { bearerToken, createInbox, handleInboxRequest } from './inbox.ts'
import { DEV_PRINCIPAL, tokenAgent } from './principal.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { InboxStore } from './inbox.ts'
import type { Principal } from './principal.ts'

/**
 * The inbox's server half under a dev server: a Vite middleware that turns a
 * node request into the transport-neutral request `inbox.ts` answers.
 *
 * **Why a Vite plugin and not only a Nitro route.** The same endpoint has to
 * exist under `nuxt dev` and under `storybook dev`, and the only thing those
 * two harnesses have in common is Vite. Storybook has no Nitro at all, and a
 * second implementation for it is the drift `contract.ts` exists to prevent —
 * so the decisions live in `inbox.ts` and this file is an adapter: request in,
 * response out, no storage layout and no route table of its own.
 *
 * **`apply: 'serve'` no longer means "never ships".** The endpoint half is
 * dev-only because a built Storybook is static files with no server to answer.
 * The *toolbar* now does ship — lazily, behind a runtime access check — and
 * `runtime/mount.ts` holds that end of the rule.
 */

/**
 * The handler, separated from the plugin so a harness can supply its own store
 * and its own notion of who is allowed in.
 */
export function createInboxHandler(options: {
  store: InboxStore
  /** Who the caller is: a principal, or `null` for nobody. */
  authorize: (req: IncomingMessage) => Promise<Principal | null> | Principal | null
}) {
  const inbox = createInbox(options.store)

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Connect has already stripped the mount prefix, leaving `/` for the
    // collection itself; the core wants the whole path back.
    const response = await handleInboxRequest(inbox, {
      method: req.method ?? 'GET',
      url: `${INBOX_ROUTE}${req.url ?? '/'}`,
      principal: await options.authorize(req),
      body: async () => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        return Buffer.concat(chunks).toString('utf8')
      },
    })

    res.statusCode = response.status
    for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value)
    res.end(response.body || undefined)
  }
}

/**
 * `options.endpoint` decides whether this dev server *answers* the inbox route
 * or only configures the client half. A Nuxt dev server has Nitro, which owns
 * the route in every environment including production; Storybook has nothing
 * else, so it asks for the endpoint here.
 */
export function annotationInbox(options: { endpoint?: boolean } = {}): Plugin {
  // The same call `vite-plugin-vue-tracer` makes for the paths it records, so
  // the directory this writes into and the paths inside the files it writes
  // are relative to one and the same root.
  const root = searchForWorkspaceRoot(process.cwd())
  const dir = join(root, INBOX_DIR)

  return {
    name: 'annotation-inbox',
    apply: 'serve',

    // Two things the dev server has to be told, both of them about identity:
    //
    //  - `__ANNOTATION_INBOX_ROOT__`: the client half turns the absolute SFC
    //    paths in `__file` into workspace-relative ones, and only the server
    //    knows where the workspace root is. A compile-time substitution, so
    //    the browser never learns a path it was not already going to print.
    //  - `optimizeDeps.exclude`: one copy of the toolbar library, not two.
    //    See `TOOLBAR_PACKAGE` in `contract.ts` for what the second copy
    //    silently breaks.
    config: () => ({
      define: { __ANNOTATION_INBOX_ROOT__: JSON.stringify(root) },
      optimizeDeps: { exclude: [TOOLBAR_PACKAGE] },
    }),

    configureServer(server) {
      if (!options.endpoint) return

      const store = createStorage({ driver: fsDriver({ base: dir }) })
      // A dev server is somebody's own machine: whoever reaches it is the
      // reviewer. The bearer token exists so a local agent can say it is one,
      // which only changes who a resolution is attributed to.
      const authorize = (req: IncomingMessage): Principal => {
        const expected = process.env[INBOX_TOKEN_ENV]
        if (!expected || bearerToken(req.headers.authorization) !== expected) return DEV_PRINCIPAL
        const label = req.headers['x-agent-label']
        return tokenAgent(Array.isArray(label) ? label[0] : label)
      }
      const handler = createInboxHandler({ store, authorize })
      server.middlewares.use(INBOX_ROUTE, (req, res) => {
        handler(req, res).catch((error: unknown) => {
          res.statusCode = 500
          res.end(String(error))
        })
      })
      // Printed once per dev server, because an inbox nobody knows the path of
      // is a feature nobody uses.
      server.config.logger.info(`annotation inbox: ${INBOX_ROUTE} → ${INBOX_DIR}/`)
    },
  }
}
