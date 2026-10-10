import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openFileInbox } from '../modules/annotation-inbox/node'
import type { InboxAnnotation, InboxPayload } from '../modules/annotation-inbox/contract'

/**
 * `openFileInbox` is the whole of the Node entry: a project root in, the same
 * inbox the dev server serves out. What is worth asserting is therefore the
 * contract with the directory — where notes land, and that merely looking at a
 * project that was never annotated leaves it untouched.
 */

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'annotation-inbox-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function annotation(id: string, comment: string): InboxAnnotation {
  return {
    id,
    comment,
    elementPath: 'body > main > button',
    vueComponents: 'App > GuidePicker > button:app/components/guide/GuidePicker.vue:52:6',
    url: 'http://localhost:3040/guide/atem',
    timestamp: 1_700_000_000_000,
  }
}

function payload(sessionId: string, annotations: InboxAnnotation[]): InboxPayload {
  return {
    sessionId,
    origin: 'http://localhost:3040',
    url: 'http://localhost:3040/guide/atem',
    annotations,
    markdown: '## Feedback',
  }
}

describe('opening a project inbox from its directory', () => {
  it('lists nothing for a project that was never annotated, and does not create the directory', async () => {
    const inbox = openFileInbox(root)

    expect(await inbox.list({ status: 'open' })).toEqual([])
    expect(existsSync(join(root, '.data', 'annotations'))).toBe(false)
  })

  it('stores a published note under <root>/.data/annotations/items and lists it as open', async () => {
    const inbox = openFileInbox(root)

    await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief')]))

    expect(existsSync(join(root, '.data', 'annotations', 'items', 'a1b2c3d4e5f6-1.json'))).toBe(true)
    const items = await inbox.list({ status: 'open' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ inboxId: 'a1b2c3d4e5f6-1', comment: 'Button sitzt zu tief', status: 'open' })
  })

  it('reports an unknown id instead of failing', async () => {
    const inbox = openFileInbox(root)

    expect(await inbox.resolve(['nope'], 'implemented', undefined, 'agent')).toEqual({
      resolved: [],
      unknown: ['nope'],
    })
  })
})
