/** Formatting of numbers and output templates. */

export interface NumberStyle {
    precision: number;
    leadingZero: boolean;
}

/** Rounds to `precision` decimals, trims trailing zeros, never uses exponent notation. */
export function formatNumber(n: number, style: NumberStyle): string {
    if (!Number.isFinite(n)) {
        return String(n);
    }
    const precision = Math.max(0, Math.min(10, Math.round(style.precision)));
    let s = n.toFixed(precision);
    if (s.includes('.')) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    if (s === '-0') {
        s = '0';
    }
    if (!style.leadingZero) {
        s = s.replace(/^(-?)0\./, '$1.');
    }
    return s;
}

/** Values available to output templates, all derived from one px value. */
export interface TemplateValues {
    px: number;
    rem: number;
    em: number;
    vw: number;
    vh: number;
    vmin: number;
    vmax: number;
    rpx: number;
    pt: number;
    fn: string;
}

export interface UnitBases {
    rootFontSize: number;
    /** Font size em values are relative to. */
    emBase: number;
    designWidth: number;
    designHeight: number;
    functionName: string;
}

export function templateValues(px: number, bases: UnitBases): TemplateValues {
    const min = Math.min(bases.designWidth, bases.designHeight);
    const max = Math.max(bases.designWidth, bases.designHeight);
    return {
        px,
        rem: px / bases.rootFontSize,
        em: px / bases.emBase,
        vw: (px / bases.designWidth) * 100,
        vh: (px / bases.designHeight) * 100,
        vmin: (px / min) * 100,
        vmax: (px / max) * 100,
        rpx: (px * 750) / bases.designWidth,
        pt: px * 0.75,
        fn: bases.functionName,
    };
}

/** Renders `{rem}rem`, `rem({px})`, `toRem({px}px)`, … */
export function renderTemplate(template: string, values: TemplateValues, style: NumberStyle): string {
    return template.replace(/\{(px|rem|em|vw|vh|vmin|vmax|rpx|pt|fn)\}/g, (_, key: keyof TemplateValues) => {
        const v = values[key];
        return typeof v === 'number' ? formatNumber(v, style) : v;
    });
}

/** Converts a value with a unit to px. Returns undefined for units that need context we do not have. */
export function toPx(value: number, unit: string, bases: UnitBases): number | undefined {
    switch (unit) {
        case 'px':
            return value;
        case 'rem':
            return value * bases.rootFontSize;
        case 'em':
            return value * bases.emBase;
        case 'vw':
        case 'svw':
        case 'lvw':
        case 'dvw':
        case 'vi':
            return (value * bases.designWidth) / 100;
        case 'vh':
        case 'svh':
        case 'lvh':
        case 'dvh':
        case 'vb':
            return (value * bases.designHeight) / 100;
        case 'vmin':
            return (value * Math.min(bases.designWidth, bases.designHeight)) / 100;
        case 'vmax':
            return (value * Math.max(bases.designWidth, bases.designHeight)) / 100;
        case 'rpx':
            return (value * bases.designWidth) / 750;
        case 'pt':
            return value / 0.75;
        case 'pc':
            return value * 16;
        case 'in':
            return value * 96;
        case 'cm':
            return (value * 96) / 2.54;
        case 'mm':
            return (value * 96) / 25.4;
        case 'q':
            return (value * 96) / 101.6;
        default:
            return undefined;
    }
}
