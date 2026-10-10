import {
  computed,
  getCurrentInstance,
  getCurrentScope,
  onBeforeUnmount,
  onMounted,
  onScopeDispose,
  ref,
  toValue,
  watch,
} from 'vue'
import { createTranslator } from '../i18n'
import type { ComputedRef, Ref } from 'vue'
import type { InboxItem, InboxListing } from '../../modules/annotation-inbox/contract'
import type { Locale, Messages, Translate } from '../i18n'

export type AnnotationFilter = 'open' | 'closed' | 'all'

/**
 * The slice of Nuxt's `$fetch` the composable uses: resolve to the parsed JSON
 * body, reject on a non-2xx answer. `$fetch` fits as is; the default is a
 * small wrapper over the global `fetch` with the same contract, so the
 * composable also works in a Vite app.
 */
export type AnnotationsFetch = <T = unknown>(
  url: string,
  init?: { method?: 'GET' | 'POST', body?: unknown, headers?: Record<string, string> },
) => Promise<T>

export interface UseAnnotationsOptions {
  /** The listing endpoint (`GET`, answers `{ status, items }`), or a getter when it depends on reactive state. */
  list: string | (() => string)
  /** The resolve endpoint (`POST { ids, status, resolution }`). */
  resolve: string
  fetch?: AnnotationsFetch
  /** Refresh interval in ms; `0` turns polling off. Default 10 000, the toolbar's own cadence. */
  pollMs?: number
  locale?: Locale
  messages?: Partial<Messages>
}

export interface ResolveResult {
  resolved: string[]
  unknown: string[]
}

export interface UseAnnotations {
  items: Ref<InboxItem[]>
  status: Ref<AnnotationFilter>
  loading: Ref<boolean>
  error: Ref<Error | null>
  /** Number of items in `items` that are still open. */
  openCount: ComputedRef<number>
  refresh: () => Promise<void>
  resolve: (ids: string[], status: 'implemented' | 'rejected', resolution?: string) => Promise<ResolveResult>
  /** The translator for the options' `locale` / `messages`, shared with `<AnnotationList>`. */
  t: Translate
}

export const DEFAULT_POLL_MS = 10_000

/** `ofetch`'s contract over `fetch`: JSON in, parsed JSON out, a thrown `Error` for anything but 2xx. */
const defaultFetch: AnnotationsFetch = async (url, init = {}) => {
  const hasBody = init.body !== undefined
  const response = await globalThis.fetch(url, {
    method: init.method ?? 'GET',
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...init.headers },
    ...(hasBody ? { body: typeof init.body === 'string' ? init.body : JSON.stringify(init.body) } : {}),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}${text ? `: ${text}` : ''}`.trim())
  }
  return (text ? JSON.parse(text) : undefined) as never
}

const asError = (cause: unknown): Error => cause instanceof Error ? cause : new Error(String(cause))

/**
 * The annotation inbox as reactive state: the notes behind `list`, a status
 * filter, and the one action a reviewer has, `resolve`.
 *
 * Endpoints are plain strings so a host that proxies the inbox (a workspace
 * route, say) works without the Nuxt module's own routes. Inside a component
 * polling starts on mount and stops on unmount, so it never runs during SSR;
 * in a bare effect scope it starts at once and stops with the scope.
 *
 * A refresh that finishes after a newer one started is dropped, so a slow
 * answer cannot overwrite a fresher listing; a failed refresh keeps the last
 * good items and sets `error`.
 */
export function useAnnotations(options: UseAnnotationsOptions): UseAnnotations {
  const fetcher = options.fetch ?? defaultFetch
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const t = createTranslator(options.locale ?? 'en', options.messages)

  const items = ref<InboxItem[]>([])
  const status = ref<AnnotationFilter>('open')
  const loading = ref(false)
  const error = ref<Error | null>(null)
  const openCount = computed(() => items.value.filter(item => item.status === 'open').length)

  let latest = 0

  async function refresh(): Promise<void> {
    const ticket = ++latest
    const base = toValue(options.list)
    const url = `${base}${base.includes('?') ? '&' : '?'}status=${status.value}`
    loading.value = true
    try {
      const listing = await fetcher<InboxListing>(url)
      if (ticket !== latest) return
      items.value = listing.items
      error.value = null
    }
    catch (cause) {
      if (ticket !== latest) return
      error.value = asError(cause)
    }
    finally {
      if (ticket === latest) loading.value = false
    }
  }

  async function resolve(
    ids: string[],
    resolveStatus: 'implemented' | 'rejected',
    resolution?: string,
  ): Promise<ResolveResult> {
    // Refused here, before any request, exactly as the server and the MCP tool
    // refuse it: the reason is what a rejection is for.
    if (ids.length === 0) throw new Error(t('error.noIds'))
    const reason = resolution?.trim()
    if (resolveStatus === 'rejected' && !reason) throw new Error(t('error.rejectedNeedsResolution'))
    try {
      const result = await fetcher<ResolveResult>(options.resolve, {
        method: 'POST',
        body: { ids, status: resolveStatus, ...(reason ? { resolution: reason } : {}) },
      })
      await refresh()
      return result
    }
    catch (cause) {
      error.value = asError(cause)
      throw error.value
    }
  }

  watch(status, () => void refresh())
  if (typeof options.list === 'function') watch(options.list, () => void refresh())

  let timer: ReturnType<typeof setInterval> | undefined
  const start = () => {
    void refresh()
    if (pollMs > 0 && timer === undefined) timer = setInterval(() => void refresh(), pollMs)
  }
  const stop = () => {
    clearInterval(timer)
    timer = undefined
  }

  if (getCurrentInstance()) {
    onMounted(start)
    onBeforeUnmount(stop)
  }
  else {
    start()
    if (getCurrentScope()) onScopeDispose(stop)
  }

  return { items, status, loading, error, openCount, refresh, resolve, t }
}
