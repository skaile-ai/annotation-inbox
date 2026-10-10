// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { AnnotationList, createTranslator } from '../src/vue'
import type { InboxItem } from '../modules/annotation-inbox/contract'
import type { UseAnnotations } from '../src/vue'

const item = (sessionId: string, id: string, overrides: Partial<InboxItem> = {}): InboxItem => ({
  id,
  inboxId: `${sessionId}-${id}`,
  sessionId,
  origin: 'http://localhost:3000',
  comment: `note ${sessionId}/${id}`,
  elementPath: 'div',
  timestamp: 1,
  target: { kind: 'element', ref: 'app/components/Foo.vue:4:2', label: 'Foo' },
  status: 'open',
  receivedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

function annotations(items: InboxItem[], locale: 'en' | 'de' = 'en'): UseAnnotations {
  return {
    items: ref(items),
    status: ref('open'),
    loading: ref(false),
    error: ref(null),
    openCount: ref(items.length) as never,
    refresh: vi.fn(async () => {}),
    resolve: vi.fn(async (ids: string[]) => ({ resolved: ids, unknown: [] })),
    t: createTranslator(locale),
  }
}

describe('<AnnotationList>', () => {
  it('groups items by session and shows file:line:col or the route', () => {
    const wrapper = mount(AnnotationList, {
      props: {
        annotations: annotations([
          item('a', '1'),
          item('b', '1', { target: { kind: 'route', ref: '/guide/atem', label: '/guide/atem' } }),
          item('a', '2'),
        ]),
      },
    })

    const groups = wrapper.findAll('.sk-annotations__group')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.findAll('li')).toHaveLength(2)
    expect(groups[0]!.text()).toContain('Session a')
    expect(groups[0]!.find('code').text()).toBe('app/components/Foo.vue:4:2')
    expect(groups[1]!.find('code').text()).toBe('/guide/atem')
  })

  it('emits implement with the item', async () => {
    const entry = item('a', '1')
    const wrapper = mount(AnnotationList, { props: { annotations: annotations([entry]) } })
    await wrapper.find('.sk-annotations__button--primary').trigger('click')
    expect(wrapper.emitted('implement')).toEqual([[entry]])
  })

  it('asks for a reason before rejecting and then calls resolve', async () => {
    const source = annotations([item('a', '1')])
    const wrapper = mount(AnnotationList, { props: { annotations: source }, attachTo: document.body })

    const reject = wrapper.findAll('.sk-annotations__actions button')[1]!
    await reject.trigger('click')
    expect(source.resolve).not.toHaveBeenCalled()

    // An empty reason is refused inside the form, without a request.
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('form [role="alert"]').text()).toBe('A rejection needs a reason.')
    expect(source.resolve).not.toHaveBeenCalled()

    await wrapper.find('textarea').setValue('widerspricht dem Phone-Frame')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(source.resolve).toHaveBeenCalledWith(['a-1'], 'rejected', 'widerspricht dem Phone-Frame'))
    wrapper.unmount()
  })

  it('shows resolved notes without actions and renders German labels', () => {
    const wrapper = mount(AnnotationList, {
      props: {
        annotations: annotations(
          [item('a', '1', { status: 'rejected', resolution: 'zu breit', resolvedBy: 'agent' })],
          'de',
        ),
      },
    })
    expect(wrapper.text()).toContain('Abgelehnt')
    expect(wrapper.text()).toContain('zu breit')
    expect(wrapper.find('.sk-annotations__actions').exists()).toBe(false)
  })

  it('shows the empty state', () => {
    const wrapper = mount(AnnotationList, { props: { annotations: annotations([]) } })
    expect(wrapper.text()).toContain('No annotations.')
  })

  it('keeps the target plain text and the actions when neither open nor readonly is used', () => {
    const wrapper = mount(AnnotationList, { props: { annotations: annotations([item('a', '1')]) } })
    expect(wrapper.find('.sk-annotations__row button').exists()).toBe(false)
    expect(wrapper.find('.sk-annotations__row code.sk-annotations__target').text()).toBe('app/components/Foo.vue:4:2')
    expect(wrapper.findAll('.sk-annotations__actions button')).toHaveLength(2)
  })

  it('emits open with the item on click and on Enter when the host listens', async () => {
    const entry = item('a', '1')
    const onOpen = vi.fn()
    const wrapper = mount(AnnotationList, { props: { annotations: annotations([entry]), onOpen } })

    const target = wrapper.find('.sk-annotations__row button')
    expect(target.attributes('type')).toBe('button')
    expect(target.text()).toBe('app/components/Foo.vue:4:2')

    await target.trigger('click')
    await target.trigger('keydown.enter')
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenNthCalledWith(1, entry)
    expect(onOpen).toHaveBeenNthCalledWith(2, entry)
  })

  it('renders the target slot with the item and the default text', () => {
    const entry = item('a', '1')
    const wrapper = mount(AnnotationList, {
      props: { annotations: annotations([entry]) },
      slots: { target: `<template #target="{ item, text }"><b class="custom">{{ item.id }}|{{ text }}</b></template>` },
    })
    expect(wrapper.find('.custom').text()).toBe('1|app/components/Foo.vue:4:2')
    expect(wrapper.find('code').exists()).toBe(false)

    const openable = mount(AnnotationList, {
      props: { annotations: annotations([entry]), onOpen: vi.fn() },
      slots: { target: `<template #target="{ text }"><b class="custom">{{ text }}</b></template>` },
    })
    expect(openable.find('button .custom').text()).toBe('app/components/Foo.vue:4:2')
  })

  it('renders no Implement, Reject or bulk action when readonly, and still shows the notes', () => {
    const wrapper = mount(AnnotationList, {
      props: { annotations: annotations([item('a', '1'), item('a', '2')]), readonly: true },
    })
    expect(wrapper.find('.sk-annotations__actions').exists()).toBe(false)
    expect(wrapper.find('.sk-annotations__button--primary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Implement')
    expect(wrapper.text()).not.toContain('Reject')
    expect(wrapper.findAll('.sk-annotations__item')).toHaveLength(2)
    // Only the header's refresh stays.
    expect(wrapper.findAll('button').map(b => b.text())).toEqual(['Refresh'])
  })
})
