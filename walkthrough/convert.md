# Convert

| Shortcut | What it does |
|---|---|
| `Ctrl+Alt+R` / `⌃⌘R` | Convert the selection, or the whole file |
| `Ctrl+Alt+U` / `⌃⌘U` | Cycle the value under the cursor: px → rem → em → vw → token |
| `Shift+Alt+PageUp/PageDown` | Step the value up or down your spacing/type scale |

```css
.card { padding: 24px; font-size: 18px; line-height: 27px; border: 1px solid; }
```

becomes

```css
.card { padding: 1.5rem; font-size: 1.125rem; line-height: 1.5; border: 1px solid; }
```

Comments, strings, `url()`, selectors and class names are never touched. Add `/* px-to-rem-disable-next-line */` to keep a line as it is.
