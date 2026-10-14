import * as vscode from 'vscode';
import { nearestColorToken } from '../core/audit';
import { alternativesAt, planConversion, renderTarget } from '../core/convert';
import type { LengthNode } from '../core/document';
import { findBreakpointMerges, type BreakpointMerge } from '../core/fluid';
import { formatNumber } from '../core/format';
import { categoryForProperty } from '../core/properties';
import { decide } from '../core/strategy';
import type { TextEdit } from '../core/text';
import type { DiagnosticsController } from './diagnostics';
import { toRange, type DocState, type Engine } from './engine';
import { msg } from './l10n';

export const SOURCE_CONVERT_KIND = vscode.CodeActionKind.Source.append('pxToRem').append('convert');

function workspaceEdit(document: vscode.TextDocument, edits: readonly TextEdit[]): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit();
    for (const e of edits) {
        edit.replace(document.uri, toRange(document, e.start, e.end), e.newText);
    }
    return edit;
}

const mergeCache = new WeakMap<object, BreakpointMerge[]>();

function mergesFor(state: DocState): BreakpointMerge[] {
    let merges = mergeCache.get(state.doc);
    if (!merges) {
        merges = state.doc.blocks.some(b => b.kind === 'atrule' && b.name === 'media') ? findBreakpointMerges(state.doc, state.options, state.ctx) : [];
        mergeCache.set(state.doc, merges);
    }
    return merges;
}

/** Comment that disables conversion on the next line, in the syntax of the surrounding code. */
export function ignoreCommentFor(length: LengthNode, hostKind: string | undefined, lineText: string): string {
    const kind = length.region.kind;
    if (hostKind === 'markup' && (kind === 'style-attribute' || kind === 'tailwind')) {
        return '<!-- px-to-rem-disable-next-line -->';
    }
    if (hostKind === 'script' && (kind === 'js-object' || kind === 'tailwind')) {
        return lineText.trim().startsWith('<') ? '{/* px-to-rem-disable-next-line */}' : '// px-to-rem-disable-next-line';
    }
    return length.region.syntax === 'css' || length.region.jsTemplate ? '/* px-to-rem-disable-next-line */' : '// px-to-rem-disable-next-line';
}

export class CodeActionsProvider implements vscode.CodeActionProvider {
    static readonly metadata: vscode.CodeActionProviderMetadata = {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix, vscode.CodeActionKind.RefactorRewrite, SOURCE_CONVERT_KIND],
    };

    constructor(
        private readonly engine: Engine,
        private readonly diagnostics: DiagnosticsController,
    ) {}

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext): vscode.CodeAction[] {
        if (!this.engine.isSupported(document)) {
            return [];
        }
        const state = this.engine.state(document);

        if (context.only) {
            if (context.only.intersects(SOURCE_CONVERT_KIND)) {
                return [this.sourceAction(state)];
            }
            if (!context.only.intersects(vscode.CodeActionKind.QuickFix) && !context.only.intersects(vscode.CodeActionKind.Refactor)) {
                return [];
            }
        }

        const actions: vscode.CodeAction[] = [];
        const titles = new Set<string>();
        const push = (action: vscode.CodeAction) => {
            if (!titles.has(action.title)) {
                titles.add(action.title);
                actions.push(action);
            }
        };

        // Fixes for diagnostics.
        for (const finding of this.diagnostics.findingsAt(document, range)) {
            const diags = context.diagnostics.filter(d => d.source === 'px-to-rem' && typeof d.code === 'object' && d.code.value === finding.rule);
            for (const fix of finding.fixes) {
                const action = new vscode.CodeAction(msg(fix.title, ...fix.titleArgs), vscode.CodeActionKind.QuickFix);
                action.edit = workspaceEdit(document, fix.edits);
                action.diagnostics = diags;
                action.isPreferred = fix.preferred;
                push(action);
            }
            if (finding.rule === 'rem-function-missing') {
                const action = new vscode.CodeAction(msg('fix.generateHelper', state.options.functionName), vscode.CodeActionKind.QuickFix);
                action.command = { title: action.title, command: 'px-to-rem.generateHelper', arguments: [document.uri] };
                action.diagnostics = diags;
                push(action);
                const useRem = new vscode.CodeAction(msg('fix.useRemFormat'), vscode.CodeActionKind.QuickFix);
                useRem.command = { title: useRem.title, command: 'px-to-rem.setFormat', arguments: ['rem', document.uri] };
                push(useRem);
            }
        }

        const offset = document.offsetAt(range.start);
        const { doc, options, ctx } = state;
        const length = doc.lengths.find(l => l.start <= offset && offset <= l.end);

        if (length && length.unit === 'px') {
            const decision = decide(doc, length, options, ctx);
            if (decision.convert) {
                const edit = renderTarget(doc, length, decision.target, options, ctx);
                const action = new vscode.CodeAction(msg('fix.convertTo', edit.newText), vscode.CodeActionKind.QuickFix);
                action.edit = workspaceEdit(document, [edit]);
                action.isPreferred = actions.length === 0;
                push(action);
            }
            const alt = alternativesAt(doc, offset, options, ctx);
            for (const text of alt?.options.slice(1) ?? []) {
                const action = new vscode.CodeAction(msg('fix.convertTo', text), vscode.CodeActionKind.RefactorRewrite);
                action.edit = workspaceEdit(document, [{ start: alt!.start, end: alt!.end, newText: text }]);
                push(action);
            }
            if (options.tokens.enable && ctx.tokens.lengths.length && length.decl && length.value > 0) {
                const category = categoryForProperty(length.decl.property);
                const near = ctx.tokens.neighbours(length.value, category, length.region.syntax, !!length.region.jsTemplate);
                for (const step of [near.below, near.above]) {
                    if (step && Math.abs(step.px - length.value) <= Math.max(4, length.value * 0.25)) {
                        const token = step.tokens[0];
                        const action = new vscode.CodeAction(msg('fix.useToken', `${token.reference} (${formatNumber(step.px, { precision: 2, leadingZero: true })}px)`), vscode.CodeActionKind.RefactorRewrite);
                        action.edit = workspaceEdit(document, [{ start: length.start, end: length.end, newText: token.reference }]);
                        push(action);
                    }
                }
            }
            this.addBulkActions(state, length, push);
            push(this.ignoreAction(document, length));
            if (length.decl && (length.decl.property === 'font-size' || length.decl.property === 'line-height' || categoryForProperty(length.decl.property) === 'spacing')) {
                const action = new vscode.CodeAction(vscode.l10n.t('Make fluid with clamp()…'), vscode.CodeActionKind.RefactorRewrite);
                action.command = { title: action.title, command: 'px-to-rem.makeFluid', arguments: [document.uri, length.start, length.end] };
                push(action);
            }
        } else if (length) {
            // rem, em, vw, … : offer the other spellings (including px).
            const alt = alternativesAt(doc, offset, options, ctx);
            for (const text of alt?.options ?? []) {
                if (text === alt?.current) {
                    continue;
                }
                const action = new vscode.CodeAction(msg('fix.convertTo', text), vscode.CodeActionKind.RefactorRewrite);
                action.edit = workspaceEdit(document, [{ start: alt!.start, end: alt!.end, newText: text }]);
                push(action);
            }
        } else {
            const call = doc.functions.find(f => f.start <= offset && offset <= f.end && f.name === options.functionName.toLowerCase());
            if (call) {
                const alt = alternativesAt(doc, offset, options, ctx);
                for (const text of alt?.options ?? []) {
                    if (text !== alt?.current) {
                        const action = new vscode.CodeAction(msg('fix.convertTo', text), vscode.CodeActionKind.RefactorRewrite);
                        action.edit = workspaceEdit(document, [{ start: alt!.start, end: alt!.end, newText: text }]);
                        push(action);
                    }
                }
            }
        }

        // Colour tokens.
        const color = doc.colors.find(c => c.start <= offset && offset <= c.end);
        if (color && options.tokens.enable && options.tokens.colors) {
            const near = nearestColorToken(color, ctx, options);
            if (near && near.distance <= Math.max(options.tokens.colorTolerance, 0.5)) {
                const action = new vscode.CodeAction(msg('fix.useToken', near.reference), vscode.CodeActionKind.QuickFix);
                action.edit = workspaceEdit(document, [{ start: color.start, end: color.end, newText: near.reference }]);
                action.isPreferred = near.distance <= 0.5;
                push(action);
            }
        }

        // Merge media-query overrides into clamp().
        const decl = doc.declarations.find(d => d.start <= offset && offset <= d.end);
        if (decl) {
            for (const merge of mergesFor(state)) {
                if (merge.decl === decl || merge.points.some(p => p.decl === decl)) {
                    const action = new vscode.CodeAction(
                        vscode.l10n.t('Merge {0} breakpoint values into {1}', merge.points.length, merge.clamp),
                        vscode.CodeActionKind.RefactorRewrite,
                    );
                    action.edit = workspaceEdit(document, merge.edits);
                    push(action);
                }
            }
        }
        return actions;
    }

    private addBulkActions(state: DocState, length: LengthNode, push: (a: vscode.CodeAction) => void): void {
        const { document, doc, options, ctx } = state;
        const block = length.block;
        if (block.kind !== 'root') {
            const plan = planConversion(doc, options, ctx, item => item.start >= block.start && item.end <= block.end);
            if (plan.edits.length > 1) {
                const action = new vscode.CodeAction(vscode.l10n.t('Convert all {0} px values in this rule', plan.edits.length), vscode.CodeActionKind.QuickFix);
                action.edit = workspaceEdit(document, plan.edits);
                push(action);
            }
        }
        const all = planConversion(doc, options, ctx);
        if (all.edits.length > 1) {
            const action = new vscode.CodeAction(vscode.l10n.t('Convert all {0} px values in this file', all.edits.length), vscode.CodeActionKind.QuickFix);
            action.edit = workspaceEdit(document, all.edits);
            push(action);
        }
    }

    private ignoreAction(document: vscode.TextDocument, length: LengthNode): vscode.CodeAction {
        const line = document.lineAt(document.positionAt(length.start).line);
        const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
        const action = new vscode.CodeAction(msg('fix.ignoreLine'), vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        const comment = ignoreCommentFor(length, this.engine.state(document).doc.host?.kind, line.text);
        edit.insert(document.uri, line.range.start, `${indent}${comment}\n`);
        action.edit = edit;
        return action;
    }

    private sourceAction(state: DocState): vscode.CodeAction {
        const plan = planConversion(state.doc, state.options, state.ctx);
        const action = new vscode.CodeAction(vscode.l10n.t('Convert px values'), SOURCE_CONVERT_KIND);
        action.edit = workspaceEdit(state.document, plan.edits);
        return action;
    }
}
