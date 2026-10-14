import { emBaseFor, type ProjectContext } from './context';
import { isEditableContext, type FunctionCallNode, type LengthNode, type ParsedDocument } from './document';
import { formatNumber, renderTemplate, templateValues, toPx, type UnitBases } from './format';
import { isFunctionTemplate, type Options } from './options';
import { categoryForProperty } from './properties';
import { decide, resolveTemplate, type Decision, type Reason, type Target } from './strategy';
import type { TextEdit } from './text';

export interface ConversionEdit extends TextEdit {
    length: LengthNode;
    target: Target;
    reason: Reason;
}

export interface ConversionPlan {
    edits: ConversionEdit[];
    /** px values that were left alone, with the reason. */
    skipped: { length: LengthNode; reason: Reason }[];
}

/** Restricts an operation to part of a document (selection, changed lines, …). */
export type LengthFilter = (item: { start: number; end: number; line: number }) => boolean;

export function unitBases(doc: ParsedDocument, length: LengthNode | undefined, options: Options, ctx: ProjectContext, emBase?: number): UnitBases {
    return {
        rootFontSize: ctx.rootFontSize,
        emBase: emBase ?? (length ? emBaseFor(doc, length, ctx, options.functionName).px : ctx.rootFontSize),
        designWidth: options.designWidth,
        designHeight: options.designHeight,
        functionName: options.functionName,
    };
}

const MATH_FUNCTIONS = new Set(['calc', 'clamp', 'min', 'max']);

/** px results are rounded to hundredths: sub-pixel noise from round trips (15.9998px) is not meaningful. */
function pxStyle(options: Options) {
    return { precision: Math.min(options.precision, 2), leadingZero: options.leadingZero };
}

/** Renders the replacement text for a decision. */
export function renderTarget(doc: ParsedDocument, length: LengthNode, target: Target, options: Options, ctx: ProjectContext): TextEdit {
    const style = { precision: options.precision, leadingZero: options.leadingZero };
    let start = length.start;
    let end = length.end;
    let text: string;
    switch (target.kind) {
        case 'zero':
            text = '0';
            break;
        case 'unitless':
            text = formatNumber(target.ratio, style);
            break;
        case 'token':
            text = target.token.reference;
            break;
        case 'tailwind-class': {
            const tw = length.region.tailwind!;
            start = tw.utilityStart;
            end = tw.valueEnd + 1;
            text = target.className;
            break;
        }
        case 'template': {
            const needsEm = target.template.includes('{em}');
            const bases = unitBases(doc, length, options, ctx, target.emBase ?? (needsEm ? undefined : ctx.rootFontSize));
            text = renderTemplate(target.template, templateValues(length.value, bases), style);
            const syntax = length.region.syntax;
            if (
                options.interpolateInCalc &&
                (syntax === 'scss' || syntax === 'sass') &&
                !length.region.jsTemplate &&
                isFunctionTemplate(target.template) &&
                length.functions.some(f => MATH_FUNCTIONS.has(f))
            ) {
                text = `#{${text}}`;
            }
            break;
        }
    }
    if (length.implicitPx) {
        text = `'${text}'`;
    }
    return { start, end, newText: text };
}

/** Plans the conversion of every px value accepted by `filter`. */
export function planConversion(doc: ParsedDocument, options: Options, ctx: ProjectContext, filter?: LengthFilter): ConversionPlan {
    const plan: ConversionPlan = { edits: [], skipped: [] };
    for (const length of doc.lengths) {
        if (length.unit !== 'px' || (filter && !filter(length))) {
            continue;
        }
        const decision = decide(doc, length, options, ctx);
        if (decision.convert) {
            const edit = renderTarget(doc, length, decision.target, options, ctx);
            if (edit.newText !== doc.text.slice(edit.start, edit.end)) {
                plan.edits.push({ ...edit, length, target: decision.target, reason: decision.reason });
            }
        } else if (isEditableContext(length.context) || length.disabled) {
            plan.skipped.push({ length, reason: decision.reason });
        }
    }
    return plan;
}

/** Decision for a single length (for hovers, quick fixes and diagnostics). */
export function decisionFor(doc: ParsedDocument, length: LengthNode, options: Options, ctx: ProjectContext): Decision {
    return decide(doc, length, options, ctx);
}

/** Parses the argument of a `rem(16)` / `rem(16px)` call. */
export function remFunctionArgument(doc: ParsedDocument, call: FunctionCallNode, options: Options): number | undefined {
    if (call.name !== options.functionName.toLowerCase() || call.args.length < 1 || call.args.length > 2) {
        return undefined;
    }
    const arg = doc.text.slice(call.args[0].start, call.args[0].end).trim();
    const m = /^(-?(?:\d+\.?\d*|\.\d+))(px)?$/i.exec(arg);
    return m ? Number(m[1]) : undefined;
}

/** Plans "convert back to px" for the units listed in `options.reverseUnits`. */
export function planReverse(doc: ParsedDocument, options: Options, ctx: ProjectContext, filter?: LengthFilter): TextEdit[] {
    const units = new Set(options.reverseUnits);
    const edits: TextEdit[] = [];
    for (const length of doc.lengths) {
        if (!units.has(length.unit) || length.disabled || (filter && !filter(length))) {
            continue;
        }
        if (!isEditableContext(length.context) || length.inInterpolation) {
            continue;
        }
        const inMedia = length.context === 'media' || length.context === 'container';
        const emBase = length.unit === 'em' || inMedia ? (inMedia ? options.mediaQueryBase : undefined) : ctx.rootFontSize;
        const bases = unitBases(doc, length, options, ctx, emBase);
        if (inMedia && length.unit === 'rem') {
            bases.rootFontSize = options.mediaQueryBase;
        }
        const px = toPx(length.value, length.unit, bases);
        if (px === undefined) {
            continue;
        }
        edits.push({ start: length.start, end: length.end, newText: `${formatNumber(px, pxStyle(options))}px` });
    }
    if (units.has('function')) {
        for (const call of doc.functions) {
            const px = remFunctionArgument(doc, call, options);
            if (px === undefined || !isEditableContext(call.context) || (filter && !filter(call))) {
                continue;
            }
            const span = call.interpolation ?? call;
            edits.push({ start: span.start, end: span.end, newText: `${formatNumber(px, pxStyle(options))}px` });
        }
    }
    return dropOverlaps(edits);
}

export interface RebasePlan {
    edits: TextEdit[];
    /** `html { font-size }` declarations that set the old base. */
    rootDeclarations: TextEdit[];
}

/**
 * Rewrites rem values so rendered sizes stay identical when the root font
 * size changes from `oldBase` to `newBase` (e.g. 10px → 16px when dropping
 * `html { font-size: 62.5% }`). Media queries are not affected by the root
 * font size and are left alone.
 */
export function planRebase(doc: ParsedDocument, oldBase: number, newBase: number, options: Options, filter?: LengthFilter): RebasePlan {
    const style = { precision: options.precision, leadingZero: options.leadingZero };
    const edits: TextEdit[] = [];
    for (const length of doc.lengths) {
        if (length.unit !== 'rem' || length.disabled || length.inInterpolation || (filter && !filter(length))) {
            continue;
        }
        if (length.context === 'media' || length.context === 'container' || !isEditableContext(length.context)) {
            continue;
        }
        const value = (length.value * oldBase) / newBase;
        edits.push({ start: length.start, end: length.end, newText: `${formatNumber(value, style)}rem` });
    }
    const rootDeclarations: TextEdit[] = [];
    for (const decl of doc.declarations) {
        const rule = decl.parent;
        if (decl.property !== 'font-size' || rule.kind !== 'rule' || !/^(html|:root)$/i.test(rule.selector ?? '') || rule.parent?.kind !== 'root') {
            continue;
        }
        const value = doc.text.slice(decl.valueSpan.start, decl.valueSpan.end).trim();
        const newText = value.endsWith('%') ? `${formatNumber((newBase / 16) * 100, style)}%` : `${formatNumber(newBase, style)}px`;
        rootDeclarations.push({ start: decl.valueSpan.start, end: decl.valueSpan.end, newText });
    }
    return { edits, rootDeclarations };
}

function dropOverlaps(edits: TextEdit[]): TextEdit[] {
    const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end);
    const out: TextEdit[] = [];
    let cursor = -1;
    for (const e of sorted) {
        if (e.start >= cursor) {
            out.push(e);
            cursor = e.end;
        }
    }
    return out;
}

/** The length or `rem()` call at an offset. */
export function valueAt(doc: ParsedDocument, offset: number): { length?: LengthNode; call?: FunctionCallNode } {
    const call = doc.functions.find(f => f.start <= offset && offset <= f.end && f.name !== 'calc' && f.name !== 'clamp' && f.name !== 'min' && f.name !== 'max' && f.name !== 'var');
    const length = doc.lengths.find(l => l.start <= offset && offset <= l.end);
    return { length, call };
}

/** px equivalent of the value at an offset, with the span it covers. */
export function pxAt(doc: ParsedDocument, offset: number, options: Options, ctx: ProjectContext): { px: number; start: number; end: number; length?: LengthNode } | undefined {
    const { length, call } = valueAt(doc, offset);
    if (call) {
        const px = remFunctionArgument(doc, call, options);
        if (px !== undefined) {
            const span = call.interpolation ?? call;
            return { px, start: span.start, end: span.end, length: doc.lengths.find(l => l.start >= call.start && l.end <= call.end) };
        }
    }
    if (length) {
        const inMedia = length.context === 'media' || length.context === 'container';
        const bases = unitBases(doc, length, options, ctx, inMedia ? options.mediaQueryBase : undefined);
        if (inMedia) {
            bases.rootFontSize = options.mediaQueryBase;
        }
        const px = toPx(length.value, length.unit, bases);
        if (px !== undefined) {
            return { px, start: length.start, end: length.end, length };
        }
    }
    return undefined;
}

/** Alternative spellings of the value at `offset`, in cycling order: px → format → rem → em → vw → tokens. */
export function alternativesAt(doc: ParsedDocument, offset: number, options: Options, ctx: ProjectContext): { start: number; end: number; current: string; options: string[] } | undefined {
    const found = pxAt(doc, offset, options, ctx);
    if (!found) {
        return undefined;
    }
    const { px, length } = found;
    const style = { precision: options.precision, leadingZero: options.leadingZero };
    const current = doc.text.slice(found.start, found.end);
    const list: string[] = [`${formatNumber(px, pxStyle(options))}px`];
    const inMedia = length?.context === 'media' || length?.context === 'container';
    if (length && inMedia) {
        // Media queries resolve rem and em against the browser default, not the root font size.
        list.push(`${formatNumber(px / options.mediaQueryBase, style)}em`);
        list.push(`${formatNumber(px / options.mediaQueryBase, style)}rem`);
    } else if (length) {
        const template = resolveTemplate(options, ctx, length);
        const bases = unitBases(doc, length, options, ctx);
        list.push(renderTemplate(template, templateValues(px, bases), style));
        list.push(`${formatNumber(px / ctx.rootFontSize, style)}rem`);
        list.push(`${formatNumber(px / bases.emBase, style)}em`);
        list.push(`${formatNumber((px / options.designWidth) * 100, style)}vw`);
        if (options.tokens.enable) {
            const category = categoryForProperty(length.decl?.property ?? '');
            for (const token of ctx.tokens.exactLength(Math.abs(px), category, length.region.syntax, !!length.region.jsTemplate).slice(0, 3)) {
                if (px > 0) {
                    list.push(token.reference);
                }
            }
        }
    } else {
        list.push(`${formatNumber(px / ctx.rootFontSize, style)}rem`);
    }
    let unique = [...new Set(list)];
    if (length?.implicitPx) {
        // `fontSize: 16` is a JS number: alternatives must be strings.
        unique = unique.map(text => `'${text}'`);
    }
    return { start: found.start, end: found.end, current, options: unique };
}

/** The next spelling for "cycle unit". */
export function cycleAt(doc: ParsedDocument, offset: number, options: Options, ctx: ProjectContext): TextEdit | undefined {
    const alt = alternativesAt(doc, offset, options, ctx);
    if (!alt || alt.options.length < 2) {
        return undefined;
    }
    let index = alt.options.indexOf(alt.current);
    if (index < 0 && /^-?[\d.]+$/.test(alt.current)) {
        // A bare React number is px.
        index = 0;
    }
    if (index < 0) {
        // Not a canonical spelling (e.g. `1.50rem`): find the entry with the same unit.
        const unit = /[a-z%]+$/i.exec(alt.current)?.[0] ?? '';
        index = alt.options.findIndex(o => o.endsWith(unit));
    }
    const next = alt.options[(index + 1) % alt.options.length];
    return { start: alt.start, end: alt.end, newText: next };
}
