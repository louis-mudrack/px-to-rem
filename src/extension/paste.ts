import * as vscode from 'vscode';
import { planConversion } from '../core/convert';
import { applyEdits } from '../core/text';
import type { Engine } from './engine';

export const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Text.append('pxToRem');

/**
 * "Paste as rem": the pasted text is spliced into the document virtually and
 * parsed in place, so it gets the surrounding syntax and the enclosing
 * rule's font size (unitless line-height, em letter-spacing).
 */
export class PasteProvider implements vscode.DocumentPasteEditProvider {
    constructor(private readonly engine: Engine) {}

    async provideDocumentPasteEdits(
        document: vscode.TextDocument,
        ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        _context: vscode.DocumentPasteEditContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.DocumentPasteEdit[] | undefined> {
        if (!this.engine.isSupported(document)) {
            return undefined;
        }
        const options = this.engine.options(document);
        if (options.paste.mode === 'off') {
            return undefined;
        }
        const item = dataTransfer.get('text/plain');
        if (!item) {
            return undefined;
        }
        const pasted = await item.asString();
        if (token.isCancellationRequested || !/\d(?:\.\d+)?px/i.test(pasted) || pasted.length > 200_000) {
            return undefined;
        }
        const range = ranges[0];
        const text = document.getText();
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        const virtual = text.slice(0, start) + pasted + text.slice(end);
        const { doc, ctx } = this.engine.parseText(virtual, document.languageId, document.uri);
        const plan = planConversion(doc, options, ctx, l => l.start >= start && l.end <= start + pasted.length);
        if (!plan.edits.length) {
            return undefined;
        }
        // Every edit lies inside the pasted range, so the converted paste is that range shifted by the length change.
        const out = applyEdits(virtual, plan.edits);
        const converted = out.slice(start, start + pasted.length + (out.length - virtual.length));
        const count = plan.edits.length;
        const edit = new vscode.DocumentPasteEdit(
            converted,
            count === 1 ? vscode.l10n.t('Paste with 1 px value converted') : vscode.l10n.t('Paste with {0} px values converted', count),
            PASTE_KIND,
        );
        if (options.paste.mode === 'offer') {
            edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text.append('plain')];
        }
        return [edit];
    }
}
