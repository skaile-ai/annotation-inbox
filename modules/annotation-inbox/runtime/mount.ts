/// <reference types="vite/client" />
// For the `?inline` stylesheet import below: this package is meant to be consumed by
// projects whose TypeScript setup it knows nothing about, so it teaches
// itself that Vite's `?inline` query hands back a string instead of a side
// effect rather than relying on the host's config to have done it.

import { inboxRoutes } from '../contract'
import { installAnnotationInbox } from './inbox'

/**
 * The annotation toolbar — apparatus for the *developer*, not the reader, and
 * the one mount both harnesses use.
 *
 * A human clicks an element, writes a comment, and the note is mirrored to the
 * dev server, which writes it into `.data/annotations/`. An agent reads the
 * file. See this package's `README.md`.
 *
 * **One file for two harnesses.** Nuxt reaches it through a plugin the
 * Nuxt module registers (`../../../src/nuxt.ts`); Storybook imports it from its `preview.ts`. Nothing in an
 * app's scanned source refers to it, so sharing it costs no reference in the
 * shipped plugin graph — which is exactly what used to force a Nuxt copy and a
 * Storybook copy to exist side by side.
 *
 * **Every harness gets its own session.** The library keys its store by
 * origin, so notes made on `http://localhost:6011` are a different session
 * from `http://localhost:3040`'s — and, downstream of that, a different file.
 *
 * **`vite-plugin-vue-tracer/client/record` is imported here, not registered.**
 * The tracer plugin (Nuxt DevTools registers it; Storybook's `viteFinal` names
 * it) instruments SFC templates at transform time and records positions into a
 * `globalThis.__vue_tracer__` singleton. Reading that store is a separate
 * module instance, and it does not matter: the singleton is on the global, so
 * the copy resolved here sees exactly what the plugin recorded.
 *
 * **Licence.** `agentation-vue` is [PolyForm Shield
 * 1.0.0](https://polyformproject.org/licenses/shield/1.0.0/) — not an open
 * source licence: it permits any use except building a competing product.
 * The toolbar therefore ships, but never arrives unasked: every import of it
 * below is dynamic, so it is a chunk of its own, and the chunk is fetched only
 * after the server has said this reader may annotate. A reader who may not
 * downloads none of it. The rule is held by a test (this package's
 * `test/locks.spec.ts`) rather than by habit.
 */
export function mountAnnotationToolbar(options: { base?: string } = {}): void {
  const routes = inboxRoutes(options.base)
  /*
   * Only where a human is actually looking at the page — and, outside a dev
   * build, only where the server says this human may annotate.
   *
   * The order matters. The cheap synchronous probes come first so a test
   * runner or a server render leaves immediately; the network question is
   * asked last, and only in a build, because on a dev server the answer is
   * always yes and a request per page load would be noise.
   */

  /*
   * Only where a human is actually looking at the page.
   *
   * Two runners load Storybook's preview and neither has a pointing finger to
   * carry:
   *
   *  - A story gate that imports `.storybook/preview.ts` and mounts composed
   *    stories under happy-dom. The toolbar reads `sessionStorage` as it
   *    evaluates, which is why the imports below are dynamic and inside this
   *    function rather than at the top of the file; this guard is the second
   *    lock on that door, the first being that `preview.ts` calls this only
   *    from `setup()`, a hook no Vitest mount path runs.
   *  - A browser-mode project rendering each story in a real Chromium, where
   *    everything here would work — and a fixed toolbar in the corner of a
   *    page whose play functions click through it is an overlay no story asked
   *    for.
   *
   * Each announces itself on the global. `happyDOM` is happy-dom's own control
   * handle (`window.happyDOM.waitUntilComplete()`), which Vitest's environment
   * copies onto `globalThis` with the rest of its window; `__vitest_browser__`
   * is the flag `@vitest/browser` sets in the tester frame before a test file
   * loads. Neither exists in the Chromium a developer drives.
   *
   * Not a capability probe, deliberately: happy-dom 20.12 implements
   * `Element.prototype.attachShadow` *and* `Element.prototype.animate`, so
   * "does this DOM do shadow roots" answers yes and proves nothing. What an
   * emulation cannot hide is the handle its runner steers it by.
   */
  if (
    typeof document === 'undefined'
    || 'happyDOM' in globalThis
    || '__vitest_browser__' in globalThis
  ) return

  /*
   * Once per document, however often this is called.
   *
   * Under Nuxt that is once per page load, but in Storybook this runs on every
   * story render and again on every HMR update — and a docs page renders many
   * stories in one tick. The guard is the host element rather than a
   * module-level flag because HMR re-evaluates this module and would reset the
   * flag while the host it appended is still in the document.
   *
   * The host is therefore created and appended *synchronously*, before the
   * awaits below: a flag that is only set after a dynamic import resolves is
   * no flag at all when ten stories ask at once.
   */
  if (document.querySelector('[data-agentation-vue]')) return

  const host = document.createElement('div')
  // The attribute the library identifies its own subtree by; on the host,
  // because that is the node `document.elementFromPoint` retargets to.
  host.setAttribute('data-agentation-vue', '')
  // No box of its own: everything inside is `position: fixed` anyway, and a
  // generated box would be one more thing the page's layout — or a story's
  // frame — has to survive. The toolbar hangs off `<body>`, outside the app
  // root and outside `#storybook-root`: apparatus beside the page, never in
  // it.
  host.style.display = 'contents'
  document.body.append(host)

  /*
   * A shadow root, because the page's CSS must not reach the toolbar and the
   * toolbar must not reach the page.
   *
   * The sharp edge is the host application's own CSS reset. A vendored
   * Tailwind preflight, scoped to something like
   * `body.app :is(SEL):not(.opted-out, …)`, carries a specificity of (0,2,1),
   * while the toolbar's own reset is written with `:where()` and carries
   * (0,0,0). Unshielded, the host's reset simply outguns it and strips the
   * toolbar's margins, borders and button styling — and it does so on
   * whichever page that reset is most thorough about, which tends to be the
   * page a developer most wants to annotate. In Storybook the same boundary
   * is what lets a story be judged unchanged against a capture taken before
   * the toolbar existed. A shadow root is the only fix that costs the host
   * page nothing: no production stylesheet has to learn that this tool
   * exists.
   *
   * `disablePortal` follows from it: the component's default is
   * `<Teleport to="body">`, which would carry it straight back out of the
   * shadow root it was mounted into. The host still carries
   * `data-agentation-vue`, so the library's own "is this click mine?" check
   * (`isInsideAgentationTree`, which reads `composedPath()` and is already
   * shadow-aware) keeps recognising the toolbar's chrome and refuses to
   * annotate itself.
   */
  const shadow = host.attachShadow({ mode: 'open' })
  const mount = document.createElement('div')

  void (async () => {
    /*
     * The gate. In a build, nothing below is fetched until the server has
     * answered — and `/access` answers rather than refusing, so an ordinary
     * reader's page load stays a clean `200` and simply grows no toolbar.
     * Any failure is a no: an inbox that cannot be reached is an inbox that
     * cannot take notes anyway.
     */
    if (!import.meta.env.DEV) {
      let allowed = false
      try {
        const response = await fetch(routes.access)
        allowed = response.ok && (await response.json() as { allowed?: boolean }).allowed === true
      } catch {
        allowed = false
      }
      if (!allowed) {
        host.remove()
        return
      }
    }

    const [
      { createApp },
      { AgentationVue, setAnnotationStorage, setVueDetector, formatAnnotations, useAnnotations },
      { default: agentationCss },
      { findTraceFromElement },
    ] = await Promise.all([
      import('vue'),
      import('agentation-vue'),
      // `?inline` hands back the stylesheet as a string instead of injecting
      // it into `<head>`, where it would be on the wrong side of the boundary.
      import('agentation-vue/style.css?inline'),
      import('vite-plugin-vue-tracer/client/record'),
    ])

    // Before the app mounts, so the first annotation is already written with a
    // file-carrying component chain and already reaches the inbox.
    installAnnotationInbox({
      setAnnotationStorage,
      setVueDetector,
      formatAnnotations,
      findTraceFromElement,
      // How a resolved note leaves the tab: the poller in `inbox.ts` calls
      // this, the library saves, and the save republishes the session without
      // it — which is also the acknowledgement the server waits for.
      removeAnnotation: useAnnotations().removeAnnotation,
    }, { base: options.base })

    const style = document.createElement('style')
    style.textContent = agentationCss
    shadow.append(style, mount)

    createApp(AgentationVue, { disablePortal: true }).mount(mount)
  })()
}
