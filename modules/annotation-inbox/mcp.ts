#!/usr/bin/env node
/**
 * A stdio MCP server over one project's annotation inbox.
 *
 * It reads `<root>/.data/annotations` directly — the same files the project's dev
 * server writes — so it needs no port, no running server and no bearer token. The
 * root is `--root <dir>`, else `ANNOTATION_INBOX_ROOT`, else the working directory.
 *
 * Built to `dist/mcp.mjs` and exposed as the `annotation-inbox-mcp` bin. Stdout is
 * the MCP transport, so everything human-readable goes to stderr.
 */
import { resolve } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { openFileInbox, renderMarkdown, INBOX_DIR } from './node.ts'
import type { InboxListing } from './node.ts'

/** `--root <dir>` / `--root=<dir>` first, then the environment, then the working directory. */
function resolveRoot(argv: string[], env: NodeJS.ProcessEnv): string {
  const flag = argv.indexOf('--root')
  const fromFlag = flag >= 0
    ? argv[flag + 1]
    : argv.find(arg => arg.startsWith('--root='))?.slice('--root='.length)
  return resolve(fromFlag || env.ANNOTATION_INBOX_ROOT || process.cwd())
}

const root = resolveRoot(process.argv.slice(2), process.env)
const inbox = openFileInbox(root)
console.error(`annotation inbox mcp: ${resolve(root, INBOX_DIR)}`)

const server = new McpServer({ name: 'annotation-inbox', version: '1.0.0-rc.0' })

const text = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  ...(isError ? { isError: true } : {}),
})

server.registerTool(
  'annotations_list',
  {
    description:
      'List the annotations a human left by clicking the running app of this project. '
      + 'Read them when the human says they left notes, and unprompted when they ask about '
      + 'something they pointed at rather than named ("this button sits too low") — that '
      + 'sentence has no referent in the repo; the annotation is the referent. Each item '
      + 'carries a Comment, a Target (what the note is about, and the one line to open '
      + 'first: `element` is a `file:line:column` to open, `route` is a page the note is '
      + 'about, narrowed down by the Path selector, the Context text and the comment), a '
      + 'Path (the CSS selector) and a Components chain. Default is every open note across '
      + 'every browser tab; an empty listing is not an error, it means nobody has an open note.',
    inputSchema: {
      status: z.enum(['open', 'implemented', 'rejected', 'closed', 'all']).default('open')
        .describe('`open` is what is still waiting; `closed` is everything answered; `all` is both.'),
      session: z.string().optional().describe('Only the notes of one browser tab.'),
      format: z.enum(['markdown', 'json']).default('markdown'),
    },
  },
  async ({ status, session, format }) => {
    const items = await inbox.list({ status, sessionId: session })
    return text(format === 'json'
      ? JSON.stringify({ status, items } satisfies InboxListing)
      : renderMarkdown(items, status))
  },
)

server.registerTool(
  'annotations_resolve',
  {
    description:
      'Answer annotations: when you have acted on a note, or decided not to, say so. This is '
      + 'what makes the note disappear from the human\'s toolbar, and `rejected` without a '
      + 'reason tells them nothing. `resolution` is your sentence to the human — it is what a '
      + 'refusal is for. The response names which ids were closed and which this inbox never '
      + 'had; resolving again corrects a note you closed too early. Done when every '
      + 'annotation in the listing is either mapped to a file and a line and resolved, or '
      + 'resolved as `rejected` with a reason: a note you silently skipped is a note the human '
      + 'believes you read.',
    inputSchema: {
      ids: z.array(z.string()).min(1).describe('The `inboxId` of each note, as listed.'),
      status: z.enum(['implemented', 'rejected']),
      resolution: z.string().optional().describe('Required for `rejected`.'),
    },
  },
  async ({ ids, status, resolution }) => {
    const reason = resolution?.trim() || undefined
    if (status === 'rejected' && !reason) return text('rejected needs a resolution', true)
    return text(JSON.stringify(await inbox.resolve(ids, status, reason, 'agent')))
  },
)

await server.connect(new StdioServerTransport())
