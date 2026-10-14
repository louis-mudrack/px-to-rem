# Architecture

PX to REM Toolkit is built around one engine. Every feature — commands, save
actions, paste, completions, quick fixes, diagnostics, hovers, inlay hints, the
dashboard and the CLI — calls the same pipeline, so a capability added to the
engine (for example design tokens) shows up everywhere at once.

```
 text + language
      │
      ▼
 ┌──────────┐   regions: whole file, <style> blocks, style="" attributes,
 │ regions  │   styled-components/emotion templates, JS style objects,
 └────┬─────┘   Tailwind arbitrary values
      ▼
 ┌──────────┐   CSS-family tokenizer (css, scss, sass, less, stylus):
 │ tokenize │   comments, strings, url(), interpolation, numbers + units
 └────┬─────┘
      ▼
 ┌──────────┐   rules, at-rules, declarations, function calls, variable
 │  parse   │   definitions; indentation syntaxes get synthetic braces
 └────┬─────┘
      ▼
 ┌──────────┐   every length with its context: property, enclosing rule,
 │ lengths  │   at-rule (media/container/mixin), function stack,
 └────┬─────┘   interpolation, directives (disable comments, uppercase PX)
      ▼
 ┌──────────┐   project context: root font size (+ where it came from),
 │ context  │   rem() function, design tokens, Tailwind, postcss-pxtorem,
 └────┬─────┘   rule font-size for em / unitless line-height
      ▼
 ┌──────────┐   simple mode: everything → format
 │ strategy │   smart mode: per-property rules (font-size → rem,
 └────┬─────┘   line-height → unitless, letter-spacing → em, borders → px,
      │         media queries → em, …), filters, token preference
      ▼
 ┌──────────┐   templates (`{rem}rem`, `rem({px})`, `var(--x)`, …),
 │  format  │   precision, leading zero, Sass/JS interpolation wrapping
 └────┬─────┘
      ▼
   edits / findings / descriptions
      │
      ├── VS Code: commands, codeActionsOnSave, paste, completion, quick
      │   fixes, diagnostics, hover, inlay hints, CodeLens, status bar,
      │   migration tree, dashboard webview, walkthrough
      └── CLI: check / fix / report / rebase, CI annotations
```

## Source layout

```
src/
  core/            Pure TypeScript. No `vscode`, no Node APIs. Used by the
                   desktop extension, the web extension and the CLI.
    options.ts       option definitions, defaults, merging, legacy mapping
    optionsSchema.ts metadata that generates package.json settings + JSON schema
    syntax.ts        language id / file extension → syntax
    tokenizer.ts     CSS-family tokenizer
    parser.ts        rule/declaration tree (brace + indentation syntaxes)
    regions.ts       embedded regions (HTML, Vue, Svelte, Astro, JS/TS)
    document.ts      parse() → ParsedDocument (regions + tree + lengths)
    properties.ts    CSS property knowledge, categories, smart rules
    directives.ts    disable comments, uppercase PX
    strategy.ts      decides what happens to each length
    format.ts        number formatting and output templates
    convert.ts       conversion, reverse, rebase, unit cycling, describe
    expr.ts          calc/clamp/min/max/var evaluator
    fluid.ts         clamp() generator, zoom check, breakpoint merging
    tokens/          design-token extraction (CSS, Sass, Less, Stylus,
                     DTCG/Tokens Studio/Style Dictionary JSON, Tailwind) and
                     snapping
    tailwind.ts      Tailwind arbitrary values and scale mapping
    detect.ts        root font size, rem() function, postcss-pxtorem config
    audit.ts         diagnostics rules (accessibility, off-scale, …)
    analyze.ts       workspace statistics, grid/type-scale detection,
                     token proposals
    generate.ts      rem() helper and token file generators
    gitDiff.ts       unified diff → changed lines
    messages.ts      English message templates (localized by the extension)
  extension/       VS Code integration (works on desktop and vscode.dev)
  cli/             `px-to-rem` command line tool (Node)
test/              unit tests (core), CLI tests, VS Code integration tests
```

## Feature map

| # | Feature | Engine modules | Surfaces |
|---|---------|----------------|----------|
| 0 | CSS-aware scanning, bug fixes | tokenizer, parser, regions, document | all |
| 1 | Output templates & precision | format, options | all conversions |
| 2 | More target units (em, vw, vh, vmin, vmax, rpx, pt) | format, convert | commands, quick fixes, cycling |
| 3 | Convert on save, completions, multi-cursor | convert | codeActionsOnSave, completion provider, commands |
| 4 | Paste as rem | convert, strategy | paste edit provider |
| 5 | Embedded languages, CSS-in-JS, Tailwind | regions, tailwind | all |
| 6 | Unit cycling | convert (cycle) | command + keybinding |
| 7 | Smart mode | strategy, properties | all conversions, hover explains |
| 8 | Rule-aware math (unitless line-height, em) | strategy, document | all conversions |
| 9 | Zero-config root font size detection | detect | status bar, hover, all math |
| 10 | Rebase rem | convert (rebase) | command with preview, CLI |
| 11 | Generate missing rem() helper | detect, generate, audit | diagnostic + quick fix |
| 12 | clamp() generator | fluid | command, quick fix |
| 13 | Merge breakpoints into clamp() | fluid, parser | quick fix |
| 14 | clamp/calc explainer + WCAG zoom check | expr, fluid, audit | hover, diagnostics |
| 15 | Text-scaling accessibility audit | audit | diagnostics, CLI |
| 16 | Token snapping | tokens, strategy, audit | quick fixes, diagnostics, conversion |
| 17 | Scale-aware nudging | tokens | commands + keybindings |
| 18 | Value audit dashboard | analyze | webview |
| 19 | Generate tokens from usage | analyze, generate | dashboard, command |
| 20 | Variable resolution | tokens, expr | hover, inlay hints |
| 21 | Colour tokens | tokens (colour) | quick fixes, diagnostics |
| 22 | `.pxtoremrc.json` + overrides | options | everywhere, CLI |
| 23 | Inline directives | directives | everywhere, CLI |
| 24 | Workspace migration with refactor preview | convert | command |
| 25 | Git-aware mode | gitDiff | commands, diagnostics scope, CLI `--changed` |
| 26 | Migration progress view + trend | analyze | tree view, dashboard |
| 27 | Status bar menu | — | status bar |
| 28 | CLI | everything | `px-to-rem` binary |
| 29 | Web extension | core has no Node APIs | `browser` entry |
| 30 | Walkthrough + setup wizard | detect | walkthrough, command |
| 31 | `vscode.l10n` + translations | messages | everywhere |

## Settings precedence

defaults → VS Code user → workspace → folder → `.pxtoremrc.json` →
matching `overrides` entry → inline directives.

The CLI uses defaults → `.pxtoremrc.json` → overrides → CLI flags.

## Performance

* Parsing is linear; results are cached per document version and shared by
  every provider.
* Diagnostics are debounced. Files above `pxToRem.maxFileSize` skip live
  features.
* The workspace index scans in the background, is cancellable, and updates
  incrementally from file watchers.
