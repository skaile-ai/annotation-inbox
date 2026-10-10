---
name: annotation-inbox
description: List and answer the annotations a human left by clicking the running app of this workspace.
version: 1.0.0
transport: stdio
command: node
args:
  - "${workspace}/node_modules/@skaile-ai/annotation-inbox/dist/mcp.mjs"
env:
  ANNOTATION_INBOX_ROOT: "${workspace}"
---

# Annotation inbox

Reads the notes a human left by clicking an element in this workspace's running app, straight
from `<workspace>/.data/annotations` — no dev-server port needed, and it works while the dev
server is down.

Two tools:

- `annotations_list` — the open notes by default (`status`: `open`, `implemented`,
  `rejected`, `closed`, `all`; `session` narrows to one browser tab; `format`: `markdown` or
  `json`). Each note has a `Target`: `element` names the `file:line:column` to open first,
  `route` names the page and leaves the `Path` selector and `Context` text to narrow it down.
  An empty listing is not an error.
- `annotations_resolve` — answer notes by `ids` with `status` `implemented` or `rejected`.
  `rejected` needs a `resolution`; `implemented` should carry one too. Resolving again
  corrects a note you closed too early.

**Done when** every note in the listing is either mapped to a file and a line and resolved,
or resolved as `rejected` with a reason. A note you silently skipped is a note the human
believes you read.
