import { emBaseFor, type ProjectContext } from './context';
import { remFunctionArgument } from './convert';
import type { LengthContext, LengthNode, ParsedDocument } from './document';
import { toPx } from './format';
import type { Options } from './options';
import type { DeclarationNode } from './parser';
import { CATEGORIES, categoryForName, categoryForProperty, LENGTH_PROPERTIES, type Category } from './properties';
import { decide, type Reason } from './strategy';

/** One length in use, as a px equivalent, for the value-audit dashboard. */
export interface ValueSample {
    /** Absolute px equivalent (the sign is dropped: `-16px` and `16px` share a scale step). */
    px: number;
    category: Category;
    /** Declaration property, variable name, mixin name or `@media` / `@container`. */
    property: string;
    /** Unit as written (`px`, `rem`, …), or `rem()` for calls of the rem function. */
    unit: string;
    /** Zero-based line. */
    line: number;
}

/** Migration statistics of one file. */
export interface FileStats {
    file: string;
    /** px values the current options would convert (decide() says convert). */
    convertible: number;
    /** px values intentionally kept (smart keep, hairline, breakpoint mixins, disabled by directives, uppercase PX, filters). */
    kept: number;
    /** Scalable lengths already present: rem, em, %, vw/vh/vi/cq* units, plus calls of options.functionName (rem(16)) and var(--…) references in declaration values. */
    scalable: number;
    /** px-equivalent samples of every length in declaration/variable/custom-property/mixin contexts, plus media/container query values with category 'breakpoint'. */
    samples: ValueSample[];
}

/** Contexts whose values are counted at all. Control flow, selectors and `@supports` are not. */
const COUNTED_CONTEXTS: ReadonlySet<LengthContext> = new Set([
    'declaration',
    'variable',
    'custom-property',
    'mixin',
    'media',
    'container',
    'breakpoint-mixin',
]);

/** Contexts whose values are breakpoints. */
const BREAKPOINT_CONTEXTS: ReadonlySet<LengthContext> = new Set(['media', 'container', 'breakpoint-mixin']);

/** Reasons for not converting that reflect a deliberate choice (options, directives, smart rules). */
const KEPT_REASONS: ReadonlySet<Reason> = new Set<Reason>([
    'disabled',
    'uppercase',
    'excluded-pattern',
    'breakpoint-mixin',
    'variables-off',
    'mixins-off',
    'out-of-range',
    'excluded-property',
    'not-included-property',
    'media-keep',
    'smart-keep',
    'hairline',
]);

/** Units that already scale with the user's font size, the viewport or a container. */
const SCALABLE_UNITS: ReadonlySet<string> = new Set([
    'rem', 'em', '%', 'ch', 'ex', 'cap', 'ic', 'lh', 'rlh', 'rcap', 'rch', 'rex', 'ric',
    'vw', 'vh', 'vmin', 'vmax', 'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', 'svi', 'svb', 'lvi', 'lvb', 'dvi', 'dvb', 'vi', 'vb',
    'cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax', 'rpx',
]);

/** Absolute units that have a fixed px equivalent. */
const ABSOLUTE_UNITS: ReadonlySet<string> = new Set(['pt', 'pc', 'in', 'cm', 'mm', 'q']);

/** Functions whose percentages are not lengths (`hsl(0 50% 50%)`, `brightness(80%)`, `scale(50%)`). */
const NON_LENGTH_PERCENT_FUNCTIONS =
    /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|brightness|contrast|grayscale|invert|opacity|saturate|sepia|scale|scale[xyz]|scale3d)$/;

/** Properties whose percentages are not lengths. */
const NON_LENGTH_PERCENT_PROPERTIES = /opacity$|^(scale|zoom|font-stretch|font-width|border-image-slice|mask-border-slice)$/;

/** Whether a declaration of `property` holds lengths, so a `var(--x)` in it stands for a length. */
function holdsLength(property: string): boolean {
    const p = property.toLowerCase();
    if (/color|style$|^border-image|^(background|background-image|mask-image|content|font-family|font-weight|transition|animation)/.test(p)) {
        return false;
    }
    return LENGTH_PROPERTIES.has(p) || categoryForProperty(p) !== 'other';
}

function propertyOf(decl: DeclarationNode | undefined): string {
    return decl?.variable?.name ?? decl?.property ?? '';
}

/** Category of a mixin argument, from the mixin name (`size`, `padding`, `font-size`, `button-size`). */
function mixinCategory(name: string | undefined): Category {
    if (!name) {
        return 'other';
    }
    const bare = name.replace(/^.*\./, '').replace(/^[.#+]/, '');
    const byProperty = categoryForProperty(bare);
    return byProperty !== 'other' ? byProperty : categoryForName(bare);
}

interface SampleSite {
    context: LengthContext;
    decl?: DeclarationNode;
    mixin?: string;
    lineHeightPart?: boolean;
}

function siteCategory(site: SampleSite): Category {
    if (BREAKPOINT_CONTEXTS.has(site.context)) {
        return 'breakpoint';
    }
    switch (site.context) {
        case 'variable':
        case 'custom-property':
            return categoryForName(propertyOf(site.decl));
        case 'mixin':
            return mixinCategory(site.mixin);
        default:
            return site.lineHeightPart ? 'line-height' : categoryForProperty(site.decl?.property ?? '');
    }
}

function siteProperty(site: SampleSite): string {
    switch (site.context) {
        case 'media':
        case 'container':
            return `@${site.context}`;
        case 'mixin':
        case 'breakpoint-mixin':
            return site.mixin ?? '';
        default:
            return propertyOf(site.decl);
    }
}

/** px equivalent of a length for statistics, or undefined for relative units (%, viewport, ch, …). */
function samplePx(doc: ParsedDocument, length: LengthNode, options: Options, ctx: ProjectContext): number | undefined {
    const inQuery = BREAKPOINT_CONTEXTS.has(length.context);
    switch (length.unit) {
        case 'px':
            return length.value;
        case 'rem':
            // Media queries resolve rem and em against the browser default, not the html font size.
            return length.value * (inQuery ? options.mediaQueryBase : ctx.rootFontSize);
        case 'em':
            return length.value * (inQuery ? options.mediaQueryBase : emBaseFor(doc, length, ctx, options.functionName).px);
        default:
            if (!ABSOLUTE_UNITS.has(length.unit)) {
                return undefined;
            }
            return toPx(length.value, length.unit, {
                rootFontSize: ctx.rootFontSize,
                emBase: ctx.rootFontSize,
                designWidth: options.designWidth,
                designHeight: options.designHeight,
                functionName: options.functionName,
            });
    }
}

function isScalableLength(length: LengthNode): boolean {
    if (!SCALABLE_UNITS.has(length.unit)) {
        return false;
    }
    if (length.unit !== '%') {
        return true;
    }
    const property = length.decl?.property ?? '';
    return !NON_LENGTH_PERCENT_PROPERTIES.test(property) && !length.functions.some(f => NON_LENGTH_PERCENT_FUNCTIONS.test(f));
}

/** Collects migration counts and value samples for one parsed document. */
export function analyzeDocument(doc: ParsedDocument, file: string, options: Options, ctx: ProjectContext): FileStats {
    const stats: FileStats = { file, convertible: 0, kept: 0, scalable: 0, samples: [] };
    const fnName = options.functionName.toLowerCase();

    const samples: { sample: ValueSample; start: number }[] = [];
    const addSample = (raw: number | undefined, site: SampleSite, unit: string, line: number, start: number) => {
        if (raw === undefined || !Number.isFinite(raw) || raw === 0) {
            return;
        }
        samples.push({ sample: { px: Math.abs(raw), category: siteCategory(site), property: siteProperty(site), unit, line }, start });
    };

    for (const length of doc.lengths) {
        if (!COUNTED_CONTEXTS.has(length.context)) {
            continue;
        }
        // Values inside rem(16px) are counted through the call below.
        const insideRemCall = length.functions.includes(fnName);

        if (length.unit === 'px') {
            const decision = decide(doc, length, options, ctx);
            if (decision.convert) {
                stats.convertible++;
            } else if (KEPT_REASONS.has(decision.reason)) {
                stats.kept++;
            }
        } else if (!insideRemCall && isScalableLength(length)) {
            stats.scalable++;
        }

        if (!insideRemCall) {
            const site: SampleSite = { context: length.context, decl: length.decl, mixin: length.contextName, lineHeightPart: !!length.shorthandFontSize };
            addSample(samplePx(doc, length, options, ctx), site, length.unit, length.line, length.start);
        }
    }

    for (const call of doc.functions) {
        if (!COUNTED_CONTEXTS.has(call.context)) {
            continue;
        }
        if (call.name === fnName) {
            if (call.functions.includes(fnName)) {
                continue;
            }
            stats.scalable++;
            // In a mixin call the outermost frame is the mixin itself: `@include size(rem(24))`.
            const site: SampleSite = { context: call.context, decl: call.decl, mixin: call.functions[0] };
            addSample(remFunctionArgument(doc, call, options), site, `${options.functionName}()`, call.line, call.start);
        } else if (call.name === 'var' && call.context === 'declaration' && call.args.length > 0) {
            const name = doc.text.slice(call.args[0].start, call.args[0].end).trim();
            if (name.startsWith('--') && !/colou?r/i.test(name) && holdsLength(call.decl?.property ?? '')) {
                stats.scalable++;
            }
        }
    }

    stats.samples = samples.sort((a, b) => a.start - b.start).map(s => s.sample);
    return stats;
}

/** Count of one rounded value in a category. */
export interface Histogram {
    value: number;
    count: number;
    /** Number of files the value appears in. */
    files: number;
}

/** A spacing, size or radius value off the grid. */
export interface Outlier {
    px: number;
    category: Category;
    count: number;
    /** At most 20, in file order. Lines are zero-based. */
    occurrences: { file: string; line: number }[];
    /** Closest value on the 4px grid (2px grid below 8px). */
    nearestGrid: number;
}

/** A modular type scale and how well the used font sizes fit it. */
export interface TypeScaleFit {
    name: string;
    ratio: number;
    base: number;
    /** base × ratio^k for k = -3…+8, rounded to 0.5px. */
    steps: number[];
    /** Share (0–1) of the distinct font sizes within 0.75px of a step. */
    fit: number;
    /** Distinct font sizes that fit no step, ascending. */
    misfits: number[];
}

/** Workspace-wide statistics for the migration view and the value-audit dashboard. */
export interface WorkspaceReport {
    files: number;
    convertible: number;
    kept: number;
    scalable: number;
    /** scalable / (scalable + convertible), 0–1; 1 when both are 0. */
    score: number;
    /** Per category, sorted by value; values rounded to 0.25px. */
    histograms: Record<Category, Histogram[]>;
    /**
     * Share (0–1) of spacing+size samples that sit on a 4px grid (2px below 8px, as for outliers) / an 8px grid;
     * `total` is the number of samples considered (hairlines and 9999px idioms are left out).
     */
    grid: { four: number; eight: number; total: number };
    /** Spacing/size/radius values off the 4px grid (and the 2px grid for values < 8), sorted by count desc then value; at most 50, at most 20 occurrences each. */
    outliers: Outlier[];
    /** Best-fitting modular type scale for the distinct font sizes. undefined with fewer than 3 distinct font sizes. */
    typeScale?: TypeScaleFit;
    /** Proposed spacing scale (px): frequent values snapped to the 4px grid (2px under 8), deduplicated, at most 16 steps, ascending. */
    spacingProposal: number[];
    /** Proposed font sizes (px): the type-scale steps that cover used sizes, else distinct used sizes rounded to 0.5px, at most 12. */
    fontSizeProposal: number[];
    /** Proposed radii (px), ascending; 9999 (a pill radius) last when one is used. */
    radiusProposal: number[];
}

/** Modular scales tried for font sizes, in order of preference on ties. */
export const TYPE_SCALES: readonly { name: string; ratio: number }[] = [
    { name: 'Minor Second', ratio: 1.067 },
    { name: 'Major Second', ratio: 1.125 },
    { name: 'Minor Third', ratio: 1.2 },
    { name: 'Major Third', ratio: 1.25 },
    { name: 'Perfect Fourth', ratio: 1.333 },
    { name: 'Augmented Fourth', ratio: 1.414 },
    { name: 'Perfect Fifth', ratio: 1.5 },
    { name: 'Golden Ratio', ratio: 1.618 },
];

const MAX_OUTLIERS = 50;
const MAX_OCCURRENCES = 20;
const MAX_SPACING_STEPS = 16;
const MAX_FONT_SIZES = 12;
const MAX_RADII = 8;
/** Spacing values above this are layout offsets rather than spacing steps. */
const MAX_SPACING_PX = 512;
/** Radii from this size on are pills (`border-radius: 9999px`). */
const PILL_RADIUS = 999;
/** A type-scale step and a font size match within this many px. */
const TYPE_SCALE_TOLERANCE = 0.75;
/** Below this share of fitting sizes the type scale is not proposed. */
const MIN_PROPOSAL_FIT = 0.5;
const EPSILON = 1e-9;

function roundTo(value: number, step: number): number {
    return Math.round(value / step) * step;
}

/** Whether a value sits on the 4px grid, or the 2px grid below 8px. */
function onGrid(px: number): boolean {
    return px < 8 ? px % 2 === 0 : px % 4 === 0;
}

/** Nearest value on the 4px grid (2px grid below 8px), never 0 for a positive value. */
export function snapToGrid(px: number): number {
    const step = px < 8 ? 2 : 4;
    return Math.max(step, roundTo(px, step));
}

/** `999px`, `9999px`, …: off-screen offsets and "infinite" sizes rather than design values. */
function isIdiom(px: number): boolean {
    return px >= 999 && /^9+$/.test(String(px));
}

/** Whether a value is a hairline (1px borders, nudges) that grid analysis ignores. */
function isHairline(px: number, options: Options): boolean {
    return options.hairline > 0 && px <= options.hairline;
}

interface Bucket {
    value: number;
    count: number;
    files: Set<string>;
    occurrences: { file: string; line: number }[];
}

function topByCount(counts: Map<number, number>, limit: number): number[] {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, limit)
        .map(([value]) => value)
        .sort((a, b) => a - b);
}

function addCount(map: Map<number, number>, key: number, by = 1): void {
    map.set(key, (map.get(key) ?? 0) + by);
}

/** Most used font size; ties go to the size closest to 16px. */
function mostUsed(counts: Map<number, number>): number {
    let best = 16;
    let bestCount = -1;
    for (const [value, count] of counts) {
        if (count > bestCount || (count === bestCount && Math.abs(value - 16) < Math.abs(best - 16))) {
            best = value;
            bestCount = count;
        }
    }
    return best;
}

function nearestIndex(steps: number[], value: number): number {
    let index = 0;
    for (let i = 1; i < steps.length; i++) {
        if (Math.abs(steps[i] - value) < Math.abs(steps[index] - value)) {
            index = i;
        }
    }
    return index;
}

/**
 * Finds the modular scale that explains the font sizes best. Each fitting size
 * scores by how close it sits to its step in log space (1 on the step, 0 half a
 * step away), so dense scales such as 1.067 do not win just because every size
 * lands near some step.
 */
export function fitTypeScale(sizeCounts: Map<number, number>): TypeScaleFit | undefined {
    const sizes = [...sizeCounts.keys()].sort((a, b) => a - b);
    if (sizes.length < 3) {
        return undefined;
    }
    const bases = [...new Set([mostUsed(sizeCounts), 16])];
    let best: { result: TypeScaleFit; score: number } | undefined;
    for (const base of bases) {
        for (const scale of TYPE_SCALES) {
            const exponents: number[] = [];
            const steps: number[] = [];
            for (let k = -3; k <= 8; k++) {
                exponents.push(k);
                steps.push(roundTo(base * scale.ratio ** k, 0.5));
            }
            let score = 0;
            const misfits: number[] = [];
            for (const size of sizes) {
                const i = nearestIndex(steps, size);
                if (Math.abs(steps[i] - size) <= TYPE_SCALE_TOLERANCE + EPSILON) {
                    const distance = Math.abs(Math.log(size / base) / Math.log(scale.ratio) - exponents[i]);
                    score += Math.max(0, 1 - 2 * distance);
                } else {
                    misfits.push(size);
                }
            }
            const result: TypeScaleFit = {
                name: scale.name,
                ratio: scale.ratio,
                base,
                steps,
                fit: (sizes.length - misfits.length) / sizes.length,
                misfits,
            };
            if (!best || score > best.score + EPSILON || (Math.abs(score - best.score) <= EPSILON && result.fit > best.result.fit)) {
                best = { result, score };
            }
        }
    }
    return best?.result;
}

/** Aggregates per-file statistics into the workspace report. */
export function buildReport(stats: FileStats[], options: Options): WorkspaceReport {
    const report: WorkspaceReport = {
        files: stats.length,
        convertible: 0,
        kept: 0,
        scalable: 0,
        score: 1,
        histograms: Object.fromEntries(CATEGORIES.map(c => [c, []])) as unknown as Record<Category, Histogram[]>,
        grid: { four: 0, eight: 0, total: 0 },
        outliers: [],
        typeScale: undefined,
        spacingProposal: [],
        fontSizeProposal: [],
        radiusProposal: [],
    };

    const histograms = new Map<Category, Map<number, Bucket>>(CATEGORIES.map(c => [c, new Map()]));
    const outliers = new Map<string, Outlier>();
    const fontSizes = new Map<number, number>();
    const spacing = new Map<number, number>();
    const radii = new Map<number, number>();
    let onFour = 0;
    let onEight = 0;
    let pill = false;

    for (const file of stats) {
        report.convertible += file.convertible;
        report.kept += file.kept;
        report.scalable += file.scalable;

        for (const sample of file.samples) {
            const value = roundTo(sample.px, 0.25);
            if (value === 0) {
                continue;
            }
            const { category } = sample;
            const buckets = histograms.get(category) ?? new Map<number, Bucket>();
            histograms.set(category, buckets);
            let bucket = buckets.get(value);
            if (!bucket) {
                bucket = { value, count: 0, files: new Set(), occurrences: [] };
                buckets.set(value, bucket);
            }
            bucket.count++;
            bucket.files.add(file.file);

            if (category === 'font-size') {
                addCount(fontSizes, value);
            }
            if (category !== 'spacing' && category !== 'size' && category !== 'radius') {
                continue;
            }
            if (isHairline(value, options)) {
                continue;
            }
            if (category === 'radius' && value >= PILL_RADIUS) {
                pill = true;
                continue;
            }
            if (isIdiom(value)) {
                continue;
            }

            if (category === 'spacing' || category === 'size') {
                report.grid.total++;
                onFour += onGrid(value) ? 1 : 0;
                onEight += value % 8 === 0 ? 1 : 0;
            }
            if (category === 'spacing' && value <= MAX_SPACING_PX) {
                addCount(spacing, snapToGrid(value));
            }
            if (category === 'radius') {
                addCount(radii, snapToGrid(value));
            }
            if (!onGrid(value)) {
                const key = `${category}\u0000${value}`;
                let outlier = outliers.get(key);
                if (!outlier) {
                    outlier = { px: value, category, count: 0, occurrences: [], nearestGrid: snapToGrid(value) };
                    outliers.set(key, outlier);
                }
                outlier.count++;
                if (outlier.occurrences.length < MAX_OCCURRENCES) {
                    outlier.occurrences.push({ file: file.file, line: sample.line });
                }
            }
        }
    }

    const scored = report.scalable + report.convertible;
    report.score = scored === 0 ? 1 : report.scalable / scored;

    for (const [category, buckets] of histograms) {
        report.histograms[category] = [...buckets.values()]
            .sort((a, b) => a.value - b.value)
            .map(b => ({ value: b.value, count: b.count, files: b.files.size }));
    }

    if (report.grid.total > 0) {
        report.grid.four = onFour / report.grid.total;
        report.grid.eight = onEight / report.grid.total;
    }

    report.outliers = [...outliers.values()]
        .sort((a, b) => b.count - a.count || a.px - b.px || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category))
        .slice(0, MAX_OUTLIERS);

    report.typeScale = fitTypeScale(fontSizes);
    report.fontSizeProposal = proposeFontSizes(fontSizes, report.typeScale);
    report.spacingProposal = topByCount(spacing, MAX_SPACING_STEPS);
    report.radiusProposal = topByCount(radii, MAX_RADII);
    if (pill) {
        report.radiusProposal.push(9999);
    }
    return report;
}

/** The type-scale steps from the smallest to the largest used size, or the used sizes themselves when no scale fits. */
function proposeFontSizes(fontSizes: Map<number, number>, typeScale: TypeScaleFit | undefined): number[] {
    if (typeScale && typeScale.fit >= MIN_PROPOSAL_FIT) {
        const sizes = [...fontSizes.keys()];
        const from = nearestIndex(typeScale.steps, Math.min(...sizes));
        const to = nearestIndex(typeScale.steps, Math.max(...sizes));
        return [...new Set(typeScale.steps.slice(from, to + 1))];
    }
    const rounded = new Map<number, number>();
    for (const [value, count] of fontSizes) {
        addCount(rounded, roundTo(value, 0.5), count);
    }
    return topByCount(rounded, MAX_FONT_SIZES);
}
