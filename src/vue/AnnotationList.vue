<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, useId } from 'vue'
import type { InboxItem } from '../../modules/annotation-inbox/contract'
import type { UseAnnotations } from './useAnnotations'

/**
 * The reference list over `useAnnotations`: notes grouped by browser session,
 * each with its target (`file:line:col` for an element, the path for a route),
 * the comment, and — while open — Implement and Reject.
 *
 * Native elements only, coloured by the `--sk-*` tokens (defaults in
 * `@skaile-ai/annotation-inbox/styles/tokens.css`, each also carries a
 * fallback here). State is never carried by colour alone: every badge is text.
 * Implement does not resolve anything — the host decides what implementing
 * means (the SKAILE forge hands the note to an agent) and resolves when done.
 * Reject asks for a reason inline, then calls `resolve`.
 *
 * `readonly` hides Implement and Reject (the list still reads and refreshes).
 * When the host listens for `open`, the target becomes a button that emits
 * `open(item)` on click and Enter; without a listener it stays plain text.
 * The `target` slot replaces the target's content (`{ item, text }`).
 */
const props = defineProps<{
  /** The object `useAnnotations()` returned. */
  annotations: UseAnnotations
  /** Read-only view: no Implement / Reject. */
  readonly?: boolean
}>()

const emit = defineEmits<{
  implement: [item: InboxItem]
  open: [item: InboxItem]
}>()

defineSlots<{
  /** Content of the target; `text` is the default (`file:line:col` or the route). */
  target?: (props: { item: InboxItem, text: string }) => unknown
}>()

const instance = getCurrentInstance()
// Read at render time: the target is only a button when the host handles `open`.
const openable = () => !!instance?.vnode.props?.onOpen

const t = props.annotations.t
const uid = useId()

interface Group {
  sessionId: string
  origin: string
  items: InboxItem[]
}

const groups = computed<Group[]>(() => {
  const bySession = new Map<string, Group>()
  for (const item of props.annotations.items.value) {
    let group = bySession.get(item.sessionId)
    if (!group) {
      group = { sessionId: item.sessionId, origin: item.origin, items: [] }
      bySession.set(item.sessionId, group)
    }
    group.items.push(item)
  }
  return [...bySession.values()]
})

const filters = ['open', 'closed', 'all'] as const
const errorText = computed(() => {
  const error = props.annotations.error.value
  return error ? t('error', { message: error.message }) : ''
})

const rejecting = ref<string | null>(null)
const reason = ref('')
const reasonError = ref(false)
const busy = ref(false)
const reasonField = ref<HTMLTextAreaElement[] | HTMLTextAreaElement | null>(null)

async function startReject(item: InboxItem) {
  rejecting.value = item.inboxId
  reason.value = ''
  reasonError.value = false
  await nextTick()
  const field = reasonField.value
  ;(Array.isArray(field) ? field[0] : field)?.focus()
}

function cancelReject() {
  rejecting.value = null
  reasonError.value = false
}

async function confirmReject(item: InboxItem) {
  if (!reason.value.trim()) {
    reasonError.value = true
    return
  }
  busy.value = true
  try {
    await props.annotations.resolve([item.inboxId], 'rejected', reason.value)
    rejecting.value = null
  }
  catch {
    // `annotations.error` carries it; the form stays open so the reason is not lost.
  }
  finally {
    busy.value = false
  }
}

const statusLabel = (item: InboxItem) => t(`item.${item.status}`)
const targetKind = (item: InboxItem) => item.target.kind === 'route' ? t('item.route') : t('item.element')
</script>

<template>
  <section class="sk-annotations" :aria-labelledby="`${uid}-title`" :aria-busy="annotations.loading.value">
    <header class="sk-annotations__header">
      <h2 :id="`${uid}-title`" class="sk-annotations__title">{{ t('title') }}</h2>
      <label class="sk-annotations__filter">
        <span>{{ t('filterLabel') }}</span>
        <select v-model="annotations.status.value" class="sk-annotations__select">
          <option v-for="filter in filters" :key="filter" :value="filter">{{ t(`status.${filter}`) }}</option>
        </select>
      </label>
      <button type="button" class="sk-annotations__button" @click="annotations.refresh()">{{ t('refresh') }}</button>
    </header>

    <p v-if="errorText" class="sk-annotations__error" role="alert">{{ errorText }}</p>
    <p v-if="annotations.loading.value && groups.length === 0" class="sk-annotations__muted" role="status">{{ t('loading') }}</p>
    <p v-else-if="groups.length === 0 && !errorText" class="sk-annotations__muted">{{ t('empty') }}</p>

    <section v-for="group in groups" :key="group.sessionId" class="sk-annotations__group">
      <h3 class="sk-annotations__group-title">
        {{ t('session', { id: group.sessionId }) }}
        <small class="sk-annotations__muted">{{ group.origin }}</small>
      </h3>
      <ul class="sk-annotations__items">
        <li v-for="item in group.items" :key="item.inboxId" class="sk-annotations__item" :data-status="item.status">
          <div class="sk-annotations__row">
            <span class="sk-annotations__badge" :data-status="item.status">{{ statusLabel(item) }}</span>
            <span class="sk-annotations__muted">{{ targetKind(item) }}</span>
            <button
              v-if="openable()"
              type="button"
              class="sk-annotations__target sk-annotations__target--open"
              :title="item.target.label"
              @click="emit('open', item)"
              @keydown.enter.prevent="emit('open', item)"
            >
              <slot name="target" :item="item" :text="item.target.ref"><code>{{ item.target.ref }}</code></slot>
            </button>
            <slot v-else name="target" :item="item" :text="item.target.ref">
              <code class="sk-annotations__target" :title="item.target.label">{{ item.target.ref }}</code>
            </slot>
          </div>
          <p class="sk-annotations__comment">{{ item.comment }}</p>
          <p v-if="item.resolution" class="sk-annotations__resolution">
            {{ item.resolution }}
            <small v-if="item.resolvedBy" class="sk-annotations__muted">{{ t('item.resolvedBy', { name: item.resolvedBy }) }}</small>
          </p>

          <div v-if="!readonly && item.status === 'open'" class="sk-annotations__actions">
            <button type="button" class="sk-annotations__button sk-annotations__button--primary" @click="emit('implement', item)">
              {{ t('implement') }}
            </button>
            <button
              type="button"
              class="sk-annotations__button"
              :aria-expanded="rejecting === item.inboxId"
              @click="startReject(item)"
            >
              {{ t('reject') }}
            </button>
          </div>

          <form v-if="!readonly && rejecting === item.inboxId" class="sk-annotations__reject" @submit.prevent="confirmReject(item)" @keydown.esc="cancelReject">
            <label :for="`${uid}-${item.inboxId}-reason`">{{ t('reject.reason') }}</label>
            <textarea
              :id="`${uid}-${item.inboxId}-reason`"
              ref="reasonField"
              v-model="reason"
              class="sk-annotations__textarea"
              rows="2"
              :aria-invalid="reasonError"
            />
            <p v-if="reasonError" class="sk-annotations__error" role="alert">{{ t('reject.required') }}</p>
            <div class="sk-annotations__actions">
              <button type="submit" class="sk-annotations__button sk-annotations__button--danger" :disabled="busy">
                {{ t('reject.confirm') }}
              </button>
              <button type="button" class="sk-annotations__button" @click="cancelReject">{{ t('reject.cancel') }}</button>
            </div>
          </form>
        </li>
      </ul>
    </section>
  </section>
</template>

<style>
.sk-annotations {
  font-family: var(--sk-font, system-ui, sans-serif);
  color: var(--sk-fg, #1f2328);
  background: var(--sk-bg, #fff);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.sk-annotations__header { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
.sk-annotations__title { margin: 0; font-size: 1rem; flex: 1 1 auto; }
.sk-annotations__filter { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--sk-muted, #656d76); }
.sk-annotations__group { display: flex; flex-direction: column; gap: 0.5rem; }
.sk-annotations__group-title { margin: 0; font-size: 0.875rem; display: flex; gap: 0.5rem; align-items: baseline; }
.sk-annotations__items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.sk-annotations__item {
  border: 1px solid var(--sk-border, #d0d7de);
  border-radius: var(--sk-radius, 6px);
  padding: 0.6rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.sk-annotations__row, .sk-annotations__actions { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.sk-annotations__comment, .sk-annotations__resolution { margin: 0; white-space: pre-wrap; }
.sk-annotations__muted { color: var(--sk-muted, #656d76); margin: 0; }
.sk-annotations__target { font-size: 0.8125rem; overflow-wrap: anywhere; }
.sk-annotations__target--open {
  font: inherit;
  font-size: 0.8125rem;
  color: var(--sk-primary, #2563eb);
  background: none;
  border: 0;
  padding: 0;
  text-align: start;
  text-decoration: underline;
  cursor: pointer;
}
.sk-annotations__target--open:focus-visible { outline: 2px solid var(--sk-primary, #2563eb); outline-offset: 2px; }
.sk-annotations__error { margin: 0; color: var(--sk-danger, #cf222e); }
.sk-annotations__badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0 0.45rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  color: var(--sk-warning, #9a6700);
}
.sk-annotations__badge[data-status='implemented'] { color: var(--sk-success, #1a7f37); }
.sk-annotations__badge[data-status='rejected'] { color: var(--sk-danger, #cf222e); }
.sk-annotations__button, .sk-annotations__select, .sk-annotations__textarea {
  font: inherit;
  color: var(--sk-fg, #1f2328);
  background: var(--sk-bg, #fff);
  border: 1px solid var(--sk-border, #d0d7de);
  border-radius: var(--sk-radius, 6px);
  padding: 0.25rem 0.65rem;
}
.sk-annotations__button { cursor: pointer; }
.sk-annotations__button:disabled { cursor: default; opacity: 0.6; }
.sk-annotations__button--primary {
  background: var(--sk-primary, #2563eb);
  border-color: var(--sk-primary, #2563eb);
  color: var(--sk-primary-fg, #fff);
}
.sk-annotations__button--danger {
  border-color: var(--sk-danger, #cf222e);
  color: var(--sk-danger, #cf222e);
}
.sk-annotations__button:focus-visible, .sk-annotations__select:focus-visible, .sk-annotations__textarea:focus-visible {
  outline: 2px solid var(--sk-primary, #2563eb);
  outline-offset: 2px;
}
.sk-annotations__reject { display: flex; flex-direction: column; gap: 0.4rem; }
.sk-annotations__textarea { width: 100%; box-sizing: border-box; resize: vertical; }
</style>
