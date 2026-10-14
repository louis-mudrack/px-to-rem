import * as vscode from 'vscode';
import type { Services } from '../services';

/** Quick pick behind the status bar item. */
async function menu(services: Services): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const supported = !!editor && services.engine.isSupported(editor.document);
    const hasSelection = !!editor && editor.selections.some(s => !s.isEmpty);
    const inlay = editor ? services.engine.options(editor.document).inlayHints.enable : true;
    type Item = vscode.QuickPickItem & { command?: string; args?: unknown[] };
    const items: Item[] = [];
    if (supported) {
        items.push(
            { label: vscode.l10n.t('File'), kind: vscode.QuickPickItemKind.Separator },
            { label: hasSelection ? vscode.l10n.t('$(symbol-ruler) Convert selection') : vscode.l10n.t('$(symbol-ruler) Convert file'), command: 'px-to-rem.convert' },
            { label: vscode.l10n.t('$(arrow-swap) Cycle unit at cursor'), command: 'px-to-rem.cycleUnit' },
            { label: vscode.l10n.t('$(history) Convert back to px'), command: 'px-to-rem.reverseConvert' },
            { label: vscode.l10n.t('$(diff) Convert changed lines only'), command: 'px-to-rem.convertChanged' },
            { label: vscode.l10n.t('$(question) Why are some values kept?'), command: 'px-to-rem.explainKept' },
        );
    }
    items.push(
        { label: vscode.l10n.t('Project'), kind: vscode.QuickPickItemKind.Separator },
        { label: vscode.l10n.t('$(files) Convert workspace…'), description: vscode.l10n.t('with preview'), command: 'px-to-rem.convertWorkspace' },
        { label: vscode.l10n.t('$(dashboard) Open value audit dashboard'), command: 'px-to-rem.openDashboard' },
        { label: vscode.l10n.t('$(symbol-constant) Generate design tokens from usage…'), command: 'px-to-rem.generateTokens' },
        { label: vscode.l10n.t('$(refresh) Rebase rem values…'), description: vscode.l10n.t('e.g. 62.5% → 100%'), command: 'px-to-rem.rebase' },
        { label: vscode.l10n.t('$(symbol-method) Generate rem() helper…'), command: 'px-to-rem.generateHelper' },
        { label: vscode.l10n.t('Settings'), kind: vscode.QuickPickItemKind.Separator },
        { label: vscode.l10n.t('$(rocket) Set up project…'), command: 'px-to-rem.setup' },
        { label: vscode.l10n.t('$(settings) Choose preset…'), command: 'px-to-rem.switchProfile' },
        { label: inlay ? vscode.l10n.t('$(eye-closed) Hide inlay hints') : vscode.l10n.t('$(eye) Show inlay hints'), command: 'px-to-rem.toggleInlayHints' },
        { label: vscode.l10n.t('$(gear) Open settings'), command: 'workbench.action.openSettings', args: ['pxToRem'] },
        { label: vscode.l10n.t('$(sync) Rescan project'), command: 'px-to-rem.refresh' },
    );
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'PX to REM' });
    if (picked?.command) {
        await vscode.commands.executeCommand(picked.command, ...(picked.args ?? []));
    }
}

async function toggleInlayHints(services: Services): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const current = document ? services.engine.options(document).inlayHints.enable : true;
    await vscode.workspace.getConfiguration('pxToRem').update('inlayHints.enable', !current, vscode.ConfigurationTarget.Global);
}

export function registerMenuCommands(services: Services): vscode.Disposable[] {
    return [
        vscode.commands.registerCommand('px-to-rem.menu', () => menu(services)),
        vscode.commands.registerCommand('px-to-rem.toggleInlayHints', () => toggleInlayHints(services)),
    ];
}
