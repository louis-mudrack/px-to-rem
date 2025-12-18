# PX zu REM Konverter

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![English](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![Sprache](https://img.shields.io/badge/lang-de-green.svg)](README.de.md)

> Professionelle VSCode Extension, die automatisch `px`-Werte in `rem()`-Funktionen umwandelt mit nützlichen Features.

## ✨ Features

### 🎯 Basis-Konvertierung
- **Zwei Konvertierungs-Modi**: `rem(10)` oder `rem(10px)` per Hotkey
- **Direct Conversion**: Direkte Umrechnung `16px` → `1rem`
- **SCSS Interpolation**: Automatische `#{}` Wrapper in `calc()`
- **Intelligente Erkennung**: Überspringt bereits konvertierte Werte
- **Negative Werte & Dezimalzahlen**: Vollständig unterstützt
- **Zero Preservation**: Optional `0px` als `0` behalten

### 🔍 Erweiterte Filterung
- **Min/Max Filter**: Nur Werte in bestimmtem Bereich konvertieren
- **Selektive Properties**: Include/Exclude spezifische CSS Properties
- **Clamp() Support**: Automatische Erkennung von clamp()-Funktionen
- **Exclude-Patterns**: Zeilen mit Regex-Patterns überspringen
- **Datei-Ignoring**: Dateien mit Glob-Patterns ausschließen (z.B. `**/*.min.css`)
- **Dateityp-Auswahl**: Nur bestimmte Dateitypen konvertieren

### 🎨 UI & UX
- **Status Bar Integration**: Live px-Count mit Click-to-Convert
- **Hover Preview**: Vorschau beim Hover über px-Werte
- **Code Lens**: Inline "Convert" Buttons über Zeilen (umschaltbar)
- **Quick Fix Provider**: 💡 Glühbirne mit Konvertierungs-Optionen (Strg+.)
- **Diagnostic Provider**: Unterstreicht px-Werte mit Warnungen/Hints
- **Statistiken**: Detaillierte Konvertierungs-Statistiken mit Timing
- **Konfigurations-Profile**: Schnell-Wechsel zwischen 4 Presets

### 📦 Batch-Operationen
- **Workspace-Konvertierung**: Alle Dateien auf einmal mit Filterung
- **Dateityp-Konvertierung**: Nur bestimmte Dateitypen konvertieren (CSS, SCSS, etc.)
- **Selektions-Konvertierung**: Nur ausgewählten Code konvertieren
- **Rückwärts-Konvertierung**: rem zurück zu px für Rollback
- **Export/Import Settings**: Config mit Team teilen
- **Progress-Indikator**: Live-Fortschritt bei großen Operationen
- **Auto-Save**: Automatisches Speichern nach Konvertierung

### 🌍 Internationalisierung
- **Mehrsprachige Unterstützung**: Deutsch & Englisch (mehr kommen!)
- **Auto-Erkennung**: Nutzt automatisch deine VSCode-Sprache
- **Vollständig Lokalisiert**: Alle UI-Elemente, Messages und Commands

## 📦 Installation

### Aus VSCode Marketplace
1. Öffne VSCode
2. Drücke `Strg+P` (Windows/Linux) oder `Cmd+P` (Mac)
3. Tippe: `ext install LouisMudrack.px-to-rem-converter`
4. Drücke Enter

### Aus Quellcode
```bash
cd px-to-rem-converter
npm install
npm run compile
```

## 🎯 Verwendung

### Standard Hotkeys
- **Windows/Linux**: 
  - `Strg+K` - Konvertiert zu `rem(10)` (ohne px)
  - `Strg+Ä` - Konvertiert zu `rem(10px)` (mit px)
  - `Strg+Shift+K` - Nur Selektion konvertieren
- **Mac**: 
  - `Cmd+K` - Konvertiert zu `rem(10)` (ohne px)
  - `Cmd+Ä` - Konvertiert zu `rem(10px)` (mit px)
  - `Cmd+Shift+K` - Nur Selektion konvertieren

**Hinweis:** `Strg+Ä` funktioniert nur auf deutschen Tastaturen.

### Via Command Palette
1. Öffne Command Palette (`Strg+Shift+P` / `Cmd+Shift+P`)
2. Suche nach:
   - "PX zu REM: Konvertieren (ohne px)" → `rem(10)`
   - "PX zu REM: Konvertieren (mit px)" → `rem(10px)`
   - "PX zu REM: Nur Selektion konvertieren" → Nur ausgewählte Zeilen
   - "PX zu REM: Alle Dateien eines bestimmten Types" → Dateityp-Auswahl
3. Drücke Enter

## ⚙️ Konfiguration

### Settings

In deiner `settings.json`:

```json
{
  // Konvertierung
  "pxToRem.directConversion": false,
  "pxToRem.baseFontSize": 16,
  "pxToRem.keepPxInRem": false,
  "pxToRem.preserveZero": true,
  "pxToRem.scssInterpolation": false,
  
  // Datei-Filterung (NEU!)
  "pxToRem.excludeFiles": [
    "**/*.min.*",
    "**/vendor/**",
    "**/node_modules/**"
  ],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Wert-Filter
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

## 📝 Beispiele

### Vorher
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

### Nachher (Strg+K - ohne px)
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

### Nachher (Strg+Ä - mit px)
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

### Mit Direct Conversion
```css
.container {
  width: 75rem;        /* 1200 / 16 */
  padding: 1.25rem 2.5rem;
  margin: 0 auto;
  font-size: 1rem;     /* 16 / 16 */
  line-height: 1.5rem;
}
```

## 🚀 Neue Marketplace-Features

### 1. Datei-Ignoring
Ignoriere bestimmte Dateien bei Batch-Konvertierung:

```json
{
  "pxToRem.excludeFiles": [
    "**/*.min.css",          // Minifizierte Dateien
    "**/vendor/**",          // Third-party Code
    "**/node_modules/**",    // Dependencies
    "**/legacy/**"           // Alter Code
  ]
}
```

### 2. Dateityp-Auswahl
Konvertiere nur bestimmte Dateitypen:

```
Command: "PX zu REM: Alle Dateien eines bestimmten Types"
→ Wähle: SCSS
→ Nur .scss Dateien werden konvertiert!
```

### 3. Mehrsprachige Unterstützung
Extension nutzt automatisch deine VSCode-Sprache:
- 🇩🇪 Deutsch (Komplett)
- 🇬🇧 English (Komplett)
- 🌍 Weitere Sprachen willkommen!

## 💡 Anwendungsfälle

### Großes Projekt mit Vendor-Code
```json
{
  "pxToRem.excludeFiles": [
    "**/vendor/**",
    "**/*.min.*"
  ]
}
```
→ Nur dein eigener Code wird konvertiert!

### Schrittweise Migration
```
1. Command: "Alle SCSS Dateien konvertieren"
2. Review & Test
3. Später: "Alle CSS Dateien konvertieren"
```
→ Sichere, kontrollierte Migration!

### Internationales Team
```
🇩🇪 Deutscher Dev → Deutsche UI
🇬🇧 Englischer Dev → Englische UI
```
→ Jeder sieht die Extension in seiner Sprache!

## 🎮 Alternative Workflows

### 1. Command Palette
```
Strg+Shift+P → "PX zu REM"
```
Zeigt alle verfügbaren Commands!

### 2. Code Lens (Click)
```css
$(symbol-property) 3 px-Werte zu rem konvertieren  ← Click!
font-size: 16px;
```

**Deaktivieren:**
```json
{
  "pxToRem.enableCodeLens": false
}
```

### 3. Quick Fix (Strg+.)
```css
font-size: 16px;  💡
           ↓ Strg+.
[Konvertieren zu 1rem]
[Konvertieren zu rem(16)]
[Konvertieren zu rem(16px)]
```

## 🤝 Mitwirken

### Neue Sprache hinzufügen
1. Erstelle `/src/locales/[code].json`
2. Kopiere Struktur von `en.json`
3. Übersetze alle Strings
4. Pull Request!

### Issues melden
Bug gefunden? Verbesserungsvorschlag?
- [GitHub Issues](https://github.com/louis-mudrack/px-to-rem)
- Marketplace Reviews

## 🔧 Entwicklung

```bash
# Dependencies installieren
npm install

# Kompilieren
npm run compile

# Watch Mode
npm run watch

# Paketieren
npm run vscode:prepublish
vsce package
```

## 📊 Statistiken

- **18+ Kern-Features**
- **3 Marketplace-Features**
- **2 Sprachen** (DE + EN)
- **1100+ Zeilen** TypeScript
- **Production-Ready**

## ⭐ Warum diese Extension?

- ✅ **International**: Mehrsprachige Unterstützung
- ✅ **Team-Freundlich**: Export/Import Settings
- ✅ **Sicher**: Datei-Ignoring für Vendor-Code
- ✅ **Flexibel**: Multiple Konvertierungs-Modi
- ✅ **Gut Dokumentiert**: Umfassende Guides
- ✅ **Aktive Entwicklung**: Regelmäßige Updates
