# @ecsplico/annotation-inbox

A Nuxt 4 module that turns "this button sits too low" into a file in your working copy, with
the line of the SFC that draws the button. Storybook and plain Vite apps without Nuxt or
Vue take the same toolbar and inbox — see *Storybook* and *A plain Vite app* — and any Vue
host can list and answer the notes with `useAnnotations` / `<AnnotationList>` — see *Listing
and answering notes in a Vue app*.

## What it does

Under `nuxt dev` — and, behind an access check, wherever the host allows it — a small
toolbar hangs off `<body>`. A human clicks an element, writes a comment, and the note is
mirrored to the server, which keeps every note as its own entry in an
[unstorage](https://unstorage.unjs.io) store. By default that store is a directory:

```
.data/annotations/items/<sessionId>-<n>.json   one note, with its target and its status
.data/annotations/sessions/<sessionId>.json    which notes one browser tab owns
.data/annotations/markdown/<sessionId>.md      the text the toolbar's Copy button produces
```

An agent reads them over HTTP — `GET /__annotations?format=markdown` — acts, and answers
each note with `POST /__annotations/resolve`. No browser extension, no clipboard step, and
nothing that only works in Chromium. The transport is plain HTTP, which is also why
wrapping it in an MCP server is a short step — and the package ships one, reading the files
directly: see *An MCP server over the inbox*.

One entry per note rather than one blob per tab is deliberate: a host that mounts a
database under the store (see *Storage*) then holds one row per annotation, so "what is
still open, and what was rejected with what reason" is a query.

Each annotation names the element three ways, and the third is the useful one:

```
- **Path:** div#__nuxt > div.phone > … > div.guide-grid > button.guide-card > img.guide-img
- **Components:** nuxt-root > NuxtLayout > WalkFrame (app/components/layout/WalkFrame.vue) > GuidePicker (app/components/guide/GuidePicker.vue) > app/components/guide/GuidePicker.vue:42:5
```

Every component in the chain carries its SFC path relative to the workspace root, and the
final segment is the annotated element's own position in the template it is written in.
Open that first.

**A tab is a session.** Each tab gets an id that lives as long as the tab, and publishes
its whole session on load and on every change, so two tabs never overwrite each other and
a tab that clears its notes clears only its own. A resolution is sticky: a note an agent
closed stays closed when the tab republishes it, and vanishes for good once the tab stops
sending it. The notes are as ephemeral as the sessions they were made in, which is why
`.data/` is gitignored — a host that wants them to outlive a container mounts a database
instead.

## Install

```bash
npm i -D @ecsplico/annotation-inbox
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@ecsplico/annotation-inbox/nuxt'],
})
```

Add `.data/` to `.gitignore` if it is not there already. That is the whole Nuxt side: the
module registers the toolbar plugin, the Nitro routes and a storage mount by itself. It
steps aside only under `@nuxt/test-utils` (`nuxt.options.test`), so a test run neither
serves the routes nor mounts a store. There is no `extends` line: this package is a module,
not a layer.

Module options, all optional, under `annotationInbox` or as the module's tuple form:

```ts
modules: [['@ecsplico/annotation-inbox/nuxt', {
  token: '',              // shared agent secret; NUXT_ANNOTATION_INBOX_TOKEN overrides it at runtime
  base: '/__annotations', // where the routes are mounted
  dir: '.data/annotations', // the default filesystem store
  authorize: 'dev',       // 'hook': ask annotation-inbox:authorize even under `nuxt dev`
}]]
```

The package is published to npmjs; no token or `.npmrc` entry is needed to install it.

Entries, each with declarations: `.` (types, `createInbox`, `renderMarkdown`,
`resolveTarget`), `./nuxt`, `./vite`, `./mount` (raw source — the consumer's Vite compiles
it; also `setAnnotationInboxBaseResolver`), `./inbox` (`openFileInbox`, Node), `./mcp` (stdio bin), `./server` (route handler for
non-Nitro servers), `./testing` (storage contract suite), `./vue` (composable and list) with
`./vue.css` and `./styles/tokens.css`. Host frameworks are optional peers (`nuxt` and
`@nuxt/kit` for `./nuxt`, `vite` for `./vite`, `vue` for `./vue`, `vitest` for `./testing`):
install what the entry you import needs; the core, `./inbox`, `./server` and `./mcp` need
none.

Requirements: Nuxt 4, and DevTools left enabled with their default `componentInspector` —
that is what registers `vite-plugin-vue-tracer`, and the tracer is what supplies the
`file:line:column` segment. With devtools off, annotations still name every component and
its file; they just stop naming the line, and fall back to naming the route the note was
made on. Adding `VueTracer()` to the module's `addVitePlugin` call brings it back (the
tracer skips already-instrumented files, so a double registration is harmless).

### Check the install

```bash
npm run dev
curl -s localhost:3000/__annotations          # {"status":"open","items":[]}
curl -s localhost:3000/__annotations/access   # {"allowed":true}
```

Then annotate something in the browser, see it in `?format=markdown`, resolve it, and watch
the marker leave the tab within about ten seconds. If `/__annotations` answers with your
app's HTML instead of JSON, the route is not registered — check that the module is listed in `modules`.

## Storybook

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by
hand — two lines in `.storybook/main.ts`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from '@ecsplico/annotation-inbox/vite'

// in viteFinal's mergeConfig:
plugins: [vue(), ...(process.env.VITEST ? [] : [VueTracer(), annotationInbox({ endpoint: true })])],
```

and one in `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from '@ecsplico/annotation-inbox/mount'

setup(() => mountAnnotationToolbar())
```

`setup()` rather than a decorator: it is the one hook only Storybook's own renderer
reaches, so importing the preview from Vitest registers the toolbar without ever mounting
it. The `VITEST` gate keeps the endpoint and the instrumentation out of a browser-mode
Vitest project that loads `main.ts` through `@storybook/addon-vitest`.

`{ endpoint: true }` is what makes this Vite server *answer* `/__annotations` rather than
only configure the client half. Storybook has no Nitro, so it is the one harness that has
to ask for it; under `nuxt dev` the Nitro route already exists and the flag stays off.

The two subpaths are deliberately different in kind. `./vite` is built to `dist/vite.mjs`,
because it is loaded by Node — and Node will not type-strip TypeScript that lives under
`node_modules`. `./mount` is the raw `.ts` source, because its consumer is a Vite pipeline
that compiles it anyway, and shipping it precompiled would put the access gate's dynamic
imports behind a build boundary where the consumer's bundler can no longer split them into
their own chunk.

Storybook is its own origin and its tabs are their own sessions, but it reads the same
store as the Nuxt server beside it, so either port lists every note.

## A plain Vite app

An app with neither Nuxt nor Vue — vanilla JS, lit-html, any framework Vite serves — takes
the toolbar the Storybook way: the Vite plugin answers the route, and the app's own entry
mounts the toolbar. Measured on
[`youtube-knowledge`](https://github.com/mortegro/youtube-knowledge) (vanilla JS +
lit-html + Web Awesome, Vite 8, an Express API behind Vite's proxy), installed from the tag.

```js
// vite.config.mjs
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { annotationInbox } from '@ecsplico/annotation-inbox/vite'

export default defineConfig({
  optimizeDeps: { exclude: ['@ecsplico/annotation-inbox'] },
  plugins: [
    annotationInbox({ endpoint: true }),
    { ...vue(), apply: 'serve' },
    // …the app's own plugins
  ],
})
```

```js
// the app's entry, after it has mounted itself
if (import.meta.env.DEV) {
  import('@ecsplico/annotation-inbox/mount').then(({ mountAnnotationToolbar }) => mountAnnotationToolbar())
}
```

Each line answers a failure seen on the way:

- **An ESM config.** `./vite` is ESM-only, and Vite loads `vite.config.js` as CommonJS when
  `package.json` has no `"type": "module"`. Rename the config to `vite.config.mjs`, or set
  the type if the rest of the project allows it.
- **`@vitejs/plugin-vue`, serve-only.** The toolbar is a Vue app shipped as `.vue` files, so
  the dev server must compile SFCs even though the app has none. `apply: 'serve'` keeps the
  plugin out of the build; add it as a devDependency.
- **`optimizeDeps.exclude` for this package.** The plugin already excludes the toolbar
  library; a mount from `node_modules` must be excluded too. Pre-bundled, it bakes its own
  copy of Vue into the bundle while the toolbar's `.vue` files import the other one, and the
  toolbar throws `Cannot read properties of null (reading 'ce')` on first render. Vite
  leaves linked packages un-bundled, so a linked workspace should not meet this.
- **A dynamic import behind `import.meta.env.DEV`.** Vite replaces the flag with `false` in
  a build and drops the branch, so the production bundle names neither the toolbar nor the
  route: `grep -rlE 'agentation|__annotations' dist/` finds nothing. The access gate is not
  involved; *Deploying it* does not apply to this shape.
- **No `VueTracer()`.** It instruments SFC templates, and the app has none. Every note's
  target is therefore `route`, and the `**Path:**` selector plus the `**Context:**` text are
  what locate the element — stable class names and `data-*` attributes in the app's markup
  are what make a path readable.

A dev proxy coexists as long as its rules leave `/__annotations` alone: the plugin's
middleware answers the route, and `/api` and friends still reach the backend. On start the
dev server prints `annotation inbox: /__annotations → .data/annotations/`; the checks under
*Check the install* apply on Vite's port.

## Deploying it

The inbox exists in a production build too — annotating a deployed preview is the point —
and there it has to know who may annotate. Two independent doors, in this order:

1. **An agent token.** `NUXT_ANNOTATION_INBOX_TOKEN` maps to
   `runtimeConfig.annotationInbox.token` and is matched against
   `Authorization: Bearer <token>`. It is empty by default, which means "no agent can
   authenticate": a token that defaults to something is a token somebody forgets to change.
2. **A reviewer session**, decided by the host through a Nitro hook. The package cannot
   know what a trusted session is in your application, so it asks:

```ts
// server/plugins/annotation-inbox.ts
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('annotation-inbox:authorize', async (decision) => {
    try {
      decision.allowed = await yourOwnSessionCheck(decision.event)
    }
    catch {
      decision.allowed = false   // see below: this runs on ordinary page loads
    }
  })
})
```

The hook's type arrives with the module (`addTypeTemplate` writes it into
`.nuxt/types/`), so `decision.event` and `decision.allowed` are typed without you
declaring anything.

**Swallow your own errors in that hook.** It also runs for `/__annotations/access`, which
every page load probes, so an unreachable auth backend must produce
`200 {"allowed": false}` and not a `500` on a reader's page.

Under `nuxt dev` neither door is needed: a dev server is somebody's own machine and
answers `reviewer` to everyone. Without that rule a developer would have to configure a
token to annotate their own app.

Everything else is refused with `401 annotation inbox: unauthorized` — except
`/__annotations/access`, which always answers `{ allowed }` with a `200`, because a
refusal there would be a failed request on every reader's page load.

### In a container

- The server's working directory is the store's base, so `.data/annotations` has to exist
  and be writable by the user the image runs as. Create it in the Dockerfile and `chown` it;
  mount a volume over it if the notes should outlive the container.
- Pass `NUXT_ANNOTATION_INBOX_TOKEN` in; without it no agent can read the inbox from
  outside, which is the safe default but rarely the one you want in a review deployment.
- If the image installs this package **from GitHub**, the builder stage needs npm 11 and
  must not run with `--ignore-scripts` (see *Install*). It does not need `git` while the
  repository is public: `npm ci` in `node:24-slim` (npm 11, no `git`) fetched the tag over
  HTTPS and ran `prepare`.

### Check the deployment

```bash
curl -s localhost:<port>/__annotations/access                       # {"allowed":false}
curl -s localhost:<port>/__annotations                              # annotation inbox: unauthorized
curl -s -H "Authorization: Bearer $TOKEN" localhost:<port>/__annotations   # a listing
```

Then load the page as an ordinary reader and count the JavaScript requests, with the
Network panel or a headless run. A refused reader fetches strictly fewer files than an
allowed one — measured on a fresh Nuxt 4 project against this package: seven versus ten,
the difference being the toolbar's two chunks. If the counts match, the gate is decorative;
look for a static `import … from 'agentation-vue'` that pulled the library into the entry.

## One toolbar, several inboxes

By default every note of the toolbar goes to the module's own inbox (`base`, `/__annotations`).
A host whose notes belong somewhere that depends on the page — a workspace-scoped inbox
behind its own auth, say — registers a resolver from a client plugin:

```ts
// app/plugins/annotation-inbox.client.ts
import { setAnnotationInboxBaseResolver } from '@ecsplico/annotation-inbox/mount'

export default defineNuxtPlugin(() => {
  setAnnotationInboxBaseResolver((pageUrl) => {
    const workspace = new URL(pageUrl).pathname.match(/^\/workspace\/([^/]+)/)?.[1]
    return workspace ? `/api/workspaces/${workspace}/annotations` : undefined
  })
})
```

The rule is one line: a note's base is `resolve(note.url ?? location.href) ?? <the module's
base>`. The resolver gets the page the note was made on and answers with the **list route** of
the inbox that should hold it (the routes under it — `/resolve`, `/access` — are derived as
for any base), or `undefined` for the module's own. Pass `null` to remove it.

- **What the client does.** It groups the tab's notes by base and POSTs each group as its own
  payload — the same `sessionId`, `origin` and `url: location.href`, the markdown formatted
  from that group alone. The bases a tab has published to are remembered in `sessionStorage`;
  a base that held notes and now holds none receives an empty session, which is how a deleted
  note, or one whose page now resolves elsewhere, leaves the old inbox. The republish on page
  load follows the same rule. The poller asks `?session=<id>&status=closed` of each base that
  currently holds a note and removes what comes back.
- **What the server must do.** Each base has to speak the inbox's request surface — mount
  `handleInboxRequest(openFileInbox(root), request, { base })` (`./server`, `./inbox`)
  under it — and authorise it itself; the resolver only chooses where a request goes.
- **`/access` stays global.** The toolbar's "may I annotate here" probe still asks the
  module's base, whose `annotation-inbox:authorize` hook decides who gets a toolbar at all;
  the per-base routes then decide who may publish or read there.
- **Timing.** The resolver is read each time a note is published or polled, never captured,
  so registering it before or after the toolbar mounts is equivalent. A note whose page
  resolved to `undefined` (or whose resolver threw) was published to the module's base, and
  moves when the resolver later answers differently.
- **No resolver, no change.** Without one the client makes the single request it always has.

## Reading and answering annotations

- `curl -s 'localhost:<port>/__annotations?format=markdown'` — every open note, with its
  id, its target and the request that closes it. `?status=implemented|rejected|closed|all`,
  `?session=<id>` to narrow it.
- `curl -s -X POST localhost:<port>/__annotations/resolve -H 'content-type: application/json' -d '{"ids":["<id>"],"status":"rejected","resolution":"why"}'`
  — answers which ids were closed and which it never had. Both closing statuses take the
  note out of the human's toolbar; `rejected` is how an agent says no without going silent.
- `GET /__annotations/access` answers `{ allowed }` and never refuses: it is how the client
  decides whether to show a toolbar at all.
- `POST /__annotations` is what the toolbar itself does; the body is
  `{ sessionId, origin, url, annotations, markdown }`
  (`modules/annotation-inbox/contract.ts`). A note the tab stops sending is
  deleted while it is still open and kept once it has been answered — dropping
  the marker is how the tab acknowledges the answer, and the answer is what the
  listing is for. An empty `annotations` array therefore clears a session that
  holds nothing answered, and nothing else.

Against a deployed server every one of these needs `-H "Authorization: Bearer $TOKEN"`.

### An MCP server over the inbox

Agents answer notes more reliably through a tool than through a remembered `curl` line, so
the package ships a stdio MCP server, `annotation-inbox-mcp` (`dist/mcp.mjs`). It does not
go through HTTP: it opens `<root>/.data/annotations` itself — the directory the dev server
writes — so it needs no port, works while the dev server is down, and cannot be answered by
a neighbouring project's server. The root is, in order, `--root <dir>`, the environment
variable `ANNOTATION_INBOX_ROOT`, then the working directory. It prints the directory it
opened to stderr once; stdout is the MCP transport.

Two tools, named like the skill's vocabulary:

- `annotations_list` — `status` (`open` by default, `implemented`, `rejected`, `closed`,
  `all`), `session` (one browser tab), `format` (`markdown` by default, or `json`).
- `annotations_resolve` — `ids`, `status` (`implemented` or `rejected`) and `resolution`.
  `rejected` without a `resolution` is refused, as the skill requires.

**In a `@skaile/workspaces` project** the server ships as an asset, `mcp/annotation-inbox/MCP.md`
(kind `mcp-server`). Add `@ecsplico/annotation-inbox` to the project's dependencies, then
either list this repository under `sources:` in `skaile.yaml` and depend on the asset:

```yaml
sources:
  - url: https://github.com/skaile-ai/annotation-inbox
dependencies:
  - mcp-server:annotation-inbox
```

or declare the same command explicitly, which needs no source clone:

```yaml
mcp_servers:
  - id: annotation-inbox
    transport: stdio
    command: node
    args: ["${workspace}/node_modules/@ecsplico/annotation-inbox/dist/mcp.mjs"]
    env:
      ANNOTATION_INBOX_ROOT: "${workspace}"
```

`${workspace}` is the project directory; the runner sets no working directory for the
server, which is why the root is passed as an environment variable.

**In Claude Code** (or any host that starts MCP servers in the project directory) a
`.mcp.json` is enough, since the root falls back to the working directory:

```json
{
  "mcpServers": {
    "annotation-inbox": {
      "command": "node",
      "args": ["node_modules/@ecsplico/annotation-inbox/dist/mcp.mjs"]
    }
  }
}
```

**From your own Node tool**, skip the protocol and open the inbox directly:

```ts
import { openFileInbox } from '@ecsplico/annotation-inbox/inbox'

const inbox = openFileInbox('/path/to/project')
const open = await inbox.list({ status: 'open' })
await inbox.resolve([open[0].inboxId], 'implemented', 'Abstand auf 12px', 'agent')
```

`createInbox`, `renderMarkdown`, `resolveTarget` and the contract types come from the same
entry. A missing `.data/annotations` is not an error: the listing is empty.

The file store is what the dev server writes, and only that. A host that mounts SQLite under
the inbox (see *Storage*) or serves notes from a deployed origin keeps them where the fs
store cannot see them; for those, a small MCP server of your own that `GET`s the listing
(`status`, `session`, `format`, `origin`) and `POST`s `/resolve` (`ids`, `status`,
`resolution`) over HTTP still works. Resolve the origin per call, send the bearer token
when one is configured, and name the origin in connection errors — `fetch failed` does not
say which address was tried.

## Listing and answering notes in a Vue app

`./vue` is for the human side of the inbox: a host that wants its own list of what agents
were asked to change, instead of (or next to) the toolbar. It has no UI-kit dependency —
`vue` is the only peer — and imports nothing from the toolbar library.

```vue
<script setup lang="ts">
import { AnnotationList, useAnnotations } from '@ecsplico/annotation-inbox/vue'

const annotations = useAnnotations({
  list: '/__annotations',              // string, or () => string for a reactive endpoint
  resolve: '/__annotations/resolve',
  pollMs: 10_000,                      // default; 0 turns polling off
  locale: 'en',                        // 'en' | 'de'
  messages: { implement: 'Do it' },    // override single keys
})

function implement(item) { /* hand the note to an agent; resolve() when it is done */ }
</script>

<template>
  <AnnotationList :annotations="annotations" @implement="implement" />
</template>
```

`useAnnotations` returns `items`, `status` (`'open' | 'closed' | 'all'`, changing it
refreshes), `loading`, `error`, `openCount`, `refresh()`, `resolve(ids, status, resolution?)`
and `t` (the translator, shared with the list). `resolve('rejected')` without a
resolution throws before any request, as the server and the MCP tool refuse it. Inside a
component polling starts on mount and stops on unmount; a failed refresh keeps the last
good items and sets `error`. The endpoints are plain strings, so a host that proxies the
inbox under its own route (a workspace-scoped one, say) needs none of the module's routes.
`fetch` takes a `$fetch`-shaped function (resolves to the parsed body, rejects on non-2xx);
Nuxt's `$fetch` fits, and the default is a small wrapper over `fetch`.

`<AnnotationList>` groups notes by browser session, shows each target as `file:line:col` or
as the route, and offers **Implement** (emits `implement(item)`; the host decides what that
means) and **Reject** (asks for a reason inline, then calls `resolve`). It is native
elements only, every state carries a text label, and the controls are keyboard-complete.

Two props and a slot let a host act on and restrict the list without CSS:

- **`open` (emit) and `#target` (slot).** When the host listens for `open`
  (`<AnnotationList @open="…">`), each target renders as a `type="button"` that emits
  `open(item)` on click and on Enter (Space works natively); the host decides what opening
  means (the SKAILE forge opens the file in its Files tab). The listener is detected at
  render time: without `@open` the target stays the plain `<code>` it always was, so a
  list that only displays targets gets no extra tab stops. The `target` scoped slot
  receives `{ item, text }`, where `text` is the default (`file:line:col` or the route),
  and replaces the target's content; inside the button when `@open` is handled.
  ```vue
  <AnnotationList :annotations="annotations" @open="openFile">
    <template #target="{ item, text }">{{ item.target.kind === 'route' ? text : basename(text) }}</template>
  </AnnotationList>
  ```
- **`readonly` (boolean prop).** Hides Implement and Reject on every note, and the rejection
  form with them; the list has no other write controls, so a bulk action cannot appear.
  Notes, filter, **Refresh** and polling keep working. Use it for viewers that may not
  resolve notes.

### Theming: the `--sk-*` tokens

The list is styled only by these CSS variables, the same names the other `@skaile-ai`
packages use:

| token | role |
|---|---|
| `--sk-bg`, `--sk-fg`, `--sk-muted` | surface, text, secondary text |
| `--sk-border`, `--sk-radius` | outlines, corner radius |
| `--sk-primary`, `--sk-primary-fg` | the Implement button |
| `--sk-success`, `--sk-warning`, `--sk-danger` | implemented / open / rejected |
| `--sk-font` | font family |

Import the sheets once — the defaults are declared under `:where(:root)`, so repeating them
(another package ships the same file) is harmless and any host rule wins:

```ts
// nuxt.config.ts
css: [
  '@ecsplico/annotation-inbox/styles/tokens.css',
  '@ecsplico/annotation-inbox/vue.css',   // the list's own rules; they carry fallbacks too
],
```

then map them to your design system once, e.g. PrimeVue:

```css
:root {
  --sk-bg: var(--p-content-background);
  --sk-fg: var(--p-text-color);
  --sk-muted: var(--p-text-muted-color);
  --sk-border: var(--p-content-border-color);
  --sk-primary: var(--p-primary-500);
  --sk-primary-fg: var(--p-primary-contrast-color);
}
```

Dark mode is the host flipping those values; nothing here reads `prefers-color-scheme`.

## Storage

The server half touches nothing but an unstorage `Storage`, so where annotations live is
the host's decision, not this package's. The module mounts a filesystem driver rooted at
`.data/annotations` under the name `annotation-inbox` at build time, and it does so with
`??=`, so a host that configures that mount itself keeps its own.

A host that wants the notes queryable or container-proof mounts something else under that
name. SQLite through [db0](https://github.com/unjs/db0), where each note is a row:

```ts
// server/plugins/annotation-inbox-storage.ts
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createDatabase } from 'db0'
import nodeSqlite from 'db0/connectors/node-sqlite'
import db0Driver from 'unstorage/drivers/db0'

const mount = 'annotation-inbox'                        // the module's INBOX_STORAGE_MOUNT
const file = '.data/annotations/inbox.sqlite'           // inside INBOX_DIR: one volume covers both

export default defineNitroPlugin(async () => {
  mkdirSync(dirname(file), { recursive: true })         // node:sqlite will not create the parent
  const database = createDatabase(nodeSqlite({ path: file }))
  const storage = useStorage()
  await storage.unmount(mount, false)                   // mount() refuses a name already taken
  storage.mount(mount, db0Driver({ database, tableName: 'annotation_inbox' }))
})
```

Three things that bite in that order: `node:sqlite` reports a missing parent directory as
"unable to open database file" rather than creating one; `useStorage().mount()` refuses a
name that is already mounted, so the module's build-time default has to be unmounted first;
and `unmount(name, false)` — a disposing unmount deletes the directory's contents on some
drivers. `db0` is your dependency, not this package's; add it yourself. Both halves log
once per process that they are experimental (unstorage's "Database driver is experimental",
Node's `ExperimentalWarning` for `node:sqlite`); neither indicates a misconfiguration.

Then the question the layout exists for is a query:

```sql
select json_extract(value, '$.status')     as status,
       json_extract(value, '$.target.ref') as ref,
       json_extract(value, '$.resolution') as resolution
from annotation_inbox where key like 'items:%';
```

Note for anything that iterates keys: unstorage treats `:` as a segment separator, so
`getKeys('items:<sessionId>')` — a partial prefix *inside* a segment — matches nothing,
while `getKeys('items')` works. That is why a session's membership lives in its
`itemIds` array and not in its key prefix.

## The shipped skills

`ai-assets/annotation-inbox/SKILL.md` travels with the package: the agent that installs the
package also gets its operating manual — how to read the notes and map each one back to a
line, and (in `setup.md`, `troubleshooting.md` beside it) how to wire the toolbar into a
project that does not have it yet. It is model-invoked, so it triggers on "I left you
notes" and on "this button sits too low" without anybody naming the skill.

`ai-assets/annotation-watch/SKILL.md` is the companion for continuous work: a dispatcher
session that watches the inbox and implements each new note through `task` subagents until
stopped. It ships `scripts/wait-for-notes.sh`, the poller the dispatcher blocks on.

Wiring them up in a consuming project is one of:

```
npx skills add skaile-ai/annotation-inbox
ln -s ../../node_modules/@ecsplico/annotation-inbox/ai-assets/annotation-inbox .claude/skills/annotation-inbox
ln -s ../../node_modules/@ecsplico/annotation-inbox/ai-assets/annotation-watch .claude/skills/annotation-watch
```

A symlink keeps the manuals in step with the package on every update; a copy is fine if
your skill loader does not follow links.

## What is inside

```
package.json                                    name, exports, the tsdown build
src/nuxt.ts                                     the Nuxt module (`./nuxt`)
src/vue/useAnnotations.ts                       the composable (`./vue`)
src/vue/AnnotationList.vue                      the reference list
src/i18n/{en,de}.ts                             message catalogs for `./vue`
styles/tokens.css                               the `--sk-*` defaults (`./styles/tokens.css`)
modules/annotation-inbox/contract.ts            route, mount name, item and session types
modules/annotation-inbox/inbox.ts               the framework-neutral core: storage + routes
modules/annotation-inbox/principal.ts           Principal types and the dev/token defaults
modules/annotation-inbox/vite.ts                the dev-server adapter; Storybook's entry
modules/annotation-inbox/runtime/server/handler.ts  the Nitro adapter, and who is allowed in
modules/annotation-inbox/runtime/mount.ts       the toolbar mount, both harnesses
modules/annotation-inbox/runtime/inbox.ts       storage adapter, component detector, poller, base resolver
modules/annotation-inbox/runtime/plugin.client.ts  Nuxt's entry into the mount
dist/                                           the built entries, with declarations
ai-assets/annotation-inbox/SKILL.md                the agent's operating manual (+ setup.md, troubleshooting.md)
ai-assets/annotation-watch/SKILL.md                the continuous-watch dispatcher (+ scripts/wait-for-notes.sh)
mcp/annotation-inbox/MCP.md                     the stdio server as a workspaces asset
docs/llms.md                                    operations, HTTP and MCP spellings, closing rule
test/                                           the contract, the adapter, the composable, the licence locks
LICENSE                                         MIT, for this wiring
```

Nothing here imports anything from outside the package except its own dependencies.

## How the toolbar reaches a browser

The toolbar ships in production builds, and the guarantee is not "absent" but "never
arrives unasked": it is a chunk of its own, fetched only after `/__annotations/access` has
said this reader may annotate. A reader who may not downloads none of it. That holds only
while the code keeps a precise shape, so `test/locks.spec.ts` asserts the shape rather than
trusting it:

1. Exactly one file in the package names `agentation-vue` at all — the shared mount, which
   Nuxt reaches through a plugin and Storybook imports from `preview.ts`.
2. Every reference to the library is a dynamic `import()`, placed *after* the access probe.
   A single static import collapses the whole property with no runtime symptom: a top-level
   import is part of the module graph before any branch runs, so the library lands in the
   entry chunk and every reader downloads it whatever the gate answers.
3. The build is told not to hint the gated chunks. Nuxt turns a dynamic plugin import into
   `<link rel="prefetch">`, and a prefetched chunk is a downloaded chunk — measured on a
   production build, a refused reader had fetched both library chunks before `/access`
   answered. The module's `build:manifest` hook clears `prefetch`/`preload` for them.
4. The package owns the dependency: a project installing this package lists it once, as this
   package's dependency, and not in its own manifest.

If you deploy a built Storybook rather than throwing it away, check it too:
`grep -rl agentation storybook-static/` after a build should find nothing, because
`VueTracer()` disables itself outside `vite dev` and the toolbar's mount is not reached
from a static build's preview.

## Licence

This package is the wiring; the toolbar it mounts is
[`agentation-vue`](https://www.npmjs.com/package/agentation-vue), licensed under [PolyForm
Shield 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — not an open source
licence: any use except building a competing product. That is why *how* it reaches a
browser is a tested property rather than a habit, and why the access gate stands in front
of the imports rather than behind them. `vite-plugin-vue-tracer` is MIT.
