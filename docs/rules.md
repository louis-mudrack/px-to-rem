# Diagnostic rules

Every diagnostic links here. Severities are set per rule in `pxToRem.diagnostics.rules` (VS Code settings or `.pxtoremrc.json`); `"off"` disables a rule:

```jsonc
{ "diagnostics": { "rules": { "font-size-px": "warning", "off-scale": "off" } } }
```

`"diagnostics.scope": "changedLines"` limits reports to lines changed since the last commit. Values in `@media print`, values disabled with `px-to-rem-disable` comments and uppercase `PX` are never reported.

- [`px-unit`](#px-unit)
- [`font-size-px`](#font-size-px)
- [`line-height-px`](#line-height-px)
- [`letter-spacing-px`](#letter-spacing-px)
- [`media-query-px`](#media-query-px)
- [`fixed-height-text`](#fixed-height-text)
- [`text-width-px`](#text-width-px)
- [`viewport-font-size`](#viewport-font-size)
- [`fluid-zoom`](#fluid-zoom)
- [`off-scale`](#off-scale)
- [`off-palette`](#off-palette)
- [`rem-function-missing`](#rem-function-missing)

---

## px-unit

**Default:** off · **Fix:** convert with the current settings

Reports every px value that the current settings would convert. Useful when a project has fully migrated and new px values should stand out. The CLI's `check` command always reports these as errors (use `--no-px` to skip them).

## font-size-px

**Default:** information · **Fix:** convert to rem (or your format)

Browsers let people choose a larger default font size. Text sized in rem follows that choice; text sized in px ignores it. [WCAG 1.4.4 Resize Text](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html) asks that text can be enlarged to 200% without loss of content or function.

```css
.lead { font-size: 18px; }     /* ✗ */
.lead { font-size: 1.125rem; } /* ✓ */
```

## line-height-px

**Default:** information · **Fix:** unitless ratio when the element font size is known, rem otherwise

A px line-height stays the same when the text grows, so lines start to overlap. A unitless line-height is a ratio of the element's own font size, and it is inherited as a ratio.

```css
.lead { font-size: 18px; line-height: 27px; } /* ✗ */
.lead { font-size: 1.125rem; line-height: 1.5; } /* ✓ */
```

## letter-spacing-px

**Default:** hint · **Fix:** em relative to the element font size

Letter-spacing in px stays fixed when the font grows, so text looks cramped at larger sizes. em keeps it proportional. [WCAG 1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) expresses spacing in multiples of the font size too.

## media-query-px

**Default:** hint · **Fix:** em relative to the browser default (`mediaQueryBase`, 16)

Breakpoints in em switch layouts at the same *text* width when users enlarge their default font size, so layouts don't break into overly narrow columns. Inside media queries `rem` and `em` both mean the browser default font size, not your `html { font-size }`. That's why the fix divides by 16 even when the root font size is 10px.

## fixed-height-text

**Default:** hint · **Fix:** rename `height` to `min-height`

A rule that sets a font size or line-height together with a fixed `height` (px or rem) clips its text when the text grows or wraps onto more lines. Rules that also set `overflow` or `min-height` are not reported.

## text-width-px

**Default:** hint · **Fix:** convert to rem

`max-width` in px on a text block keeps the same width when the font grows, so the number of characters per line shrinks. `rem` or `ch` keep the measure readable.

## viewport-font-size

**Default:** warning

A font size made only of viewport units (`font-size: 4vw`, `calc(2vw + 1vh)`) does not respond to browser zoom at all, because zooming does not change the viewport width in CSS pixels the way it changes everything else. Add a rem part, for example `clamp(1rem, 0.5rem + 2vw, 2rem)`.

## fluid-zoom

**Default:** warning

Fluid font sizes such as `clamp(1rem, 0.5rem + 3vw, 3rem)` grow with the viewport. When a user zooms in, the layout viewport (in CSS pixels) shrinks, so the vw part *shrinks* while the zoom enlarges the result. If the range between minimum and maximum is too wide, text can't reach 200% at some window widths.

The check simulates browser zoom up to 500% for window widths from 320px to 2560px and reports the worst case, for example: *"only reaches 160% at a 1280px wide window"*. Keeping the maximum at most 2.5× the minimum is a reliable rule of thumb. Hover any `clamp()` to see the result at each breakpoint.

## off-scale

**Default:** hint · **Fixes:** use the nearest token, or snap the value to it

Reported for spacing, size, font-size and radius values (px or rem) that are not on your design-token scale, when the category has at least three tokens. Values outside the scale's range (for example large widths) are not reported. Tokens come from `pxToRem.tokens.sources` or auto-detection.

```scss
$space-3: 12px;
$space-4: 16px;

.card { padding: 15px; } // 15px is not on your spacing scale. Nearest: $space-4 (16px).
```

## off-palette

**Default:** hint · **Fix:** use the colour token

A literal colour that is visually almost identical to a colour token (CIEDE2000 difference up to `tokens.colorTolerance`, default 3; around 2 is barely perceptible) is probably meant to be that token.

## rem-function-missing

**Default:** warning · **Fixes:** generate the helper, or switch to the `rem` format

`rem()` (or your `functionName`) is called in a Sass, Less or Stylus file, but no definition was found in the project. Without it the stylesheet doesn't compile. **Generate rem() helper…** writes one for SCSS, indented Sass, Stylus, CSS `@function`, TypeScript or JavaScript.
