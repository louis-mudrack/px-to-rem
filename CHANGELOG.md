# Changelog

## 2.0.0

A rewrite around a CSS-aware engine. The extension is now **PX to REM Toolkit**: same Marketplace id, a new icon, many more ways to keep CSS scalable.

### Breaking changes

- **Shortcuts.** `Ctrl+K` / `Cmd+K` no longer converts: as a single-key binding it blocked every `Ctrl+K …` chord in VS Code (comment, format, fold, …) and also fired in non-CSS files. Convert with `Ctrl+Alt+R` (`⌃⌘R` on macOS); it converts the selection when there is one. `Ctrl+Shift+K` and `Ctrl+Ä` were removed. All shortcuts only apply in supported files.
- **Removed** `useDynamicBaseFontSize`, `baseFontSizeFile` and `baseFontSizeVariable`. The root font size is now detected automatically from `html`/`:root` rules and postcss-pxtorem; set `baseFontSize` to pin it.
- **Smart mode is the default**: line-height becomes unitless, letter-spacing em, borders/shadows and 1px values stay px, media queries become em. Set `"mode": "simple"` for the 1.x behaviour.
- **`format: "auto"` is the default**: `rem(16)` is only written in Sass/Less/Stylus when the project defines a `rem()` function, otherwise `1rem`. Function output is never written into plain CSS any more, where it was invalid. Set `"format": "rem-function"` to always use `rem()`.
- **`preserveZero` defaults to `true`**: `0px` becomes `0` (except inside `calc()` and friends, where the unit is required).
- **Export/Import settings** now create and fill `.pxtoremrc.json` instead of editing user settings.
- Requires VS Code 1.97 or newer.

Pre-2.0 settings `directConversion`, `keepPxInRem`, `scssInterpolation`, `enableDiagnostics`, `diagnosticSeverity`, `enableCodeLens` and `enableInlayHints` are still honoured and marked as deprecated in the Settings UI.

### Fixed

- Comments, strings, `url()`, selectors and class names such as `.mt-16px` were converted.
- `.5px` became `.rem(5)`.
- Reverse conversion turned `1.5rem` into `1.5px` and failed completely when the file contained `#{rem(…)}`.
- The CodeLens "convert line" action ignored all filters and produced `rem(rem(10))`.
- Property filters did not work for one-line rules such as `a { padding: 4px }`.
- JSX/TSX support never activated (wrong language ids).
- Direct conversion wrote values such as `0.7142857142857143rem`; output now has `precision` decimal places.
- Workspace conversion saved every file without a preview and could not be cancelled.

### New

**Conversion**
- CSS-aware parser for CSS, SCSS, indented Sass, Less, Stylus and PostCSS, plus CSS embedded in HTML, Vue, Svelte, Astro, PHP and other templates (`<style>` blocks, `style=""`), styled-components/emotion/Lit templates, JS style objects and Tailwind arbitrary values.
- Smart mode with per-property rules (`smartRules`), rule-aware unitless line-height and em letter-spacing, em breakpoints relative to the browser default.
- Output formats and templates: rem, `rem()`, `rem(px)`, em, vw, vh, vmin, vmax, rpx, pt or any template such as `toRem({px})`; `precision`, `leadingZero`; `${rem(16)}` inside styled-components.
- Tailwind: `p-[16px]` → `p-4`, `text-[14px]` → `text-sm`, otherwise `p-[1rem]`; v3 and v4 scales and themes.
- Disable comments (`px-to-rem-disable-next-line`, `-disable-line`, `-disable`/`-enable`, `-disable-file`, postcss-pxtorem's `pxtorem-disable-next-line`) and the uppercase `PX` opt-out.
- Convert back to px for rem, em, vw, vh, vmin, vmax, rpx, pt and `rem()` calls.
- **Rebase rem values**: change the root font size (e.g. drop 62.5%) without visual changes.
- **Cycle unit** (`Ctrl+Alt+U`) and **step along the scale** (`Shift+Alt+PageUp/PageDown`).

**Project awareness**
- Root font size from `html`/`:root` rules, postcss-pxtorem `rootValue` or settings, shown in the status bar with its source.
- `rem()` helpers in Sass, Stylus, CSS `@function` and JS/TS, with a generator when one is missing.
- Design tokens from CSS custom properties, Sass/Less/Stylus variables and maps, Tailwind v4 `@theme`, and DTCG, Tokens Studio and Style Dictionary JSON.
- `.pxtoremrc.json` with JSON schema, comments and per-glob `overrides`, shared with the CLI.

**Fluid type**
- **Make value fluid with clamp()…**, in `vw` or container query units.
- Quick fix that merges media-query overrides into one `clamp()`.
- Hover tables for `clamp()`, `calc()`, `min()` and `max()` at each breakpoint, with a WCAG 1.4.4 zoom check.

**Accessibility and design-system diagnostics**
- Rules for px font sizes, px line-heights, px letter-spacing, px breakpoints, fixed heights on text, px max-width on text, viewport-only font sizes, fluid type that fails zoom, off-scale values, near-miss colours and missing `rem()` helpers, each with quick fixes and documentation.
- Git-aware scope: report only on changed lines.

**Editor**
- Hovers that explain each decision, inlay hints for rem/em/vw/`rem()`/variables, completions while typing px, **Paste as rem**, convert on save (setting or `source.pxToRem.convert` code action), CodeLens per file, rule or line, status bar menu, editor context menu.
- Workspace conversion of all files, a folder, a file type, changed files or changed lines through the Refactor Preview.
- **PX to REM** Explorer view with migration progress and a daily trend.
- **Value audit dashboard**: values in use per category, grid adherence, type-scale fit, off-grid outliers, proposed tokens and token file generation (CSS, Sass, Sass maps, Less, Stylus, Tailwind v4, DTCG).
- Setup wizard, presets and a getting-started walkthrough.
- Runs on vscode.dev and github.dev.
- UI in English, German, French, Spanish, Italian, Portuguese (Brazil), Japanese, Chinese (Simplified) and Korean.

**Command line**
- New npm package `px-to-rem-toolkit` with `check`, `fix`, `report`, `rebase` and `init`, stylish/JSON/GitHub reporters and `--changed`.

## 1.1.1

- Bug fixes.

## 1.1.0

- File ignoring, file type selection, profiles, export/import of settings, inlay hints, dynamic base font size, German UI.

## 1.0.0

- Initial release: convert px to `rem()` with a shortcut.
