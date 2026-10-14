# Enforce it in CI

The same engine runs on the command line and reads the same `.pxtoremrc.json`:

```bash
npx px-to-rem-toolkit check "src/**/*.{css,scss,vue}"
npx px-to-rem-toolkit fix "src/**/*.scss"
npx px-to-rem-toolkit check --changed --reporter github
```

`check` exits with code 1 when it finds px values to convert or accessibility problems, so it works in CI and pre-commit hooks.
