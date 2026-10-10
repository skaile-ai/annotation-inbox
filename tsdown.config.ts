import { defineConfig } from 'tsdown'
import type { UserConfig } from 'tsdown'

/**
 * Seven public entries and one runtime file are built, for one reason that is Node rather than taste.
 *
 * A consuming project names this package's Vite plugin from its own
 * `vite.config.ts` (and from `.storybook/main.ts`, which is loaded the same
 * way). Vite's config loader hands that file to Node, and Node refuses to
 * type-strip TypeScript that lives under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — a deliberate rule, because
 * a published package is expected to have been compiled by whoever published
 * it. So everything Node (or a test runner) loads directly arrives as
 * JavaScript with a declaration file beside it:
 *
 *  - `index`   (`.`)        the framework-free core,
 *  - `nuxt`    (`./nuxt`)   the Nuxt module, read by Nuxt through jiti,
 *  - `vite`    (`./vite`)   the Vite plugin,
 *  - `inbox`   (`./inbox`)  `openFileInbox(root)` for server code and tools,
 *  - `mcp`     (`./mcp`)    the `annotation-inbox-mcp` stdio bin,
 *  - `server`  (`./server`) the route table for non-Nitro servers,
 *  - `testing` (`./testing`) the storage contract suite, run by vitest.
 *
 * The runtime file is the Nitro handler (`dist/runtime/server/handler.mjs`).
 * Nitro does not transpile TypeScript it finds under `node_modules` — it fails
 * to parse the first `import type` — so the one file that runs in the server
 * build is shipped as JavaScript, with `h3` and `nitropack/runtime` left to
 * the host and the inbox core inlined. It has no declaration file: nobody
 * imports it, Nuxt is handed its path.
 *
 * What is **not** built: the client plugin and `./mount`. They are compiled by
 * the consumer's own Vite — for a Nuxt app and for a Storybook preview alike.
 * `mount.ts` in particular must stay source: its
 * `import.meta.env.DEV` guard is what keeps the toolbar out of production
 * bundles, and that constant is only folded — and the branch only eliminated —
 * by the *consumer's* build. Pre-bundling it here would hand every consumer a
 * branch their bundler has to be trusted to remove again. They ship from
 * `modules/` (see `files` in `package.json`), and the built Nuxt module finds
 * the plugin there.
 *
 * `outExtensions` is pinned rather than left to the default: with
 * `"type": "module"` tsdown would emit `dist/vite.js`, and the `exports` map
 * in `package.json` promises `dist/vite.mjs` and the matching `.d.ts` files.
 */
const publicEntries: UserConfig = {
  entry: {
    index: 'modules/annotation-inbox/core.ts',
    nuxt: 'src/nuxt.ts',
    server: 'modules/annotation-inbox/server.ts',
    testing: 'modules/annotation-inbox/testing.ts',
    vite: 'modules/annotation-inbox/vite.ts',
    inbox: 'modules/annotation-inbox/node.ts',
    mcp: 'modules/annotation-inbox/mcp.ts',
  },
  outDir: 'dist',
  format: ['es'],
  platform: 'node',
  dts: true,
  // Neither config cleans: they run side by side into the same `dist/`, and a
  // clean in one would race the other's output. `prebuild` empties it.
  clean: false,
  outExtensions: () => ({ js: '.mjs', dts: '.d.ts' }),
  // tsdown already externalises everything in `dependencies` and
  // `peerDependencies`; naming them is how the list stays readable next to the
  // manifest. `vite` above all: bundling a copy of `searchForWorkspaceRoot`
  // would mean the plugin no longer shares the host's Vite instance. The
  // unstorage, MCP SDK and zod patterns cover their subpath imports
  // (`unstorage/drivers/fs`, `@modelcontextprotocol/sdk/server/mcp.js`).
  external: [
    /^node:/,
    'vite',
    'vitest',
    /^@nuxt\/kit(\/|$)/,
    'agentation-vue',
    'vite-plugin-vue-tracer',
    /^unstorage(\/|$)/,
    /^@modelcontextprotocol\/sdk(\/|$)/,
    'zod',
  ],
}

export default defineConfig([
  publicEntries,
  {
    entry: { 'runtime/server/handler': 'modules/annotation-inbox/runtime/server/handler.ts' },
    outDir: 'dist',
    format: ['es'],
    platform: 'node',
    dts: false,
    clean: false,
    outExtensions: () => ({ js: '.mjs' }),
    external: [/^node:/, 'h3', /^nitropack(\/|$)/],
  },
])
