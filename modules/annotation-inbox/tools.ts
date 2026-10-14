/**
 * The `annotations_list` / `annotations_resolve` tool text and handler logic, shared by
 * the stdio MCP server (`mcp.ts`) and the omp extension. Each declares its own input
 * schema (different builders); descriptions and behaviour live here once.
 *
 * Deliberately free of `@modelcontextprotocol/sdk` and `zod` so the omp bundle can use it.
 */
import { renderMarkdown } from './node.ts'
import type { Inbox, InboxListing } from './node.ts'

export const LIST_DESCRIPTION =
  'List the annotations a human left by clicking the running app of this project. '
  + 'Read them when the human says they left notes, and unprompted when they ask about '
  + 'something they pointed at rather than named ("this button sits too low") — that '
  + 'sentence has no referent in the repo; the annotation is the referent. Each item '
  + 'carries a Comment, a Target (what the note is about, and the one line to open '
  + 'first: `element` is a `file:line:column` to open, `route` is a page the note is '
  + 'about, narrowed down by the Path selector, the Context text and the comment), a '
  + 'Path (the CSS selector) and a Components chain. Default is every open note across '
  + 'every browser tab; an empty listing is not an error, it means nobody has an open note.'

export const RESOLVE_DESCRIPTION =
  'Answer annotations: when you have acted on a note, or decided not to, say so. This is '
  + 'what makes the note disappear from the human\'s toolbar, and `rejected` without a '
  + 'reason tells them nothing. `resolution` is your sentence to the human — it is what a '
  + 'refusal is for. The response names which ids were closed and which this inbox never '
  + 'had; resolving again corrects a note you closed too early. Done when every '
  + 'annotation in the listing is either mapped to a file and a line and resolved, or '
  + 'resolved as `rejected` with a reason: a note you silently skipped is a note the human '
  + 'believes you read.'

export const STATUS_DOC = '`open` is what is still waiting; `closed` is everything answered; `all` is both.'

export async function runList(
  inbox: Inbox,
  args: { status: InboxListing['status']; session?: string | undefined; format: 'markdown' | 'json' },
): Promise<string> {
  const { status, session, format } = args
  const items = await inbox.list({ status, sessionId: session })
  // Both callers (MCP server, omp extension) also expose `annotations_resolve`, and the
  // omp reader may have no dev server, so the hint names the tool rather than the route.
  return format === 'json'
    ? JSON.stringify({ status, items } satisfies InboxListing)
    : renderMarkdown(items, status, { resolveVia: 'tool' })
}

export async function runResolve(
  inbox: Inbox,
  args: { ids: string[]; status: 'implemented' | 'rejected'; resolution?: string | undefined },
): Promise<{ ok: true; text: string } | { ok: false; text: 'rejected needs a resolution' }> {
  const { ids, status, resolution } = args
  const reason = resolution?.trim() || undefined
  if (status === 'rejected' && !reason) return { ok: false, text: 'rejected needs a resolution' }
  return { ok: true, text: JSON.stringify(await inbox.resolve(ids, status, reason, 'agent')) }
}
