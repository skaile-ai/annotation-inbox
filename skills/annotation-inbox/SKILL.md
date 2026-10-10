---
name: annotation-inbox
description: Set up the annotation toolbar in a Nuxt, Storybook or plain Vite project, and read the annotations a human left by clicking the running app. Use when asked to install or wire the annotation inbox, when the human says they left notes or annotations, or when they describe something they pointed at ("this button", "the spacing here") rather than named.
---

# Annotation inbox

A human clicks an element in the running app, writes a comment, and the server stores that
comment together with the file and line of the template that draws the element. You read
those notes, act, and — this is new — say what you did: every note has a status, and
leaving it `open` means the human is still waiting.

## Reading annotations

Read them when the human says they left notes, and read them unprompted when they ask
about something they *pointed at* rather than named — "this button sits too low", "the
spacing here is wrong". That sentence has no referent in the repo; the annotation is the
referent.

```
curl -s 'localhost:<port>/__annotations?format=markdown'
```

Port 3000/3040 for the Nuxt dev server, 6011 for Storybook, `server.port` in
`vite.config.*` for a plain Vite app. Default is every open note
across every tab; `?status=closed` shows what has been answered, `?status=all` everything,
`?session=<id>` one browser tab. An empty listing is not an error: it means nobody has an
open note.

Each item carries a `**Comment:**`, a `**Target:**` (what the note is about, and the one
line to open first), a `**Path:**` (the CSS selector, which says where on screen the thing
ended up) and a `**Components:**` chain. The target is derived for you:

```
- **Target:** element `app/components/guide/GuidePicker.vue:42:5`
- **Target:** route `/guide/atem`
```

`element` when the tracer knew the source position — open that file and line. `route` when
it did not, which is what a production build gives, and every note in an app without Vue
SFCs: the note is about that page, and the `**Path:**` selector, the `**Context:**` text and
the comment are what narrow it down — search the source for the path's class names and
`data-*` attributes. A note never has no target.

Read the components chain backwards when you need the call site: the last segment is the
element's own `file:line:column`, the chain above it is its ancestry, and that only matters
when the element is rendered from more than one place.

## Answering a note

When you have acted on a note, or decided not to, say so. This is not bookkeeping: it is
what makes the note disappear from the human's toolbar, and `rejected` without a reason
tells them nothing.

```
curl -s -X POST localhost:<port>/__annotations/resolve \
  -H 'content-type: application/json' \
  -d '{"ids":["<inboxId>"],"status":"implemented","resolution":"Abstand auf 12px"}'
```

`status` is `implemented` or `rejected`; `resolution` is your sentence to the human and is
what a refusal is *for* — "widerspricht dem Phone-Frame" is an answer, silence is not. The
response names which ids were closed and which it never had. Resolving again corrects a
note you closed too early.

**Done when** every annotation in the listing is either mapped to a file and a line and
resolved, or resolved as `rejected` with a reason. A note you silently skipped is a note
the human believes you read.

## Installing it

Add `@skaile-ai/annotation-inbox` as a devDependency, and add `.data/` to `.gitignore` —
the notes are as ephemeral as the browser session they were made in and are never
committed.

For Nuxt, one line in `nuxt.config.ts` and nothing else:

```ts
modules: ['@skaile-ai/annotation-inbox/nuxt']
```

The module (options `token`, `base`, `dir`, `authorize` — all optional) registers the toolbar plugin, the routes and a storage mount in every
environment except a `@nuxt/test-utils` run, so there is no flag to set. In a dev server
everyone may annotate. In a deployed build nobody may until the host says so: an agent
sends `Authorization: Bearer $NUXT_ANNOTATION_INBOX_TOKEN`, and a human's session is judged
by the host's `annotation-inbox:authorize` Nitro hook. The README's *Deploying it* section
is the recipe; a deployment with neither configured serves a page with no toolbar and an
inbox that refuses you.

Storybook is standalone Vite and is not covered by the Nuxt module, so it is wired by hand.
In `.storybook/main.ts`, inside `viteFinal`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from '@skaile-ai/annotation-inbox/vite'

plugins: [vue(), VueTracer(), annotationInbox({ endpoint: true })],
```

`VueTracer` is what supplies the `file:line:column` segment; without it the annotations
still name every component and its SFC, they just stop naming the line. Nuxt registers the
tracer itself through DevTools' component inspector, which is why the Nuxt side needs no
equivalent line.

In `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from '@skaile-ai/annotation-inbox/mount'

setup(() => mountAnnotationToolbar())
```

Use `setup()` rather than a decorator. It is the one hook only Storybook's own renderer
reaches, so a Vitest run that imports the preview registers the toolbar without ever
mounting it.

A plain Vite app — no Nuxt, no Vue — is wired like Storybook, plus four pieces whose
absence each breaks something: an ESM `vite.config.mjs`, a serve-only
`@vitejs/plugin-vue` for the toolbar's own `.vue` files, `optimizeDeps.exclude:
['@skaile-ai/annotation-inbox']` (else two Vues: `Cannot read properties of null (reading
'ce')`), and a mount behind `if (import.meta.env.DEV)` in the app's entry so the build
carries none of it. The README's *A plain Vite app* has the code; copy it from there.

**Done when** all three checks have been observed rather than assumed:

- `curl -s localhost:<port>/__annotations` answers with a listing, and
  `curl -s localhost:<port>/__annotations/access` with `{"allowed":true}`. HTML instead of
  JSON means the route is not registered — check that the module is listed in `modules`. Storybook and a plain
  Vite app print `annotation inbox: /__annotations → .data/annotations/` on start, because
  there the endpoint is the Vite plugin's; under Nuxt it is a Nitro route and prints nothing.
- A note survives the round trip: annotate something, see it `open` in the listing, resolve
  it, and see it leave the default listing and the toolbar within about ten seconds.
- On a deployed build, `/__annotations/access` answers `{"allowed":false}` for a reader
  with no session and the page carries no toolbar, while the agent token still lists. A
  plain Vite app has no deployed toolbar at all: `grep -rlE 'agentation|__annotations'
  dist/` after a build finds nothing.

## Beyond that

If your tool list has `annotations_list` and `annotations_resolve`, use them instead of the
`curl` lines above: they come from the package's own MCP server (`annotation-inbox-mcp`,
shipped as `mcp/annotation-inbox/MCP.md`), read `.data/annotations` directly so they need no
port, and take the same `status`, `session`, `ids` and `resolution`. `rejected` without a
`resolution` is refused.

The package README covers what only some projects need: *Deploying it* (the agent token,
the `annotation-inbox:authorize` hook, containers), *Storage* (mounting SQLite under the
inbox so every note is a row), *An MCP server over the inbox* (wiring it into a skaile
workspace or Claude Code), how a browser tab becomes a
session, the POST contract the toolbar speaks, and the PolyForm Shield licence of the
toolbar library with the locks that keep it from reaching a reader who may not annotate.
Read it when a question is about the mechanism rather than about using it.
