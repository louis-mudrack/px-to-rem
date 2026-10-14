/** Groups of properties that share a design scale. */
export type Category =
    | 'spacing'
    | 'size'
    | 'font-size'
    | 'line-height'
    | 'letter-spacing'
    | 'radius'
    | 'border'
    | 'shadow'
    | 'breakpoint'
    | 'other';

export const CATEGORIES: readonly Category[] = [
    'spacing',
    'size',
    'font-size',
    'line-height',
    'letter-spacing',
    'radius',
    'border',
    'shadow',
    'breakpoint',
    'other',
];

/** What smart mode does with a px value of a property. */
export type SmartAction = 'convert' | 'rem' | 'em' | 'unitless' | 'keep';

/** Default smart-mode rules. Keys are property names or `*` globs. */
export const DEFAULT_SMART_RULES: Readonly<Record<string, SmartAction>> = {
    'font-size': 'convert',
    'line-height': 'unitless',
    'letter-spacing': 'em',
    'word-spacing': 'em',
    border: 'keep',
    'border-width': 'keep',
    'border-*-width': 'keep',
    'border-top': 'keep',
    'border-right': 'keep',
    'border-bottom': 'keep',
    'border-left': 'keep',
    'border-block': 'keep',
    'border-block-start': 'keep',
    'border-block-end': 'keep',
    'border-inline': 'keep',
    'border-inline-start': 'keep',
    'border-inline-end': 'keep',
    'border-spacing': 'convert',
    '*-radius': 'convert',
    outline: 'keep',
    'outline-width': 'keep',
    'outline-offset': 'keep',
    'box-shadow': 'keep',
    'text-shadow': 'keep',
    'column-rule': 'keep',
    'column-rule-width': 'keep',
    'stroke-width': 'keep',
    '-webkit-text-stroke': 'keep',
    '-webkit-text-stroke-width': 'keep',
    filter: 'keep',
    'backdrop-filter': 'keep',
    'text-decoration-thickness': 'em',
    'text-underline-offset': 'em',
};

const SPACING = /^(margin|padding|gap|row-gap|column-gap|grid-gap|grid-row-gap|grid-column-gap|inset|top|right|bottom|left|scroll-margin|scroll-padding|text-indent|border-spacing|translate)(-|$)/;
const SIZE = /^(width|height|min-width|min-height|max-width|max-height|inline-size|block-size|min-inline-size|max-inline-size|min-block-size|max-block-size|flex-basis|flex|column-width|grid-template-columns|grid-template-rows|grid-auto-columns|grid-auto-rows|background-size|mask-size|container|size)$/;

/** Category of a CSS property, for token scales and statistics. */
export function categoryForProperty(property: string): Category {
    const p = property.toLowerCase();
    if (p === 'font-size' || p === 'font') {
        return 'font-size';
    }
    if (p === 'line-height') {
        return 'line-height';
    }
    if (p === 'letter-spacing' || p === 'word-spacing') {
        return 'letter-spacing';
    }
    if (p.endsWith('-radius')) {
        return 'radius';
    }
    if (/^(border|outline|column-rule|stroke-width|-webkit-text-stroke)/.test(p)) {
        return 'border';
    }
    if (/shadow$|^(backdrop-)?filter$/.test(p)) {
        return 'shadow';
    }
    if (SPACING.test(p)) {
        return 'spacing';
    }
    if (SIZE.test(p)) {
        return 'size';
    }
    return 'other';
}

/** Infers a category from a variable or token name such as `--space-4` or `$font-size-lg`. */
export function categoryForName(name: string): Category {
    const n = name.toLowerCase().replace(/^[-$@]+/, '');
    if (/(breakpoint|^bp\b|^bp-|-bp-|screen|^mq|media)/.test(n)) {
        return 'breakpoint';
    }
    if (/(radius|rounded|corner)/.test(n)) {
        return 'radius';
    }
    if (/(border|outline|stroke|hairline|divider)/.test(n)) {
        return 'border';
    }
    if (/(shadow|elevation)/.test(n)) {
        return 'shadow';
    }
    if (/(line-?height|leading|^lh\b|-lh\b)/.test(n)) {
        return 'line-height';
    }
    if (/(letter-?spacing|tracking)/.test(n)) {
        return 'letter-spacing';
    }
    if (/(font|text|type|^fs\b|-fs\b|heading|display|caption|title|body)/.test(n)) {
        return 'font-size';
    }
    if (/(space|spacing|spacer|gap|gutter|margin|padding|inset|stack|sp-|^s-?\d|^size-\d|^unit)/.test(n)) {
        return 'spacing';
    }
    if (/(width|height|size|container|wrapper|max|min)/.test(n)) {
        return 'size';
    }
    return 'other';
}

/** Which token categories may stand in for a value of the given property category. */
export function tokenCategoriesFor(category: Category): Category[] {
    switch (category) {
        case 'spacing':
            return ['spacing', 'size', 'other'];
        case 'size':
            return ['size', 'spacing', 'other'];
        default:
            return [category, 'other'];
    }
}

/** Properties that accept lengths, in kebab-case. Used to recognise JS style objects. */
export const LENGTH_PROPERTIES: ReadonlySet<string> = new Set([
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'margin-block', 'margin-block-start', 'margin-block-end', 'margin-inline', 'margin-inline-start', 'margin-inline-end',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-block-start', 'padding-block-end', 'padding-inline', 'padding-inline-start', 'padding-inline-end',
    'gap', 'row-gap', 'column-gap', 'grid-gap', 'grid-row-gap', 'grid-column-gap',
    'inset', 'inset-block', 'inset-block-start', 'inset-block-end', 'inset-inline', 'inset-inline-start', 'inset-inline-end', 'top', 'right', 'bottom', 'left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'inline-size', 'block-size', 'min-inline-size', 'max-inline-size', 'min-block-size', 'max-block-size',
    'font-size', 'font', 'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
    'border', 'border-width', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
    'border-start-start-radius', 'border-start-end-radius', 'border-end-start-radius', 'border-end-end-radius',
    'outline', 'outline-width', 'outline-offset', 'box-shadow', 'text-shadow',
    'flex', 'flex-basis', 'grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows',
    'background-size', 'background-position', 'transform', 'translate', 'perspective', 'column-width', 'column-rule-width',
    'scroll-margin', 'scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left',
    'scroll-padding', 'scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left',
    'text-underline-offset', 'text-decoration-thickness', 'stroke-width', 'vertical-align', 'object-position', 'transform-origin',
]);

/**
 * Properties React leaves unitless when given a number (so `lineHeight: 1.5`
 * is a ratio, not pixels).
 */
export const REACT_UNITLESS: ReadonlySet<string> = new Set([
    'line-height', 'flex', 'flex-grow', 'flex-shrink', 'z-index', 'opacity', 'font-weight', 'order', 'zoom', 'columns', 'column-count', 'tab-size', 'orphans', 'widows', 'grid-row', 'grid-column', 'aspect-ratio',
]);

/** `fontSize` → `font-size`, `WebkitTextStroke` → `-webkit-text-stroke`. */
export function camelToKebab(name: string): string {
    if (name.includes('-')) {
        return name.toLowerCase();
    }
    const kebab = name.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    if (/^(webkit|moz|ms|o)-/.test(kebab)) {
        return '-' + kebab;
    }
    return kebab;
}

/** Units that describe lengths. */
export const LENGTH_UNITS: ReadonlySet<string> = new Set([
    'px', 'rem', 'em', 'vw', 'vh', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', 'svi', 'svb', 'lvi', 'lvb', 'dvi', 'dvb', 'vi', 'vb',
    'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax', 'ch', 'ex', 'cap', 'ic', 'lh', 'rlh', 'rcap', 'rch', 'rex', 'ric',
    'pt', 'pc', 'cm', 'mm', 'q', 'in', 'rpx',
]);

/** Rules that compare a property against a glob pattern such as `border-*-width`. */
const patternCache = new Map<string, RegExp | string>();

export function matchesPropertyPattern(property: string, pattern: string): boolean {
    let compiled = patternCache.get(pattern);
    if (compiled === undefined) {
        const p = pattern.trim().toLowerCase();
        compiled = p.includes('*') ? new RegExp('^' + p.split('*').map(escapeRegExp).join('.*') + '$') : p;
        patternCache.set(pattern, compiled);
    }
    return typeof compiled === 'string' ? property === compiled : compiled.test(property);
}

/** Number of literal characters, used to pick the most specific matching pattern. */
export function patternSpecificity(pattern: string): number {
    return pattern.includes('*') ? pattern.replace(/\*/g, '').length : Number.MAX_SAFE_INTEGER;
}

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const lookupCache = new WeakMap<object, Map<string, unknown>>();

/** Finds the most specific rule for a property (memoized per rules object). */
export function lookupRule<T>(rules: Readonly<Record<string, T>>, property: string): T | undefined {
    let cache = lookupCache.get(rules);
    if (!cache) {
        cache = new Map();
        lookupCache.set(rules, cache);
    }
    if (cache.has(property)) {
        return cache.get(property) as T | undefined;
    }
    const found = findRule(rules, property);
    cache.set(property, found);
    return found;
}

function findRule<T>(rules: Readonly<Record<string, T>>, property: string): T | undefined {
    let best: T | undefined;
    let bestScore = -1;
    for (const [pattern, value] of Object.entries(rules)) {
        if (matchesPropertyPattern(property, pattern)) {
            const score = patternSpecificity(pattern);
            if (score > bestScore) {
                best = value;
                bestScore = score;
            }
        }
    }
    return best;
}
