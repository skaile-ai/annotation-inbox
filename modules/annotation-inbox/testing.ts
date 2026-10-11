import { beforeEach, describe, expect, it } from 'vitest'
import { createInbox, markdownKey, sessionKey } from './inbox.ts'
import type { Storage } from 'unstorage'
import type { InboxAnnotation, InboxPayload } from './contract.ts'
import type { Inbox } from './inbox.ts'

/**
 * `@ecsplico/annotation-inbox/testing` — the storage behaviour suite.
 *
 * The inbox reads and writes only through unstorage, so a host that mounts a
 * driver other than the filesystem (db0/SQLite, Redis, …) under
 * `annotation-inbox` changes where annotations live without changing a line
 * here — provided the driver honours what the inbox relies on: one entry per
 * note, `:` as a key separator, `getKeys('items')` listing a prefix, objects
 * and strings round-tripping through `setItem`/`getItem`, `null` for a missing
 * key. This suite is that list, executed.
 *
 * Call it from a vitest file:
 *
 *     storageContractTests('sqlite', () => createStorage({ driver: sqliteDriver(...) }))
 *
 * `factory` is called once per test and must return an **empty** store.
 */
export function storageContractTests(name: string, factory: () => Storage | Promise<Storage>): void {
  describe(`annotation-inbox storage contract: ${name}`, () => {
    let store: Storage
    let inbox: Inbox

    beforeEach(async () => {
      store = await factory()
      inbox = createInbox(store)
    })

    const annotation = (id: string, comment: string, extra: Partial<InboxAnnotation> = {}): InboxAnnotation => ({
      id,
      comment,
      elementPath: 'body > main > button',
      vueComponents: 'App > GuidePicker > button:app/components/guide/GuidePicker.vue:52:6',
      url: 'http://localhost:3040/guide/atem',
      timestamp: 1_700_000_000_000,
      ...extra,
    })

    const payload = (sessionId: string, annotations: InboxAnnotation[], markdown = '## Feedback'): InboxPayload => ({
      sessionId,
      origin: 'http://localhost:3040',
      url: 'http://localhost:3040/guide/atem',
      annotations,
      markdown,
    })

    describe('publishing a session', () => {
      it('stores one entry per note, keyed so that sessions cannot collide', async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'Button sitzt zu tief'), annotation('2', 'Text zu lang')]))
        await inbox.publish(payload('ffee00112233', [annotation('1', 'Anderer Tab')]))

        expect(await store.getKeys('items')).toEqual([
          'items:a1b2c3d4e5f6-1.json',
          'items:a1b2c3d4e5f6-2.json',
          'items:ffee00112233-1.json',
        ])

        const items = await inbox.list({ status: 'open' })
        expect(items.map(item => item.comment)).toContain('Button sitzt zu tief')
        expect(items.every(item => item.status === 'open')).toBe(true)
        expect(items.every(item => typeof item.receivedAt === 'string' && item.receivedAt.length > 0)).toBe(true)
        expect(await store.getItem(markdownKey('a1b2c3d4e5f6'))).toBe('## Feedback')
      })

      it('gives a note the element it was made on, and the route when there is no source position', async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [
          annotation('1', 'mit Tracer'),
          annotation('2', 'ohne Tracer', { vueComponents: 'App > GuidePicker' }),
          annotation('3', 'ganz ohne', { vueComponents: undefined }),
        ]))

        const byId = Object.fromEntries((await inbox.list({ status: 'all' })).map(item => [item.inboxId, item]))
        expect(byId['a1b2c3d4e5f6-1']!.target).toEqual({
          kind: 'element',
          ref: 'button:app/components/guide/GuidePicker.vue:52:6',
          label: 'GuidePicker',
        })
        expect(byId['a1b2c3d4e5f6-2']!.target).toEqual({ kind: 'route', ref: '/guide/atem', label: '/guide/atem' })
        expect(byId['a1b2c3d4e5f6-3']!.target.kind).toBe('route')
      })
    })

    describe('resolving notes', () => {
      beforeEach(async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'umsetzbar'), annotation('2', 'nicht umsetzbar')]))
      })

      it('answers which ids it closed and which it never had, and records the refusal', async () => {
        const result = await inbox.resolve(
          ['a1b2c3d4e5f6-2', 'nie-dagewesen'],
          'rejected',
          'Widerspricht dem Phone-Frame',
          'agent',
        )
        expect(result).toEqual({ resolved: ['a1b2c3d4e5f6-2'], unknown: ['nie-dagewesen'] })

        const [rejected] = await inbox.list({ status: 'rejected' })
        expect(rejected).toMatchObject({
          inboxId: 'a1b2c3d4e5f6-2',
          status: 'rejected',
          resolution: 'Widerspricht dem Phone-Frame',
          resolvedBy: 'agent',
        })
        expect(rejected!.resolvedAt).toBeTypeOf('string')
      })

      it('takes closed notes out of the default listing and shows them under closed', async () => {
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', undefined, 'agent')

        expect((await inbox.list({ status: 'open' })).map(item => item.inboxId)).toEqual(['a1b2c3d4e5f6-2'])
        expect((await inbox.list({ status: 'closed' })).map(item => item.inboxId)).toEqual(['a1b2c3d4e5f6-1'])
        expect((await inbox.list({ status: 'all' })).length).toBe(2)
      })

      it('keeps a resolution when the same tab publishes the note again', async () => {
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'umsetzbar'), annotation('2', 'nicht umsetzbar')]))

        const [closed] = await inbox.list({ status: 'closed' })
        expect(closed).toMatchObject({ inboxId: 'a1b2c3d4e5f6-1', status: 'implemented', resolution: 'erledigt' })
      })

      it('treats a reused local id as a new note once the toolbar counter resets', async () => {
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
        await inbox.publish(payload('a1b2c3d4e5f6', [
          annotation('1', 'neuer Hinweis', { timestamp: 1_700_000_500_000 }),
          annotation('2', 'nicht umsetzbar'),
        ]))

        const open = await inbox.list({ status: 'open' })
        expect(open.find(item => item.comment === 'neuer Hinweis')).toMatchObject({ status: 'open' })
        const closed = await inbox.list({ status: 'closed' })
        expect(closed).toMatchObject([
          { inboxId: 'a1b2c3d4e5f6-1', status: 'implemented', resolution: 'erledigt', comment: 'umsetzbar' },
        ])

        await inbox.publish(payload('a1b2c3d4e5f6', [
          annotation('1', 'neuer Hinweis', { timestamp: 1_700_000_500_000 }),
          annotation('2', 'nicht umsetzbar'),
        ]))
        expect((await inbox.list({ status: 'open' })).filter(item => item.comment === 'neuer Hinweis')).toHaveLength(1)
      })

      it('lets an agent correct a note it closed too early', async () => {
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'rejected', 'doch nicht machbar', 'agent')

        expect((await inbox.list({ status: 'implemented' })).length).toBe(0)
        expect((await inbox.list({ status: 'rejected' }))[0]).toMatchObject({ resolution: 'doch nicht machbar' })
      })
    })

    describe('a tab taking its notes back', () => {
      beforeEach(async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('1', 'erste'), annotation('2', 'zweite')]))
        await inbox.publish(payload('ffee00112233', [annotation('1', 'fremde Sitzung')]))
      })

      it('deletes a note the human withdrew while it was still open', async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('2', 'zweite')]))

        expect((await inbox.list({ status: 'all' })).map(item => item.inboxId)).toEqual([
          'a1b2c3d4e5f6-2',
          'ffee00112233-1',
        ])
      })

      it('keeps an answered note when the tab drops its marker', async () => {
        // The tab dropping a closed note *is* the acknowledgement, and it is the
        // only signal the server gets that the human saw the answer. Deleting the
        // item here would take the reason with it, which is the one thing a
        // rejection exists to leave behind.
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'rejected', 'Widerspricht dem Phone-Frame', 'agent')
        await inbox.publish(payload('a1b2c3d4e5f6', [annotation('2', 'zweite')]))

        expect((await inbox.list({ status: 'closed' })).map(item => [item.inboxId, item.resolution])).toEqual([
          ['a1b2c3d4e5f6-1', 'Widerspricht dem Phone-Frame'],
        ])
      })

      it('clears everything it owns when it publishes nothing, and nothing another tab owns', async () => {
        await inbox.publish(payload('a1b2c3d4e5f6', [], ''))

        expect(await store.getItem(sessionKey('a1b2c3d4e5f6'))).toBeNull()
        expect(await store.getItem(markdownKey('a1b2c3d4e5f6'))).toBeNull()
        expect((await inbox.list({ status: 'all' })).map(item => item.inboxId)).toEqual(['ffee00112233-1'])
        expect(await store.getItem(markdownKey('ffee00112233'))).toBe('## Feedback')
      })

      it('keeps answered notes when an emptied tab publishes nothing', async () => {
        await inbox.resolve(['a1b2c3d4e5f6-1'], 'implemented', 'erledigt', 'agent')
        await inbox.publish(payload('a1b2c3d4e5f6', [], ''))

        expect((await inbox.list({ status: 'all', sessionId: 'a1b2c3d4e5f6' })).map(item => item.inboxId))
          .toEqual(['a1b2c3d4e5f6-1'])
      })
    })
  })
}
