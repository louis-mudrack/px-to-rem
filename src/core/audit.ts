import { emBaseFor, fontSizeOf, type ProjectContext } from './context';
import { renderTarget } from './convert';
import type { ColorNode, LengthNode, ParsedDocument } from './document';
import { explainValue } from './fluid';
import { formatNumber } from './format';
import type { MessageId } from './messages';
import type { Options, Severity } from './options';
import type { BlockNode, DeclarationNode } from './parser';
import { categoryForProperty, type Category } from './properties';
import { evalEnv } from './resolve';
import { decide, resolveTemplate, type Target } from './strategy';
import { isPreprocessor } from './syntax';
import type { TextEdit } from './text';
import { toHex } from './tokens/color';

export type RuleId =
    | 'px-unit'
    | 'font-size-px'
    | 'line-height-px'
    | 'letter-spacing-px'
    | 'media-query-px'
    | 'fixed-height-text'
    | 'text-width-px'
    | 'viewport-font-size'
    | 'fluid-zoom'
    | 'off-scale'
    | 'off-palette'
    | 'rem-function-missing';

export interface Fix {
    title: MessageId;
    titleArgs: (string | number)[];
    edits: TextEdit[];
    preferred?: boolean;
}

export interface Finding {
    rule: RuleId;
    severity: Exclude<Severity, 'off'>;
    start: number;
    end: number;
    line: number;
    message: MessageId;
    args: (string | number)[];
    fixes: Fix[];
}

export interface AuditEnv {
    /** False while the workspace scan is still running (suppresses project-wide rules). */
    projectReady: boolean;
    /** Only report on these zero-based lines (git-aware mode). */
    lines?: Set<number>;
}

const RULE_URL_BASE = 'https://github.com/louis-mudrack/px-to-rem/blob/master/docs/rules.md#';

export function ruleUrl(rule: RuleId): string {
    return RULE_URL_BASE + rule;
}

function insidePrint(block: BlockNode | undefined, doc: ParsedDocument): boolean {
    for (let b = block; b; b = b.parent) {
        if (b.kind === 'atrule' && b.name === 'media' && b.prelude && /\bprint\b/i.test(doc.text.slice(b.prelude.start, b.prelude.end))) {
            return true;
        }
    }
    return false;
}

function hasTextProperties(block: BlockNode): boolean {
    return block.declarations.some(d => d.property === 'font-size' || d.property === 'line-height' || d.property === 'font');
}

function declValue(doc: ParsedDocument, decl: DeclarationNode): string {
    return doc.text.slice(decl.valueSpan.start, decl.valueSpan.end).trim();
}

/** Runs every enabled rule over a document. */
export function audit(doc: ParsedDocument, options: Options, ctx: ProjectContext, env: AuditEnv): Finding[] {
    if (!options.diagnostics.enable || doc.directives.fileDisabled) {
        return [];
    }
    const rules = options.diagnostics.rules;
    const severity = (rule: RuleId): Exclude<Severity, 'off'> | undefined => {
        const s = rules[rule];
        return s && s !== 'off' ? s : undefined;
    };
    const findings: Finding[] = [];
    const add = (rule: RuleId, start: number, end: number, message: MessageId, args: (string | number)[], fixes: Fix[] = []) => {
        const sev = severity(rule);
        if (!sev) {
            return;
        }
        const line = doc.lines.lineAt(start);
        if (env.lines && !env.lines.has(line)) {
            return;
        }
        findings.push({ rule, severity: sev, start, end, line, message, args, fixes });
    };
    const style = { precision: options.precision, leadingZero: options.leadingZero };
    const raw = (n: { start: number; end: number }) => doc.text.slice(n.start, n.end);

    /** A rem (or unitless/em) rendering of a px length, ignoring user filters. */
    const suggestion = (length: LengthNode, target?: Target): TextEdit => {
        const t: Target = target ?? { kind: 'template', template: '{rem}rem' };
        return renderTarget(doc, length, t, options, ctx);
    };

    for (const length of doc.lengths) {
        if (length.disabled || length.unit !== 'px' || length.inInterpolation) {
            continue;
        }
        if (options.ignoreUppercasePx && length.rawUnit !== 'px' && !length.implicitPx) {
            continue;
        }
        const property = length.decl?.property ?? '';
        const inDeclaration = length.context === 'declaration';

        // Generic px → configured output.
        if (severity('px-unit') && (inDeclaration || length.context === 'variable' || length.context === 'custom-property' || length.context === 'mixin')) {
            const d = decide(doc, length, options, ctx);
            if (d.convert) {
                const edit = renderTarget(doc, length, d.target, options, ctx);
                add('px-unit', length.start, length.end, 'diag.px-unit', [raw(length), edit.newText], [
                    { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit], preferred: true },
                ]);
            }
        }

        if (!inDeclaration && length.context !== 'media' && length.context !== 'container') {
            continue;
        }
        if (insidePrint(length.block, doc)) {
            continue;
        }
        const zeroish = Math.abs(length.value) === 0;

        if ((length.context === 'media' || length.context === 'container') && !zeroish) {
            const edit = suggestion(length, { kind: 'template', template: '{em}em', emBase: options.mediaQueryBase });
            add('media-query-px', length.start, length.end, 'diag.media-query-px', [edit.newText], [
                { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit], preferred: true },
            ]);
            continue;
        }

        const inMathOfOtherValue = length.functions.some(f => f === 'var');
        if (zeroish || inMathOfOtherValue) {
            continue;
        }

        if ((property === 'font-size' || (property === 'font' && !length.shorthandFontSize)) && length.region.kind !== 'tailwind') {
            const edit = suggestion(length, { kind: 'template', template: resolveTemplate(options, ctx, length) });
            add('font-size-px', length.start, length.end, 'diag.font-size-px', [edit.newText], [
                { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit], preferred: true },
            ]);
        } else if (property === 'line-height' || length.shorthandFontSize) {
            const fontSize = length.shorthandFontSize?.unit === 'px' ? length.shorthandFontSize.value : fontSizeOf(doc, length.block, ctx, options.functionName);
            const target: Target | undefined = fontSize ? { kind: 'unitless', ratio: length.value / fontSize, fontSize } : undefined;
            const edit = suggestion(length, target);
            add('line-height-px', length.start, length.end, 'diag.line-height-px', [edit.newText], [
                { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit], preferred: true },
            ]);
        } else if (property === 'letter-spacing' || property === 'word-spacing') {
            const base = emBaseFor(doc, length, ctx, options.functionName);
            const edit = suggestion(length, base.assumed ? undefined : { kind: 'template', template: '{em}em', emBase: base.px });
            add('letter-spacing-px', length.start, length.end, 'diag.letter-spacing-px', [edit.newText], [
                { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit], preferred: true },
            ]);
        } else if (property === 'max-width' && length.decl && hasTextProperties(length.block) && length.functions.length === 0) {
            const edit = suggestion(length);
            add('text-width-px', length.start, length.end, 'diag.text-width-px', [edit.newText], [
                { title: 'fix.convertTo', titleArgs: [edit.newText], edits: [edit] },
            ]);
        }
    }

    // Fixed heights on text containers.
    if (severity('fixed-height-text')) {
        for (const decl of doc.declarations) {
            if (decl.property !== 'height' || decl.variable || !hasTextProperties(decl.parent) || insidePrint(decl.parent, doc)) {
                continue;
            }
            if (decl.parent.declarations.some(d => d.property === 'overflow' || d.property === 'overflow-y' || d.property === 'min-height')) {
                continue;
            }
            const value = declValue(doc, decl);
            const m = /^(-?[\d.]+)(px|rem|em)$/i.exec(value);
            if (!m) {
                continue;
            }
            const px = m[2].toLowerCase() === 'px' ? Number(m[1]) : Number(m[1]) * ctx.rootFontSize;
            if (px <= 2) {
                continue;
            }
            add('fixed-height-text', decl.propertySpan.start, decl.propertySpan.end, 'diag.fixed-height-text', [], [
                { title: 'fix.minHeight', titleArgs: [], edits: [{ start: decl.propertySpan.start, end: decl.propertySpan.end, newText: 'min-height' }], preferred: true },
            ]);
        }
    }

    // Viewport-based font sizes.
    if (severity('viewport-font-size') || (severity('fluid-zoom') && options.fluid.checkZoom)) {
        const env0 = evalEnv(doc, options, ctx);
        for (const decl of doc.declarations) {
            if (decl.property !== 'font-size' || insidePrint(decl.parent, doc)) {
                continue;
            }
            const value = declValue(doc, decl);
            if (!/(vw|vi|vmin|vmax|cqi|cqw|vh)\b/i.test(value)) {
                continue;
            }
            const firstLine = doc.lines.lineAt(decl.valueSpan.start);
            if (doc.directives.lines.has(firstLine)) {
                continue;
            }
            const explanation = explainValue(value, env0, options.fluid.breakpoints, true, options.fluid.checkZoom);
            if (!explanation) {
                continue;
            }
            const pureViewport = !explanation.respondsToFontSize && !/\d(px|rem|em)\b/i.test(value);
            if (pureViewport) {
                add('viewport-font-size', decl.valueSpan.start, decl.valueSpan.end, 'diag.viewport-font-size', []);
            } else if (explanation.zoom && !explanation.zoom.passes) {
                add('fluid-zoom', decl.valueSpan.start, decl.valueSpan.end, 'diag.fluid-zoom', [
                    Math.round(explanation.zoom.worstScale * 100),
                    Math.round(explanation.zoom.worstViewport),
                ]);
            }
        }
    }

    // Values off the design-token scale.
    if (severity('off-scale') && options.tokens.enable && ctx.tokens.lengths.length) {
        for (const length of doc.lengths) {
            if (length.disabled || length.context !== 'declaration' || length.functions.length || length.inInterpolation || length.region.tailwind) {
                continue;
            }
            if (length.unit !== 'px' && length.unit !== 'rem') {
                continue;
            }
            const property = length.decl?.property ?? '';
            const category: Category = categoryForProperty(property);
            if (category !== 'spacing' && category !== 'size' && category !== 'font-size' && category !== 'radius') {
                continue;
            }
            const px = Math.abs(length.unit === 'px' ? length.value : length.value * ctx.rootFontSize);
            if (px <= options.hairline || px === 0) {
                continue;
            }
            const syntax = length.region.syntax;
            const scale = ctx.tokens.scale(category, syntax, !!length.region.jsTemplate);
            if (scale.length < 3 || scale.some(s => Math.abs(s.px - px) < 1e-6)) {
                continue;
            }
            // Only flag values inside the scale's range; huge widths are not spacing decisions.
            if (px > scale[scale.length - 1].px * 1.5) {
                continue;
            }
            const { nearest } = ctx.tokens.neighbours(px, category, syntax, !!length.region.jsTemplate);
            if (!nearest) {
                continue;
            }
            const sign = length.value < 0 ? -1 : 1;
            const token = nearest.tokens[0];
            const snapped = length.unit === 'px' ? `${formatNumber(sign * nearest.px, style)}px` : `${formatNumber((sign * nearest.px) / ctx.rootFontSize, style)}rem`;
            const fixes: Fix[] = [];
            if (sign > 0) {
                fixes.push({ title: 'fix.useToken', titleArgs: [token.reference], edits: [{ start: length.start, end: length.end, newText: token.reference }], preferred: true });
            }
            fixes.push({ title: 'fix.snapTo', titleArgs: [snapped], edits: [{ start: length.start, end: length.end, newText: snapped }] });
            add('off-scale', length.start, length.end, 'diag.off-scale', [raw(length), `category.${category}`, `${token.reference} (${formatNumber(nearest.px, style)}px)`], fixes);
        }
    }

    // Colours close to (but not exactly) a colour token.
    if (severity('off-palette') && options.tokens.enable && options.tokens.colors && ctx.tokens.colors.length) {
        for (const color of doc.colors) {
            if (color.disabled || color.context !== 'declaration') {
                continue;
            }
            const near = nearestColorToken(color, ctx, options);
            if (near && near.distance > 0.5 && near.distance <= options.tokens.colorTolerance) {
                add('off-palette', color.start, color.end, 'diag.off-palette', [raw(color), near.reference, formatNumber(near.distance, { precision: 1, leadingZero: true })], [
                    { title: 'fix.useToken', titleArgs: [near.reference], edits: [{ start: color.start, end: color.end, newText: near.reference }], preferred: true },
                ]);
            }
        }
    }

    // rem() used but never defined.
    if (severity('rem-function-missing') && env.projectReady && !ctx.remFunctions.some(f => f.name.toLowerCase() === options.functionName.toLowerCase())) {
        const fn = options.functionName.toLowerCase();
        const call = doc.functions.find(f => f.name === fn && isPreprocessor(f.region.syntax) && f.context !== 'control' && !f.region.jsTemplate);
        if (call) {
            add('rem-function-missing', call.nameSpan.start, call.nameSpan.end, 'diag.rem-function-missing', [options.functionName], []);
        }
    }

    return findings;
}

/** The closest usable colour token, if any. */
export function nearestColorToken(color: ColorNode, ctx: ProjectContext, _options: Options): { reference: string; distance: number; hex: string } | undefined {
    const [best] = ctx.tokens.nearestColors(color.rgba, color.region.syntax, !!color.region.jsTemplate, 1);
    if (!best) {
        return undefined;
    }
    return { reference: best.token.reference, distance: best.distance, hex: toHex(best.token.color!) };
}
