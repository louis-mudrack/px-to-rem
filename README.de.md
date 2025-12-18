# PX zu REM Konverter

[![Version](https://img.shields.io/badge/version-1.1.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Installationen](https://img.shields.io/visual-studio-marketplace/i/LouisMudrack.px-to-rem-function.svg)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![English](https://img.shields.io/badge/lang-en-red.svg)](README.md)
[![Sprache](https://img.shields.io/badge/lang-de-green.svg)](README.de.md)

> Professionelle VSCode Extension, die automatisch `px`-Werte in `rem()`-Funktionen umwandelt mit Enterprise-Features. Perfekt für Teams und große Projekte.

**Features:** Datei-Ignoring • Typ-Auswahl • Mehrsprachig • 18+ Konvertierungs-Features • Code Lens • Quick Fix • Batch-Operationen

---

## 📦 Installation

### Aus VSCode Marketplace (Empfohlen)

**Methode 1: VSCode UI**
1. Öffne VSCode
2. Gehe zu Extensions (`Strg+Shift+X` / `Cmd+Shift+X`)
3. Suche nach "PX to REM Converter"
4. Klicke auf **Installieren**

**Methode 2: Kommandozeile**
```bash
code --install-extension LouisMudrack.px-to-rem-function
```

**Methode 3: Quick Open**
1. Drücke `Strg+P` (Windows/Linux) oder `Cmd+P` (Mac)
2. Tippe: `ext install LouisMudrack.px-to-rem-function`
3. Drücke Enter

---

## 🚀 Quick Start

### 1️⃣ Öffne eine CSS/SCSS Datei
```css
.container {
  font-size: 16px;
  padding: 20px;
  margin: 10px 0;
}
```

### 2️⃣ Drücke `Strg+K` (Windows/Linux) oder `Cmd+K` (Mac)

### 3️⃣ Fertig! 
```css
.container {
  font-size: rem(16);
  padding: rem(20);
  margin: rem(10) 0;
}
```

**Das war's!** ✨

---

## ⌨️ Tastenkürzel

| Shortcut | Aktion | Ergebnis |
|----------|--------|----------|
| **`Strg+K`** | Gesamte Datei konvertieren | `rem(16)` |
| **`Strg+Ä`** | Mit px-Einheit konvertieren | `rem(16px)` |
| **`Strg+Shift+K`** | Nur Selektion konvertieren | Nur ausgewählte Zeilen |
| **`Strg+.`** | Quick Fix Menü | Mehrere Optionen |

**Mac:** Ersetze `Strg` mit `Cmd`

**Hinweis:** `Strg+Ä` funktioniert auf deutschen Tastaturen. Für andere Layouts:
1. Öffne Tastenkürzel (`Strg+K Strg+S`)
2. Suche nach "px-to-rem.convertWithPx"
3. Ändere zu deinem bevorzugten Shortcut (z.B. `Strg+Alt+P`)

---

## ✨ Features

### 🎯 Basis-Konvertierung
- **Zwei Modi**: `rem(10)` oder `rem(10px)` per Hotkey
- **Direct Conversion**: `16px` → `1rem` (konfigurierbare Basis-Schriftgröße)
- **SCSS Interpolation**: Automatische `#{}` Wrapper in `calc()`
- **Intelligente Erkennung**: Überspringt bereits konvertierte Werte
- **Clamp() Support**: Konvertiert Werte in clamp-Funktionen
- **Negative & Dezimalzahlen**: `-16px`, `16.5px` vollständig unterstützt
- **Zero Preservation**: Optional `0px` als `0` behalten

### 🔍 Erweiterte Filterung
- **Min/Max Bereich**: Nur Werte zwischen min und max konvertieren
- **Property-Filter**: Include/Exclude spezifische CSS Properties
- **Zeilen-Patterns**: Zeilen mit Regex-Patterns überspringen
- **Datei-Ignoring**: Dateien mit Glob-Patterns ausschließen
- **Typ-Auswahl**: Nur bestimmte Dateitypen konvertieren

### 🎨 UI-Features
- **Inlay Hints**: Permanente graue px-Anzeige neben rem (z.B., `2rem → 32px`)
- **Status Bar**: Live px-Count mit Click-to-Convert
- **Code Lens**: Inline "N px-Werte konvertieren" Buttons (umschaltbar)
- **Quick Fix**: 💡 Glühbirne mit 3 Format-Optionen (`Strg+.`)
- **Hover Vorschau**: Zeigt Konvertierungs-Vorschau beim Hovern
- **Diagnostics**: Unterstreicht px-Werte (konfigurierbare Schwere)
- **Statistiken**: Detaillierte Berichte mit Timing

### 📦 Batch-Operationen
- **Workspace-Konvertierung**: Alle Dateien auf einmal
- **Typ-Spezifisch**: Nur CSS, oder nur SCSS, etc.
- **Selektions-Konvertierung**: Nur ausgewählten Code
- **Rückwärts-Konvertierung**: rem → px für Rollback
- **Export/Import**: Settings mit Team teilen

### 🌍 International
- **Deutsch** & **Englisch** UI (automatisch erkannt)
- Alle Meldungen, Commands und Dialoge lokalisiert
- Weitere Sprachen: Community Beiträge willkommen!

### ⚙️ Dynamische Konfiguration
- **Dynamische Base Font Size**: Aus SCSS/CSS Variablen auslesen
- **Live Updates**: Automatische Aktualisierung bei Variablen-Änderung
- **Flexibles Format**: Unterstützt `$base-font-size: 20` oder `20px`

---

## ⚙️ Konfiguration

### Wichtige Settings

```json
{
  // Konvertierungs-Modus
  "pxToRem.directConversion": false,        // false = rem(16), true = 1rem
  "pxToRem.baseFontSize": 16,               // Basis-Größe für Berechnungen
  
  // Dynamische Base Font Size
  "pxToRem.useDynamicBaseFontSize": false,  // Aus SCSS/CSS Datei auslesen
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size",
  
  // Inlay Hints
  "pxToRem.enableInlayHints": true,         // Zeigt "2rem → 32px" in grau
  
  // Datei-Filterung
  "pxToRem.excludeFiles": [
    "**/*.min.css",                         // Minifizierte Dateien ignorieren
    "**/vendor/**",                         // Vendor-Code ignorieren
    "**/node_modules/**"                    // Dependencies ignorieren
  ],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Wert-Filterung
  "pxToRem.minValue": 0,                    // Minimaler px-Wert (z.B. 4 um 1-3px zu überspringen)
  "pxToRem.maxValue": 9999,                 // Maximaler px-Wert
  "pxToRem.excludeProperties": [],          // Properties überspringen (z.B. ["border-width"])
  
  // UI
  "pxToRem.enableCodeLens": true,           // Inline Convert-Buttons zeigen
  "pxToRem.enableDiagnostics": false        // px-Werte unterstreichen
}
```

### Alle Settings

<details>
<summary>Klicke um die komplette Settings-Liste zu sehen</summary>

```json
{
  // Konvertierung
  "pxToRem.directConversion": false,
  "pxToRem.baseFontSize": 16,
  "pxToRem.keepPxInRem": false,
  "pxToRem.preserveZero": true,
  "pxToRem.scssInterpolation": false,
  
  // Dynamische Base Font Size
  "pxToRem.useDynamicBaseFontSize": false,
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size",
  
  // Datei-Filterung
  "pxToRem.excludeFiles": [],
  "pxToRem.fileTypes": ["css", "scss", "sass", "less"],
  
  // Wert-Filterung
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

## 📝 Beispiele

### Vorher
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

### Nachher `Strg+K`
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

### Mit Direct Conversion
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

### Mit SCSS Interpolation
```json
{ "pxToRem.scssInterpolation": true }
```
```scss
.hero {
  width: calc(100% - #{rem(40)});    /* Auto-Wrapped in calc() */
  padding: clamp(#{rem(16)}, 2vw, #{rem(32)});
}
```

---

## Zusätzliche Features

### Inlay Hints
Permanenter grauer Text zeigt px-Werte neben rem:

```css
.container {
  font-size: 2rem → 32px;
  padding: 1.5rem → 24px;
  margin: rem(20) → 20px;
}
```

**Verwendung:**
- Standardmäßig aktiviert
- Wird automatisch in CSS/SCSS Dateien angezeigt
- Hover für zusätzliche Infos
- Deaktivieren: `"pxToRem.enableInlayHints": false`

### Dynamische Base Font Size
BaseFontSize aus deinen SCSS/CSS Variablen auslesen:

**variables.scss:**
```scss
$base-font-size: 20;  // oder 20px
```

**settings.json:**
```json
{
  "pxToRem.useDynamicBaseFontSize": true,
  "pxToRem.baseFontSizeFile": "src/styles/variables.scss",
  "pxToRem.baseFontSizeVariable": "$base-font-size"
}
```

**Ergebnis:**
```css
font-size: 2rem → 40px  /* 2 * 20 */
```

**Vorteile:**
- ✅ Single Source of Truth
- ✅ Team-Sync über Git
- ✅ Live-Updates bei Datei-Änderung
- ✅ Funktioniert mit oder ohne px-Einheit

---

## 🎮 Workflows

### Methode 1: Tastenkürzel (Schnellste)
```
Datei öffnen → Strg+K → Fertig!
```

### Methode 2: Code Lens (Visuell)
```css
$(symbol-property) 3 px-Werte zu rem konvertieren  ← Klicken!
font-size: 16px;
padding: 20px;
```
*Erscheint über Zeilen mit px-Werten*

### Methode 3: Quick Fix (Optionen)
```css
font-size: 16px;  💡 ← Strg+. drücken
```
Wähle aus:
- Konvertieren zu `1rem`
- Konvertieren zu `rem(16)`
- Konvertieren zu `rem(16px)`

### Methode 4: Command Palette (Erweitert)
```
Strg+Shift+P → "PX zu REM" eingeben
```
- Gesamte Datei konvertieren
- Selektion konvertieren
- Workspace konvertieren
- Nach Dateityp konvertieren
- Rückwärts konvertieren
- Einstellungen exportieren/importieren

---

## 🚀 Erweiterte Features

### 1. Datei-Ignoring
**Problem:** Vendor-Dateien und minifizierte Dateien werden konvertiert  
**Lösung:** Ignoriere sie!

```json
{
  "pxToRem.excludeFiles": [
    "**/*.min.css",       // Alle minifizierten
    "**/vendor/**",       // Third-party
    "**/legacy/**"        // Alter Code
  ]
}
```

Dann **"Alle Dateien im Workspace konvertieren"** ausführen → Nur deine Dateien werden konvertiert! ✅

---

### 2. Dateityp-Auswahl
**Problem:** Möchte nur SCSS konvertieren, nicht CSS  
**Lösung:** Typ-spezifische Konvertierung!

```
Strg+Shift+P → "PX zu REM: Alle Dateien eines bestimmten Types"
→ Wähle: SCSS
→ Nur .scss Dateien werden konvertiert!
```

Oder Standard-Typen konfigurieren:
```json
{
  "pxToRem.fileTypes": ["scss", "sass"]  // Nur SCSS & Sass
}
```

---

### 3. Selektive Properties
**Beispiel:** Borders in px behalten, alles andere konvertieren

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
/* Vorher */
.box {
  width: 200px;           /* ✅ Wird konvertiert */
  border-width: 2px;      /* ❌ Wird NICHT konvertiert */
  padding: 20px;          /* ✅ Wird konvertiert */
}

/* Nachher */
.box {
  width: rem(200);
  border-width: 2px;      /* Bleibt px! */
  padding: rem(20);
}
```

---

### 4. Min/Max Bereich
**Beispiel:** Nur Werte ab 8px konvertieren

```json
{
  "pxToRem.minValue": 8
}
```

```css
/* Vorher */
.box {
  width: 200px;        /* ✅ Konvertiert (>= 8) */
  border: 2px solid;   /* ❌ Bleibt (< 8) */
  padding: 16px;       /* ✅ Konvertiert (>= 8) */
}

/* Nachher */
.box {
  width: rem(200);
  border: 2px solid;   /* Erhalten! */
  padding: rem(16);
}
```

---

### 5. Konfigurations-Profile
Schnell-Wechsel zwischen 4 Presets:

```
Strg+Shift+P → "PX zu REM: Profil wechseln"
```

**Verfügbare Profile:**
1. **🎨 SCSS Funktion** - `rem(16)` mit SCSS Interpolation
2. **📐 Direct Conversion** - `1rem` direkte Umrechnung
3. **🔧 SCSS mit px** - `rem(16px)` Format
4. **⚡ Minimal** - Nur große Werte (≥8px), ohne Borders

---

### 6. Team-Einstellungen
**Config mit deinem Team teilen:**

```
Strg+Shift+P → "PX zu REM: Einstellungen exportieren"
→ Speichere als px-to-rem-config.json
→ In Git committen
```

**Team-Mitglieder:**
```
Öffne px-to-rem-config.json
→ Strg+Shift+P → "PX zu REM: Einstellungen importieren"
→ Alle haben die gleiche Config! ✅
```

---

## 💡 Anwendungsfälle

### Großes Projekt mit Vendor-Code
```json
{
  "pxToRem.excludeFiles": ["**/vendor/**", "**/*.min.*"]
}
```
**Ergebnis:** Nur dein Code wird konvertiert, Vendor bleibt unberührt

### Schrittweise Migration
```
Woche 1: Alle SCSS Dateien konvertieren
Woche 2: Review & Test
Woche 3: Alle CSS Dateien konvertieren
```
**Ergebnis:** Sichere, kontrollierte Migration

### Design System Regeln
```json
{
  "pxToRem.minValue": 4,
  "pxToRem.excludeProperties": ["border-width", "outline-width"]
}
```
**Ergebnis:** Borders bleiben px, Spacing wird zu rem

### Internationales Team
- 🇩🇪 Deutscher Entwickler → Deutsche UI
- 🇬🇧 Englischer Entwickler → Englische UI
- Extension erkennt VSCode-Sprache automatisch!

---

## 🌍 Mehrsprachige Unterstützung

### Automatische Sprach-Erkennung
Extension nutzt automatisch deine VSCode-Sprache!

**Englische UI:**
```
✅ 23 px values converted to rem(N)!
No active editor found!
```

**Deutsche UI:**
```
✅ 23 px-Werte in rem(N) konvertiert!
Kein aktiver Editor gefunden!
```

### Deine Sprache hinzufügen
Möchtest du eine Übersetzung beitragen?
1. Erstelle `/src/locales/[code].json`
2. Kopiere Struktur von `en.json`
3. Übersetze alle Strings
4. Pull Request einreichen!

**Benötigte Sprachen:** Französisch, Spanisch, Italienisch, Japanisch, Chinesisch, etc.

---

## 🔧 Anpassung

### Tastenkürzel ändern

**Standard-Shortcuts gefallen nicht?** Passe sie an:

1. Öffne Tastenkürzel: `Strg+K Strg+S`
2. Suche nach: `px-to-rem`
3. Klicke auf Stift-Icon zum Ändern

**Beispiel für eigene Shortcuts:**
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

### Code Lens umschalten

**Code Lens Buttons zu aufdringlich?**
```json
{
  "pxToRem.enableCodeLens": false
}
```

### Diagnostics aktivieren

**Möchtest du px-Werte als Warnungen unterstrichen?**
```json
{
  "pxToRem.enableDiagnostics": true,
  "pxToRem.diagnosticSeverity": "warning"  // oder "error", "information", "hint"
}
```

---

## 🎯 Tipps & Tricks

### Tipp 1: Quick Fix zum Testen nutzen
Verschiedene Formate vor dem Committen ausprobieren:
```css
font-size: 16px;  💡 Strg+.
→ "1rem" probieren
→ Rückgängig (Strg+Z)
→ "rem(16)" stattdessen probieren
```

### Tipp 2: Selektion für Teiländerungen konvertieren
```
1. Bestimmte Zeilen selektieren
2. Strg+Shift+K
3. Nur Selektion wird konvertiert!
```

### Tipp 3: Rückwärts-Konvertierung zum Debuggen
```
Strg+Shift+P → "Rückwärts konvertieren"
→ Alle rem() zurück zu px
→ Perfekt zum Debuggen!
```

### Tipp 4: Status Bar Schnellzugriff
Klicke auf **📏 42 px** in der Status Bar → Konvertiert Datei sofort!

### Tipp 5: Workspace-Konvertierung vor Merge
```
1. Git Commit aktueller Stand
2. Workspace konvertieren
3. Review mit Git Diff
4. Committen oder zurücksetzen
```

---

## 🤝 Mitwirken

### Bug gefunden?
- [Auf GitHub melden](https://github.com/your-username/px-to-rem-converter/issues)
- Oder Review auf [Marketplace](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function) hinterlassen

### Feature-Wunsch?
- GitHub Issue öffnen
- Oder für bestehende Anfragen voten

### Übersetzung hinzufügen?
1. Repository forken
2. `/src/locales/[sprache].json` erstellen
3. Alle Strings übersetzen
4. Pull Request!

Wir brauchen: **Französisch, Spanisch, Italienisch, Japanisch, Chinesisch, Koreanisch, Russisch, Portugiesisch, Niederländisch, Polnisch**

---

## 📊 Extension-Statistiken

- **21 Features Gesamt**
- **2 Sprachen** (Deutsch + Englisch)
- **1100+ Zeilen** TypeScript
- **Production-Ready**
- **Enterprise-Grade**
- **Regelmäßige Updates**

---

## ⭐ Warum diese Extension?

✅ **Am Vollständigsten** - 21 Features vs. 3-5 bei anderen Extensions  
✅ **Enterprise-Ready** - Datei-Ignoring, Typ-Auswahl, Team-Einstellungen  
✅ **International** - Mehrsprachige Unterstützung  
✅ **Gut Dokumentiert** - Umfassende Guides  
✅ **Aktive Entwicklung** - Regelmäßige Updates & Bug-Fixes  
✅ **Kostenlos & Open Source** - MIT Lizenz  

---

## 📝 FAQ

<details>
<summary><strong>Kann ich das mit Tailwind CSS nutzen?</strong></summary>

Ja! Aber Vorsicht - Tailwind nutzt px-Werte in Utilities. Erwäge:
```json
{
  "pxToRem.excludeFiles": ["**/tailwind.config.js", "**/utilities/**"]
}
```
</details>

<details>
<summary><strong>Funktioniert es mit CSS-in-JS?</strong></summary>

Ja, für styled-components, emotion, etc. Unterstützt `.jsx` und `.tsx` Dateien.
</details>

<details>
<summary><strong>Werden Werte in Kommentaren konvertiert?</strong></summary>

Nein, Kommentare werden automatisch ignoriert.
</details>

<details>
<summary><strong>Kann ich eine Konvertierung rückgängig machen?</strong></summary>

Ja! Nutze `Strg+Z` oder den "Rückwärts konvertieren" Command.
</details>

<details>
<summary><strong>Behandelt es calc() korrekt?</strong></summary>

Ja, mit aktivierter SCSS Interpolation: `calc(100% - #{rem(20)})`
</details>

---

## 📞 Support

- **GitHub**: [Issues & Discussions](https://github.com/your-username/px-to-rem-converter)
- **Marketplace**: [Reviews & Fragen](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
- **E-Mail**: support@example.com

---

## 📜 Lizenz

MIT Lizenz - Kostenlos für private und kommerzielle Nutzung

---

## 🎉 Credits

Erstellt mit ❤️ von [Dein Name]  
**Made in Germany** 🇩🇪 | **Für die Welt** 🌍

---

**[⬆ Zurück nach oben](#px-zu-rem-konverter)**
