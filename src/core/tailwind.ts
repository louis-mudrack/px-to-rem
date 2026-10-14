/**
 * Tailwind CSS support: maps utilities with arbitrary values (`p-[16px]`) to
 * the CSS property they set, and finds the canonical scale class for a value
 * (`p-[16px]` → `p-4`).
 */

/** Utility prefix → CSS property (for smart mode and categories). */
export const TAILWIND_UTILITIES: Readonly<Record<string, string>> = {
    p: 'padding', px: 'padding-inline', py: 'padding-block', pt: 'padding-top', pr: 'padding-right', pb: 'padding-bottom', pl: 'padding-left', ps: 'padding-inline-start', pe: 'padding-inline-end',
    m: 'margin', mx: 'margin-inline', my: 'margin-block', mt: 'margin-top', mr: 'margin-right', mb: 'margin-bottom', ml: 'margin-left', ms: 'margin-inline-start', me: 'margin-inline-end',
    gap: 'gap', 'gap-x': 'column-gap', 'gap-y': 'row-gap', 'space-x': 'margin-left', 'space-y': 'margin-top',
    w: 'width', h: 'height', size: 'width', 'min-w': 'min-width', 'min-h': 'min-height', 'max-w': 'max-width', 'max-h': 'max-height',
    inset: 'inset', 'inset-x': 'inset-inline', 'inset-y': 'inset-block', top: 'top', right: 'right', bottom: 'bottom', left: 'left', start: 'inset-inline-start', end: 'inset-inline-end',
    'translate-x': 'translate', 'translate-y': 'translate',
    text: 'font-size', leading: 'line-height', tracking: 'letter-spacing', indent: 'text-indent',
    rounded: 'border-radius', 'rounded-t': 'border-radius', 'rounded-r': 'border-radius', 'rounded-b': 'border-radius', 'rounded-l': 'border-radius',
    'rounded-tl': 'border-top-left-radius', 'rounded-tr': 'border-top-right-radius', 'rounded-bl': 'border-bottom-left-radius', 'rounded-br': 'border-bottom-right-radius',
    'rounded-s': 'border-radius', 'rounded-e': 'border-radius', 'rounded-ss': 'border-start-start-radius', 'rounded-se': 'border-start-end-radius', 'rounded-es': 'border-end-start-radius', 'rounded-ee': 'border-end-end-radius',
    border: 'border-width', 'border-t': 'border-top-width', 'border-r': 'border-right-width', 'border-b': 'border-bottom-width', 'border-l': 'border-left-width', 'border-x': 'border-inline-width', 'border-y': 'border-block-width',
    outline: 'outline-width', 'outline-offset': 'outline-offset', ring: 'box-shadow', 'ring-offset': 'box-shadow', shadow: 'box-shadow', blur: 'filter', 'backdrop-blur': 'backdrop-filter',
    basis: 'flex-basis', 'grid-cols': 'grid-template-columns', 'grid-rows': 'grid-template-rows', 'auto-cols': 'grid-auto-columns', 'auto-rows': 'grid-auto-rows', columns: 'column-width',
    'scroll-m': 'scroll-margin', 'scroll-mx': 'scroll-margin', 'scroll-my': 'scroll-margin', 'scroll-mt': 'scroll-margin-top', 'scroll-mr': 'scroll-margin-right', 'scroll-mb': 'scroll-margin-bottom', 'scroll-ml': 'scroll-margin-left',
    'scroll-p': 'scroll-padding', 'scroll-px': 'scroll-padding', 'scroll-py': 'scroll-padding', 'scroll-pt': 'scroll-padding-top', 'scroll-pr': 'scroll-padding-right', 'scroll-pb': 'scroll-padding-bottom', 'scroll-pl': 'scroll-padding-left',
    decoration: 'text-decoration-thickness', 'underline-offset': 'text-underline-offset', 'border-spacing': 'border-spacing', 'stroke': 'stroke-width',
};

/** Spacing-scale utilities: value N means N × 0.25rem. */
const SPACING_UTILITIES = new Set([
    'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
    'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
    'gap', 'gap-x', 'gap-y', 'space-x', 'space-y',
    'w', 'h', 'size', 'min-w', 'min-h', 'max-h',
    'inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end',
    'translate-x', 'translate-y', 'basis', 'indent',
    'scroll-m', 'scroll-mx', 'scroll-my', 'scroll-mt', 'scroll-mr', 'scroll-mb', 'scroll-ml',
    'scroll-p', 'scroll-px', 'scroll-py', 'scroll-pt', 'scroll-pr', 'scroll-pb', 'scroll-pl',
]);

/** Tailwind v3 default spacing keys (v4 accepts any multiple of 0.25rem). */
const V3_SPACING_STEPS = new Set([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);

const FONT_SIZES: Readonly<Record<string, number>> = {
    xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36, '5xl': 48, '6xl': 60, '7xl': 72, '8xl': 96, '9xl': 128,
};

const RADIUS_V3: Readonly<Record<string, number>> = { none: 0, sm: 2, '': 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24 };
const RADIUS_V4: Readonly<Record<string, number>> = { none: 0, xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32 };

const BORDER_WIDTHS: Readonly<Record<string, number>> = { '0': 0, '': 1, '2': 2, '4': 4, '8': 8 };

export interface TailwindConfig {
    version: 3 | 4;
    /** Size of one spacing step in px (default 4 = 0.25rem at 16px). */
    spacingPx: number;
    /** Extra named font sizes from the theme, in px. */
    fontSizes?: Record<string, number>;
    /** Extra named spacing values from the theme, in px. */
    spacing?: Record<string, number>;
}

export const DEFAULT_TAILWIND: TailwindConfig = { version: 4, spacingPx: 4 };

/**
 * Returns the canonical class for `utility` with a px value, or undefined if
 * the value is not on the scale. `negative` adds a leading `-`.
 */
export function canonicalTailwindClass(utility: string, px: number, negative: boolean, config: TailwindConfig): string | undefined {
    const sign = negative ? '-' : '';
    const abs = Math.abs(px);

    if (SPACING_UTILITIES.has(utility)) {
        if (abs === 1 && !negative) {
            return `${utility}-px`;
        }
        if (config.spacing) {
            for (const [key, value] of Object.entries(config.spacing)) {
                if (value === abs) {
                    return `${sign}${utility}-${key}`;
                }
            }
        }
        const step = abs / config.spacingPx;
        const isQuarter = Math.abs(step * 4 - Math.round(step * 4)) < 1e-9;
        if (!isQuarter) {
            return undefined;
        }
        const rounded = Math.round(step * 4) / 4;
        if (config.version === 3 && !V3_SPACING_STEPS.has(rounded)) {
            return undefined;
        }
        if (config.version === 4 && !Number.isInteger(rounded * 2)) {
            // v4 accepts quarter steps only through arbitrary values in practice; keep halves and integers.
            return undefined;
        }
        return `${sign}${utility}-${formatStep(rounded)}`;
    }

    if (utility === 'text' && !negative) {
        const sizes = { ...FONT_SIZES, ...config.fontSizes };
        for (const [key, value] of Object.entries(sizes)) {
            if (value === abs) {
                return `text-${key}`;
            }
        }
        return undefined;
    }

    if (utility.startsWith('rounded') && !negative) {
        const scale = config.version === 3 ? RADIUS_V3 : RADIUS_V4;
        for (const [key, value] of Object.entries(scale)) {
            if (value === abs) {
                return key ? `${utility}-${key}` : utility;
            }
        }
        return undefined;
    }

    if (utility.startsWith('border') && !negative) {
        for (const [key, value] of Object.entries(BORDER_WIDTHS)) {
            if (value === abs) {
                return key ? `${utility}-${key}` : utility;
            }
        }
    }
    return undefined;
}

function formatStep(step: number): string {
    return Number.isInteger(step) ? String(step) : String(step).replace(/^0\./, '0.');
}

/** A Tailwind class with an arbitrary value, e.g. `md:-mt-[16px]` or `[padding:16px]`. */
export interface TailwindClass {
    /** Whole class token, variants included. */
    start: number;
    end: number;
    /** Where the utility (after variants and `!`) starts. */
    utilityStart: number;
    utility: string;
    negative: boolean;
    /** CSS property set by the class. */
    property: string;
    /** Inside the brackets (type hints such as `length:` excluded). */
    valueStart: number;
    valueEnd: number;
    arbitraryProperty: boolean;
}

/** Finds arbitrary-value Tailwind classes in `text[start, end)` (a class string). */
export function findTailwindClasses(text: string, start: number, end: number): TailwindClass[] {
    const out: TailwindClass[] = [];
    const slice = text.slice(start, end);
    const re = /[^\s"'`{}]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice))) {
        const token = m[0];
        if (!token.includes('[') || (!token.endsWith(']') && !token.endsWith(']!'))) {
            continue;
        }
        const tokenStart = start + m.index;
        // Split off variants (`md:hover:`), ignoring colons inside brackets.
        let depth = 0;
        let utilityOffset = 0;
        for (let i = 0; i < token.length; i++) {
            const c = token[i];
            if (c === '[') {
                depth++;
            } else if (c === ']') {
                depth--;
            } else if (c === ':' && depth === 0) {
                utilityOffset = i + 1;
            }
        }
        let utility = token.slice(utilityOffset);
        let utilityStart = tokenStart + utilityOffset;
        if (utility.startsWith('!')) {
            utility = utility.slice(1);
            utilityStart++;
        }
        if (utility.endsWith('!')) {
            utility = utility.slice(0, -1);
        }
        const arbitraryProp = /^\[(--[\w-]+|[a-z-]+):(.+)\]$/.exec(utility);
        if (arbitraryProp) {
            const valueStart = utilityStart + 1 + arbitraryProp[1].length + 1;
            out.push({
                start: tokenStart,
                end: tokenStart + token.length,
                utilityStart,
                utility: '',
                negative: false,
                property: arbitraryProp[1],
                valueStart,
                valueEnd: valueStart + arbitraryProp[2].length,
                arbitraryProperty: true,
            });
            continue;
        }
        const negative = utility.startsWith('-');
        const body = negative ? utility.slice(1) : utility;
        const cls = /^([a-z][a-z0-9-]*?)-\[(.+)\]$/.exec(body);
        if (!cls) {
            continue;
        }
        const name = cls[1];
        const property = TAILWIND_UTILITIES[name];
        if (!property) {
            continue;
        }
        let value = cls[2];
        let valueStart = utilityStart + (negative ? 1 : 0) + name.length + 2;
        const hint = /^(length|size|number|percentage|line-width):/.exec(value);
        if (hint) {
            valueStart += hint[0].length;
            value = value.slice(hint[0].length);
        }
        out.push({
            start: tokenStart,
            end: tokenStart + token.length,
            utilityStart,
            utility: name,
            negative,
            property,
            valueStart,
            valueEnd: valueStart + value.length,
            arbitraryProperty: false,
        });
    }
    return out;
}
