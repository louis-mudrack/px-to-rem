import { emBaseFor, fontSizeOf, type ProjectContext } from './context';
import type { LengthNode, ParsedDocument } from './document';
import { formatTemplate, isFunctionTemplate, type Options } from './options';
import { categoryForName, categoryForProperty, DEFAULT_SMART_RULES, lookupRule, matchesPropertyPattern, type SmartAction } from './properties';
import { isPreprocessor } from './syntax';
import { canonicalTailwindClass } from './tailwind';
import type { TokenDef } from './tokens';

/** Why a value was (or was not) converted. Used in hovers and reports. */
export type Reason =
    | 'not-px'
    | 'disabled'
    | 'uppercase'
    | 'excluded-pattern'
    | 'context'
    | 'breakpoint-mixin'
    | 'interpolation'
    | 'inside-function'
    | 'variables-off'
    | 'mixins-off'
    | 'out-of-range'
    | 'excluded-property'
    | 'not-included-property'
    | 'media-keep'
    | 'media-em'
    | 'media-rem'
    | 'media-format'
    | 'zero'
    | 'smart-keep'
    | 'hairline'
    | 'smart-em'
    | 'smart-unitless'
    | 'smart-rem'
    | 'smart-convert'
    | 'smart-fallback'
    | 'format'
    | 'token'
    | 'tailwind-scale';

export type Target =
    | { kind: 'template'; template: string; emBase?: number; emAssumed?: boolean }
    | { kind: 'unitless'; ratio: number; fontSize: number }
    | { kind: 'zero' }
    | { kind: 'token'; token: TokenDef }
    | { kind: 'tailwind-class'; className: string };

export type Decision = { convert: true; target: Target; reason: Reason } | { convert: false; reason: Reason };

/** Functions whose arguments are already handled by a converter. */
const CONVERTER_FUNCTIONS = new Set(['rem', 'torem', 'to-rem', 'pxtorem', 'px-to-rem', 'px2rem', 'rpx', 'em', 'toem', 'to-em', 'pxtoem', 'vw', 'tovw', 'pxtovw']);

/** The template used for "convert" decisions in a region of a given syntax. */
export function resolveTemplate(options: Options, ctx: ProjectContext, length: Pick<LengthNode, 'region'>): string {
    const { region } = length;
    const syntax = region.syntax;
    let template: string;
    if (options.format === 'auto') {
        const hasFunction =
            isPreprocessor(syntax) &&
            !region.jsTemplate &&
            region.kind !== 'js-object' &&
            region.kind !== 'tailwind' &&
            ctx.remFunctions.some(f => f.name.toLowerCase() === options.functionName.toLowerCase() && (f.syntax === syntax || (syntax === 'sass' && f.syntax === 'scss') || (syntax === 'scss' && f.syntax === 'sass')));
        template = hasFunction ? formatTemplate('rem-function') : formatTemplate('rem');
    } else {
        template = formatTemplate(options.format);
    }
    if (isFunctionTemplate(template)) {
        // Plain CSS, inline styles, JS objects and Tailwind cannot call preprocessor functions.
        if (!isPreprocessor(syntax) || region.kind === 'js-object' || region.kind === 'tailwind') {
            return formatTemplate('rem');
        }
        if (region.jsTemplate) {
            return '${' + template + '}';
        }
    }
    return template;
}

function lineText(doc: ParsedDocument, line: number): string {
    return doc.lines.lineText(line);
}

function compilePatterns(patterns: string[]): RegExp[] {
    const out: RegExp[] = [];
    for (const p of patterns) {
        try {
            out.push(new RegExp(p));
        } catch {
            // Invalid user regex: ignore it rather than matching everything.
        }
    }
    return out;
}

const patternCache = new Map<string, RegExp[]>();
function excludeRegexes(patterns: string[]): RegExp[] {
    const key = patterns.join('\u0000');
    let cached = patternCache.get(key);
    if (!cached) {
        cached = compilePatterns(patterns);
        patternCache.set(key, cached);
    }
    return cached;
}

/** The property a length is filtered by: the declaration property, or the variable name. */
export function effectiveProperty(length: LengthNode): string {
    return length.decl?.property ?? '';
}

const mergedRules = new WeakMap<Record<string, SmartAction>, Record<string, SmartAction>>();

/** Default smart rules merged with the user's, cached per options object. */
function smartRules(options: Options): Record<string, SmartAction> {
    let merged = mergedRules.get(options.smartRules);
    if (!merged) {
        merged = { ...DEFAULT_SMART_RULES, ...options.smartRules };
        mergedRules.set(options.smartRules, merged);
    }
    return merged;
}

/** Decides what to do with one length. */
export function decide(doc: ParsedDocument, length: LengthNode, options: Options, ctx: ProjectContext): Decision {
    if (length.unit !== 'px') {
        return { convert: false, reason: 'not-px' };
    }
    if (length.disabled) {
        return { convert: false, reason: 'disabled' };
    }
    if (options.ignoreUppercasePx && length.rawUnit !== 'px' && !length.implicitPx) {
        return { convert: false, reason: 'uppercase' };
    }
    if (options.excludePatterns.length && excludeRegexes(options.excludePatterns).some(r => r.test(lineText(doc, length.line)))) {
        return { convert: false, reason: 'excluded-pattern' };
    }
    if (length.region.kind === 'js-object' && ctx.reactNative) {
        return { convert: false, reason: 'context' };
    }

    switch (length.context) {
        case 'selector':
        case 'control':
        case 'supports':
        case 'other':
            return { convert: false, reason: 'context' };
        case 'breakpoint-mixin':
            return { convert: false, reason: 'breakpoint-mixin' };
        case 'mixin':
            if (!options.convertMixinArguments) {
                return { convert: false, reason: 'mixins-off' };
            }
            break;
        case 'variable':
        case 'custom-property':
            if (!options.convertVariables) {
                return { convert: false, reason: 'variables-off' };
            }
            break;
    }
    if (length.inInterpolation) {
        return { convert: false, reason: 'interpolation' };
    }
    const fnName = options.functionName.toLowerCase();
    if (length.functions.some(f => f === fnName || CONVERTER_FUNCTIONS.has(f))) {
        return { convert: false, reason: 'inside-function' };
    }

    const abs = Math.abs(length.value);
    if (abs < options.minValue || abs > options.maxValue) {
        return { convert: false, reason: 'out-of-range' };
    }

    if (length.context === 'media' || length.context === 'container') {
        switch (options.mediaQueries) {
            case 'keep':
                return { convert: false, reason: 'media-keep' };
            case 'em':
                return { convert: true, target: { kind: 'template', template: '{em}em', emBase: options.mediaQueryBase }, reason: 'media-em' };
            case 'rem':
                return { convert: true, target: { kind: 'template', template: '{em}rem', emBase: options.mediaQueryBase }, reason: 'media-rem' };
            default:
                return { convert: true, target: { kind: 'template', template: resolveTemplate(options, ctx, length) }, reason: 'media-format' };
        }
    }

    const property = effectiveProperty(length);
    if (options.includeProperties.length && !options.includeProperties.some(p => matchesPropertyPattern(property, p))) {
        return { convert: false, reason: 'not-included-property' };
    }
    if (options.excludeProperties.some(p => matchesPropertyPattern(property, p))) {
        return { convert: false, reason: 'excluded-property' };
    }

    if (length.value === 0 && options.preserveZero) {
        return { convert: true, target: { kind: 'zero' }, reason: 'zero' };
    }

    // Tailwind scale classes and exact tokens win over unit conversion when enabled.
    const tw = length.region.tailwind;
    if (tw && ctx.tailwind && options.tailwind.preferScale && !tw.arbitraryProperty && singleLength(doc, length)) {
        // Tailwind scales are rem based; TailwindConfig values are expressed at a 16px root.
        const px16 = (length.value * 16) / ctx.rootFontSize;
        const className = canonicalTailwindClass(tw.utility, px16, tw.negative || length.value < 0, ctx.tailwind);
        if (className) {
            return { convert: true, target: { kind: 'tailwind-class', className }, reason: 'tailwind-scale' };
        }
    }
    if (options.tokens.enable && options.tokens.preferTokens && length.context === 'declaration' && !length.region.tailwind && length.region.kind !== 'js-object') {
        const category = categoryForProperty(property);
        const tokens = ctx.tokens.exactLength(abs, category, length.region.syntax, !!length.region.jsTemplate);
        if (tokens.length && length.value > 0) {
            return { convert: true, target: { kind: 'token', token: tokens[0] }, reason: 'token' };
        }
    }

    const template = resolveTemplate(options, ctx, length);
    if (options.mode === 'simple') {
        return { convert: true, target: { kind: 'template', template }, reason: 'format' };
    }

    // Smart mode.
    let action: SmartAction;
    if (length.shorthandFontSize) {
        action = 'unitless';
    } else if (length.context === 'variable' || length.context === 'custom-property') {
        const category = categoryForName(property);
        action = category === 'border' || category === 'shadow' || category === 'breakpoint' ? 'keep' : 'convert';
    } else {
        action = lookupRule(smartRules(options), property) ?? 'convert';
    }

    // Hairlines (1px nudges, separators) stay crisp; text-relative values still scale.
    const textProperty = property === 'font-size' || property === 'font' || property === 'line-height';
    if ((action === 'convert' || action === 'rem') && options.hairline > 0 && abs > 0 && abs <= options.hairline && !textProperty) {
        return { convert: false, reason: 'hairline' };
    }

    switch (action) {
        case 'keep':
            return { convert: false, reason: 'smart-keep' };
        case 'rem':
            return { convert: true, target: { kind: 'template', template: '{rem}rem' }, reason: 'smart-rem' };
        case 'unitless': {
            const fontSize = length.shorthandFontSize
                ? fontSizePx(length.shorthandFontSize, ctx)
                : fontSizeOf(doc, length.block, ctx, options.functionName);
            if (fontSize && fontSize > 0) {
                return { convert: true, target: { kind: 'unitless', ratio: length.value / fontSize, fontSize }, reason: 'smart-unitless' };
            }
            return { convert: true, target: { kind: 'template', template }, reason: 'smart-fallback' };
        }
        case 'em': {
            const base = emBaseFor(doc, length, ctx, options.functionName);
            if (!base.assumed) {
                return { convert: true, target: { kind: 'template', template: '{em}em', emBase: base.px }, reason: 'smart-em' };
            }
            return { convert: true, target: { kind: 'template', template }, reason: 'smart-fallback' };
        }
        default:
            return { convert: true, target: { kind: 'template', template }, reason: 'smart-convert' };
    }
}

function fontSizePx(length: LengthNode, ctx: ProjectContext): number | undefined {
    if (length.unit === 'px') {
        return length.value;
    }
    if (length.unit === 'rem') {
        return length.value * ctx.rootFontSize;
    }
    return undefined;
}

/** Whether the length is the only value in its declaration (Tailwind class mapping needs that). */
function singleLength(doc: ParsedDocument, length: LengthNode): boolean {
    const decl = length.decl;
    if (!decl) {
        return false;
    }
    return doc.text.slice(decl.valueSpan.start, decl.valueSpan.end).trim() === doc.text.slice(length.start, length.end);
}
