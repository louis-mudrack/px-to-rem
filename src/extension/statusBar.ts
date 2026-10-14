import * as vscode from 'vscode';
import { planConversion } from '../core/convert';
import { formatNumber } from '../core/format';
import type { Engine } from './engine';

/** `$(symbol-ruler) 16px · 12 px` — root font size and convertible px in the active file. */
export class StatusBar implements vscode.Disposable {
    private readonly item = vscode.window.createStatusBarItem('pxToRem.status', vscode.StatusBarAlignment.Right, 100);
    private readonly disposables: vscode.Disposable[] = [];
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly engine: Engine) {
        this.item.name = 'PX to REM';
        this.item.command = 'px-to-rem.menu';
        this.disposables.push(
            this.item,
            vscode.window.onDidChangeActiveTextEditor(() => this.schedule(0)),
            vscode.workspace.onDidChangeTextDocument(e => {
                if (e.document === vscode.window.activeTextEditor?.document) {
                    this.schedule();
                }
            }),
            engine.onDidChange(() => this.schedule(0)),
        );
        this.update();
    }

    private schedule(delay = 250): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => this.update(), delay);
    }

    update(): void {
        const editor = vscode.window.activeTextEditor;
        const document = editor?.document;
        void vscode.commands.executeCommand('setContext', 'pxToRem.active', !!document && this.engine.isSupported(document));
        if (!document || !this.engine.isSupported(document) || !this.engine.options(document).statusBar.enable) {
            this.item.hide();
            return;
        }
        const info = this.engine.project.infoFor(document.uri);
        const root = formatNumber(info.context.rootFontSize, { precision: 2, leadingZero: true });
        let count = 0;
        if (this.engine.isLive(document)) {
            const { doc, options, ctx } = this.engine.state(document);
            count = planConversion(doc, options, ctx).edits.length;
        }
        this.item.text = count ? `$(symbol-ruler) ${root}px · ${count} px` : `$(symbol-ruler) ${root}px`;

        const options = this.engine.options(document);
        const source = info.context.rootFontSizeSource;
        const md = new vscode.MarkdownString(undefined, true);
        md.appendMarkdown(`**PX to REM**\n\n`);
        md.appendMarkdown(
            `${vscode.l10n.t('Root font size: {0}px', root)}${source?.description ? ` — ${source.description}${source.file ? ` (${source.file})` : ''}` : ''}\n\n`,
        );
        if (info.rootAmbiguous) {
            md.appendMarkdown(`$(warning) ${vscode.l10n.t('Several different root font sizes were found. Set pxToRem.baseFontSize to choose.')}\n\n`);
        }
        md.appendMarkdown(`${vscode.l10n.t('Mode: {0} · Format: {1}', options.mode, options.format)}\n\n`);
        if (info.context.tokens.size) {
            md.appendMarkdown(`${vscode.l10n.t('{0} design tokens', info.context.tokens.size)}\n\n`);
        }
        if (info.context.tailwind) {
            md.appendMarkdown(`${vscode.l10n.t('Tailwind CSS v{0}', info.context.tailwind.version)}\n\n`);
        }
        if (info.buildTimeConversion) {
            md.appendMarkdown(`$(info) ${vscode.l10n.t('postcss-pxtorem also converts at build time.')}\n\n`);
        }
        md.appendMarkdown(count ? vscode.l10n.t('{0} px values can be converted. Click for actions.', count) : vscode.l10n.t('Click for actions.'));
        this.item.tooltip = md;
        this.item.show();
    }

    dispose(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        for (const d of this.disposables) {
            d.dispose();
        }
    }
}
