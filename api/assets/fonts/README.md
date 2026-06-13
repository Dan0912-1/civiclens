# Bundled fonts (OG image rendering)

These TTFs are the design-system fonts, bundled so the per-bill Open Graph card
(`api/billOgImage.js`) renders identical text on Railway's headless Linux Node.
`@resvg/resvg-js` reads raw TTF/OTF only, so the `@fontsource` woff2 files cannot
be used directly.

Each TTF is the latin subset from the matching `@fontsource` woff2, converted to
TTF with `fonttools` and given a clean, unambiguous family name (the upstream
woff2 name tables, derived from variable fonts, label the static instances oddly,
e.g. "Source Sans 3 ExtraLight"). Each face is its own family so resvg matches by
family name alone, with no reliance on weight matching.

| File                       | Family                | Weight | Source                         |
| -------------------------- | --------------------- | ------ | ------------------------------ |
| `PlayfairDisplay-Bold.ttf` | Playfair Display      | 700    | `@fontsource/playfair-display` |
| `SourceSans3-Regular.ttf`  | Source Sans 3         | 400    | `@fontsource/source-sans-3`    |
| `SourceSans3-SemiBold.ttf` | Source Sans 3 SemiBold| 600    | `@fontsource/source-sans-3`    |
| `IBMPlexMono-Medium.ttf`   | IBM Plex Mono         | 500    | `@fontsource/ibm-plex-mono`    |

All three families are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution. Upstream license text ships in each `@fontsource`
package under `node_modules/@fontsource/<family>/LICENSE`.
