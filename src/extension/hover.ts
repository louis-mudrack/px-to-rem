import * as vscode from 'vscode';
import { nearestColorToken } from '../core/audit';
import { emBaseFor } from '../core/context';
import { alternativesAt, pxAt, renderTarget } from '../core/convert';
import type { LengthNode } from '../core/document';
import { explainValue } from '../core/fluid';
import { formatNumber } from '../core/format';
import type { MessageId } from '../core/messages';
import { categoryForProperty } from '../core/properties';
import { evalEnv } from '../core/resolve';
import { decide } from '../core/strategy';
import { toHex } from '../core/tokens/color';
import { toRange, type DocState, type Engine } from './engine';
import { msg } from './l10n';

const px2 = (n: number) => formatNumber(n, { precision: 2, leadingZero: true });
const MATH = new Set(['calc', 'clamp', 'min', 'max']);

function code(s: string): string {
    return '`' + s.replace(/`/g, '\\`') + '`';
}

function rootLine(state: DocState): string {
    const { ctx } = state;
    const source = ctx.rootFontSizeSource;
    const where = source ? `${source.description ?? ''}${source.file ? ` — ${source.file}${source.line !== undefined ? `:${source.line + 1}` : ''}` : ''}` : vscode.l10n.t('setting pxToRem.baseFontSize');
    return vscode.l10n.t('1rem = {0}px ({1})', px2(ctx.rootFontSize), where.trim());
}

/** Hover with conversions, the smart-mode reasoning, tokens and fluid explanations. */
export class HoverProvider implements vscode.HoverProvider {
    constructor(private readonly engine: Engine) {}

    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        if (!this.engine.isSupported(document) || !this.engine.options(document).hover.enable) {
            return undefined;
        }
        const state = this.engine.state(document);
        const offset = document.offsetAt(position);
        const { doc } = state;

        const call = doc.functions.find(f => f.nameSpan.start <= offset && offset <= f.nameSpan.end && MATH.has(f.name));
        if (call) {
            return this.mathHover(state, call.start, call.end);
        }
        const varRef = /var\(\s*(--[\w-]+)|(\$[\w-]+)|(@[\w-]+)/g;
        const lineText = document.lineAt(position.line).text;
        let m: RegExpExecArray | null;
        while ((m = varRef.exec(lineText))) {
            const start = m.index + (m[0].length - (m[1] ?? m[2] ?? m[3]).length);
            if (position.character >= start && position.character <= m.index + m[0].length) {
                const hover = this.variableHover(state, m[1] ?? m[2] ?? m[3], new vscode.Range(position.line, m.index, position.line, m.index + m[0].length));
                if (hover) {
                    return hover;
                }
            }
        }

        const length = doc.lengths.find(l => l.start <= offset && offset <= l.end);
        if (length) {
            return length.unit === 'px' ? this.pxHover(state, length) : this.lengthHover(state, offset);
        }
        const fnCall = doc.functions.find(f => f.start <= offset && offset <= f.end && f.name === state.options.functionName.toLowerCase());
        if (fnCall) {
            return this.lengthHover(state, offset);
        }
        const color = doc.colors.find(c => c.start <= offset && offset <= c.end);
        if (color && state.options.tokens.enable && state.options.tokens.colors) {
            const near = nearestColorToken(color, state.ctx, state.options);
            if (near && near.distance <= Math.max(state.options.tokens.colorTolerance * 2, 3)) {
                const md = new vscode.MarkdownString();
                md.appendMarkdown(
                    near.distance < 0.5
                        ? vscode.l10n.t('Colour token {0} ({1})', code(near.reference), near.hex)
                        : vscode.l10n.t('Closest colour token: {0} ({1}, difference {2})', code(near.reference), near.hex, px2(near.distance)),
                );
                return new vscode.Hover(md, toRange(document, color.start, color.end));
            }
        }
        return undefined;
    }

    private pxHover(state: DocState, length: LengthNode): vscode.Hover {
        const { document, doc, options, ctx } = state;
        const decision = decide(doc, length, options, ctx);
        const md = new vscode.MarkdownString(undefined, true);
        md.isTrusted = { enabledCommands: ['px-to-rem.convertAt', 'workbench.action.openSettings'] };
        const raw = doc.text.slice(length.start, length.end);
        if (decision.convert) {
            const edit = renderTarget(doc, length, decision.target, options, ctx);
            md.appendMarkdown(`**${code(raw)} → ${code(edit.newText)}**  \n`);
        } else {
            md.appendMarkdown(`**${code(raw)}** — ${vscode.l10n.t('stays px')}  \n`);
        }
        const reasonId = `reason.${decision.reason}` as MessageId;
        const property = length.decl?.property ?? '';
        const reasonArg =
            decision.reason === 'smart-keep'
                ? property
                : decision.reason === 'hairline'
                  ? options.hairline
                  : decision.reason === 'media-em' || decision.reason === 'media-rem'
                    ? options.mediaQueryBase
                    : decision.convert && decision.target.kind === 'unitless'
                      ? px2(decision.target.fontSize)
                      : decision.convert && decision.target.kind === 'template' && decision.target.emBase
                        ? px2(decision.target.emBase)
                        : decision.convert && decision.target.kind === 'token'
                          ? decision.target.token.reference
                          : '';
        if (decision.reason !== 'not-px') {
            md.appendMarkdown(`_${msg(reasonId, reasonArg)}_\n\n`);
        }

        const alt = alternativesAt(doc, length.start, options, ctx);
        if (alt && alt.options.length > 1) {
            md.appendMarkdown(alt.options.slice(1).map(code).join(' · ') + '\n\n');
        }
        if (options.tokens.enable && length.decl && length.value > 0) {
            const category = categoryForProperty(length.decl.property);
            const exact = ctx.tokens.exactLength(length.value, category, length.region.syntax, !!length.region.jsTemplate);
            if (exact.length) {
                md.appendMarkdown(vscode.l10n.t('Token: {0}', exact.map(t => code(t.reference)).join(', ')) + '\n\n');
            } else {
                const near = ctx.tokens.neighbours(length.value, category, length.region.syntax, !!length.region.jsTemplate);
                const parts = [near.below, near.above].filter(Boolean).map(s => `${code(s!.tokens[0].reference)} (${px2(s!.px)}px)`);
                if (parts.length) {
                    md.appendMarkdown(vscode.l10n.t('Between tokens: {0}', parts.join(' ↔ ')) + '\n\n');
                }
            }
        }
        md.appendMarkdown(`<sub>${rootLine(state)}</sub>`);
        md.supportHtml = true;
        return new vscode.Hover(md, toRange(document, length.start, length.end));
    }

    private lengthHover(state: DocState, offset: number): vscode.Hover | undefined {
        const { document, doc, options, ctx } = state;
        const found = pxAt(doc, offset, options, ctx);
        if (!found) {
            return undefined;
        }
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = true;
        const raw = doc.text.slice(found.start, found.end);
        md.appendMarkdown(`**${code(raw)} = ${code(px2(found.px) + 'px')}**`);
        const length = found.length;
        if (length && length.unit === 'em' && length.context !== 'media' && length.context !== 'container') {
            const base = emBaseFor(doc, length, ctx, options.functionName);
            md.appendMarkdown(
                base.assumed
                    ? `  \n_${vscode.l10n.t('Assuming the inherited font size is {0}px; em depends on the parent element.', px2(base.px))}_`
                    : `  \n_${vscode.l10n.t('Relative to this element’s font size ({0}px).', px2(base.px))}_`,
            );
        } else if (length && (length.context === 'media' || length.context === 'container') && (length.unit === 'em' || length.unit === 'rem')) {
            md.appendMarkdown(`  \n_${vscode.l10n.t('Media queries use the browser default font size ({0}px), not the html font size.', options.mediaQueryBase)}_`);
        } else if (length && /^(vw|vh|vmin|vmax|svw|dvw|lvw|svh|dvh|lvh)$/.test(length.unit)) {
            md.appendMarkdown(`  \n_${vscode.l10n.t('At the design viewport of {0}×{1}px.', options.designWidth, options.designHeight)}_`);
        }
        const alt = alternativesAt(doc, offset, options, ctx);
        if (alt && alt.options.length > 1) {
            md.appendMarkdown('\n\n' + alt.options.filter(o => o !== alt.current).map(code).join(' · '));
        }
        md.appendMarkdown(`\n\n<sub>${rootLine(state)}</sub>`);
        return new vscode.Hover(md, toRange(document, found.start, found.end));
    }

    private variableHover(state: DocState, name: string, range: vscode.Range): vscode.Hover | undefined {
        const { doc, options, ctx } = state;
        const env = evalEnv(doc, options, ctx);
        const raw = env.resolveVariable?.(name);
        const token = ctx.tokens.get(name);
        if (raw === undefined && !token) {
            return undefined;
        }
        const value = raw ?? token!.rawValue;
        const explanation = explainValue(value, env, [options.designWidth], false, false);
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = true;
        md.appendMarkdown(`${code(name)}: ${code(value.trim())}`);
        const px = explanation?.rows[0]?.px;
        if (px !== undefined && !explanation?.viewportDependent) {
            md.appendMarkdown(` = **${code(px2(px) + 'px')}** · ${code(formatNumber(px / ctx.rootFontSize, { precision: options.precision, leadingZero: options.leadingZero }) + 'rem')}`);
        }
        if (token?.color) {
            md.appendMarkdown(` · ${toHex(token.color)}`);
        }
        if (token?.source?.file) {
            md.appendMarkdown(`\n\n<sub>${token.source.file}${token.source.line !== undefined ? `:${token.source.line + 1}` : ''}</sub>`);
        }
        return new vscode.Hover(md, range);
    }

    private mathHover(state: DocState, start: number, end: number): vscode.Hover | undefined {
        const { document, doc, options, ctx } = state;
        const text = doc.text.slice(start, end);
        const length = doc.lengths.find(l => l.start >= start && l.end <= end);
        const decl = doc.declarations.find(d => d.start <= start && end <= d.end);
        const emBase = length ? emBaseFor(doc, length, ctx, options.functionName).px : ctx.rootFontSize;
        const isFontSize = decl?.property === 'font-size';
        const explanation = explainValue(text, evalEnv(doc, options, ctx, emBase), options.fluid.breakpoints, isFontSize, options.fluid.checkZoom);
        if (!explanation || explanation.rows.every(r => r.px === undefined)) {
            return undefined;
        }
        const md = new vscode.MarkdownString(undefined, true);
        md.supportHtml = true;
        if (explanation.viewportDependent) {
            md.appendMarkdown(`| ${vscode.l10n.t('Viewport')} | px | rem |\n|---:|---:|---:|\n`);
            for (const row of explanation.rows) {
                const value = row.px === undefined ? '—' : px2(row.px);
                const rem = row.px === undefined ? '—' : formatNumber(row.px / ctx.rootFontSize, { precision: 3, leadingZero: true });
                md.appendMarkdown(`| ${row.viewport}px | ${value} | ${rem} |\n`);
            }
        } else {
            const px = explanation.rows[0].px!;
            md.appendMarkdown(`**${code(text.length > 60 ? text.slice(0, 57) + '…' : text)} = ${code(px2(px) + 'px')}**`);
        }
        if (explanation.zoom) {
            md.appendMarkdown(
                '\n\n' +
                    (explanation.zoom.passes
                        ? `✅ ${vscode.l10n.t('Reaches 200% with browser zoom at every window width (WCAG 1.4.4).')}`
                        : `⚠️ ${vscode.l10n.t('With browser zoom it only reaches {0}% at a {1}px wide window (WCAG 1.4.4 needs 200%).', Math.round(explanation.zoom.worstScale * 100), Math.round(explanation.zoom.worstViewport))}`),
            );
        }
        if (explanation.viewportDependent && !explanation.respondsToFontSize && isFontSize) {
            md.appendMarkdown(`\n\n⚠️ ${vscode.l10n.t('Ignores the user’s font size setting: add a rem part.')}`);
        }
        return new vscode.Hover(md, toRange(document, start, end));
    }
}
