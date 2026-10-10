import { defineConfig } from 'tsdown'

/**
 * Three entries are built, for one reason that is Node rather than taste.
 *
 * A consuming project names this package's Vite plugin from its own
 * `vite.config.ts` (and from `.storybook/main.ts`, which is loaded the same
 * way). Vite's config loader hands that file to Node, and Node refuses to
 * type-strip TypeScript that lives under `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — a deliberate rule, because
 * a published package is expected to have been compiled by whoever published
 * it. So `modules/annotation-inbox/vite.ts` must arrive as JavaScript, with a
 * declaration file beside it.
 *
 * `node.ts` (`./inbox`) and `mcp.ts` (`./mcp`) are built for the same reason:
 * they are loaded by Node, not by a bundler. `./inbox` is imported by server
 * code and tools that open a project's inbox from its directory, and `mcp` is
 * an executable — the `annotation-inbox-mcp` bin, started as a stdio process
 * by an agent runner — so neither can lean on a host's compiler.
 *
 * Every other entry is read by a tool that compiles TypeScript itself: Nuxt
 * reads `nuxt.config.ts` and scans `modules/`, and `./mount` is imported into
 * an app or a Storybook preview, where the host's Vite is the compiler. Those
 * ship as source on purpose. `mount.ts` in particular must stay source: its
 * `import.meta.env.DEV` guard is what keeps the toolbar out of production
 * bundles, and that constant is only folded — and the branch only eliminated —
 * by the *consumer's* build. Pre-bundling it here would hand every consumer a
 * branch their bundler has to be trusted to remove again.
 *
 * `outExtensions` is pinned rather than left to the default: with
 * `"type": "module"` tsdown would emit `dist/vite.js`, and the `exports` map
 * in `package.json` promises `dist/vite.mjs`, `dist/inbox.mjs`,
 * `dist/mcp.mjs` and the matching `.d.ts` files.
 */
export default defineConfig({
  entry: {
    vite: 'modules/annotation-inbox/vite.ts',
    inbox: 'modules/annotation-inbox/node.ts',
    mcp: 'modules/annotation-inbox/mcp.ts',
  },
  outDir: 'dist',
  format: ['es'],
  platform: 'node',
  dts: true,
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
    'agentation-vue',
    'vite-plugin-vue-tracer',
    /^unstorage(\/|$)/,
    /^@modelcontextprotocol\/sdk(\/|$)/,
    'zod',
  ],
})
