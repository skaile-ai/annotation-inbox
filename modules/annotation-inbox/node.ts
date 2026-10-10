import { join } from 'node:path'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import { INBOX_DIR } from './contract.ts'
import { createInbox } from './inbox.ts'
import type { Inbox } from './inbox.ts'

/**
 * The inbox of the project rooted at `root`, read straight from
 * `<root>/.data/annotations`.
 *
 * The store is built exactly as the Vite plugin builds it, so a dev server and
 * this entry see the same keys. Nothing is created on read: a project that was
 * never annotated has no directory, and the fs driver answers that with an
 * empty listing rather than an error.
 */
export function openFileInbox(root: string): Inbox {
  return createInbox(createStorage({ driver: fsDriver({ base: join(root, INBOX_DIR) }) }))
}

export { createInbox, renderMarkdown, resolveTarget } from './inbox.ts'
export type { Inbox, InboxStore } from './inbox.ts'
export { INBOX_DIR, INBOX_ROUTE, INBOX_RESOLVE_ROUTE } from './contract.ts'
export type { InboxItem, InboxListing, InboxRole, InboxStatus, InboxTarget } from './contract.ts'
