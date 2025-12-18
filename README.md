# PX to REM Converter

[![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/LouisMudrack.px-to-rem-function.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Language](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![Deutsch](https://img.shields.io/badge/lang-de-green.svg)](README.de.md)

> Professional VSCode extension that automatically converts `px` values to `rem()` functions with enterprise-grade features. Perfect for teams and large projects.

**Features:** File ignoring • Type selection • Multi-language • 18+ conversion features • Code Lens • Quick Fix • Batch operations

---

## 📦 Installation

### From VSCode Marketplace (Recommended)

**Method 1: VSCode UI**
1. Open VSCode
2. Go to Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
3. Search for "PX to REM Converter"
4. Click **Install**

**Method 2: Command Line**
```bash
code --install-extension LouisMudrack.px-to-rem-function
```

**Method 3: Quick Open**
1. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac)
2. Type: `ext install LouisMudrack.px-to-rem-function`
3. Press Enter

---

## 🚀 Quick Start

### 1️⃣ Open a CSS/SCSS file
```css
.container {
  font-size: 16px;
  padding: 20px;
  margin: 10px 0;
}
```

### 2️⃣ Press `Ctrl+K` (Windows/Linux) or `Cmd+K` (Mac)

### 3️⃣ Done! 
```css
.container {
  font-size: rem(16);
  padding: rem(20);
  margin: rem(10) 0;
}
```

**That's it!** ✨

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action | Result |
|----------|--------|--------|
| **`Ctrl+K`** | Convert entire file | `rem(16)` |
| **`Ctrl+Ä`** | Convert with px unit | `rem(16px)` |
| **`Ctrl+Shift+K`** | Convert selection only | Selected lines |
| **`Ctrl+.`** | Quick Fix menu | Multiple options |

**Mac:** Replace `Ctrl` with `Cmd`

**Note:** `Ctrl+Ä` works on German keyboards. For other layouts:
1. Open Keyboard Shortcuts (`Ctrl+K Ctrl+S`)
2. Search for "px-to-rem.convertWithPx"
3. Change to your preferred shortcut (e.g., `Ctrl+Alt+P`)

---

## ✨ Features

### 🎯 Core Conversion
- **Dual Modes**: `rem(10)` or `rem(10px)` via hotkeys
- **Direct Conversion**: `16px` → `1rem` (configurable base font size)
- **SCSS Interpolation**: Automatic `#{}` wrappers in `calc()`
- **Smart Detection**: Skips already converted values
- **Clamp() Support**: Converts values inside clamp functions
- **Negative & Decimals**: `-16px`, `16.5px` fully supported
- **Zero Preservation**: Optionally keep `0px` as `0`

### 🔍 Advanced Filtering
- **Min/Max Range**: Only convert values between min and max
- **Property Filter**: Include/exclude specific CSS properties
- **Line Patterns**: Skip lines matching regex patterns
- **File Ignoring**: Exclude files with glob patterns
- **Type Selection**: Convert only specific file types

### 🎨 UI Features
- **Inlay Hints**: Permanent gray px display next to rem (e.g., `2rem → 32px`)
- **Status Bar**: Live px-count with click-to-convert
- **Code Lens**: Inline "Convert N px values" buttons (toggleable)
- **Quick Fix**: 💡 Lightbulb with 3 format options (`Ctrl+.`)
- **Hover Preview**: Shows conversion preview on hover
- **Diagnostics**: Underlines px values (configurable severity)
- **Statistics**: Detailed reports with timing

### 📦 Batch Operations
- **Workspace Convert**: All files at once
- **Type-Specific**: Only CSS, or only SCSS, etc.
- **Selection Convert**: Only selected code
- **Reverse Convert**: rem → px for rollback
- **Export/Import**: Share settings with team

### 🌍 International
- **English** & **German** UI (auto-detected)
- All messages, commands, and dialogs localized
- More languages: Community contributions welcome!

### ⚙️ Dynamic Configuration
- **Dynamic Base Font Size**: Read from SCSS/CSS variables
- **Live Updates**: Auto-updates when variable changes
- **Flexible Format**: Supports `$base-font-size: 20` or `20px`

---

## ⚙️ Configuration

### Essential Settings

```json
{
  // Conversion Mode
  "pxToRem.directConversion": false,        // false = rem(16), true = 1rem
  "pxToRem.baseFontSize": 16,               // Base size for calculations
  
  // Dynamic Base Font Size
  "pxToRem.useDynamicBaseFontSize": false,  // Read from SCSS/CSS file
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size",
  
  // Inlay Hints
  "pxToRem.enableInlayHints": true,         // Show "2rem → 32px" in gray
  
  // File Filtering
  "pxToRem.excludeFiles": [
    "**/*.min.css",                         // Ignore minified files
    "**/vendor/**",                         // Ignore vendor code
    "**/node_modules/**"                    // Ignore dependencies
  ],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Value Filtering
  "pxToRem.minValue": 0,                    // Minimum px value (e.g., 4 to skip 1-3px)
  "pxToRem.maxValue": 9999,                 // Maximum px value
  "pxToRem.excludeProperties": [],          // Properties to skip (e.g., ["border-width"])
  
  // UI
  "pxToRem.enableCodeLens": true,           // Show inline convert buttons
  "pxToRem.enableDiagnostics": false        // Underline px values
}
```

### All Settings

<details>
<summary>Click to expand complete settings list</summary>

```json
{
  // Conversion
  "pxToRem.directConversion": false,
  "pxToRem.baseFontSize": 16,
  "pxToRem.keepPxInRem": false,
  "pxToRem.preserveZero": true,
  "pxToRem.scssInterpolation": false,
  
  // Dynamic Base Font Size
  "pxToRem.useDynamicBaseFontSize": false,
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size",
  
  // File Filtering
  "pxToRem.excludeFiles": [],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Value Filtering
  "pxToRem.minValue": 0,
  "pxToRem.maxValue": 9999,
  "pxToRem.includeProperties": [],
  "pxToRem.excludeProperties": [],
  "pxToRem.excludePatterns": [],
  
  // UI
  "pxToRem.enableInlayHints": true,
  "pxToRem.enableCodeLens": true,
  "pxToRem.enableDiagnostics": false,
  "pxToRem.diagnosticSeverity": "information"
}
```
</details>

---

## 📝 Examples

### Before
```css
.hero {
  width: 1200px;
  padding: 40px 80px;
  margin: 0px auto;
  font-size: 24px;
}

.button {
  height: 48px;
  padding: 12px 24px;
  border-radius: 8px;
}
```

### After `Ctrl+K`
```css
.hero {
  width: rem(1200);
  padding: rem(40) rem(80);
  margin: 0 auto;           /* 0px → 0 */
  font-size: rem(24);
}

.button {
  height: rem(48);
  padding: rem(12) rem(24);
  border-radius: rem(8);
}
```

### With Direct Conversion
```json
{ "pxToRem.directConversion": true }
```
```css
.hero {
  width: 75rem;            /* 1200 / 16 */
  padding: 2.5rem 5rem;
  font-size: 1.5rem;       /* 24 / 16 */
}
```

### With SCSS Interpolation
```json
{ "pxToRem.scssInterpolation": true }
```
```scss
.hero {
  width: calc(100% - #{rem(40)});    /* Auto-wrapped in calc() */
  padding: clamp(#{rem(16)}, 2vw, #{rem(32)});
}
```

---

## Additional Features

### Inlay Hints
Permanent gray text showing px values next to rem:

```css
.container {
  font-size: 2rem → 32px;
  padding: 1.5rem → 24px;
  margin: rem(20) → 20px;
}
```

**How to use:**
- Enabled by default
- Shows automatically in CSS/SCSS files
- Hover for additional info
- Disable: `"pxToRem.enableInlayHints": false`

### Dynamic Base Font Size
Read baseFontSize from your SCSS/CSS variables:

**variables.scss:**
```scss
$base-font-size: 20;  // or 20px
```

**settings.json:**
```json
{
  "pxToRem.useDynamicBaseFontSize": true,
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size"
}
```

**Result:**
```css
font-size: 2rem → 40px  /* 2 * 20 */
```

**Benefits:**
- ✅ Single source of truth
- ✅ Team sync via Git
- ✅ Live updates on file change
- ✅ Works with or without px unit

---

## 🎮 Workflows

### Method 1: Keyboard Shortcuts (Fastest)
```
Open file → Ctrl+K → Done!
```

### Method 2: Code Lens (Visual)
```css
$(symbol-property) Convert 3 px values to rem  ← Click!
font-size: 16px;
padding: 20px;
```
*Appears above lines with px values*

### Method 3: Quick Fix (Options)
```css
font-size: 16px;  💡 ← Press Ctrl+.
```
Choose from:
- Convert to `1rem`
- Convert to `rem(16)`
- Convert to `rem(16px)`

### Method 4: Command Palette (Advanced)
```
Ctrl+Shift+P → Type "PX to REM"
```
- Convert entire file
- Convert selection
- Convert workspace
- Convert by file type
- Reverse convert
- Export/Import settings

---

## 🚀 Advanced Features

### 1. File Ignoring
**Problem:** Vendor files and minified files get converted  
**Solution:** Exclude them!

```json
{
  "pxToRem.excludeFiles": [
    "**/*.min.css",       // All minified
    "**/vendor/**",       // Third-party
    "**/legacy/**"        // Old code
  ]
}
```

Then run **"Convert all files in workspace"** → Only your files are converted! ✅

---

### 2. File Type Selection
**Problem:** Want to convert only SCSS, not CSS  
**Solution:** Type-specific conversion!

```
Ctrl+Shift+P → "PX to REM: Convert all files of specific type"
→ Select: SCSS
→ Only .scss files converted!
```

Or configure default types:
```json
{
  "pxToRem.fileTypes": ["scss", "sass"]  // Only SCSS & Sass
}
```

---

### 3. Selective Properties
**Example:** Keep borders in px, convert everything else

```json
{
  "pxToRem.excludeProperties": [
    "border-width",
    "outline-width",
    "stroke-width"
  ]
}
```

```css
/* Before */
.box {
  width: 200px;           /* ✅ Will convert */
  border-width: 2px;      /* ❌ Won't convert */
  padding: 20px;          /* ✅ Will convert */
}

/* After */
.box {
  width: rem(200);
  border-width: 2px;      /* Stays px! */
  padding: rem(20);
}
```

---

### 4. Min/Max Range
**Example:** Only convert values 8px and larger

```json
{
  "pxToRem.minValue": 8
}
```

```css
/* Before */
.box {
  width: 200px;        /* ✅ Converts (>= 8) */
  border: 2px solid;   /* ❌ Stays (< 8) */
  padding: 16px;       /* ✅ Converts (>= 8) */
}

/* After */
.box {
  width: rem(200);
  border: 2px solid;   /* Preserved! */
  padding: rem(16);
}
```

---

### 5. Configuration Profiles
Quick-switch between 4 presets:

```
Ctrl+Shift+P → "PX to REM: Switch configuration profile"
```

**Available Profiles:**
1. **🎨 SCSS Function** - `rem(16)` with SCSS interpolation
2. **📐 Direct Conversion** - `1rem` direct calculation
3. **🔧 SCSS with px** - `rem(16px)` format
4. **⚡ Minimal** - Only large values (≥8px), excludes borders

---

### 6. Team Settings
**Share config with your team:**

```
Ctrl+Shift+P → "PX to REM: Export settings"
→ Save as px-to-rem-config.json
→ Commit to Git
```

**Team members:**
```
Open px-to-rem-config.json
→ Ctrl+Shift+P → "PX to REM: Import settings"
→ Everyone has same config! ✅
```

---

## 💡 Use Cases

### Large Project with Vendor Code
```json
{
  "pxToRem.excludeFiles": ["**/vendor/**", "**/*.min.*"]
}
```
**Result:** Only your code converts, vendor stays untouched

### Gradual Migration
```
Week 1: Convert all SCSS files
Week 2: Review & test
Week 3: Convert all CSS files
```
**Result:** Safe, controlled rollout

### Design System Rules
```json
{
  "pxToRem.minValue": 4,
  "pxToRem.excludeProperties": ["border-width", "outline-width"]
}
```
**Result:** Borders stay in px, spacing converts to rem

### International Team
- 🇩🇪 German developer → German UI
- 🇬🇧 English developer → English UI
- Extension auto-detects VSCode language!

---

## 🌍 Multi-Language Support

### Automatic Language Detection
Extension uses your VSCode language automatically!

**English UI:**
```
✅ 23 px values converted to rem(N)!
No active editor found!
```

**German UI:**
```
✅ 23 px-Werte in rem(N) konvertiert!
Kein aktiver Editor gefunden!
```

### Add Your Language
Want to contribute a translation?
1. Create `/src/locales/[code].json`
2. Copy structure from `en.json`
3. Translate all strings
4. Submit Pull Request!

**Needed Languages:** French, Spanish, Italian, Japanese, Chinese, etc.

---

## 🔧 Customization

### Change Hotkeys

**Don't like default shortcuts?** Customize them:

1. Open Keyboard Shortcuts: `Ctrl+K Ctrl+S`
2. Search for: `px-to-rem`
3. Click pencil icon to change

**Example custom shortcuts:**
```json
{
  "key": "ctrl+alt+r",
  "command": "px-to-rem.convert"
},
{
  "key": "ctrl+alt+p",
  "command": "px-to-rem.convertWithPx"
}
```

### Toggle Code Lens

**Code Lens buttons too distracting?**
```json
{
  "pxToRem.enableCodeLens": false
}
```

### Enable Diagnostics

**Want px values underlined as warnings?**
```json
{
  "pxToRem.enableDiagnostics": true,
  "pxToRem.diagnosticSeverity": "warning"  // or "error", "information", "hint"
}
```

---

## 🎯 Tips & Tricks

### Tip 1: Use Quick Fix for Testing
Try different formats before committing:
```css
font-size: 16px;  💡 Ctrl+.
→ Try "1rem"
→ Undo (Ctrl+Z)
→ Try "rem(16)" instead
```

### Tip 2: Convert Selection for Partial Changes
```
1. Select specific lines
2. Ctrl+Shift+K
3. Only selection converts!
```

### Tip 3: Reverse Convert for Debugging
```
Ctrl+Shift+P → "Reverse convert"
→ All rem() back to px
→ Perfect for debugging!
```

### Tip 4: Status Bar Quick Access
Click the **📏 42 px** in status bar → Instantly converts file!

### Tip 5: Workspace Conversion Before Merge
```
1. Git commit current state
2. Convert workspace
3. Review with Git diff
4. Commit or revert
```

---

## 🤝 Contributing

### Found a Bug?
- [Report on GitHub](https://github.com/your-username/px-to-rem-converter/issues)
- Or leave a review on [Marketplace](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)

### Feature Request?
- Open GitHub Issue
- Or vote on existing requests

### Add a Translation?
1. Fork the repository
2. Create `/src/locales/[language].json`
3. Translate all strings
4. Pull Request!

We need: **French, Spanish, Italian, Japanese, Chinese, Korean, Russian, Portuguese, Dutch, Polish**

---

## 📊 Extension Statistics

- **21 Total Features**
- **2 Languages** (English + German)
- **1100+ Lines** of TypeScript
- **Production-Ready**
- **Enterprise-Grade**
- **Regular Updates**

---

## ⭐ Why Choose This Extension?

✅ **Most Complete** - 21 features vs. 3-5 in other extensions  
✅ **Enterprise-Ready** - File ignoring, type selection, team settings  
✅ **International** - Multi-language support  
✅ **Well-Documented** - Comprehensive guides  
✅ **Active Development** - Regular updates & bug fixes  
✅ **Free & Open Source** - MIT License  

---

## 📝 FAQ

<details>
<summary><strong>Can I use this with Tailwind CSS?</strong></summary>

Yes! But be careful - Tailwind uses px values in utilities. Consider:
```json
{
  "pxToRem.excludeFiles": ["**/tailwind.config.js", "**/utilities/**"]
}
```
</details>

<details>
<summary><strong>Does it work with CSS-in-JS?</strong></summary>

Yes, for styled-components, emotion, etc. Supports `.jsx` and `.tsx` files.
</details>

<details>
<summary><strong>Will it convert values in comments?</strong></summary>

No, comments are ignored automatically.
</details>

<details>
<summary><strong>Can I undo a conversion?</strong></summary>

Yes! Use `Ctrl+Z` or "Reverse convert" command.
</details>

<details>
<summary><strong>Does it handle calc() correctly?</strong></summary>

Yes, with SCSS interpolation enabled: `calc(100% - #{rem(20)})`
</details>

---

## 📞 Support

- **GitHub**: [Issues & Discussions](https://github.com/your-username/px-to-rem-converter)
- **Marketplace**: [Reviews & Questions](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
- **Email**: support@example.com

---

## 📜 License

MIT License - Free for personal and commercial use

---

## 🎉 Credits

Created with ❤️ by [Your Name]  
**Made in Germany** 🇩🇪 | **For the World** 🌍

---

**[⬆ Back to Top](#px-to-rem-converter)**
