import * as vscode from 'vscode';
import { planConversion } from '../core/convert';
import type { BlockNode } from '../core/parser';
import type { Engine } from './engine';

/** "Convert N px values" lenses per file, rule or line. */
export class CodeLensProvider implements vscode.CodeLensProvider {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.emitter.event;

    constructor(private readonly engine: Engine) {
        engine.onDidChange(() => this.emitter.fire());
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        if (!this.engine.isLive(document)) {
            return [];
        }
        const mode = this.engine.options(document).codeLens;
        if (mode === 'off') {
            return [];
        }
        const { doc, options, ctx } = this.engine.state(document);
        const plan = planConversion(doc, options, ctx);
        if (!plan.edits.length) {
            return [];
        }
        const lens = (line: number, start: number, end: number, title: string) =>
            new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                title,
                command: 'px-to-rem.convertRange',
                arguments: [document.uri, start, end],
                tooltip: vscode.l10n.t('Convert the px values below with the current settings'),
            });

        if (mode === 'file') {
            const first = plan.edits[0];
            const line = document.positionAt(first.start).line;
            const kept = plan.skipped.length;
            const title =
                plan.edits.length === 1 ? vscode.l10n.t('$(symbol-ruler) Convert 1 px value in this file') : vscode.l10n.t('$(symbol-ruler) Convert {0} px values in this file', plan.edits.length);
            const lenses = [lens(line, 0, doc.text.length, title)];
            if (kept) {
                lenses.push(
                    new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
                        title: kept === 1 ? vscode.l10n.t('1 kept on purpose') : vscode.l10n.t('{0} kept on purpose', kept),
                        command: 'px-to-rem.explainKept',
                        arguments: [document.uri],
                    }),
                );
            }
            return lenses;
        }

        if (mode === 'rule') {
            const byBlock = new Map<BlockNode, number>();
            for (const edit of plan.edits) {
                const block = edit.length.block;
                byBlock.set(block, (byBlock.get(block) ?? 0) + 1);
            }
            return [...byBlock.entries()].map(([block, count]) => {
                const line = document.positionAt(block.start).line;
                return lens(line, block.start, block.end, count === 1 ? vscode.l10n.t('Convert 1 px value') : vscode.l10n.t('Convert {0} px values', count));
            });
        }

        const byLine = new Map<number, number>();
        for (const edit of plan.edits) {
            const line = document.positionAt(edit.start).line;
            byLine.set(line, (byLine.get(line) ?? 0) + 1);
        }
        return [...byLine.entries()].map(([line, count]) => {
            const textLine = document.lineAt(line);
            return lens(
                line,
                document.offsetAt(textLine.range.start),
                document.offsetAt(textLine.range.end),
                count === 1 ? vscode.l10n.t('Convert 1 px value') : vscode.l10n.t('Convert {0} px values', count),
            );
        });
    }
}
