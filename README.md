# PX to REM Toolkit

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/LouisMudrack.px-to-rem-function?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/LouisMudrack.px-to-rem-function)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![CI](https://github.com/louis-mudrack/px-to-rem/actions/workflows/ci.yml/badge.svg)](https://github.com/louis-mudrack/px-to-rem/actions/workflows/ci.yml)
[![Deutsch](https://img.shields.io/badge/lang-de-green.svg)](README.de.md)

**Scalable CSS without the busywork.** Convert `px` to `rem`, `em`, `vw` or your own `rem()` function — with the right unit for each property, in every place CSS lives, and with checks that keep it that way.

```scss
// Before                               // After (Ctrl+Alt+R)
.card {                                 .card {
  font-size: 18px;                        font-size: 1.125rem;
  line-height: 27px;                      line-height: 1.5;          // unitless, from the font size
  letter-spacing: 0.9px;                  letter-spacing: 0.05em;    // em, scales with the text
  padding: 16px 24px;                     padding: 1rem 1.5rem;
  border: 1px solid;                      border: 1px solid;         // hairlines stay crisp
  @media (min-width: 768px) {             @media (min-width: 48em) { // em: follows the user font size
    font-size: 24px;                        font-size: 1.5rem;
  }                                       }
}                                       }
```

## Highlights

- **Smart units per property** — rem for sizes, unitless line-height, em letter-spacing, px borders, em breakpoints. Every decision is explained on hover.
- **Reads your project** — finds `html { font-size: 62.5% }`, your `rem()` helper, postcss-pxtorem's `rootValue`, design tokens and Tailwind. No setup needed.
- **Everywhere CSS lives** — CSS, SCSS, Sass, Less, Stylus, PostCSS, `<style>` blocks and `style=""` in HTML, Vue, Svelte, Astro and PHP, styled-components/emotion templates, React style objects and Tailwind arbitrary values (`p-[16px]` → `p-4`).
- **Fluid type** — generate `clamp()`, merge media-query overrides into one fluid value, and see what any `clamp()`/`calc()` resolves to at each breakpoint.
- **Accessibility audit** — WCAG 1.4.4 checks for px font sizes, px line-heights, fixed heights on text, viewport-only font sizes and fluid type that can't reach 200% with browser zoom.
- **Design tokens** — snap values to your spacing/type scale, flag off-scale values and near-miss colours, or generate a token file from the values you already use.
- **Safe migrations** — workspace conversion through VS Code's refactor preview, git-aware "changed lines only" mode, a progress view and a value audit dashboard.
- **Same rules in CI** — the [`px-to-rem` CLI](cli/README.md) runs the engine and your `.pxtoremrc.json` in pipelines and pre-commit hooks.

Runs in VS Code 1.97+, Cursor, VSCodium and on [vscode.dev](https://vscode.dev). UI in English, German, French, Spanish, Italian, Portuguese (Brazil), Japanese, Chinese (Simplified) and Korean.

---

## Quick start

1. Install from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function) or run `code --install-extension LouisMudrack.px-to-rem-function`.
2. Open a stylesheet and press **Ctrl+Alt+R** (macOS **⌃⌘R**). With a selection only the selection is converted; otherwise the whole file. It is one undo step.
3. Optional: run **PX to REM: Set up project…** to review what was detected and save a shared `.pxtoremrc.json`.

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+R` / `⌃⌘R` | Convert selection or file |
| `Ctrl+Alt+U` / `⌃⌘U` | Cycle the value under the cursor: `16px` → `1rem` → `1em` → `1.1111vw` → token → `16px` |
| `Shift+Alt+PageUp` / `PageDown` | Step the value up or down your token scale (or a 4px / type scale) |
| `Ctrl+.` | Quick fixes: other units, tokens, snap to scale, convert rule/file, ignore line |

Shortcuts only apply in supported files. Everything is also in the editor context menu (**PX to REM**) and the status bar menu (click `16px · 12 px` in the status bar).

> **Upgrading from 1.x?** `Ctrl+K` no longer converts (it blocked every `Ctrl+K …` chord in VS Code). See [Migrating from 1.x](#migrating-from-1x).

---

## How values are converted

### Smart mode (default)

| Property | Becomes | Why |
|---|---|---|
| `font-size`, spacing, sizes, radii | `rem` (or your format) | Follows the user's browser font-size setting |
| `line-height` | unitless `1.5` | Scales with the element's own font size; needs the rule's font size |
| `letter-spacing`, `word-spacing`, `text-underline-offset` | `em` | Proportional to the text |
| `border*`, `outline*`, `box-shadow`, `text-shadow`, `filter` | stays `px` | Hairlines and shadows should stay crisp |
| values up to `1px` (`hairline`) | stays `px` | 1px nudges and separators |
| `@media` / `@container` | `em` | Breakpoints are resolved against the browser default (16px), not your `html` font size |
| breakpoint mixins (`@include mq($from: 768px)`) | untouched | The mixin decides |

The element font size is found through the rule itself, `font` shorthands, nesting and `&:hover`-style selectors. When it can't be known, rem is used instead. Change any rule with `pxToRem.smartRules`, for example `{ "border": "convert", "letter-spacing": "rem" }`, or switch `pxToRem.mode` to `simple` to convert everything the same way.

### Output formats

`pxToRem.format` (can differ per language with `"[scss]": { "pxToRem.format": … }`):

| Format | `16px` becomes |
|---|---|
| `auto` (default) | `rem(16)` in Sass/Less/Stylus when the project defines a `rem()` function, otherwise `1rem` |
| `rem` | `1rem` |
| `rem-function` / `rem-function-px` | `rem(16)` / `rem(16px)` |
| `em`, `vw`, `vh`, `vmin`, `vmax`, `rpx`, `pt` | based on the element font size or `designWidth`/`designHeight` |
| any template | e.g. `toRem({px})`, `{rem}rem`, `calc({px} * var(--unit))` |

Function formats are never written into plain CSS, inline styles, JS objects or Tailwind classes (where they would be invalid); inside styled-components templates they become `${rem(16)}`. With `interpolateInCalc`, Sass gets `#{rem(16)}` inside `calc()`.

### What is never touched

Comments, strings, `url()`, selectors and class names (`.mt-16px`), values already passed to `rem()`, Sass `@function` bodies and control flow, interpolation, uppercase `PX` (postcss-pxtorem's opt-out), and lines you disable:

```css
.legacy {
  /* px-to-rem-disable-next-line */
  width: 320px;
  height: 200px; /* px-to-rem-disable-line */
}
/* px-to-rem-disable */
.email-table { padding: 8px; }
/* px-to-rem-enable */
```

`// …` comments work in Sass, Less, Stylus and JS; `<!-- px-to-rem-disable-next-line -->` works in HTML. `px-to-rem-disable-file` skips a file. postcss-pxtorem's `pxtorem-disable-next-line` is understood too.

### Root font size

1rem is detected in this order: an explicit `pxToRem.baseFontSize` (settings or `.pxtoremrc.json`), postcss-pxtorem's `rootValue`, `html`/`:root` font sizes in your stylesheets (`62.5%` → 10px), then 16px. The status bar shows the value and where it came from. **Rebase rem values…** rewrites every rem in the project when you change the root size (for example dropping the 62.5% trick) so nothing changes visually.

---

## Everywhere CSS lives

| Where | Example |
|---|---|
| Stylesheets | `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.pcss` (indented Sass and Stylus included) |
| Markup | `<style lang="scss">` blocks and `style=""` in HTML, Vue, Svelte, Astro, PHP, Blade, Twig, Handlebars, Liquid… |
| CSS-in-JS | ``styled.div`…` ``, ``styled(Button).attrs(…)`…` ``, ``css`…` ``, ``createGlobalStyle`…` ``, ``keyframes`…` `` |
| Style objects | `{ fontSize: '16px' }` → `{ fontSize: '1rem' }`; with `js.unitlessNumbers`, `{ width: 320 }` → `{ width: '20rem' }` (never in React Native projects) |
| Tailwind | `p-[16px]` → `p-4`, `text-[14px]` → `text-sm`, `w-[13px]` → `w-[0.8125rem]`, `@apply`, variants and `!important` kept |

---

## Fluid type and clamp()

- **Make value fluid with clamp()…** asks for the small and large size and the viewport range and writes `clamp(1rem, 0.8239rem + 0.7512vw, 1.5rem)`. Choose `fluid.unit: "cqi"` to scale with containers.
- **Merge breakpoints** (quick fix on a declaration) turns `font-size: 16px` plus `@media (min-width: 1024px) { font-size: 24px }` into one `clamp()` and removes the overrides, nested or in separate media blocks, mobile- or desktop-first.
- **Hover any `clamp()`, `calc()`, `min()` or `max()`** to see a table of the resolved size at each breakpoint, and whether the text still reaches 200% with browser zoom.

## Accessibility audit

Diagnostics explain *why* a value hurts users and come with quick fixes. All rules and their severities are configurable in `pxToRem.diagnostics.rules`; see the [rule reference](docs/rules.md).

| Rule | Default | Catches |
|---|---|---|
| `font-size-px` | information | px font sizes ignore the browser font size (WCAG 1.4.4) |
| `line-height-px` | information | px line-heights don't grow with the text |
| `letter-spacing-px` | hint | px letter-spacing doesn't scale with the font |
| `media-query-px` | hint | px breakpoints ignore the user font size |
| `fixed-height-text` | hint | fixed heights clip enlarged text (WCAG 1.4.4, 1.4.12) |
| `text-width-px` | hint | px max-width on text doesn't grow with the font |
| `viewport-font-size` | warning | font sizes made only of `vw` can't be zoomed |
| `fluid-zoom` | warning | fluid font sizes that can't reach 200% with zoom |
| `off-scale` | hint | values not on your token scale, with snap fixes |
| `off-palette` | hint | colours that almost match a colour token |
| `rem-function-missing` | warning | `rem()` used but never defined, with a generator |
| `px-unit` | off | any convertible px value |

Set `"diagnostics.scope": "changedLines"` to only report on lines changed since the last commit.

## Design tokens

Tokens are read from CSS custom properties (`:root`, `html`, themes, Tailwind v4 `@theme`), Sass/Less/Stylus variables and Sass maps, and JSON token files (W3C DTCG including the 2025 format, Tokens Studio, Style Dictionary). Point `tokens.sources` at your files or let auto-detection find them.

- Hover a px value to see the matching token or the tokens around it.
- Quick fixes and completions offer `var(--space-4)`, `$space-md`, `map.get($spacing, md)`.
- `tokens.preferTokens: true` converts exact matches to the token instead of rem.
- **Step Up/Down** moves along your scale; colours that almost match a token get a fix.
- **Generate design tokens from usage…** proposes spacing, type and radius scales from your code and writes CSS, Sass, Sass maps, Less, Stylus, Tailwind v4 `@theme` or DTCG JSON.

## Migrating a codebase

- **Convert workspace…** — all files, a folder, one file type, changed files or changed lines only. Every change opens in VS Code's **Refactor Preview**, where you can untick anything before applying; one undo reverts all of it.
- **Convert on save** — `pxToRem.convertOnSave`, or add `"source.pxToRem.convert": "explicit"` to `editor.codeActionsOnSave`.
- **Paste as rem** — pasting CSS from Figma or DevTools offers a converted version in the paste menu (`paste.mode: "default"` makes it the default).
- **PX to REM view** (Explorer) — files with px left and the share of lengths that already scale, with a daily trend.
- **Value audit dashboard** — every spacing, size, font-size and radius in use, off-grid outliers with links, grid adherence, the type scale your sizes follow and proposed tokens.

---

## Configuration

Settings live in VS Code (`pxToRem.*`) and, for the whole team and the CLI, in `.pxtoremrc.json` at the project root (JSON with comments, validated with autocomplete):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json",
  "mode": "smart",
  "format": "auto",
  "minValue": 2,
  "tokens": { "sources": ["src/styles/tokens.scss", "tokens/*.json"], "preferTokens": true },
  "diagnostics": { "scope": "changedLines", "rules": { "font-size-px": "warning" } },
  "overrides": [
    { "files": "src/emails/**", "excludeProperties": ["*"] },
    { "files": "**/*.styl", "format": "rem" }
  ]
}
```

Precedence: defaults → user → workspace → folder settings → `.pxtoremrc.json` → matching `overrides` → disable comments.

<details>
<summary>Most used settings</summary>

| Setting | Default | |
|---|---|---|
| `pxToRem.format` | `auto` | Output, see [formats](#output-formats) |
| `pxToRem.mode` | `smart` | `smart` or `simple` |
| `pxToRem.baseFontSize` / `baseFontSizeDetection` | `16` / `auto` | Root font size and detection |
| `pxToRem.precision` | `4` | Decimal places |
| `pxToRem.minValue` / `maxValue` | `0` / `9999` | Absolute px range to convert |
| `pxToRem.includeProperties` / `excludeProperties` | `[]` | Property globs such as `border*` |
| `pxToRem.mediaQueries` | `em` | `em`, `rem`, `keep` or `convert` |
| `pxToRem.smartRules` | `{}` | Per-property smart actions |
| `pxToRem.tokens.*` | | Token sources, preference, colour matching |
| `pxToRem.tailwind.enable` | `auto` | Tailwind arbitrary values |
| `pxToRem.js.*` | | styled-components, style objects, React numbers |
| `pxToRem.fluid.*` | | Viewport range, breakpoints, `vw` or `cqi`, zoom check |
| `pxToRem.diagnostics.*` | | Rules, severities, changed-lines scope |
| `pxToRem.convertOnSave` | `false` | Convert when saving |
| `pxToRem.codeLens` | `file` | `off`, `file`, `rule` or `line` |
| `pxToRem.excludeFiles` | `[]` | Globs to ignore; `.gitignore` is honoured |

Every setting is documented in the Settings UI under **PX to REM**.
</details>

## Command line

```bash
npx px-to-rem-toolkit check "src/**/*.{css,scss,vue}"   # exit 1 when something needs fixing
npx px-to-rem-toolkit fix                               # convert in place
npx px-to-rem-toolkit check --changed --reporter github # PR annotations, changed lines only
npx px-to-rem-toolkit report                            # score, grid, type scale, outliers, token proposals
```

See the [CLI README](cli/README.md) for CI and pre-commit examples.

---

## Migrating from 1.x

| 1.x | 2.0 |
|---|---|
| `Ctrl+K` converted the file | `Ctrl+Alt+R` / `⌃⌘R`, only in supported files (`Ctrl+K` chords work again) |
| `Ctrl+Shift+K` converted the selection | `Ctrl+Alt+R` converts the selection when there is one |
| `Ctrl+Ä` converted to `rem(16px)` | `format: "rem-function-px"` or the **Convert px to rem(Npx)** command |
| `directConversion`, `keepPxInRem` | `format` (still read: `true` → `rem`, `keepPxInRem` → `rem-function-px`) |
| `scssInterpolation` | `interpolateInCalc` (still read) |
| `enableDiagnostics`, `diagnosticSeverity` | `diagnostics.rules["px-unit"]` (still read) |
| `enableCodeLens`, `enableInlayHints` | `codeLens`, `inlayHints.enable` (still read) |
| `useDynamicBaseFontSize`, `baseFontSizeFile`, `baseFontSizeVariable` | Removed. The root font size is detected automatically; set `baseFontSize` to pin it |
| Export / import settings | `.pxtoremrc.json` (the commands now create and fill it) |
| `0px` → `rem(0)` | `0` (`preserveZero` now defaults to `true`) |
| Everything converted the same way | Smart mode by default; `"mode": "simple"` restores it |
| `rem(16)` by default | `auto`: `rem(16)` only where your project defines `rem()`; set `"format": "rem-function"` to always use it |

## FAQ

<details>
<summary>Why not convert borders and media queries to rem?</summary>

A 1px border that grows to 2px when someone enlarges their text looks broken, and it adds nothing to readability. Media queries are different: inside them rem and em both mean the browser default font size (16px), whatever `html { font-size }` says, so a breakpoint converted with a 10px root would silently move. Smart mode uses em with the browser default. Both behaviours can be changed.
</details>

<details>
<summary>My build already uses postcss-pxtorem. Do I need this?</summary>

The extension reads the plugin's `rootValue` so editor and build agree, and the status bar notes that conversion also happens at build time. Many teams still convert in source so code review, design tokens and hovers show the real units.
</details>

<details>
<summary>Does it work without Sass, Vue or Svelte extensions installed?</summary>

Yes. Files are recognised by extension when VS Code has no language for them.
</details>

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/louis-mudrack/px-to-rem). `npm ci && npm run check` runs typecheck, lint, unit tests and the build; `npm run test:integration` runs the extension in VS Code. The architecture is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Translations live in `l10n/` and `package.nls.*.json`; corrections from native speakers are very welcome.

## License

[MIT](LICENSE.md)
