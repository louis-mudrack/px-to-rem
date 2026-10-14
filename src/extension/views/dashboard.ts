import * as vscode from 'vscode';
import { generateTokenFile, tokenNamesFor, type TokenFileFormat } from '../../core/generate';
import { formatNumber } from '../../core/format';
import { MESSAGES } from '../../core/messages';
import type { Services } from '../services';
import type { StatsService } from '../stats';
import { resolveRelative } from './migrationTree';

const FORMATS: { id: TokenFileFormat; label: string; language: string }[] = [
    { id: 'css', label: 'CSS custom properties', language: 'css' },
    { id: 'scss', label: 'Sass variables', language: 'scss' },
    { id: 'scss-map', label: 'Sass maps', language: 'scss' },
    { id: 'less', label: 'Less variables', language: 'less' },
    { id: 'stylus', label: 'Stylus variables', language: 'stylus' },
    { id: 'dtcg', label: 'Design Tokens (W3C DTCG JSON)', language: 'json' },
    { id: 'tailwind-v4', label: 'Tailwind CSS v4 @theme', language: 'css' },
];

/** UI strings for the webview, localized on the extension side. */
function strings(): Record<string, string> {
    const keys = [
        'Show chart', 'Show table', 'Value', 'Uses', 'Files', 'On the 4px grid', 'yes', 'no', 'Off the 4px grid', '{0} most used of {1} values',
        '{0} distinct values', 'Distribution of {0} values', 'uses in {0} files', 'Migration progress', 'Share of lengths that scale with the user font size',
        'Date', 'Scalable', 'px left', 'scalable', 'Scanning workspace…', 'Value audit', 'Refresh', 'Convert workspace…',
        'of lengths scale with the user font size', 'in {0} files', 'Kept on purpose', 'borders, hairlines, opt-outs', 'Scalable values',
        'Root font size', 'Design tokens', 'Grid adherence', '{0} spacing and size values', 'On a 4px grid', 'Values divisible by 4 (2 below 8px).',
        'On an 8px grid', 'Values divisible by 8.', 'Type scale', 'Closest match: {0} ({1}) from {2}px — {3} of sizes fit', 'Off the scale: {0}',
        'Values in use', 'Off-grid values', 'Candidates for snapping to your scale', 'Category', 'Nearest on grid', 'Where', '+{0} more',
        'Proposed design tokens', 'Derived from the values your code already uses', 'Token file format', 'Generate token file', 'Files with px values',
        'Most px values first', 'File', 'Kept',
    ];
    const out: Record<string, string> = {};
    for (const key of keys) {
        out[key] = vscode.l10n.t(key);
    }
    for (const [id, template] of Object.entries(MESSAGES)) {
        if (id.startsWith('category.')) {
            out[id] = vscode.l10n.t(template);
        }
    }
    return out;
}

function nonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
}

const CSS = `
:root {
  --accent: #2a78d6; --muted-mark: #898781; --track: #cde2fb;
  --surface: var(--vscode-editor-background); --ink: var(--vscode-foreground); --ink-2: var(--vscode-descriptionForeground);
  --hairline: color-mix(in srgb, var(--vscode-foreground) 12%, transparent);
  --axis: color-mix(in srgb, var(--vscode-foreground) 28%, transparent);
  --card: color-mix(in srgb, var(--vscode-foreground) 3%, var(--vscode-editor-background));
}
body.vscode-dark { --accent: #3987e5; --muted-mark: #6b6a65; --track: #184f95; }
body.vscode-high-contrast, body.vscode-high-contrast-light {
  --accent: var(--vscode-charts-blue); --muted-mark: var(--vscode-charts-foreground); --track: transparent;
  --hairline: var(--vscode-contrastBorder); --axis: var(--vscode-contrastBorder);
}
body { margin: 0; padding: 0 24px 32px; background: var(--surface); color: var(--ink); font-family: var(--vscode-font-family); font-size: 13px; }
.page { max-width: 1280px; margin: 0 auto; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 20px 0 8px; }
h1 { font-size: 20px; font-weight: 600; margin: 0; }
h2 { font-size: 14px; font-weight: 600; margin: 0; }
h3 { font-size: 12px; font-weight: 600; margin: 12px 0 6px; color: var(--ink-2); }
.section-title { margin: 24px 0 12px; }
.subtitle { color: var(--ink-2); margin: 4px 0 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; border-radius: 2px; padding: 4px 12px; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
button.link { background: none; color: var(--vscode-textLink-foreground); padding: 0; text-align: left; }
button.link:hover { text-decoration: underline; background: none; }
button:focus-visible, select:focus-visible, [tabindex]:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
select { font: inherit; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); padding: 3px 6px; }
.kpis { display: grid; grid-template-columns: minmax(200px, 1fr) 3fr; gap: 16px; margin: 12px 0 16px; }
@media (max-width: 720px) { .kpis { grid-template-columns: 1fr; } }
.hero, .tile, .card { background: var(--card); border: 1px solid var(--hairline); border-radius: 6px; padding: 16px; }
.hero-value { font-size: 48px; font-weight: 600; line-height: 1.1; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
.tile-label { color: var(--ink-2); }
.tile-value { font-size: 22px; font-weight: 600; margin-top: 4px; }
.tile-detail { color: var(--ink-2); margin-top: 2px; font-size: 12px; overflow-wrap: anywhere; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 16px; margin-bottom: 16px; }
.card { margin-bottom: 16px; min-width: 0; }
.grid .card { margin-bottom: 0; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
.legend { display: flex; gap: 16px; flex-wrap: wrap; color: var(--ink-2); margin-bottom: 8px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
.swatch.accent { background: var(--accent); } .swatch.muted { background: var(--muted-mark); }
svg { display: block; overflow: visible; }
.grid line, line.grid { stroke: var(--hairline); stroke-width: 1; }
line.axis { stroke: var(--axis); stroke-width: 1; }
.tick { fill: var(--ink-2); font-size: 11px; font-variant-numeric: tabular-nums; }
.value { fill: var(--ink); font-size: 12px; font-weight: 600; }
.fill-accent { fill: var(--accent); } .fill-muted { fill: var(--muted-mark); }
.mark .hit { fill: transparent; }
.mark .hit.hover { fill: color-mix(in srgb, var(--ink) 6%, transparent); }
.hit { fill: transparent; outline: none; }
path.line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
path.area { fill: var(--accent); opacity: 0.1; }
circle.dot { fill: var(--accent); stroke: var(--surface); stroke-width: 2; }
line.crosshair { stroke: var(--axis); stroke-width: 1; }
.meter { margin-bottom: 12px; }
.meter-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
.meter-track { height: 8px; background: var(--track); border-radius: 4px; overflow: hidden; border: 1px solid transparent; }
body.vscode-high-contrast .meter-track, body.vscode-high-contrast-light .meter-track { border-color: var(--vscode-contrastBorder); }
.meter-fill { height: 100%; background: var(--accent); border-radius: 4px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--hairline); border-radius: 10px; padding: 1px 8px; font-variant-numeric: tabular-nums; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; }
th { color: var(--ink-2); font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.where { display: flex; flex-direction: column; gap: 2px; }
.tooltip { position: absolute; display: none; pointer-events: none; z-index: 10; background: var(--vscode-editorHoverWidget-background); color: var(--vscode-editorHoverWidget-foreground); border: 1px solid var(--vscode-editorHoverWidget-border); border-radius: 4px; padding: 6px 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.16); max-width: 260px; }
.tooltip-row strong { font-weight: 600; }
.tooltip-row span { color: var(--vscode-descriptionForeground); }
`;

/** The value audit dashboard (webview panel). */
class Dashboard {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly services: Services,
        private readonly stats: StatsService,
    ) {
        stats.onDidChange(() => {
            if (this.panel?.visible) {
                void this.send();
            }
        });
    }

    show(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        const extensionUri = this.services.context.extensionUri;
        const panel = vscode.window.createWebviewPanel('pxToRem.dashboard', vscode.l10n.t('PX to REM: Value audit'), vscode.ViewColumn.Active, {
            enableScripts: true,
            retainContextWhenHidden: false,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')],
        });
        this.panel = panel;
        const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview', 'dashboard.js'));
        const n = nonce();
        panel.webview.html = `<!doctype html>
<html lang="${vscode.env.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${n}'; script-src 'nonce-${n}' ${panel.webview.cspSource}; img-src ${panel.webview.cspSource} data:;">
<style nonce="${n}">${CSS}</style>
<title>PX to REM</title>
</head>
<body><div id="app"></div><script nonce="${n}" src="${script}"></script></body>
</html>`;
        panel.onDidDispose(() => {
            this.panel = undefined;
        });
        panel.onDidChangeViewState(e => {
            if (e.webviewPanel.visible) {
                void this.send();
            }
        });
        panel.webview.onDidReceiveMessage(message => void this.onMessage(message));
    }

    private async send(): Promise<void> {
        const panel = this.panel;
        if (!panel) {
            return;
        }
        const { stats, report } = await this.stats.compute();
        const folder = vscode.workspace.workspaceFolders?.[0];
        const info = this.services.project.infoFor(folder?.uri);
        const source = info.context.rootFontSizeSource;
        await panel.webview.postMessage({
            type: 'data',
            data: {
                report,
                trend: this.stats.trend,
                root: { px: info.context.rootFontSize, source: source?.description ? `${source.description}${source.file ? ` — ${source.file}` : ''}` : vscode.l10n.t('setting pxToRem.baseFontSize') },
                tokens: info.context.tokens.size,
                files: [...stats].sort((a, b) => b.convertible - a.convertible).slice(0, 100).map(s => ({ file: s.file, convertible: s.convertible, kept: s.kept, scalable: s.scalable })),
                formats: FORMATS.map(f => ({ id: f.id, label: f.label })),
                t: strings(),
            },
        });
    }

    private async onMessage(message: { type: string; file?: string; line?: number; format?: string }): Promise<void> {
        switch (message.type) {
            case 'ready':
                await this.send();
                break;
            case 'refresh':
                await this.services.index.rescan();
                await this.send();
                break;
            case 'convertWorkspace':
                await vscode.commands.executeCommand('px-to-rem.convertWorkspace');
                break;
            case 'open': {
                const uri = message.file ? resolveRelative(message.file) : undefined;
                if (uri) {
                    const line = message.line ?? 0;
                    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, 0, line, 0), viewColumn: vscode.ViewColumn.Beside });
                }
                break;
            }
            case 'generateTokens':
                await generateTokens(this.services, this.stats, message.format as TokenFileFormat | undefined);
                break;
        }
    }
}

/** Opens a token file generated from the values the workspace uses. */
async function generateTokens(services: Services, stats: StatsService, format?: TokenFileFormat): Promise<void> {
    let chosen = FORMATS.find(f => f.id === format);
    if (!chosen) {
        chosen = await vscode.window.showQuickPick(FORMATS.map(f => ({ ...f, description: f.id })), { placeHolder: vscode.l10n.t('Token file format') });
        if (!chosen) {
            return;
        }
    }
    const { report } = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('PX to REM: analysing values…') }, () =>
        stats.compute(),
    );
    const folder = vscode.workspace.workspaceFolders?.[0];
    const options = services.config.optionsFor(folder?.uri);
    const root = services.project.contextFor(folder?.uri).rootFontSize;
    const scales = { spacing: report.spacingProposal, fontSize: report.fontSizeProposal, radius: report.radiusProposal };
    const fileOptions = { rootFontSize: root, units: 'rem' as const, prefix: '', precision: options.precision, leadingZero: options.leadingZero };
    const content = generateTokenFile(chosen.id, scales, fileOptions);
    const doc = await vscode.workspace.openTextDocument({ content, language: chosen.language });
    await vscode.window.showTextDocument(doc);
    const names = tokenNamesFor(chosen.id, scales, fileOptions);
    const use = await vscode.window.showInformationMessage(
        vscode.l10n.t(
            'Generated {0} tokens ({1} … {2}). Save the file in your styles folder, then use the tokens when converting?',
            names.length,
            names[0]?.reference ?? '',
            names[names.length - 1] ? `${formatNumber(names[names.length - 1].px, { precision: 2, leadingZero: true })}px` : '',
        ),
        vscode.l10n.t('Use tokens when converting'),
    );
    if (use) {
        await vscode.workspace.getConfiguration('pxToRem', folder?.uri).update('tokens.preferTokens', true, vscode.ConfigurationTarget.Workspace);
    }
}

export function registerDashboard(services: Services, stats: StatsService): vscode.Disposable[] {
    const dashboard = new Dashboard(services, stats);
    return [
        vscode.commands.registerCommand('px-to-rem.openDashboard', () => dashboard.show()),
        vscode.commands.registerCommand('px-to-rem.generateTokens', (format?: TokenFileFormat) => generateTokens(services, stats, format)),
    ];
}
