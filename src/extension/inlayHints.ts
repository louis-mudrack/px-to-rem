import * as vscode from 'vscode';
import { emBaseFor } from '../core/context';
import { remFunctionArgument, unitBases } from '../core/convert';
import { explainValue } from '../core/fluid';
import { formatNumber, toPx } from '../core/format';
import { evalEnv } from '../core/resolve';
import type { Engine } from './engine';

const HINT_UNITS = new Set(['rem', 'em', 'vw', 'vh', 'vmin', 'vmax', 'rpx', 'pt']);

/** Shows px equivalents after rem, em, vw, rem() and variable references. */
export class InlayHintsProvider implements vscode.InlayHintsProvider {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeInlayHints = this.emitter.event;

    constructor(private readonly engine: Engine) {
        engine.onDidChange(() => this.emitter.fire());
    }

    provideInlayHints(document: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
        if (!this.engine.isLive(document)) {
            return [];
        }
        const options = this.engine.options(document);
        if (!options.inlayHints.enable) {
            return [];
        }
        const { doc, ctx } = this.engine.state(document);
        const start = document.offsetAt(range.start);
        const end = document.offsetAt(range.end);
        const style = { precision: 2, leadingZero: true };
        const hints: vscode.InlayHint[] = [];
        const hint = (offset: number, px: number, approx: boolean, tooltip: string) => {
            const h = new vscode.InlayHint(document.positionAt(offset), `${approx ? '≈' : '='}${formatNumber(px, style)}px`, vscode.InlayHintKind.Type);
            h.paddingLeft = true;
            h.tooltip = tooltip;
            hints.push(h);
        };

        for (const length of doc.lengths) {
            if (length.end < start || length.start > end || !HINT_UNITS.has(length.unit) || length.functions.length && length.functions.includes(options.functionName.toLowerCase())) {
                continue;
            }
            if (length.context === 'selector' || length.context === 'control') {
                continue;
            }
            const inMedia = length.context === 'media' || length.context === 'container';
            let approx = false;
            let emBase: number | undefined;
            if (length.unit === 'em' && !inMedia) {
                const base = emBaseFor(doc, length, ctx, options.functionName);
                approx = base.assumed;
                emBase = base.px;
            }
            const bases = unitBases(doc, length, options, ctx, inMedia ? options.mediaQueryBase : emBase ?? ctx.rootFontSize);
            if (inMedia) {
                bases.rootFontSize = options.mediaQueryBase;
            }
            const px = toPx(length.value, length.unit, bases);
            if (px === undefined) {
                continue;
            }
            const tooltip = inMedia
                ? vscode.l10n.t('Media queries use the browser default font size ({0}px).', options.mediaQueryBase)
                : length.unit === 'em'
                  ? vscode.l10n.t('em relative to {0}px', formatNumber(bases.emBase, style))
                  : vscode.l10n.t('1rem = {0}px', formatNumber(ctx.rootFontSize, style));
            hint(length.end, px, approx, tooltip);
        }

        const fn = options.functionName.toLowerCase();
        for (const call of doc.functions) {
            if (call.end < start || call.start > end || call.name !== fn || call.context === 'control') {
                continue;
            }
            const px = remFunctionArgument(doc, call, options);
            if (px !== undefined) {
                const end = call.interpolation?.end ?? call.end;
                hint(end, (px / ctx.rootFontSize) * ctx.rootFontSize, false, `${formatNumber(px / ctx.rootFontSize, { precision: options.precision, leadingZero: true })}rem`);
            }
        }

        if (options.inlayHints.variables) {
            const env = evalEnv(doc, options, ctx);
            for (const decl of doc.declarations) {
                if (decl.end < start || decl.start > end) {
                    continue;
                }
                const value = doc.text.slice(decl.valueSpan.start, decl.valueSpan.end);
                const re = /var\(\s*(--[\w-]+)[^)]*\)|(\$[\w-]+)|(?<![\w-])(@[\w-]+)/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(value))) {
                    const name = m[1] ?? m[2] ?? m[3];
                    const rawValue = env.resolveVariable?.(name);
                    if (rawValue === undefined) {
                        continue;
                    }
                    const explanation = explainValue(rawValue, env, [options.designWidth], false, false);
                    const px = explanation?.rows[0]?.px;
                    if (px === undefined || explanation?.viewportDependent || Math.abs(px) < 1e-9 && !/\b0(px)?\b/.test(rawValue)) {
                        continue;
                    }
                    hint(decl.valueSpan.start + m.index + m[0].length, px, false, `${name}: ${rawValue.trim()}`);
                }
            }
        }
        return hints;
    }
}
