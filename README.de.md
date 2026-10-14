# PX to REM Toolkit

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/LouisMudrack.px-to-rem-function?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![Installationen](https://img.shields.io/visual-studio-marketplace/i/LouisMudrack.px-to-rem-function)](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function)
[![CI](https://github.com/louis-mudrack/px-to-rem/actions/workflows/ci.yml/badge.svg)](https://github.com/louis-mudrack/px-to-rem/actions/workflows/ci.yml)
[![English](https://img.shields.io/badge/lang-en-red.svg)](README.md)

**Skalierbares CSS ohne Fleißarbeit.** Wandelt `px` in `rem`, `em`, `vw` oder deine eigene `rem()`-Funktion um – mit der passenden Einheit für jede Eigenschaft, überall dort, wo CSS steht, und mit Prüfungen, die dafür sorgen, dass es so bleibt.

```scss
// Vorher                               // Nachher (Strg+Alt+R)
.card {                                 .card {
  font-size: 18px;                        font-size: 1.125rem;
  line-height: 27px;                      line-height: 1.5;          // einheitenlos, aus der Schriftgröße
  letter-spacing: 0.9px;                  letter-spacing: 0.05em;    // em, wächst mit dem Text
  padding: 16px 24px;                     padding: 1rem 1.5rem;
  border: 1px solid;                      border: 1px solid;         // Haarlinien bleiben scharf
  @media (min-width: 768px) {             @media (min-width: 48em) { // em: folgt der Schriftgröße der Nutzer
    font-size: 24px;                        font-size: 1.5rem;
  }                                       }
}                                       }
```

## Highlights

- **Smarte Einheiten pro Eigenschaft** – rem für Größen, einheitenlose line-height, em für letter-spacing, px für Rahmen, em für Breakpoints. Jede Entscheidung wird im Hover erklärt.
- **Liest dein Projekt** – findet `html { font-size: 62.5% }`, deine `rem()`-Hilfsfunktion, den `rootValue` von postcss-pxtorem, Design Tokens und Tailwind. Ohne Einrichtung.
- **Überall, wo CSS steht** – CSS, SCSS, Sass, Less, Stylus, PostCSS, `<style>`-Blöcke und `style=""` in HTML, Vue, Svelte, Astro und PHP, styled-components-/emotion-Templates, React-Style-Objekte und Tailwind-Arbitrary-Values (`p-[16px]` → `p-4`).
- **Fluide Typografie** – `clamp()` erzeugen, Media-Query-Overrides zu einem fluiden Wert zusammenführen und sehen, was ein `clamp()`/`calc()` an jedem Breakpoint ergibt.
- **Barrierefreiheits-Prüfung** – WCAG-1.4.4-Prüfungen für px-Schriftgrößen, px-Zeilenhöhen, feste Höhen bei Text, reine Viewport-Schriftgrößen und fluide Schrift, die mit Browser-Zoom keine 200 % erreicht.
- **Design Tokens** – Werte an deine Abstands- und Schriftskala anpassen, Werte außerhalb der Skala und fast passende Farben markieren oder aus den bereits verwendeten Werten eine Token-Datei erzeugen.
- **Sichere Migrationen** – Umwandlung des Arbeitsbereichs über die Refactoring-Vorschau von VS Code, git-basierter Modus „nur geänderte Zeilen“, Fortschrittsansicht und Werte-Audit-Dashboard.
- **Dieselben Regeln in der CI** – die [`px-to-rem`-CLI](cli/README.md) führt dieselbe Engine und deine `.pxtoremrc.json` in Pipelines und Pre-Commit-Hooks aus.

Läuft in VS Code 1.97+, Cursor, VSCodium und auf [vscode.dev](https://vscode.dev). Oberfläche auf Deutsch, Englisch, Französisch, Spanisch, Italienisch, Portugiesisch (Brasilien), Japanisch, Chinesisch (vereinfacht) und Koreanisch.

---

## Schnellstart

1. Aus dem [Marketplace](https://marketplace.visualstudio.com/items?itemName=LouisMudrack.px-to-rem-function) installieren oder `code --install-extension LouisMudrack.px-to-rem-function` ausführen.
2. Ein Stylesheet öffnen und **Strg+Alt+R** drücken (macOS **⌃⌘R**). Mit einer Auswahl wird nur die Auswahl umgewandelt, sonst die ganze Datei – in einem Rückgängig-Schritt.
3. Optional: **PX to REM: Projekt einrichten…** ausführen, um zu sehen, was erkannt wurde, und eine gemeinsame `.pxtoremrc.json` zu speichern.

| Tastenkürzel | Aktion |
|---|---|
| `Strg+Alt+R` / `⌃⌘R` | Auswahl oder Datei umwandeln |
| `Strg+Alt+U` / `⌃⌘U` | Wert am Cursor durchschalten: `16px` → `1rem` → `1em` → `1.1111vw` → Token → `16px` |
| `Umschalt+Alt+Bild↑` / `Bild↓` | Wert auf deiner Token-Skala (oder einem 4px-/Schriftraster) eine Stufe hoch oder runter |
| `Strg+.` | Quick Fixes: andere Einheiten, Tokens, an Skala anpassen, Regel/Datei umwandeln, Zeile ignorieren |

Die Tastenkürzel gelten nur in unterstützten Dateien. Alles findest du auch im Kontextmenü des Editors (**PX to REM**) und im Menü der Statusleiste (Klick auf `16px · 12 px`).

> **Update von 1.x?** `Strg+K` wandelt nicht mehr um (es blockierte alle `Strg+K …`-Tastenfolgen von VS Code). Siehe [Umstieg von 1.x](#umstieg-von-1x).

---

## Wie Werte umgewandelt werden

### Smart-Modus (Standard)

| Eigenschaft | Wird zu | Warum |
|---|---|---|
| `font-size`, Abstände, Größen, Radien | `rem` (oder dein Format) | Folgt der im Browser eingestellten Schriftgröße |
| `line-height` | einheitenlos `1.5` | Wächst mit der Schriftgröße des Elements; braucht die Schriftgröße der Regel |
| `letter-spacing`, `word-spacing`, `text-underline-offset` | `em` | Bleibt proportional zum Text |
| `border*`, `outline*`, `box-shadow`, `text-shadow`, `filter` | bleibt `px` | Haarlinien und Schatten sollen scharf bleiben |
| Werte bis `1px` (`hairline`) | bleibt `px` | 1px-Korrekturen und Trennlinien |
| `@media` / `@container` | `em` | Breakpoints beziehen sich auf die Browser-Standardgröße (16px), nicht auf deine `html`-Schriftgröße |
| Breakpoint-Mixins (`@include mq($from: 768px)`) | unverändert | Das Mixin entscheidet |

Die Schriftgröße eines Elements wird über die Regel selbst, `font`-Kurzschreibweisen, Verschachtelung und Selektoren wie `&:hover` ermittelt. Ist sie nicht bestimmbar, wird rem verwendet. Jede Regel lässt sich mit `pxToRem.smartRules` ändern, z. B. `{ "border": "convert", "letter-spacing": "rem" }`; mit `pxToRem.mode: "simple"` wird alles gleich umgewandelt.

### Ausgabeformate

`pxToRem.format` (pro Sprache einstellbar mit `"[scss]": { "pxToRem.format": … }`):

| Format | Aus `16px` wird |
|---|---|
| `auto` (Standard) | `rem(16)` in Sass/Less/Stylus, wenn das Projekt eine `rem()`-Funktion definiert, sonst `1rem` |
| `rem` | `1rem` |
| `rem-function` / `rem-function-px` | `rem(16)` / `rem(16px)` |
| `em`, `vw`, `vh`, `vmin`, `vmax`, `rpx`, `pt` | relativ zur Schriftgröße des Elements bzw. zu `designWidth`/`designHeight` |
| beliebiges Template | z. B. `toRem({px})`, `{rem}rem`, `calc({px} * var(--unit))` |

Funktionsformate werden nie in reines CSS, Inline-Styles, JS-Objekte oder Tailwind-Klassen geschrieben (dort wären sie ungültig); in styled-components-Templates werden sie zu `${rem(16)}`. Mit `interpolateInCalc` erhält Sass innerhalb von `calc()` ein `#{rem(16)}`.

### Was nie angefasst wird

Kommentare, Strings, `url()`, Selektoren und Klassennamen (`.mt-16px`), Werte, die bereits an `rem()` übergeben werden, Sass-`@function`-Rümpfe und Kontrollstrukturen, Interpolation, großgeschriebenes `PX` (der Opt-out von postcss-pxtorem) und Zeilen, die du deaktivierst:

```css
.legacy {
  /* px-to-rem-disable-next-line */
  width: 320px;
  height: 200px; /* px-to-rem-disable-line */
}
/* px-to-rem-disable */
.email-table { padding: 8px; }
/* px-to-rem-enable */
```

`// …`-Kommentare funktionieren in Sass, Less, Stylus und JS, `<!-- px-to-rem-disable-next-line -->` in HTML. `px-to-rem-disable-file` überspringt eine Datei. Auch `pxtorem-disable-next-line` von postcss-pxtorem wird verstanden.

### Root-Schriftgröße

1rem wird in dieser Reihenfolge ermittelt: ein explizites `pxToRem.baseFontSize` (Einstellungen oder `.pxtoremrc.json`), der `rootValue` von postcss-pxtorem, `html`-/`:root`-Schriftgrößen in deinen Stylesheets (`62.5%` → 10px), sonst 16px. Die Statusleiste zeigt den Wert und seine Herkunft. **rem-Werte neu berechnen (Root-Schriftgröße ändern)…** schreibt beim Wechsel der Root-Schriftgröße (z. B. Abschied vom 62.5-%-Trick) alle rem-Werte im Projekt so um, dass sich optisch nichts ändert.

---

## Überall, wo CSS steht

| Wo | Beispiel |
|---|---|
| Stylesheets | `.css`, `.scss`, `.sass`, `.less`, `.styl`, `.pcss` (inklusive eingerücktem Sass und Stylus) |
| Markup | `<style lang="scss">`-Blöcke und `style=""` in HTML, Vue, Svelte, Astro, PHP, Blade, Twig, Handlebars, Liquid… |
| CSS-in-JS | ``styled.div`…` ``, ``styled(Button).attrs(…)`…` ``, ``css`…` ``, ``createGlobalStyle`…` ``, ``keyframes`…` `` |
| Style-Objekte | `{ fontSize: '16px' }` → `{ fontSize: '1rem' }`; mit `js.unitlessNumbers` auch `{ width: 320 }` → `{ width: '20rem' }` (nie in React-Native-Projekten) |
| Tailwind | `p-[16px]` → `p-4`, `text-[14px]` → `text-sm`, `w-[13px]` → `w-[0.8125rem]`; `@apply`, Varianten und `!important` bleiben erhalten |

---

## Fluide Typografie und clamp()

- **Wert mit clamp() fluid machen…** fragt nach kleiner und großer Größe sowie dem Viewport-Bereich und schreibt `clamp(1rem, 0.8239rem + 0.7512vw, 1.5rem)`. Mit `fluid.unit: "cqi"` skaliert der Wert mit Containern.
- **Breakpoints zusammenführen** (Quick Fix auf einer Deklaration) macht aus `font-size: 16px` plus `@media (min-width: 1024px) { font-size: 24px }` ein einziges `clamp()` und entfernt die Overrides – verschachtelt oder in eigenen Media-Blöcken, mobile-first oder desktop-first.
- **Hover über `clamp()`, `calc()`, `min()` oder `max()`** zeigt eine Tabelle der Werte an jedem Breakpoint und ob der Text mit Browser-Zoom noch 200 % erreicht.

## Barrierefreiheits-Prüfung

Diagnosen erklären, *warum* ein Wert Nutzern schadet, und bringen Quick Fixes mit. Alle Regeln und Schweregrade lassen sich in `pxToRem.diagnostics.rules` einstellen; siehe [Regelreferenz](docs/rules.md) (Englisch).

| Regel | Standard | Findet |
|---|---|---|
| `font-size-px` | information | px-Schriftgrößen ignorieren die Browser-Schriftgröße (WCAG 1.4.4) |
| `line-height-px` | information | px-Zeilenhöhen wachsen nicht mit dem Text |
| `letter-spacing-px` | hint | px-letter-spacing skaliert nicht mit der Schrift |
| `media-query-px` | hint | px-Breakpoints ignorieren die Schriftgröße der Nutzer |
| `fixed-height-text` | hint | feste Höhen schneiden vergrößerten Text ab (WCAG 1.4.4, 1.4.12) |
| `text-width-px` | hint | px-max-width bei Text wächst nicht mit der Schrift |
| `viewport-font-size` | warning | Schriftgrößen nur aus `vw` lassen sich nicht zoomen |
| `fluid-zoom` | warning | fluide Schriftgrößen, die mit Zoom keine 200 % erreichen |
| `off-scale` | hint | Werte außerhalb deiner Token-Skala, mit Quick Fixes zum Anpassen |
| `off-palette` | hint | Farben, die fast einem Farb-Token entsprechen |
| `rem-function-missing` | warning | `rem()` wird verwendet, ist aber nirgends definiert – mit Generator |
| `px-unit` | off | jeder umwandelbare px-Wert |

Mit `"diagnostics.scope": "changedLines"` wird nur auf Zeilen gemeldet, die seit dem letzten Commit geändert wurden.

## Design Tokens

Tokens werden aus CSS Custom Properties (`:root`, `html`, Themes, Tailwind v4 `@theme`), Sass-/Less-/Stylus-Variablen und Sass-Maps sowie aus JSON-Token-Dateien (W3C DTCG inklusive 2025er-Format, Tokens Studio, Style Dictionary) gelesen. Gib die Dateien mit `tokens.sources` an oder lass sie automatisch finden.

- Hover über einen px-Wert zeigt das passende Token oder die Tokens drumherum.
- Quick Fixes und Vervollständigungen bieten `var(--space-4)`, `$space-md`, `map.get($spacing, md)` an.
- `tokens.preferTokens: true` wandelt exakte Treffer in das Token statt in rem um.
- **Eine Stufe hoch/runter** bewegt sich entlang deiner Skala; fast passende Farben bekommen einen Fix.
- **Design Tokens aus verwendeten Werten generieren…** schlägt Abstands-, Schrift- und Radius-Skalen aus deinem Code vor und schreibt CSS, Sass, Sass-Maps, Less, Stylus, Tailwind v4 `@theme` oder DTCG-JSON.

## Eine Codebasis migrieren

- **Arbeitsbereich umwandeln…** – alle Dateien, ein Ordner, ein Dateityp, geänderte Dateien oder nur geänderte Zeilen. Jede Änderung erscheint in der **Refactoring-Vorschau** von VS Code, wo du vor dem Anwenden alles abwählen kannst; ein Rückgängig macht alles rückgängig.
- **Beim Speichern umwandeln** – `pxToRem.convertOnSave` oder `"source.pxToRem.convert": "explicit"` in `editor.codeActionsOnSave`.
- **Als rem einfügen** – beim Einfügen von CSS aus Figma oder den DevTools gibt es im Einfügemenü eine umgewandelte Variante (`paste.mode: "default"` stellt sie an die erste Stelle).
- **PX-to-REM-Ansicht** (Explorer) – Dateien mit verbleibenden px-Werten und der Anteil bereits skalierender Längen, mit täglichem Verlauf.
- **Werte-Audit-Dashboard** – alle verwendeten Abstände, Größen, Schriftgrößen und Radien, Ausreißer außerhalb des Rasters mit Links, Rastertreue, die Schriftskala deiner Größen und vorgeschlagene Tokens.

---

## Konfiguration

Einstellungen liegen in VS Code (`pxToRem.*`) und – für das ganze Team und die CLI – in `.pxtoremrc.json` im Projektstamm (JSON mit Kommentaren, validiert und mit Autovervollständigung):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/louis-mudrack/px-to-rem/master/schemas/pxtoremrc.schema.json",
  "mode": "smart",
  "format": "auto",
  "minValue": 2,
  "tokens": { "sources": ["src/styles/tokens.scss", "tokens/*.json"], "preferTokens": true },
  "diagnostics": { "scope": "changedLines", "rules": { "font-size-px": "warning" } },
  "overrides": [
    { "files": "src/emails/**", "excludeProperties": ["*"] },
    { "files": "**/*.styl", "format": "rem" }
  ]
}
```

Reihenfolge: Standardwerte → Benutzer → Arbeitsbereich → Ordner-Einstellungen → `.pxtoremrc.json` → passende `overrides` → Deaktivierungs-Kommentare.

Alle Einstellungen sind in der Einstellungsoberfläche unter **PX to REM** beschrieben; die wichtigsten stehen im [englischen README](README.md#configuration).

## Kommandozeile

```bash
npx px-to-rem-toolkit check "src/**/*.{css,scss,vue}"   # Exit-Code 1, wenn etwas zu tun ist
npx px-to-rem-toolkit fix                               # direkt umwandeln
npx px-to-rem-toolkit check --changed --reporter github # PR-Annotationen, nur geänderte Zeilen
npx px-to-rem-toolkit report                            # Anteil, Raster, Schriftskala, Ausreißer, Token-Vorschläge
```

Beispiele für CI und Pre-Commit stehen im [CLI-README](cli/README.md).

---

## Umstieg von 1.x

| 1.x | 2.0 |
|---|---|
| `Strg+K` wandelte die Datei um | `Strg+Alt+R` / `⌃⌘R`, nur in unterstützten Dateien (`Strg+K`-Tastenfolgen funktionieren wieder) |
| `Strg+Umschalt+K` wandelte die Auswahl um | `Strg+Alt+R` wandelt die Auswahl um, wenn es eine gibt |
| `Strg+Ä` wandelte in `rem(16px)` um | `format: "rem-function-px"` oder der Befehl **px in rem(Npx) umwandeln** |
| `directConversion`, `keepPxInRem` | `format` (wird weiterhin gelesen: `true` → `rem`, `keepPxInRem` → `rem-function-px`) |
| `scssInterpolation` | `interpolateInCalc` (wird weiterhin gelesen) |
| `enableDiagnostics`, `diagnosticSeverity` | `diagnostics.rules["px-unit"]` (wird weiterhin gelesen) |
| `enableCodeLens`, `enableInlayHints` | `codeLens`, `inlayHints.enable` (wird weiterhin gelesen) |
| `useDynamicBaseFontSize`, `baseFontSizeFile`, `baseFontSizeVariable` | Entfernt. Die Root-Schriftgröße wird automatisch erkannt; mit `baseFontSize` lässt sie sich festlegen |
| Einstellungen exportieren/importieren | `.pxtoremrc.json` (die Befehle erstellen und befüllen sie jetzt) |
| `0px` → `rem(0)` | `0` (`preserveZero` ist jetzt standardmäßig `true`) |
| Alles wurde gleich umgewandelt | Standardmäßig Smart-Modus; `"mode": "simple"` stellt das alte Verhalten her |
| Standardmäßig `rem(16)` | `auto`: `rem(16)` nur, wo dein Projekt `rem()` definiert; mit `"format": "rem-function"` immer |

## FAQ

<details>
<summary>Warum werden Rahmen und Media Queries nicht in rem umgewandelt?</summary>

Ein 1px-Rahmen, der beim Vergrößern der Schrift auf 2px wächst, sieht kaputt aus und verbessert die Lesbarkeit nicht. Media Queries sind ein Sonderfall: Dort bedeuten rem und em beide die Browser-Standardgröße (16px), egal was `html { font-size }` sagt – ein mit 10px-Root umgewandelter Breakpoint würde sich also unbemerkt verschieben. Der Smart-Modus verwendet deshalb em relativ zur Browser-Standardgröße. Beides lässt sich ändern.
</details>

<details>
<summary>Mein Build nutzt schon postcss-pxtorem. Brauche ich das?</summary>

Die Erweiterung liest den `rootValue` des Plugins, damit Editor und Build übereinstimmen, und die Statusleiste weist darauf hin, dass zusätzlich beim Build umgewandelt wird. Viele Teams wandeln trotzdem im Quelltext um, damit Code-Reviews, Design Tokens und Hovers die echten Einheiten zeigen.
</details>

<details>
<summary>Funktioniert das ohne installierte Sass-, Vue- oder Svelte-Erweiterung?</summary>

Ja. Dateien werden über ihre Endung erkannt, wenn VS Code keine Sprache für sie kennt.
</details>

## Mitmachen

Issues und Pull Requests sind auf [GitHub](https://github.com/louis-mudrack/px-to-rem) willkommen. `npm ci && npm run check` führt Typprüfung, Lint, Unit-Tests und Build aus; `npm run test:integration` startet die Erweiterung in VS Code. Die Architektur ist in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) beschrieben. Übersetzungen liegen in `l10n/` und `package.nls.*.json` – Korrekturen von Muttersprachlern sind sehr willkommen.

## Lizenz

[MIT](LICENSE.md)
