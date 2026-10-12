# Installing the annotation inbox

## Contents

- [Install](#install)
- [Nuxt](#nuxt)
- [Storybook](#storybook)
- [Plain Vite app](#plain-vite-app)
- [Deployment](#deployment)
- [Finish on evidence](#finish-on-evidence)

Package `@ecsplico/annotation-inbox` on npmjs (no token needed), repository
`github.com/skaile-ai/annotation-inbox`. The README is the recipe and the single source for
every command; read it once the package is installed
(`node_modules/@ecsplico/annotation-inbox/README.md`) rather than reconstructing steps from
here. Reference consumers, each running the branches below: `boje-designstudy` (Nuxt,
Storybook, deployment) and `youtube-knowledge` (plain Vite, vanilla JS + lit-html).

A project still on the old `nuxt-layer-annotation-inbox` (a Nuxt *layer*, up to 0.1.x)
migrates to the 1.x Nuxt *module* by swapping the dependency and every import specifier.

## Install

`npm i -D @ecsplico/annotation-inbox`, and add `.data/` to `.gitignore` — the notes are as
ephemeral as the browser session they were made in and are never committed.

Host frameworks are optional peers: install the one the entry you import needs (`nuxt` +
`@nuxt/kit` for `./nuxt`, `vite` for `./vite`, `vue` for `./vue`). Only a project that also
*edits* the package links a clone of the repository instead (npm workspace or `npm link`).

Wire only the surfaces the project has.

## Nuxt

One line in `nuxt.config.ts` and nothing else:

```ts
modules: ['@ecsplico/annotation-inbox/nuxt']
```

The module (options `token`, `base`, `dir`, `authorize`, all optional) registers the
toolbar plugin, the routes and a storage mount in every environment except a
`@nuxt/test-utils` run, so there is no flag to set. In a dev server everyone may annotate.

## Storybook

Storybook is standalone Vite, has no Nitro and is not covered by the Nuxt module, so it is
wired by hand and serves the route itself. In `.storybook/main.ts`, inside `viteFinal`:

```ts
import { VueTracer } from 'vite-plugin-vue-tracer'
import { annotationInbox } from '@ecsplico/annotation-inbox/vite'

plugins: [vue(), VueTracer(), annotationInbox({ endpoint: true })],
```

`VueTracer` supplies the `file:line:column` segment; without it the annotations still name
every component and its SFC, they just stop naming the line. Nuxt registers the tracer
itself through DevTools' component inspector, which is why the Nuxt side needs no
equivalent line.

In `.storybook/preview.ts`:

```ts
import { mountAnnotationToolbar } from '@ecsplico/annotation-inbox/mount'

setup(() => mountAnnotationToolbar())
```

Use `setup()` rather than a decorator. It is the one hook only Storybook's own renderer
reaches, so a Vitest run that imports the preview registers the toolbar without ever
mounting it.

## Plain Vite app

No Nuxt, no Vue; the toolbar lives in the dev server only. Wire it like Storybook, plus four
pieces whose absence each breaks something:

- an ESM `vite.config.mjs` (the `/vite` export is ESM-only);
- a serve-only `@vitejs/plugin-vue` for the toolbar's own `.vue` files;
- `optimizeDeps.exclude: ['@ecsplico/annotation-inbox']` (else two Vues: `Cannot read
  properties of null (reading 'ce')`);
- a mount behind `if (import.meta.env.DEV) import('@ecsplico/annotation-inbox/mount')…` in
  the app's entry, so the build carries none of it.

The README's *A plain Vite app* section has the code; copy it from there. Deployment does
not apply.

## Deployment

Only for an app that is deployed. In a deployed build nobody may annotate until the host
says so: an agent sends `Authorization: Bearer $NUXT_ANNOTATION_INBOX_TOKEN`, and a human's
session is judged by the host's `annotation-inbox:authorize` Nitro hook (a Nitro plugin
answering who counts as a reviewer). Add a SQLite mount if the notes must outlive the
container. The toolbar ships as a lazy chunk and asks `GET /__annotations/access` before
mounting, so a reader who is refused downloads none of it. A deployment with neither token
nor hook serves a page with no toolbar and an inbox that refuses you. The README's
*Deploying it* is the recipe.

## Finish on evidence

Done when all of these have been observed rather than assumed:

- `curl -s localhost:<port>/__annotations` answers with a listing, and
  `curl -s localhost:<port>/__annotations/access` with `{"allowed":true}`. Storybook and a
  plain Vite app print `annotation inbox: /__annotations → .data/annotations/` on start,
  because there the endpoint is the Vite plugin's; under Nuxt it is a Nitro route and prints
  nothing. HTML instead of JSON: [troubleshooting.md](troubleshooting.md).
- A note survives the round trip: annotate something, see it `open` in
  `?format=markdown` with a `**Target:**` line naming a file and line (a route on plain
  Vite), resolve it, and see it leave the default listing and the toolbar within about ten
  seconds. The toolbar renders without a console error.
- On a deployed build, `/__annotations/access` answers `{"allowed":false}` for a reader with
  no session and the page carries no toolbar chunk, while the agent token still lists. On a
  plain Vite app: after `npm run build`, `grep -rlE 'agentation|__annotations' dist/` finds
  nothing.
