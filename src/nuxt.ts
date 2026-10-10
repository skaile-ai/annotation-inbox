import { addPlugin, addServerHandler, addTypeTemplate, addVitePlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import type { NuxtModule } from '@nuxt/kit'
import { INBOX_DIR, INBOX_ROUTE, INBOX_STORAGE_MOUNT } from '../modules/annotation-inbox/contract'
import { annotationInbox } from '../modules/annotation-inbox/vite'

/** What `modules: [['@skaile-ai/annotation-inbox/nuxt', options]]` (or the `annotationInbox` key) accepts. */
export interface ModuleOptions {
  /**
   * The shared secret an agent presents as `Authorization: Bearer`. Empty means
   * "no agent can authenticate". Overridable at runtime with
   * `NUXT_ANNOTATION_INBOX_TOKEN`.
   */
  token?: string
  /** Where the routes are mounted. Default `/__annotations`. */
  base?: string
  /** Directory of the default filesystem store, relative to the server's working directory. Default `.data/annotations`. */
  dir?: string
  /**
   * Who may annotate without a token. `'dev'` (default): everyone under
   * `nuxt dev`, the `annotation-inbox:authorize` hook otherwise. `'hook'`: the
   * hook always, development included.
   */
  authorize?: 'dev' | 'hook'
}

/**
 * The modules whose chunks may not be hinted to the browser: the toolbar
 * library and the mount that imports it. Matched against the manifest's keys,
 * which are source paths, so a hash change cannot age this out.
 */
const GATED_CHUNK = /agentation-vue|annotation-inbox\/(?:modules\/annotation-inbox\/)?runtime\/mount/

/**
 * Registers the annotation toolbar, its server routes and its storage mount.
 *
 * **Why a module rather than a plugin in the app's `app/plugins/`.** A
 * module decides what exists for a build at all, rather than contributing a
 * plugin entry whose body dead-branch folding may or may not remove. That is
 * what keeps it out of a *test* build, where a toolbar nobody clicks is only a
 * source of flakes.
 *
 * **Where the runtime comes from.** Two pieces, shipped differently. The
 * Nitro handler is built to `dist/runtime/server/handler.mjs`, next to this
 * module: Nitro does not transpile TypeScript it finds under `node_modules`.
 * The client plugin and the toolbar mount ship as TypeScript source in
 * `modules/annotation-inbox/runtime/`, because the consumer's own Vite must
 * see them or the `import.meta.env.DEV` guard in `mount.ts` is never folded
 * there; that directory is added to `build.transpile`. The built module
 * (`dist/nuxt.mjs`) and its source (`src/nuxt.ts`) both sit one level below
 * the package root, so the relative path to `modules/` is the same in both.
 *
 * **What "ships" means here.** The routes exist in every build and refuse
 * everyone who is neither a token holder nor someone the host's
 * `annotation-inbox:authorize` hook vouches for. The toolbar's own code stays
 * in a lazily imported chunk that `runtime/mount.ts` fetches only after
 * `/__annotations/access` has said yes — so an ordinary reader downloads
 * neither the toolbar nor the PolyForm Shield library behind it.
 *
 * **The tracer is not registered here.** Nuxt DevTools already adds
 * `vite-plugin-vue-tracer` on the client whenever devtools are enabled with
 * their default `componentInspector`, and a second registration would be
 * redundant. The consequence is worth knowing: with `devtools: { enabled:
 * false }` or `componentInspector: false`, annotations still name every
 * component and its SFC, but lose the final `file:line:column` segment — and
 * a note without one falls back to naming the route it was made on, which is
 * also what a production build gives.
 */
const annotationInboxModule: NuxtModule<ModuleOptions> = defineNuxtModule<ModuleOptions>({
  meta: { name: 'annotation-inbox', configKey: 'annotationInbox' },

  defaults: {
    base: INBOX_ROUTE,
    dir: INBOX_DIR,
    authorize: 'dev',
  },

  setup(options, nuxt) {
    // `@nuxt/test-utils` sets this. Everything else — dev, preview, production
    // — gets the routes.
    if (nuxt.options.test) return

    const { resolve } = createResolver(import.meta.url)
    const clientRuntimeDir = resolve('../modules/annotation-inbox/runtime')
    const base = (options.base ?? INBOX_ROUTE).replace(/\/+$/, '') || INBOX_ROUTE
    const dir = options.dir ?? INBOX_DIR

    nuxt.options.build.transpile.push(clientRuntimeDir)
    // Empty by default, which means "no agent can authenticate": a token that
    // defaults to something is a token somebody forgets to change. What the
    // host put in its own `runtimeConfig.annotationInbox` wins over the module
    // options, so the environment can still override a configured token.
    nuxt.options.runtimeConfig.annotationInbox = {
      token: options.token ?? '',
      authorize: options.authorize ?? 'dev',
      ...(nuxt.options.runtimeConfig.annotationInbox as Record<string, unknown> | undefined),
    }
    // Public because the client plugin has to know where to ask; the server
    // handler reads the same value so the two cannot disagree.
    nuxt.options.runtimeConfig.public.annotationInbox = {
      base,
      ...(nuxt.options.runtimeConfig.public.annotationInbox as Record<string, unknown> | undefined),
    }

    // `??=`, so a host that mounts a database here keeps it. The fallback base
    // is relative to the server's working directory: the repo root under
    // `nuxt dev`, the image's app directory in a container.
    nuxt.options.nitro.storage ??= {}
    nuxt.options.nitro.storage[INBOX_STORAGE_MOUNT] ??= { driver: 'fs', base: `./${dir}` }

    // Build-time configuration only — the workspace root define and the
    // optimiser exclusion. Under Nuxt the endpoint is Nitro's, below, which is
    // the one that also exists in a build.
    addVitePlugin(annotationInbox())

    // Two routes because h3 matches the collection and its children
    // separately; both land on the same handler, which branches on the path.
    const handler = resolve('./runtime/server/handler.mjs')
    addServerHandler({ route: base, handler })
    addServerHandler({ route: `${base}/**`, handler })

    addPlugin({ src: resolve('../modules/annotation-inbox/runtime/plugin.client'), mode: 'client' })

    // A gate the browser walks around by itself otherwise. Nuxt turns every
    // dynamic import of a plugin chunk into `<link rel="prefetch">`, so a
    // reader who is refused still downloads the toolbar — measured on
    // 2026-09-23: `/` on a production build fetched both library chunks before
    // `/access` had answered. The gate is about what leaves the server, so the
    // hint has to go.
    nuxt.hook('build:manifest', (manifest) => {
      for (const [id, entry] of Object.entries(manifest)) {
        if (!GATED_CHUNK.test(id)) continue
        entry.prefetch = false
        entry.preload = false
      }
    })

    // The host implements the hook, so the host needs its type. Declared from
    // the module rather than documented in a README, because a hook whose
    // payload a consumer has to guess is a hook they implement wrongly once.
    addTypeTemplate({
      filename: 'types/annotation-inbox.d.ts',
      getContents: () => `import type { H3Event } from 'h3'

declare module 'nitropack/types' {
  interface NitroRuntimeHooks {
    /**
     * Asked once per inbox request that carried no agent token. Set
     * \`decision.allowed = true\` to let the request in as a reviewer, and
     * \`decision.principal\` to say who that reviewer is: its \`name ?? id\`
     * is what a resolution is attributed to.
     */
    'annotation-inbox:authorize': (decision: {
      event: H3Event
      allowed: boolean
      principal?: { kind: 'human', id: string, name?: string, roles?: string[] }
    }) => void | Promise<void>
  }
}

declare module 'nuxt/schema' {
  interface RuntimeConfig {
    annotationInbox: { token: string, authorize: 'dev' | 'hook' }
  }
  interface PublicRuntimeConfig {
    annotationInbox: { base: string }
  }
}

export {}
`,
    }, { nuxt: true, nitro: true })
  },
})

export default annotationInboxModule
