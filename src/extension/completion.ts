import * as vscode from 'vscode';
import { alternativesAt, renderTarget } from '../core/convert';
import { formatNumber } from '../core/format';
import { categoryForProperty } from '../core/properties';
import { decide } from '../core/strategy';
import { toRange, type Engine } from './engine';

/** While typing `24px`, suggests the converted value and matching tokens. */
export class CompletionProvider implements vscode.CompletionItemProvider {
    static readonly triggerCharacters = ['x'];

    constructor(private readonly engine: Engine) {}

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
        const before = document.lineAt(position.line).text.slice(0, position.character);
        if (!/(?:^|[^\w.-])-?(?:\d+\.?\d*|\.\d+)px$/.test(before)) {
            return undefined;
        }
        if (!this.engine.isSupported(document)) {
            return undefined;
        }
        const options = this.engine.options(document);
        if (!options.completion.enable) {
            return undefined;
        }
        const state = this.engine.state(document);
        const offset = document.offsetAt(position);
        const length = state.doc.lengths.find(l => l.end === offset && l.unit === 'px');
        if (!length) {
            return undefined;
        }
        const range = toRange(document, length.start, length.end);
        const raw = state.doc.text.slice(length.start, length.end);
        const items: vscode.CompletionItem[] = [];
        const add = (text: string, detail: string, sort: number, preselect = false) => {
            const item = new vscode.CompletionItem({ label: text, description: detail }, vscode.CompletionItemKind.Unit);
            item.range = range;
            item.insertText = text;
            item.filterText = raw;
            item.sortText = `0${sort}`;
            item.preselect = preselect;
            item.detail = `${raw} → ${text}`;
            items.push(item);
        };

        const decision = decide(state.doc, length, state.options, state.ctx);
        let primary: string | undefined;
        if (decision.convert) {
            primary = renderTarget(state.doc, length, decision.target, state.options, state.ctx).newText;
            add(primary, 'PX to REM', 0, true);
        }
        const alt = alternativesAt(state.doc, offset, state.options, state.ctx);
        let sort = 1;
        for (const text of alt?.options.slice(1) ?? []) {
            if (text !== primary) {
                add(text, 'PX to REM', sort++);
            }
        }
        if (state.options.tokens.enable && length.decl && length.value > 0) {
            const category = categoryForProperty(length.decl.property);
            const near = state.ctx.tokens.neighbours(length.value, category, length.region.syntax, !!length.region.jsTemplate);
            for (const step of [near.below, near.above]) {
                if (step) {
                    add(step.tokens[0].reference, `${formatNumber(step.px, { precision: 2, leadingZero: true })}px`, sort++);
                }
            }
        }
        return items;
    }
}
