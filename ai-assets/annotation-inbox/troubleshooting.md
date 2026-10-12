# Annotation inbox troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `curl /__annotations` returns the app's HTML | The route is not registered. Nuxt: list `@ecsplico/annotation-inbox/nuxt` in `modules`. Storybook or plain Vite: add `annotationInbox({ endpoint: true })` to the Vite plugins and check the `annotation inbox: /__annotations → .data/annotations/` line on start. Also confirm the port belongs to the dev server you mean. |
| No answer at all | The dev server is not running, or the port is wrong: 3000/3040 Nuxt, 6011 Storybook, `server.port` in `vite.config.*` otherwise. |
| Toolbar throws `Cannot read properties of null (reading 'ce')` | Two copies of Vue. Add `optimizeDeps.exclude: ['@ecsplico/annotation-inbox']` to the Vite config. |
| Annotations name components but no line | `VueTracer()` is missing from the Vite plugins (Storybook, plain Vite with Vue). Nuxt supplies it itself. |
| Every note has a `route` target | A production build, or an app without Vue SFCs. Locate the element through the `**Path:**` selector and `**Context:**` text. |
| Deployed page has no toolbar; `/__annotations/access` says `{"allowed":false}` | Intended for a reader the host did not authorise. Answer the `annotation-inbox:authorize` Nitro hook for reviewers, and send `Authorization: Bearer $NUXT_ANNOTATION_INBOX_TOKEN` as the agent. README *Deploying it*. |
| A resolved note stays in the toolbar | The toolbar polls; allow about ten seconds, then confirm with `?status=closed` that the resolve POST named the id. |
