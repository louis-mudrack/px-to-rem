# px-to-rem-toolkit

The command line twin of the [PX to REM Toolkit](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function) VS Code extension. It uses the same engine and the same `.pxtoremrc.json`, so CI enforces exactly what editors show.

```bash
npx px-to-rem-toolkit check
```

Node.js 20 or newer. Installs two equivalent binaries: `px-to-rem` and `px-to-rem-toolkit`.

## Commands

| Command | |
|---|---|
| `px-to-rem check [patterns…]` | Reports px values to convert (errors) and accessibility/design-system findings. Exit code 1 when anything is an error. |
| `px-to-rem fix [patterns…]` | Converts px values in place. `--dry-run` lists the changes and exits with 1 if there are any. |
| `px-to-rem report [patterns…]` | Scalable share, grid adherence, type scale, off-grid outliers and proposed tokens. `--json` for machines. |
| `px-to-rem rebase --from 10 --to 16 [patterns…]` | Rewrites rem values for a new root font size (e.g. removing `html { font-size: 62.5% }`). `--root-declarations` updates the `html` rule too. |
| `px-to-rem init` | Writes `.pxtoremrc.json` with what was detected. |

Patterns are globs relative to the current directory; quote them so your shell doesn't expand them. Without patterns, every file type in `fileTypes` is checked. `node_modules`, build output and `.gitignore`d files are skipped.

## Options

| Option | |
|---|---|
| `--config <file>` | Use this config file instead of searching for `.pxtoremrc.json` upwards |
| `--changed [ref]` | Only lines changed since `ref` (default `HEAD`); untracked files are checked completely |
| `--reporter stylish\|json\|github` | `github` prints workflow annotations that show up on pull requests |
| `--max-warnings <n>` | Fail when there are more than `n` warnings |
| `--no-px` | Only run the audit rules |
| `--set key=value` | Override any option, e.g. `--set format=rem --set mode=simple` |
| `-q`, `--quiet` | Only print errors |

Exit codes: `0` success, `1` problems found (or changes pending with `--dry-run`), `2` usage or runtime error.

## GitHub Actions

```yaml
name: CSS units
on: pull_request
jobs:
  px-to-rem:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx px-to-rem-toolkit check --changed origin/${{ github.base_ref }} --reporter github
```

## pre-commit

With [lint-staged](https://github.com/lint-staged/lint-staged):

```json
{
  "lint-staged": {
    "*.{css,scss,sass,less,styl,vue,svelte,astro}": "px-to-rem fix"
  }
}
```

Or without lint-staged, in `.husky/pre-commit`:

```sh
npx px-to-rem-toolkit check --changed
```

## Configuration

`.pxtoremrc.json` (JSON with comments) is found by walking up from the current directory. All options are listed in the [JSON schema](https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json) and described in the [extension README](https://github.com/louis-mudrack/px-to-rem#configuration).

```jsonc
{
  "mode": "smart",
  "format": "auto",
  "excludeFiles": ["**/*.min.css", "src/legacy/**"],
  "overrides": [{ "files": "src/emails/**", "excludeProperties": ["*"] }]
}
```

The root font size, `rem()` helpers, design tokens, Tailwind and postcss-pxtorem settings are detected the same way as in the editor.

## License

MIT
