import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { mountAnnotationToolbar } from './mount'

/**
 * The Nuxt end of the shared mount. Registered by the package's Nuxt module;
 * the `.client` suffix and `mode: 'client'` keep it out of Nitro, because the
 * mount touches `document` and the toolbar reads `sessionStorage`. The base is
 * the module's `base` option, handed over through public runtime config.
 */
export default defineNuxtPlugin(() => {
  const base = (useRuntimeConfig().public.annotationInbox as { base?: string } | undefined)?.base
  mountAnnotationToolbar({ base })
})
