import * as vscode from 'vscode';
import { cycleAt, planConversion, planReverse, pxAt, type LengthFilter } from '../../core/convert';
import { formatNumber } from '../../core/format';
import type { MessageId } from '../../core/messages';
import { applyOptions } from '../../core/options';
import { categoryForProperty, type Category } from '../../core/properties';
import { decide } from '../../core/strategy';
import type { TextEdit } from '../../core/text';
import { toRange, type DocState } from '../engine';
import { lineFilter } from '../git';
import { msg } from '../l10n';
import type { Services } from '../services';

function activeState(services: Services, uri?: vscode.Uri): { editor: vscode.TextEditor; state: DocState } | undefined {
    const editor = uri ? vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString()) : vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Open a file first.'));
        return undefined;
    }
    if (!services.engine.isSupported(editor.document)) {
        void vscode.window.showInformationMessage(
            vscode.l10n.t('PX to REM is not active for {0} files. Add the language to pxToRem.languages to enable it.', editor.document.languageId),
        );
        return undefined;
    }
    return { editor, state: services.engine.state(editor.document) };
}

export async function applyTextEdits(editor: vscode.TextEditor, edits: readonly TextEdit[]): Promise<boolean> {
    if (!edits.length) {
        return true;
    }
    const document = editor.document;
    return editor.edit(builder => {
        for (const e of edits) {
            builder.replace(toRange(document, e.start, e.end), e.newText);
        }
    });
}

function selectionFilter(editor: vscode.TextEditor): LengthFilter | undefined {
    const ranges = editor.selections.filter(s => !s.isEmpty).map(s => ({ start: editor.document.offsetAt(s.start), end: editor.document.offsetAt(s.end) }));
    if (!ranges.length) {
        return undefined;
    }
    return item => ranges.some(r => item.start >= r.start && item.end <= r.end);
}

function report(converted: number, kept: number): void {
    if (!converted) {
        void vscode.window.showInformationMessage(
            kept ? vscode.l10n.t('No px values to convert ({0} kept on purpose).', kept) : vscode.l10n.t('No px values to convert.'),
        );
        return;
    }
    const base = converted === 1 ? vscode.l10n.t('Converted 1 px value.') : vscode.l10n.t('Converted {0} px values.', converted);
    void vscode.window.setStatusBarMessage(kept ? `${base} ${vscode.l10n.t('{0} kept on purpose.', kept)}` : base, 4000);
}

/** Convert the selection(s), or the whole file when nothing is selected. */
async function convert(services: Services, filterOverride?: LengthFilter, layer?: Record<string, unknown>, uri?: vscode.Uri): Promise<void> {
    const active = activeState(services, uri);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const options = layer ? applyOptions(state.options, layer) : state.options;
    const filter = filterOverride ?? selectionFilter(editor);
    const plan = planConversion(state.doc, options, state.ctx, filter);
    await applyTextEdits(editor, plan.edits);
    report(plan.edits.length, plan.skipped.length);
}

/** Converts the value under each cursor, or the selected ranges. */
async function convertSelection(services: Services): Promise<void> {
    const active = activeState(services);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const ranges = editor.selections.map(s => {
        if (!s.isEmpty) {
            return { start: editor.document.offsetAt(s.start), end: editor.document.offsetAt(s.end) };
        }
        const offset = editor.document.offsetAt(s.active);
        const length = state.doc.lengths.find(l => l.start <= offset && offset <= l.end);
        return length ? { start: length.start, end: length.end } : { start: offset, end: offset };
    });
    const plan = planConversion(state.doc, state.options, state.ctx, item => ranges.some(r => item.start >= r.start && item.end <= r.end));
    await applyTextEdits(editor, plan.edits);
    report(plan.edits.length, plan.skipped.length);
}

async function reverse(services: Services): Promise<void> {
    const active = activeState(services);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const edits = planReverse(state.doc, state.options, state.ctx, selectionFilter(editor));
    await applyTextEdits(editor, edits);
    void vscode.window.setStatusBarMessage(
        edits.length === 1 ? vscode.l10n.t('Converted 1 value back to px.') : vscode.l10n.t('Converted {0} values back to px.', edits.length),
        4000,
    );
}

async function cycle(services: Services): Promise<void> {
    const active = activeState(services);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const edits: TextEdit[] = [];
    for (const selection of editor.selections) {
        const edit = cycleAt(state.doc, editor.document.offsetAt(selection.active), state.options, state.ctx);
        if (edit && !edits.some(e => e.start === edit.start)) {
            edits.push(edit);
        }
    }
    await applyTextEdits(editor, edits);
}

const SPACING_SCALE = [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 112, 128, 144, 160, 192, 224, 256, 320, 384, 448, 512];
const TYPE_SCALE = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 128];

/** Moves the value under each cursor to the next/previous step of its scale (tokens, or a sensible default). */
async function step(services: Services, direction: 1 | -1): Promise<void> {
    const active = activeState(services);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const { doc, options, ctx } = state;
    const style = { precision: options.precision, leadingZero: options.leadingZero };
    const edits: TextEdit[] = [];
    for (const selection of editor.selections) {
        const offset = editor.document.offsetAt(selection.active);

        // A token reference: step to the neighbouring token.
        const lineText = editor.document.lineAt(selection.active.line).text;
        const ref = /var\(\s*--[\w-]+\s*\)|\$[\w-]+|@[\w-]+/g;
        let m: RegExpExecArray | null;
        let handled = false;
        while ((m = ref.exec(lineText))) {
            if (selection.active.character < m.index || selection.active.character > m.index + m[0].length) {
                continue;
            }
            const name = m[0].startsWith('var(') ? /--[\w-]+/.exec(m[0])![0] : m[0];
            const token = ctx.tokens.get(name);
            if (token?.px === undefined) {
                break;
            }
            const decl = doc.declarations.find(d => d.start <= offset && offset <= d.end);
            const category = (decl ? categoryForProperty(decl.property) : token.category) as Category;
            const near = ctx.tokens.neighbours(token.px, category === 'other' ? (token.category as Category) : category, doc.regions[0]?.syntax ?? 'css');
            const next = direction > 0 ? near.above : near.below;
            if (next) {
                const lineStart = editor.document.offsetAt(new vscode.Position(selection.active.line, 0));
                edits.push({ start: lineStart + m.index, end: lineStart + m.index + m[0].length, newText: next.tokens[0].reference });
            }
            handled = true;
            break;
        }
        if (handled) {
            continue;
        }

        const found = pxAt(doc, offset, options, ctx);
        if (!found || !found.length) {
            continue;
        }
        const length = found.length;
        const category = categoryForProperty(length.decl?.property ?? '');
        const tokenScale = options.tokens.enable ? ctx.tokens.scale(category, length.region.syntax, !!length.region.jsTemplate).map(s => s.px) : [];
        const scale = tokenScale.length >= 2 ? tokenScale : category === 'font-size' ? TYPE_SCALE : SPACING_SCALE;
        const abs = Math.abs(found.px);
        const sign = found.px < 0 ? -1 : 1;
        const candidates = direction * sign > 0 ? scale.filter(v => v > abs + 1e-6) : [...scale].reverse().filter(v => v < abs - 1e-6);
        const target = candidates[0];
        if (target === undefined) {
            continue;
        }
        const px = sign * target;
        const current = doc.text.slice(found.start, found.end);
        let newText: string;
        if (/px$/i.test(current)) {
            newText = `${formatNumber(px, { precision: 2, leadingZero: options.leadingZero })}px`;
        } else if (/rem$/i.test(current)) {
            newText = `${formatNumber(px / ctx.rootFontSize, style)}rem`;
        } else if (/em$/i.test(current)) {
            newText = `${formatNumber((px * length.value) / found.px, style)}em`;
        } else if (current.toLowerCase().startsWith(options.functionName.toLowerCase() + '(')) {
            newText = current.replace(/\(\s*-?[\d.]+/, `(${formatNumber(px, { precision: 2, leadingZero: options.leadingZero })}`);
        } else {
            newText = `${formatNumber(px / ctx.rootFontSize, style)}rem`;
        }
        edits.push({ start: found.start, end: found.end, newText });
    }
    await applyTextEdits(editor, edits);
}

/** Lists px values that were left alone and why. */
async function explainKept(services: Services, uri?: vscode.Uri): Promise<void> {
    const active = activeState(services, uri);
    if (!active) {
        return;
    }
    const { editor, state } = active;
    const plan = planConversion(state.doc, state.options, state.ctx);
    if (!plan.skipped.length) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Every px value in this file would be converted.'));
        return;
    }
    const items = plan.skipped.map(({ length, reason }) => {
        const d = decide(state.doc, length, state.options, state.ctx);
        const arg = reason === 'smart-keep' ? length.decl?.property ?? '' : reason === 'hairline' ? state.options.hairline : state.options.mediaQueryBase;
        return {
            label: `${state.doc.text.slice(length.start, length.end)}`,
            description: `${length.decl?.property ?? length.context} · ${vscode.l10n.t('line {0}', length.line + 1)}`,
            detail: msg(`reason.${d.reason}` as MessageId, arg),
            length,
        };
    });
    const picked = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('px values kept on purpose — pick one to jump to it'), matchOnDetail: true });
    if (picked) {
        const range = toRange(editor.document, picked.length.start, picked.length.end);
        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
}

/** Converts only lines changed since the last commit. */
async function convertChanged(services: Services): Promise<void> {
    const active = activeState(services);
    if (!active) {
        return;
    }
    const lines = await services.git.changedLines(active.editor.document.uri);
    if (lines === undefined) {
        void vscode.window.showWarningMessage(vscode.l10n.t('This file is not in a git repository (or the Git extension is disabled).'));
        return;
    }
    await convert(services, lineFilter(lines) ?? (() => true));
}

export function registerEditingCommands(services: Services): vscode.Disposable[] {
    const reg = vscode.commands.registerCommand;
    return [
        reg('px-to-rem.convert', () => convert(services)),
        reg('px-to-rem.convertSelection', () => convertSelection(services)),
        reg('px-to-rem.convertWithPx', () => convert(services, undefined, { format: 'rem-function-px' })),
        reg('px-to-rem.convertRange', (uri: vscode.Uri, start: number, end: number) =>
            convert(services, item => item.start >= start && item.end <= end, undefined, uri),
        ),
        reg('px-to-rem.convertLine', (line: number) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            return convert(services, item => item.line === line);
        }),
        reg('px-to-rem.convertChanged', () => convertChanged(services)),
        reg('px-to-rem.reverseConvert', () => reverse(services)),
        reg('px-to-rem.cycleUnit', () => cycle(services)),
        reg('px-to-rem.stepUp', () => step(services, 1)),
        reg('px-to-rem.stepDown', () => step(services, -1)),
        reg('px-to-rem.explainKept', (uri?: vscode.Uri) => explainKept(services, uri)),
    ];
}
