---
name: annotation-inbox
description: Read and answer the annotations a human left by clicking the running app (Nuxt, Storybook or plain Vite). Use when the human says they left notes or annotations, or points at something ("this button", "the spacing here") instead of naming it. Use also to install the toolbar into a project, or to fix a `/__annotations` route that does not answer.
---

# Annotation inbox

A human clicks an element in the running app, writes a comment, and the server stores that
comment together with the file and line of the template that draws the element. You read
those notes, act, and say what you did: every note has a status, and leaving it `open`
means the human is still waiting.

Branches off this file:

- Toolbar not installed in the project yet: [setup.md](setup.md).
- `/__annotations` returns HTML, nothing, or a refusal; the toolbar throws on mount: [troubleshooting.md](troubleshooting.md).
- Keeping an agent watching the inbox while the human annotates: run the `annotation-watch` skill.

## Reading annotations

Read them when the human says they left notes, and unprompted when they ask about
something they *pointed at* rather than named — "this button sits too low", "the spacing
here is wrong". That sentence has no referent in the repo; the annotation is the referent.

```
curl -s 'localhost:<port>/__annotations?format=markdown'
```

Port 3000/3040 for the Nuxt dev server, 6011 for Storybook, `server.port` in
`vite.config.*` for a plain Vite app. The default is every open note across every tab;
`?status=closed` shows what has been answered, `?status=all` everything, `?session=<id>`
one browser tab. An empty listing is not an error: nobody has an open note.

Each item carries a `**Comment:**`, a `**Target:**` (what the note is about, and the one
line to open first), a `**Path:**` (the CSS selector, which says where on screen the thing
ended up) and a `**Components:**` chain. The target is derived for you:

```
- **Target:** element `app/components/guide/GuidePicker.vue:42:5`
- **Target:** route `/guide/atem`
```

`element`: the tracer knew the source position — open that file and line. `route`: it did
not, which is what a production build gives, and every note in an app without Vue SFCs. The
note is about that page; the `**Path:**` selector, the `**Context:**` text and the comment
narrow it down — search the source for the path's class names and `data-*` attributes. A
note never has no target.

Read the components chain backwards when you need the call site: the last segment is the
element's own `file:line:column`, the chain above it is its ancestry, and that only matters
when the element is rendered from more than one place.

## Answering a note

When you have acted on a note, or decided not to, say so. This is what makes the note
disappear from the human's toolbar, and `rejected` without a reason tells them nothing.

```
curl -s -X POST localhost:<port>/__annotations/resolve \
  -H 'content-type: application/json' \
  -d '{"ids":["<inboxId>"],"status":"implemented","resolution":"Abstand auf 12px"}'
```

`status` is `implemented` or `rejected`; `resolution` is your sentence to the human and is
what a refusal is *for* — "widerspricht dem Phone-Frame" is an answer, silence is not. Write
it in the language of the comment. The response names which ids were closed and which it
never had. Resolving again corrects a note you closed too early.

**Done when** every annotation in the listing is either mapped to a file and a line and
resolved, or resolved as `rejected` with a reason. A note you silently skipped is a note
the human believes you read.

## MCP tools instead of curl

If your tool list has `annotations_list` and `annotations_resolve`, use them instead of the
`curl` lines above: they come from the package's own MCP server (`annotation-inbox-mcp`,
`dist/mcp.mjs`, shipped as `mcp/annotation-inbox/MCP.md`), read `.data/annotations`
directly so they need no port, and take the same `status`, `session`, `ids` and
`resolution`. `rejected` without a `resolution` is refused.

In omp with the package's extension installed, they are plain tools (no `mcp__` prefix) that read `.data/annotations` in process: no MCP entry and no dev server.

## Mechanism questions

The package README (`node_modules/@ecsplico/annotation-inbox/README.md`) is the single
source for every recipe and for what only some projects need: *Deploying it* (agent token,
`annotation-inbox:authorize` hook, containers), *Storage* (SQLite under the inbox),
*An MCP server over the inbox* (skaile workspace or Claude Code), how a browser tab becomes
a session, the POST contract the toolbar speaks, and the PolyForm Shield licence of the
toolbar library with the locks that keep it from a reader who may not annotate. Read it
when a question is about the mechanism rather than about using it.
