# Set up for your project

PX to REM Toolkit reads your project instead of asking you to configure it:

| It looks for | Example | Used for |
|---|---|---|
| Root font size | `html { font-size: 62.5% }` → 1rem = 10px | every rem calculation |
| A rem() helper | `@function rem($px) { … }` | `format: "auto"` writes `rem(16)` in Sass |
| Design tokens | `--space-4: 16px`, `$spacing: (md: 16px)`, `tokens.json` | quick fixes, snapping, hovers |
| Tailwind CSS | `tailwindcss` in package.json | `p-[16px]` → `p-4` |
| postcss-pxtorem | `rootValue: 10` | same base as your build |

**Set up project** shows what was found and writes a `.pxtoremrc.json` that the whole team (and CI) shares.
