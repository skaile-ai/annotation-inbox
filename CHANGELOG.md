# Changelog

## Unreleased

### Changed

- The shipped agent skills moved from `skills/` to `ai-assets/` (`package.json` `files`
  ships `ai-assets`). `annotation-inbox` is now a short `SKILL.md` for reading and answering
  notes, with the install steps in `setup.md` and fixes in `troubleshooting.md`. Symlinks
  and copies pointing at `skills/annotation-inbox` need the new path.

### Added

- The `annotation-watch` skill (`ai-assets/annotation-watch/`): a dispatcher that watches
  the inbox and implements each new note through subagents, with
  `scripts/wait-for-notes.sh`.

## 1.1.1

### Changed

- The optional `vitest` peer accepts `^4.0.0 || ^5.0.0`. A consumer on vitest 5 no longer
  needs `--legacy-peer-deps` to install the package. `./testing` uses only `describe`, `it`,
  `expect` and `beforeEach`, which vitest 5 keeps unchanged; the package's own suite now runs
  on vitest 5.

## 1.1.0

### Added

- `setAnnotationInboxBaseResolver(resolve | null)`, exported from `@ecsplico/annotation-inbox/mount`.
  A host registers `(pageUrl: string) => string | undefined`; each note is published to
  `resolve(note.url ?? location.href) ?? <the module's base>`, so one toolbar can fill several
  inboxes — a workspace-scoped route per workspace, say — instead of the single
  `/__annotations`. The client groups the tab's notes by base and POSTs each group to its own
  list route (same `sessionId`, `origin` and `url`; markdown formatted from that group only). A
  base that held notes of this tab and now holds none gets an empty-session POST, so a deleted
  note disappears there; the bases this tab has published to are kept in `sessionStorage`
  (`annotation-inbox-bases`). The load-time republish follows the same rule. The poller asks
  each base that currently holds a note for `?session=<id>&status=closed`. `/access` still
  uses the module's base. The resolver is read at call time, so a host plugin may register it
  before or after the toolbar mounts.

### Fixed

- The poller no longer takes a *new* note off the page because an answered note of the same
  `id` is still on the server. The toolbar's counter restarts at 1 after a reload or once every
  note is answered, and the server keeps answered notes for the reviewer; matching on the id
  alone removed the new note within one poll, and its next publish deleted it from the inbox.
  A returned note now removes the local one only when its `timestamp` matches too.

### Unchanged

- Without a resolver the client makes exactly the requests 1.0.0 did: one base, one POST per
  change, one poll.

## 1.0.0

First release under `@ecsplico/annotation-inbox`: the Nuxt module, Vite plugin, framework-free
core, Node and MCP surfaces, the Vue composable and reference list.
