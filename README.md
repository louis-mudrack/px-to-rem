# PX to REM Converter

[![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Language](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![Deutsch](https://img.shields.io/badge/lang-de-green.svg)](README.de.md)

> Professional VSCode extension that automatically converts `px` values to `rem()` functions with usefull features.

## ✨ Features

### 🎯 Core Conversion
- **Dual Conversion Modes**: `rem(10)` or `rem(10px)` via hotkeys
- **Direct Conversion**: Direct calculation `16px` → `1rem`
- **SCSS Interpolation**: Automatic `#{}` wrappers in `calc()`
- **Smart Detection**: Skips already converted values
- **Negative Values & Decimals**: Fully supported
- **Zero Preservation**: Optionally keep `0px` as `0`

### 🔍 Advanced Filtering
- **Min/Max Filter**: Convert only values in specific range
- **Selective Properties**: Include/Exclude specific CSS properties
- **Clamp() Support**: Automatic detection of clamp() functions
- **Exclude Patterns**: Skip lines with regex patterns
- **File Ignoring**: Exclude files with glob patterns (e.g., `**/*.min.css`)
- **File Type Selection**: Convert only specific file types

### 🎨 UI & UX
- **Status Bar Integration**: Live px-count with click-to-convert
- **Hover Preview**: Preview on hover over px values
- **Code Lens**: Inline "Convert" buttons above lines (toggleable)
- **Quick Fix Provider**: 💡 Lightbulb with conversion options (Ctrl+.)
- **Diagnostic Provider**: Underlines px values with warnings/hints
- **Statistics**: Detailed conversion statistics with timing
- **Configuration Profiles**: Quick-switch between 4 presets

### 📦 Batch Operations
- **Workspace Conversion**: Convert all files at once with filtering
- **File Type Conversion**: Convert only specific file types (CSS, SCSS, etc.)
- **Selection Conversion**: Convert only selected code
- **Reverse Conversion**: rem back to px for rollback
- **Export/Import Settings**: Share config with team
- **Progress Indicator**: Live progress for large operations
- **Auto-Save**: Automatic saving after conversion

### 🌍 Internationalization
- **Multi-Language Support**: English & German (more coming!)
- **Auto-Detection**: Uses your VSCode language automatically
- **Fully Localized**: All UI elements, messages, and commands

## 📦 Installation

### From VSCode Marketplace
1. Open VSCode
2. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac)
3. Type: `ext install LouisMudrack.px-to-rem-converter`
4. Press Enter

### From Source
```bash
cd px-to-rem-converter
npm install
npm run compile
```

## 🎯 Usage

### Standard Hotkeys
- **Windows/Linux**: 
  - `Ctrl+K` - Convert to `rem(10)` (without px)
  - `Ctrl+Ä` - Convert to `rem(10px)` (with px)
  - `Ctrl+Shift+K` - Convert selection only
- **Mac**: 
  - `Cmd+K` - Convert to `rem(10)` (without px)
  - `Cmd+Ä` - Convert to `rem(10px)` (with px)
  - `Cmd+Shift+K` - Convert selection only

**Note:** `Ctrl+Ä` works only on German keyboards.

### Via Command Palette
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for:
   - "PX to REM: Convert (without px)" → `rem(10)`
   - "PX to REM: Convert (with px)" → `rem(10px)`
   - "PX to REM: Convert selection only" → Selected lines only
   - "PX to REM: Convert all files of specific type" → File type selection
3. Press Enter

## ⚙️ Configuration

### Settings

In your `settings.json`:

```json
{
  // Conversion
  "pxToRem.directConversion": false,
  "pxToRem.baseFontSize": 16,
  "pxToRem.keepPxInRem": false,
  "pxToRem.preserveZero": true,
  "pxToRem.scssInterpolation": false,
  
  // File Filtering (NEW!)
  "pxToRem.excludeFiles": [
    "**/*.min.*",
    "**/vendor/**",
    "**/node_modules/**"
  ],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Value Filters
  "pxToRem.minValue": 0,
  "pxToRem.maxValue": 9999,
  "pxToRem.includeProperties": [],
  "pxToRem.excludeProperties": [],
  "pxToRem.excludePatterns": [],
  
  // UI Features
  "pxToRem.enableCodeLens": true,
  "pxToRem.enableDiagnostics": false,
  "pxToRem.diagnosticSeverity": "information"
}
```

## 📝 Examples

### Before
```css
.container {
  width: 1200px;
  padding: 20px 40px;
  margin: 0px auto;
  font-size: 16px;
  line-height: 24px;
}

.button {
  height: 48px;
  border-radius: 8px;
}
```

### After (Ctrl+K - without px)
```css
.container {
  width: rem(1200);
  padding: rem(20) rem(40);
  margin: 0 auto;
  font-size: rem(16);
  line-height: rem(24);
}

.button {
  height: rem(48);
  border-radius: rem(8);
}
```

### After (Ctrl+Ä - with px)
```css
.container {
  width: rem(1200px);
  padding: rem(20px) rem(40px);
  margin: 0 auto;
  font-size: rem(16px);
  line-height: rem(24px);
}

.button {
  height: rem(48px);
  border-radius: rem(8px);
}
```

### With Direct Conversion
```css
.container {
  width: 75rem;        /* 1200 / 16 */
  padding: 1.25rem 2.5rem;
  margin: 0 auto;
  font-size: 1rem;     /* 16 / 16 */
  line-height: 1.5rem;
}
```

## 🚀 New Marketplace Features

### 1. File Ignoring
Ignore specific files during batch conversion:

```json
{
  "pxToRem.excludeFiles": [
    "**/*.min.css",          // Minified files
    "**/vendor/**",          // Third-party code
    "**/node_modules/**",    // Dependencies
    "**/legacy/**"           // Old code
  ]
}
```

### 2. File Type Selection
Convert only specific file types:

```
Command: "PX to REM: Convert all files of specific type"
→ Select: SCSS
→ Only .scss files are converted!
```

### 3. Multi-Language Support
Extension automatically uses your VSCode language:
- 🇬🇧 English (Complete)
- 🇩🇪 German (Complete)
- 🌍 More languages welcome!

## 💡 Use Cases

### Large Project with Vendor Code
```json
{
  "pxToRem.excludeFiles": [
    "**/vendor/**",
    "**/*.min.*"
  ]
}
```
→ Only your own code is converted!

### Gradual Migration
```
1. Command: "Convert all SCSS files"
2. Review & Test
3. Later: "Convert all CSS files"
```
→ Safe, controlled migration!

### International Team
```
🇩🇪 German Dev → German UI
🇬🇧 English Dev → English UI
```
→ Everyone sees the extension in their language!

## 🎮 Alternative Workflows

### 1. Command Palette
```
Ctrl+Shift+P → "PX to REM"
```
Shows all available commands!

### 2. Code Lens (Click)
```css
$(symbol-property) Convert 3 px values to rem  ← Click!
font-size: 16px;
```

**Disable:**
```json
{
  "pxToRem.enableCodeLens": false
}
```

### 3. Quick Fix (Ctrl+.)
```css
font-size: 16px;  💡
           ↓ Ctrl+.
[Convert to 1rem]
[Convert to rem(16)]
[Convert to rem(16px)]
```

## 🤝 Contributing

### Add a New Language
1. Create `/src/locales/[code].json`
2. Copy structure from `en.json`
3. Translate all strings
4. Pull Request!

### Report Issues
Found a bug? Have a suggestion?
- [GitHub Issues](https://github.com/louis-mudrack/px-to-rem)
- Marketplace Reviews

## 🔧 Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npm run vscode:prepublish
vsce package
```

## 📊 Statistics

- **18+ Core Features**
- **3 Marketplace Features**
- **2 Languages** (EN + DE)
- **1100+ Lines** of TypeScript
- **Production-Ready**

## ⭐ Why This Extension?

- ✅ **International**: Multi-language support
- ✅ **Team-Friendly**: Export/Import settings
- ✅ **Safe**: File ignoring for vendor code
- ✅ **Flexible**: Multiple conversion modes
- ✅ **Well-Documented**: Comprehensive guides
- ✅ **Active Development**: Regular updates
