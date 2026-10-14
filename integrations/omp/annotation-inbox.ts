/**
 * omp extension: the annotation inbox of the project omp runs in, as native tools.
 *
 *  - `annotations_list` / `annotations_resolve` read and write `<cwd>/.data/annotations` in
 *    process — no dev server, no MCP entry, no `mcp__` tool-name prefix.
 *  - `/annotations [open|all] | watch on|off | status` is the human's view of the same inbox.
 *  - A watcher (off by default; `/annotations watch on` or `ANNO_WATCH=1`) polls the inbox and
 *    wakes the session with each note it has not dispatched yet. It shares `.watch-seen` with
 *    `ai-assets/annotation-watch/scripts/wait-for-notes.sh` — one `inboxId` per line — so the
 *    skill's script and this watcher never hand the agent the same note twice.
 *
 * Built to `dist/omp.mjs` (see `tsdown.config.ts`) and copied into `~/.omp/agent/extensions/`,
 * where no `node_modules` resolves: the bundle inlines `unstorage` and the inbox core.
 *
 * The host's types (`@oh-my-pi/pi-coding-agent`) are not a dependency of this package, so the
 * slice of the extension API this file uses is declared below instead of imported.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { INBOX_DIR, openFileInbox, renderMarkdown } from '../../modules/annotation-inbox/node.ts'
import {
  LIST_DESCRIPTION,
  RESOLVE_DESCRIPTION,
  STATUS_DOC,
  runList,
  runResolve,
} from '../../modules/annotation-inbox/tools.ts'
import type { Inbox, InboxItem, InboxListing } from '../../modules/annotation-inbox/node.ts'
import type { z as Zod } from 'zod'

/** The part of omp's `ExtensionContext` / `ExtensionCommandContext` this extension reads. */
export interface OmpContext {
  cwd: string
  agent?: { kind: 'main' | 'sub' }
  sessionManager?: { getSessionId?: () => string | undefined }
  ui?: {
    notify: (text: string, level: 'info' | 'warning' | 'error') => void
    setStatus?: (key: string, text: string | undefined) => void
  }
  /** Managed timers: a throw inside is contained, and `session_shutdown` clears them. */
  setInterval: (fn: () => unknown, ms: number) => unknown
  clearTimer: (timer: unknown) => void
}

/** The part of omp's `ExtensionAPI` this extension uses. */
export interface OmpApi {
  zod: typeof Zod
  logger?: { warn?: (message: string, fields?: Record<string, unknown>) => void }
  setLabel: (label: string) => void
  sendUserMessage: (text: string, options: { deliverAs?: 'aside'; attribution: 'agent' }) => void
  registerTool: (tool: Record<string, unknown>) => void
  registerCommand: (name: string, command: Record<string, unknown>) => void
  on: (
    event: 'session_start' | 'session_switch' | 'session_shutdown',
    handler: (event: unknown, ctx: OmpContext) => void,
  ) => void
}

export interface Watcher {
  /** One poll: wake the session with notes not yet in `.watch-seen`, refresh the status. */
  tick: () => Promise<void>
  /** Settles when the poll that starts with the watcher has. */
  started: Promise<void>
  stop: () => void
}

type ListParams = { status?: InboxListing['status']; session?: string; format?: 'markdown' | 'json' }
type ResolveParams = { ids: string[]; status: 'implemented' | 'rejected'; resolution?: string }

const STATUS_KEY = 'annotations'
/** Lives at `<cwd>/.data/annotations/.watch-seen`; same file the `annotation-watch` skill uses. */
const SEEN_FILE = '.watch-seen'
const POLL_MS = 5000
const WATCH_ENV = 'ANNO_WATCH'
const COMPLETIONS = ['open', 'all', 'watch on', 'watch off', 'status']

/** A thin unstorage handle; cheap enough to open per call. */
export function inboxFor(cwd: string): Inbox {
  return openFileInbox(cwd)
}

export async function readSeen(cwd: string): Promise<Set<string>> {
  try {
    const text = await readFile(join(cwd, INBOX_DIR, SEEN_FILE), 'utf8')
    return new Set(text.split('\n').filter(line => line.length > 0))
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return new Set()
    throw error
  }
}

export async function markSeen(cwd: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  await mkdir(join(cwd, INBOX_DIR), { recursive: true })
  await appendFile(join(cwd, INBOX_DIR, SEEN_FILE), `${ids.join('\n')}\n`)
}

/** The resolve hint names the tool: no dev server is needed to answer a note. */
export function renderWake(items: InboxItem[]): string {
  return `New annotations from the running app (${items.length}). Implement each, then call annotations_resolve with its inboxId (a rejection needs a resolution).\n\n${renderMarkdown(items, 'open', { resolveVia: 'tool' })}`
}

/**
 * Starts polling immediately: one tick now, then one per `POLL_MS`. Only managed `ctx` timers
 * are used, so a throw cannot take the session down; a failed tick is logged, shown in the
 * status bar, and the next one tries again.
 */
export function createWatcher(pi: OmpApi, ctx: OmpContext, cwd: string): Watcher {
  let running = false
  async function tick(): Promise<void> {
    if (running) return
    running = true
    try {
      const items = await inboxFor(cwd).list({ status: 'open' })
      const seen = await readSeen(cwd)
      const fresh = items.filter(item => !seen.has(item.inboxId))
      if (fresh.length) {
        pi.sendUserMessage(renderWake(fresh), { deliverAs: 'aside', attribution: 'agent' })
        await markSeen(cwd, fresh.map(item => item.inboxId))
      }
      ctx.ui?.setStatus?.(STATUS_KEY, `${items.length} open · watch`)
    }
    catch (error) {
      pi.logger?.warn?.('annotation watch failed', { error: String(error) })
      ctx.ui?.setStatus?.(STATUS_KEY, 'annotations: error')
    }
    finally {
      running = false
    }
  }
  const timer = ctx.setInterval(() => tick(), POLL_MS)
  const started = tick()
  return {
    tick,
    started,
    stop() {
      ctx.clearTimer(timer)
      ctx.ui?.setStatus?.(STATUS_KEY, undefined)
    },
  }
}

export default function annotationInbox(pi: OmpApi): void {
  const z = pi.zod
  pi.setLabel('Annotation Inbox')

  pi.registerTool({
    name: 'annotations_list',
    label: 'Annotations',
    approval: 'read',
    description: LIST_DESCRIPTION,
    parameters: z.object({
      status: z.enum(['open', 'implemented', 'rejected', 'closed', 'all']).default('open').describe(STATUS_DOC),
      session: z.string().optional().describe('Only the notes of one browser tab.'),
      format: z.enum(['markdown', 'json']).default('markdown'),
    }),
    execute: async (_id: string, params: ListParams, _signal: unknown, _onUpdate: unknown, ctx: OmpContext) => ({
      content: [{
        type: 'text',
        text: await runList(inboxFor(ctx.cwd), {
          status: params.status ?? 'open',
          session: params.session,
          format: params.format ?? 'markdown',
        }),
      }],
    }),
  })

  pi.registerTool({
    name: 'annotations_resolve',
    label: 'Resolve annotations',
    description: RESOLVE_DESCRIPTION,
    parameters: z.object({
      ids: z.array(z.string()).min(1).describe('The `inboxId` of each note, as listed.'),
      status: z.enum(['implemented', 'rejected']),
      resolution: z.string().optional().describe('Required for `rejected`.'),
    }),
    execute: async (_id: string, params: ResolveParams, _signal: unknown, _onUpdate: unknown, ctx: OmpContext) => {
      const result = await runResolve(inboxFor(ctx.cwd), params)
      return { content: [{ type: 'text', text: result.text }], isError: !result.ok }
    },
  })

  // One watcher per factory instance, i.e. per omp session runtime. Child sessions run the
  // factory again and get their own (never started) slot. `/new`, `/resume` and `/fork` keep
  // the runtime and change the session id, so the watcher is not keyed by session id: it is
  // rebound to the new context on `session_switch` and stays reachable from the commands.
  let watcher: Watcher | undefined

  function startWatch(ctx: OmpContext): void {
    watcher ??= createWatcher(pi, ctx, ctx.cwd)
  }

  function stopWatch(): void {
    watcher?.stop()
    watcher = undefined
  }

  pi.registerCommand('annotations', {
    description: 'Annotation inbox of this project: /annotations [open|all] | watch on|off | status',
    getArgumentCompletions: (prefix: string) => {
      const p = (prefix ?? '').trim()
      const matches = COMPLETIONS.filter(c => c.startsWith(p)).map(c => ({ value: c, label: c }))
      return matches.length ? matches : null
    },
    handler: async (args: string, ctx: OmpContext) => {
      const notify = (text: string, level: 'info' | 'warning') => ctx.ui?.notify(text, level)
      const words = (args ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean)
      const where = join(ctx.cwd, INBOX_DIR)
      const arg = words[0] ?? ''

      if (words.length === 0 || (words.length === 1 && (arg === 'open' || arg === 'all'))) {
        const all = arg === 'all'
        const items = await inboxFor(ctx.cwd).list({ status: all ? 'all' : 'open' })
        if (!items.length) {
          notify(`No ${all ? '' : 'open '}annotations in ${where}`, 'info')
          return
        }
        // No `deliverAs`: starts a prompt when idle, queues a steer while streaming.
        pi.sendUserMessage(
          all
            ? `Annotations of this project:\n\n${renderMarkdown(items, 'all', { resolveVia: 'tool' })}`
            : renderWake(items),
          { attribution: 'agent' },
        )
        return
      }

      if (arg === 'watch' && words.length === 2 && (words[1] === 'on' || words[1] === 'off')) {
        if (ctx.agent?.kind === 'sub') {
          notify('watch runs in the main session only', 'warning')
          return
        }
        if (words[1] === 'on') {
          startWatch(ctx)
          notify('Annotation watch on · polling every 5 s', 'info')
        }
        else {
          stopWatch()
          notify('Annotation watch off', 'info')
        }
        return
      }

      if (arg === 'status' && words.length === 1) {
        const open = await inboxFor(ctx.cwd).list({ status: 'open' })
        notify(`${open.length} open · watch ${watcher ? 'on' : 'off'} · ${where}`, 'info')
        return
      }

      notify('usage: /annotations [open|all] | watch on|off | status', 'warning')
    },
  })

  // Off by default: several omp sessions in one project would each be woken by the same note.
  // `ANNO_WATCH=1` opts a session in. It is also what the `annotation-watch` skill sets on the
  // dispatcher's herdr tab; the skill sees this tool registered and leaves the watching to it.
  pi.on('session_start', (_event, ctx) => {
    if (ctx.agent?.kind === 'sub') return
    if (process.env[WATCH_ENV] === '1') startWatch(ctx)
  })

  // The session changed under the same runtime: hand the running watcher the new context, so
  // its timer, status entry and wake-ups belong to the session that is now current.
  pi.on('session_switch', (_event, ctx) => {
    if (ctx.agent?.kind === 'sub' || !watcher) return
    stopWatch()
    startWatch(ctx)
  })

  // Managed timers are cleared by the host; the status entry and the watcher slot are not.
  pi.on('session_shutdown', (_event, ctx) => {
    if (ctx.agent?.kind === 'sub') return
    stopWatch()
  })
}
