import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * This package puts a toolbar in front of a reviewer, and the toolbar is a
 * third-party component under a licence that makes *how* it reaches a browser
 * the thing worth guarding. That is a rule, and a rule nobody can break by
 * accident is a rule a test states.
 *
 * `agentation-vue` is PolyForm Shield 1.0.0 — not an open-source licence, and
 * not one a project installing this layer wants to be distributing under. It
 * used to be kept out of every build outright. It no longer is: annotating a
 * deployed preview is the point of this package, so the toolbar ships — but
 * only ever as a chunk of its own, fetched after the server has said this
 * reader may annotate. A reader who may not never downloads it.
 *
 * That is a weaker guarantee than "absent", and it holds only while the code
 * keeps a precise shape. A single static `import … from 'agentation-vue'`
 * collapses it: a top-level import is part of the module graph before any
 * branch runs, so the library lands in the entry chunk and every reader
 * downloads it whatever the gate answers. There is no runtime symptom — the
 * toolbar still appears only for those allowed in, and the only visible trace
 * is a bigger bundle nobody measures.
 *
 * So the locks that make the layer safe to install live with the layer:
 *
 * 1. Exactly one file in the package names the package at all — the shared
 *    mount, which Nuxt reaches through a plugin and Storybook imports from its
 *    `preview.ts`. Asserted as an equality, not a subset: a second importer is
 *    the failure the rule is about.
 * 2. That mount reaches the package only through dynamic `import()`, and the
 *    access gate stands *before* the first of them — so in a build nothing of
 *    the library is fetched until the server has answered.
 * 3. The package is *this layer's* dependency. A layer another project
 *    installs has to install what it uses, so the entry lives in this
 *    directory's `package.json`; whether the consuming root manifest stays
 *    clean is the consumer's own gate to keep.
 *
 * Read as text off disk rather than through the bundler: the property being
 * asserted is what the source *says*, and the only way to ask the bundler
 * instead would be to build a consuming app and inspect its chunks — a
 * several-minute gate for a rule that is three string searches.
 */

const layerRoot = fileURLToPath(new URL('..', import.meta.url))

/** The package whose reachability is the rule. */
const PACKAGE = 'agentation-vue'

/**
 * The one mount, shared by both harnesses: Nuxt reaches it through the plugin
 * the module registers, Storybook imports it from `preview.ts`.
 */
const MOUNT = 'modules/annotation-inbox/runtime/mount.ts'

/** The Nuxt module, which owns what the build is told about those chunks. */
const MODULE = 'src/nuxt.ts'

/** This package's manifest, which owns the dependency. */
const MANIFEST = 'package.json'

/**
 * The mount, paired with the gate that has to stand in front of its dynamic
 * imports: outside a dev build nothing of the library is fetched until
 * `/__annotations/access` has answered.
 *
 * Matched as the **statement**, not as the bare name. The file also names the
 * route and the literal in the prose that explains them, and a search for a
 * name is therefore satisfied by a comment: deleting the real `if` and leaving
 * its paragraph behind would keep this case green.
 */
const MOUNTS = [
  {
    file: MOUNT,
    literal: 'import.meta.env.DEV',
    guard: /if\s*\(\s*!import\.meta\.env\.DEV\s*\)\s*\{/,
    probe: /fetch\(\s*routes\.access\s*\)/,
  },
] as const

/** The allowlist of the first case: the mounts, in the order a scan yields. */
const ALLOWED: readonly string[] = MOUNTS.map(mount => mount.file).sort()

/**
 * Where this package's source lives. `modules/` is nearly all of it — the
 * Vite plugin, the core and the runtime shared with the Nuxt module — plus
 * `src/`, which holds the Nuxt module itself. `test/` is in the list so that a fixture or
 * helper landing beside the specs is scanned like anything else; the specs
 * themselves are taken back out below. Root files are named one by one rather
 * than globbed: the root also holds `package.json`, which legitimately names
 * the package.
 *
 * `tsdown.config.ts` is left out on purpose, and the omission is the
 * interesting one. It names `agentation-vue` in its `external` list — a bare
 * string in an array, not a specifier — so scanning it would change nothing
 * today; it stays out because it is not code any consumer's bundler ever
 * reaches, and the rule this scan states is about reachable code. The build
 * config's own subject, which entries ship compiled and which ship as source,
 * is argued in the file itself.
 */
const SCANNED_DIRS: readonly string[] = ['src', 'modules', 'test']
const SCANNED_ROOT_FILES: readonly string[] = []

/** Extensions worth reading as text; anything else cannot hold an import. */
const SCANNED = /\.(?:ts|vue|js|mjs|css|json)$/

/**
 * The package's own specs, excluded from the scan by `scannedFiles()`. This
 * one quotes the forbidden line in order to explain it, and a rule that cannot
 * say what it is about is a rule nobody can read. Anything else that ends up
 * beside them — a fixture, a helper — is scanned like the rest.
 */
const SPEC = /\.spec\.ts$/

/** Every scanned file, as a layer-relative POSIX path a human can paste. */
function scannedFiles(): string[] {
  const fromDirs = SCANNED_DIRS.filter(dir => existsSync(resolve(layerRoot, dir))).flatMap(dir =>
    readdirSync(resolve(layerRoot, dir), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile() && SCANNED.test(entry.name))
      .map(entry => [relative(layerRoot, entry.parentPath).split(sep).join('/'), entry.name].join('/')),
  )

  return [...fromDirs, ...SCANNED_ROOT_FILES.filter(file => existsSync(resolve(layerRoot, file)))]
    // The specs quote the forbidden line to explain what it forbids, and a
    // rule that cannot state its own subject is a rule nobody can read.
    // Excluding them costs nothing: a spec is not a code path a build reaches,
    // and it is not published either.
    .filter(file => !SPEC.test(file))
    .sort()
}

/**
 * The package where it is *reachable* — as the specifier of an `import`, a
 * dynamic `import()` or a `require`, with or without a subpath and query.
 *
 * Deliberately not a scan for the bare name. Files may write the name down
 * without depending on it, and `contract.ts` does: its storage key happens to
 * start with it. Matching the bare name would fail that file and teach the
 * next author to talk around the subject rather than name it; matching the
 * specifier catches the one shape that actually puts the dependency on a code
 * path.
 */
const IMPORT_OF_PACKAGE = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${PACKAGE}(?:/[^'"]*)?['"]`)

/** A scanned file's text. Every read in this spec goes through the layer root. */
function source(file: string): string {
  return readFileSync(resolve(layerRoot, file), 'utf8')
}

describe('the annotation toolbar reaches a browser only through the gate', () => {
  it('is named by exactly the file that mounts it', () => {
    // The failure this catches in both directions: a second file in the
    // package importing the toolbar — a component, a composable that wanted
    // its selector logic — puts a PolyForm Shield dependency on a code path
    // some consumer's build reaches, and an allowlist entry with no file
    // behind it is a rule guarding something that no longer exists.
    const referencing = scannedFiles().filter(file => IMPORT_OF_PACKAGE.test(source(file)))

    expect(
      referencing,
      `Exactly one file may import \`${PACKAGE}\`: \`${ALLOWED.join('`, `')}\`. It is a development `
      + 'tool under PolyForm Shield 1.0.0, so every reference to it must sit on a file that no build '
      + 'reaches. If something else needs what the toolbar does, it needs its own answer, not this '
      + 'dependency; if the allowed file is gone, the toolbar is gone with it and this list should '
      + 'shrink in the same commit.',
    ).toEqual([...ALLOWED])
  })

  it('fetches the package only after the gate has answered', () => {
    // The chain this protects, link by link. Every reference to the library is
    // a dynamic `import()`, so a bundler emits it as its own chunk instead of
    // folding it into the entry; the gate above those imports means the chunk
    // is requested only once `/__annotations/access` has said this reader may
    // annotate. A reader who may not fetches nothing.
    //
    // A single static `import … from 'agentation-vue'` breaks that silently: a
    // top-level import is evaluated before any branch, so the library lands in
    // the entry chunk and every reader downloads it no matter what the gate
    // answers. The toolbar still behaves correctly — the only symptom is a
    // bundle nobody measures.
    for (const { file, literal, guard, probe } of MOUNTS) {
      const text = source(file)
      const guardAt = text.search(guard)

      expect(
        guardAt,
        `\`${file}\` no longer branches on \`!${literal}\`. That literal is what its bundler replaces `
        + 'outside development, and it is what keeps a dev server from asking permission on every page '
        + 'load. Matched as the statement, not the name: the file also spells the literal out in the '
        + 'prose that explains it, and a comment is not a guard.',
      ).toBeGreaterThanOrEqual(0)

      const probeAt = text.search(probe)

      expect(
        probeAt,
        `\`${file}\` no longer asks the access route (\`routes.access\`) before mounting. That request is the whole `
        + 'licence argument in a build: without it the toolbar appears for anyone who loads the page, '
        + `and \`${PACKAGE}\` is PolyForm Shield 1.0.0.`,
      ).toBeGreaterThanOrEqual(0)

      const staticImports = [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^\n]*?from\s*['"]([^'"]+)['"]/g)]
        .map(match => match[1]!)
        .filter(specifier => specifier.startsWith(PACKAGE))

      expect(
        staticImports,
        `A static import of \`${PACKAGE}\` was added to \`${file}\`. A top-level import is part of the `
        + 'module graph before any branch runs, so it ships to every reader regardless of the gate. '
        + 'Move it into the `await import()` after the gate.',
      ).toEqual([])

      const dynamic = [...text.matchAll(/import\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]!)
      const mentions = [...text.matchAll(new RegExp(`['"]${PACKAGE}[^'"]*['"]`, 'g'))].map(match => match[0]!.slice(1, -1))

      expect(
        mentions.filter(specifier => !dynamic.includes(specifier)),
        `Every reference to \`${PACKAGE}\` in \`${file}\` has to be a dynamic \`import()\` — that is `
        + 'the shape that becomes a chunk of its own rather than part of what every reader downloads.',
      ).toEqual([])

      // A scan that matches nothing is a green test that gates nothing, and
      // both specifiers can drift: the component and its stylesheet are
      // imported separately because the stylesheet is pulled in `?inline`, as
      // a string for the shadow root rather than a tag in `<head>`.
      expect(dynamic).toEqual(expect.arrayContaining([PACKAGE, `${PACKAGE}/style.css?inline`]))

      // The ordering property, and the one a reader would not think to check.
      // The gate has to stand *before* the imports it guards: an `await
      // import()` above it has already fetched the chunk by the time the
      // server answers, which is exactly the state the gate exists to prevent.
      // This shape has regressed once before — an earlier version of this file
      // put a runtime probe in front of the guard and a `storybook:build`
      // emitted an `assets/agentation-*.js` chunk into `storybook-static/`.
      const firstImportOfPackage = text.search(new RegExp(`import\\(\\s*['"]${PACKAGE}`))

      expect(
        probeAt,
        `In \`${file}\` a dynamic \`import()\` of \`${PACKAGE}\` comes before the access probe. The `
        + 'chunk would then be fetched for every reader and the gate would decide only whether it is '
        + 'displayed, which is not the property this package claims.',
      ).toBeLessThan(firstImportOfPackage)
    }
  })

  it('tells the build not to hint the chunks it gates', () => {
    // The browser walks around the gate on its own otherwise. Nuxt turns a
    // plugin's dynamic imports into `<link rel="prefetch">`, and a prefetch is
    // a download: measured on 2026-09-23, `/` on a production build fetched
    // both library chunks before `/access` had answered. The `import()` is
    // still lazy and the toolbar still stays hidden, so nothing about the page
    // shows the loss - only the network panel does.
    const moduleText = source(MODULE)

    expect(
      /build:manifest/.test(moduleText) && /prefetch\s*=\s*false/.test(moduleText) && /preload\s*=\s*false/.test(moduleText),
      `\`${MODULE}\` must clear \`prefetch\` and \`preload\` on the gated chunks in a `
      + '`build:manifest` hook. Without it Nuxt prefetches the toolbar for every reader and the '
      + 'gate decides only whether it is displayed, which is not the property this package claims.',
    ).toBe(true)
  })

  it('declares the package as its own dependency', () => {
    // The layer has to *own* the dependency. A project installs this package
    // as a devDependency and gets whatever this manifest names installed with
    // it; an entry left to the consuming root instead would make the layer
    // silently broken in the next project that installs it. Keeping it out of
    // their production `dependencies` is the consumer's gate, not this one —
    // in this study, `test/unit/annotation-toolbar.spec.ts`.
    const manifest = JSON.parse(source(MANIFEST)) as { dependencies?: Record<string, string> }

    expect(
      Object.keys(manifest.dependencies ?? {}),
      `\`${PACKAGE}\` belongs in \`${MANIFEST}\`'s \`dependencies\`. The layer is installed as a `
      + "devDependency by whoever uses it, and a layer's own dependencies have to install with it — "
      + 'as `dependencies`, or the copy in the next project resolves nothing.',
    ).toContain(PACKAGE)
  })
})
