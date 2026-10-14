import * as vscode from 'vscode';
import { pxAt } from '../../core/convert';
import { generateClamp } from '../../core/fluid';
import { formatNumber } from '../../core/format';
import { toRange } from '../engine';
import type { Services } from '../services';

const px2 = (n: number) => formatNumber(n, { precision: 2, leadingZero: true });

function parsePx(value: string, root: number): number | undefined {
    const m = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(px|rem)?\s*$/i.exec(value);
    if (!m) {
        return undefined;
    }
    return m[2]?.toLowerCase() === 'rem' ? Number(m[1]) * root : Number(m[1]);
}

/** Replaces the value under the cursor with a fluid clamp() between two viewport widths. */
async function makeFluid(services: Services, uri?: vscode.Uri, start?: number, end?: number): Promise<void> {
    const editor = uri ? vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString()) : vscode.window.activeTextEditor;
    if (!editor || !services.engine.isSupported(editor.document)) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Put the cursor on a px or rem value first.'));
        return;
    }
    const state = services.engine.state(editor.document);
    const { options, ctx } = state;
    const offset = start ?? editor.document.offsetAt(editor.selection.active);
    const found = pxAt(state.doc, offset, options, ctx);
    if (!found) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Put the cursor on a px or rem value first.'));
        return;
    }
    const spanStart = start ?? found.start;
    const spanEnd = end ?? found.end;
    const root = ctx.rootFontSize;
    const validate = (v: string) => (parsePx(v, root) === undefined ? vscode.l10n.t('Enter a size such as 16px or 1rem') : undefined);

    const minText = await vscode.window.showInputBox({
        title: vscode.l10n.t('Fluid value (1/3)'),
        prompt: vscode.l10n.t('Size on small screens'),
        value: `${px2(found.px)}px`,
        validateInput: validate,
    });
    if (minText === undefined) {
        return;
    }
    const maxText = await vscode.window.showInputBox({
        title: vscode.l10n.t('Fluid value (2/3)'),
        prompt: vscode.l10n.t('Size on large screens'),
        value: `${px2(Math.round(found.px * 1.5))}px`,
        validateInput: validate,
    });
    if (maxText === undefined) {
        return;
    }
    const rangeText = await vscode.window.showInputBox({
        title: vscode.l10n.t('Fluid value (3/3)'),
        prompt: vscode.l10n.t('Viewport range in px (from-to)'),
        value: `${options.fluid.minViewport}-${options.fluid.maxViewport}`,
        validateInput: v => (/^\s*\d+\s*-\s*\d+\s*$/.test(v) && Number(v.split('-')[0]) < Number(v.split('-')[1]) ? undefined : vscode.l10n.t('Use the form 375-1440')),
    });
    if (rangeText === undefined) {
        return;
    }
    const [minViewport, maxViewport] = rangeText.split('-').map(Number);
    const minPx = parsePx(minText, root)!;
    const maxPx = parsePx(maxText, root)!;
    const clamp = generateClamp({
        minPx,
        maxPx,
        minViewport,
        maxViewport,
        rootFontSize: root,
        unit: options.fluid.unit,
        precision: options.precision,
        leadingZero: options.leadingZero,
    });
    await editor.edit(b => b.replace(toRange(editor.document, spanStart, spanEnd), clamp));
    if (Math.max(minPx, maxPx) > 2.5 * Math.min(minPx, maxPx) && found.length?.decl?.property === 'font-size') {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('The large size is more than 2.5× the small one, so text may not reach 200% with browser zoom (WCAG 1.4.4).'),
        );
    }
}

export function registerFluidCommands(services: Services): vscode.Disposable[] {
    return [vscode.commands.registerCommand('px-to-rem.makeFluid', (uri?: vscode.Uri, start?: number, end?: number) => makeFluid(services, uri, start, end))];
}
