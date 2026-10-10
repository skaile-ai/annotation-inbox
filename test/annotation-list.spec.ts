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
})
