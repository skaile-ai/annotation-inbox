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
import { openFileInbox, INBOX_DIR } from './node.ts'
import { LIST_DESCRIPTION, RESOLVE_DESCRIPTION, STATUS_DOC, runList, runResolve } from './tools.ts'

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

const server = new McpServer({ name: 'annotation-inbox', version: '1.0.0' })

const text = (value: string, isError = false) => ({
  content: [{ type: 'text' as const, text: value }],
  ...(isError ? { isError: true } : {}),
})

server.registerTool(
  'annotations_list',
  {
    description: LIST_DESCRIPTION,
    inputSchema: {
      status: z.enum(['open', 'implemented', 'rejected', 'closed', 'all']).default('open')
        .describe(STATUS_DOC),
      session: z.string().optional().describe('Only the notes of one browser tab.'),
      format: z.enum(['markdown', 'json']).default('markdown'),
    },
  },
  async args => text(await runList(inbox, args)),
)

server.registerTool(
  'annotations_resolve',
  {
    description: RESOLVE_DESCRIPTION,
    inputSchema: {
      ids: z.array(z.string()).min(1).describe('The `inboxId` of each note, as listed.'),
      status: z.enum(['implemented', 'rejected']),
      resolution: z.string().optional().describe('Required for `rejected`.'),
    },
  },
  async args => {
    const result = await runResolve(inbox, args)
    return text(result.text, !result.ok)
  },
)

await server.connect(new StdioServerTransport())
