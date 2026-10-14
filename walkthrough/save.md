# Convert on save

Turn on **pxToRem.convertOnSave**, or add the code action to your save actions:

```json
"editor.codeActionsOnSave": {
  "source.pxToRem.convert": "explicit"
}
```

Migrating a large codebase? Set `"diagnostics.scope": "changedLines"` in `.pxtoremrc.json`: only lines you touch are converted and flagged.
