# @ecsplico/annotation-inbox — notes for coding agents

A human clicks an element in a running app, writes a comment, and the server stores it with
the file and line of the template that draws the element. You read those notes, act on them,
and **say what you did** — a note left `open` means the human is still waiting.

Full operating manual: `ai-assets/annotation-inbox/SKILL.md`. Install and deployment recipes:
`README.md`.

## Operations

There are two, and one note is identified by its `inboxId` (`<sessionId>-<n>`).

| Operation | HTTP | MCP tool (stdio, `annotation-inbox-mcp`) | Node (`@ecsplico/annotation-inbox/inbox`) |
|---|---|---|---|
| List notes | `GET /__annotations?status=open&format=markdown` | `annotations_list { status, session?, format }` | `openFileInbox(root).list({ status, sessionId? })` |
| Resolve notes | `POST /__annotations/resolve` with `{ "ids": ["<inboxId>"], "status": "implemented" \| "rejected", "resolution": "<why>" }` | `annotations_resolve { ids, status, resolution? }` | `openFileInbox(root).resolve(ids, status, resolution, 'agent')` |

- `status` of a listing: `open` (default), `implemented`, `rejected`, `closed` (both answered
  states), `all`. `?session=<id>` narrows to one browser tab. `format=markdown` (default) is
  written to be acted on; `format=json` answers `{ status, items }`.
- Each item carries `comment`, `target`, `elementPath` (CSS selector) and `vueComponents`
  (the component chain). `target.kind` is `element` — `target.ref` is a `file:line:column`,
  open it first — or `route` — the note is about that page; narrow it with the selector, the
  context text and the comment. A note never has no target.
- `resolve` answers `{ "resolved": [...], "unknown": [...] }`: which ids it closed and which
  it never had. Resolving again corrects a note you closed too early.
- HTTP against a deployed server needs `Authorization: Bearer $NUXT_ANNOTATION_INBOX_TOKEN`;
  under `nuxt dev` and the stdio MCP server no token is needed. The MCP server reads
  `<root>/.data/annotations` directly (`--root <dir>`, else `ANNOTATION_INBOX_ROOT`, else the
  working directory), so it works without a running dev server.

## The closing rule

You are **done** when every note in the listing is either

1. mapped to a file and a line and resolved as `implemented` (with a short `resolution`), or
2. resolved as `rejected` **with a reason**.

`rejected` without a `resolution` is refused — by the HTTP route (400), by the MCP tool and
by the Vue composable — because the reason is what a refusal is for. A note you silently
skipped is a note the human believes you read.

## Where the code is

| Entry | What |
|---|---|
| `@ecsplico/annotation-inbox` | types (`InboxItem`, `InboxStatus`, `InboxTarget`), `createInbox(store)` with `subscribe`, `renderMarkdown`, `resolveTarget`, `Principal` types |
| `/nuxt` | the Nuxt module: `modules: ['@ecsplico/annotation-inbox/nuxt']`, options `token`, `base`, `dir`, `authorize`; Nitro hook `annotation-inbox:authorize` |
| `/vite`, `/mount` | Storybook and plain Vite wiring; `/mount` also exports `setAnnotationInboxBaseResolver(resolve \| null)` |
| `/inbox` | `openFileInbox(root)` for Node tools |
| `/mcp` | the stdio server (`dist/mcp.mjs`, bin `annotation-inbox-mcp`) |
| `/server` | `handleInboxRequest(inbox, request, { base })` for non-Nitro servers |
| `/testing` | `storageContractTests(name, factory)` to prove a custom unstorage mount |
| `/vue`, `/vue.css`, `/styles/tokens.css` | `useAnnotations`, `<AnnotationList>`, `--sk-*` theme tokens, `en`/`de` messages |

For a human-facing list in a Vue host, `useAnnotations({ list, resolve, pollMs?, locale?,
messages?, fetch? })` returns `items`, `status`, `loading`, `error`, `refresh()` and
`resolve(ids, status, resolution?)`; `<AnnotationList :annotations="…" @implement="…" />`
renders it. Endpoints are explicit strings, so a host may proxy the inbox under its own
route. `<AnnotationList>` also takes `readonly` (hides Implement/Reject; the list still
reads and refreshes), emits `open(item)` on click/Enter of a target when the host listens
for it (otherwise the target stays plain text), and has a `target` slot receiving
`{ item, text }` (`text` = `file:line:col` or the route).

A host that wants a note to land in an inbox other than `/__annotations` (a workspace-scoped
one, say) registers `setAnnotationInboxBaseResolver((pageUrl) => listRoute | undefined)` from
a client plugin. Each note's base is `resolve(note.url ?? location.href) ?? <module base>`;
the client POSTs each base only its own notes, sends an empty session to a base that lost its
last note, and polls only bases holding notes. The base is a list route (`GET`/`POST`, with
`/resolve` under it) — the agent reads and resolves there exactly as at `/__annotations`.
`/access` stays on the module's base. See README "One toolbar, several inboxes".
