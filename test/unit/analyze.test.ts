import { describe, expect, it } from 'vitest';
import { analyzeDocument, buildReport, fitTypeScale, snapToGrid, type FileStats } from '../../src/core/analyze';
import { createContext, type ProjectContext } from '../../src/core/context';
import { parseDocument } from '../../src/core/document';
import { applyOptions, defaultOptions, type PartialOptions } from '../../src/core/options';
import { CATEGORIES } from '../../src/core/properties';

function analyze(file: string, text: string, languageId = 'css', layer: PartialOptions = {}, ctxPartial: Partial<ProjectContext> = {}): FileStats {
    const options = applyOptions(defaultOptions(), layer);
    const ctx = createContext(options, ctxPartial);
    return analyzeDocument(parseDocument(text, languageId), file, options, ctx);
}

function report(files: FileStats[], layer: PartialOptions = {}) {
    return buildReport(files, applyOptions(defaultOptions(), layer));
}

const counts = (s: FileStats) => ({ convertible: s.convertible, kept: s.kept, scalable: s.scalable });

/** A component stylesheet halfway through a migration. */
const CARD_CSS = `:root {
  --space-2: 8px;
  --radius-md: 6px;
  --border-width: 1px;
}
.card {
  padding: 16px 24px;
  margin: -12px 0 10px;
  gap: 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 14px;
  line-height: 20px;
  width: 50%;
  color: hsl(200 50% 40%);
  max-width: calc(100vw - var(--space-2));
  top: 4PX;
  left: 30px; /* px-to-rem-disable-line */
  box-shadow: 0 2px 4px #0003;
  font: 700 16px/24px Inter;
}
@media (min-width: 768px) and (max-width: 63.9375em) {
  .card { padding: 14px; }
}
`;

/** A Sass partial that already uses a rem() function. */
const LAYOUT_SCSS = `@use 'sass:math';
@function rem($px, $base: 16px) { @return math.div($px, $base) * 1rem; }
$space-lg: rem(32);
.layout {
  padding: rem(16) rem(10px);
  margin: #{rem(8)};
  @include size(rem(24), 10px);
  @include mq(768px) { top: 2px; }
}
`;

/** Headings on a Major Third scale (16 × 1.25ⁿ) plus two off-scale body sizes. */
const TYPE_CSS = `.caption { font-size: 12px; }
.small { font-size: 0.875rem; }
body { font-size: 16px; }
h3 { font-size: 1.25rem; }
h2 { font-size: 25px; }
h1 { font-size: 31.25px; }
`;

describe('analyzeDocument', () => {
    it('classifies px values as convertible or deliberately kept and counts scalable lengths', () => {
        const stats = analyze('card.css', CARD_CSS);
        // Convertible: 3 custom properties minus the border one, padding ×2, margin ×2, radius,
        // font-size, line-height (unitless), the font shorthand ×2, the breakpoint and the nested padding.
        // Kept: --border-width (smart), border (smart), 4PX (uppercase), the disabled line, box-shadow ×2.
        // Scalable: 1rem, 50%, 100vw, var(--space-2) and 63.9375em; hsl() percentages and
        // var(--border-color) are not lengths.
        expect(counts(stats)).toEqual({ convertible: 13, kept: 6, scalable: 5 });
        expect(stats.file).toBe('card.css');
    });

    it('samples every length as px with its category and property', () => {
        const stats = analyze('card.css', CARD_CSS);
        const brief = stats.samples.map(s => `${s.line}:${s.property}:${s.category}:${s.px}${s.unit === 'px' ? '' : ' (' + s.unit + ')'}`);
        expect(brief).toEqual([
            '1:--space-2:spacing:8',
            '2:--radius-md:radius:6',
            '3:--border-width:border:1',
            '6:padding:spacing:16',
            '6:padding:spacing:24',
            '7:margin:spacing:12',
            '7:margin:spacing:10',
            '8:gap:spacing:16 (rem)',
            '9:border:border:1',
            '10:border-radius:radius:6',
            '11:font-size:font-size:14',
            '12:line-height:line-height:20',
            '16:top:spacing:4',
            '17:left:spacing:30',
            '18:box-shadow:shadow:2',
            '18:box-shadow:shadow:4',
            '19:font:font-size:16',
            '19:font:line-height:24',
            '21:@media:breakpoint:768',
            '21:@media:breakpoint:1023 (em)',
            '22:padding:spacing:14',
        ]);
    });

    it('counts rem() calls as scalable and samples their argument', () => {
        const stats = analyze('layout.scss', LAYOUT_SCSS, 'scss');
        // rem(32), rem(16), rem(10px), #{rem(8)}, rem(24): scalable. The 10px mixin argument and
        // top: 2px are convertible, the breakpoint mixin argument is kept, and the function body is ignored.
        expect(counts(stats)).toEqual({ convertible: 2, kept: 1, scalable: 5 });
        expect(stats.samples.filter(s => s.unit === 'rem()').map(s => [s.property, s.category, s.px])).toEqual([
            ['$space-lg', 'spacing', 32],
            ['padding', 'spacing', 16],
            ['padding', 'spacing', 10],
            ['margin', 'spacing', 8],
            ['size', 'size', 24],
        ]);
        expect(stats.samples.find(s => s.property === 'mq')).toMatchObject({ category: 'breakpoint', px: 768 });
    });

    it('uses the configured function name', () => {
        const scss = '.a { padding: toRem(16) rem(8); }';
        expect(analyze('a.scss', scss, 'scss', { functionName: 'toRem' }).scalable).toBe(1);
        expect(analyze('a.scss', scss, 'scss').scalable).toBe(1);
        expect(analyze('a.scss', scss, 'scss', { functionName: 'toRem' }).samples.map(s => s.unit)).toEqual(['toRem()']);
    });

    it('follows the options that decide conversion', () => {
        const css = '$gap: 8px;\n.a { border: 2px solid; padding: 3px; }\n@media (min-width: 600px) {}';
        expect(counts(analyze('a.scss', css, 'scss'))).toEqual({ convertible: 3, kept: 1, scalable: 0 });
        expect(counts(analyze('a.scss', css, 'scss', { mode: 'simple' }))).toEqual({ convertible: 4, kept: 0, scalable: 0 });
        expect(counts(analyze('a.scss', css, 'scss', { mediaQueries: 'keep', convertVariables: false }))).toEqual({ convertible: 1, kept: 3, scalable: 0 });
        expect(counts(analyze('a.scss', css, 'scss', { minValue: 4 }))).toEqual({ convertible: 2, kept: 2, scalable: 0 });
        expect(counts(analyze('a.scss', css, 'scss', { excludeProperties: ['padding'] }))).toEqual({ convertible: 2, kept: 2, scalable: 0 });
    });

    it('keeps hairlines and whole files disabled by a directive', () => {
        expect(counts(analyze('a.css', '.a { top: 1px; margin: 1px 2px; }'))).toEqual({ convertible: 1, kept: 2, scalable: 0 });
        expect(counts(analyze('a.css', '/* px-to-rem-disable-file */\n.a { padding: 16px; }'))).toEqual({ convertible: 0, kept: 1, scalable: 0 });
    });

    it('resolves rem with the root font size and media query units with the browser default', () => {
        const css = 'html { font-size: 62.5%; }\n.a { padding: 1.6rem; }\n@media (min-width: 48rem) {}';
        const stats = analyze('a.css', css, 'css', {}, { rootFontSize: 10 });
        expect(stats.samples.map(s => [s.category, s.px])).toEqual([
            ['spacing', 16],
            ['breakpoint', 768],
        ]);
        // 62.5% (a percentage font size) is scalable, as are both rem values.
        expect(stats.scalable).toBe(3);
    });

    it('resolves em against the element font size and converts absolute units', () => {
        const css = '.a { font-size: 20px; letter-spacing: 0.05em; margin-top: 12pt; }';
        expect(analyze('a.css', css).samples.map(s => [s.category, s.px])).toEqual([
            ['font-size', 20],
            ['letter-spacing', 1],
            ['spacing', 16],
        ]);
    });

    it('skips zeros, relative units and values outside counted contexts', () => {
        const scss = `@function f($x) { @return $x + 4px; }
@supports (width: 1px) {}
.a { margin: 0px; width: 50vw; height: 2ch; padding: -8px; transform: scale(50%); opacity: 50%; }`;
        const stats = analyze('a.scss', scss, 'scss');
        expect(stats.samples.map(s => [s.property, s.px])).toEqual([['padding', 8]]);
        // margin: 0px and padding: -8px convert; 50vw and 2ch are scalable; scale(50%) and opacity are not lengths.
        expect(counts(stats)).toEqual({ convertible: 2, kept: 0, scalable: 2 });
    });

    it('only counts var() references that stand for lengths', () => {
        const css = '.a { padding: var(--space-2) var(--space-4); color: var(--fg); background: var(--surface); border-color: var(--line); inset: var(--offset); }';
        expect(analyze('a.css', css).scalable).toBe(3);
    });

    it('analyzes styles embedded in markup', () => {
        const vue = `<template><div style="padding: 8px"></div></template>
<style lang="scss">
.a { margin: rem(16); font-size: 14px; }
</style>`;
        const stats = analyze('Card.vue', vue, 'vue');
        expect(counts(stats)).toEqual({ convertible: 2, kept: 0, scalable: 1 });
        expect(stats.samples.map(s => [s.line, s.property, s.px])).toEqual([
            [0, 'padding', 8],
            [2, 'margin', 16],
            [2, 'font-size', 14],
        ]);
    });
});

describe('buildReport', () => {
    const files = () => [analyze('card.css', CARD_CSS), analyze('layout.scss', LAYOUT_SCSS, 'scss'), analyze('type.css', TYPE_CSS)];

    it('sums counts and computes the migration score', () => {
        const r = report(files());
        expect(r.files).toBe(3);
        // type.css: four px font sizes, two rem font sizes.
        expect({ convertible: r.convertible, kept: r.kept, scalable: r.scalable }).toEqual({ convertible: 19, kept: 7, scalable: 12 });
        expect(r.score).toBeCloseTo(12 / 31);
    });

    it('scores 1 when there is nothing to convert', () => {
        const empty = report([]);
        expect(empty.score).toBe(1);
        expect(empty.files).toBe(0);
        expect(Object.keys(empty.histograms).sort()).toEqual([...CATEGORIES].sort());
        expect(Object.values(empty.histograms).every(h => h.length === 0)).toBe(true);
        expect(empty.grid).toEqual({ four: 0, eight: 0, total: 0 });
        expect(empty.typeScale).toBeUndefined();
        expect(empty).toMatchObject({ outliers: [], spacingProposal: [], fontSizeProposal: [], radiusProposal: [] });
        expect(report([analyze('a.css', '.a { padding: 1rem; }')]).score).toBe(1);
    });

    it('builds histograms per category with value counts and file counts', () => {
        const r = report(files());
        expect(r.histograms.spacing).toEqual([
            { value: 2, count: 1, files: 1 },
            { value: 4, count: 1, files: 1 },
            { value: 8, count: 2, files: 2 },
            { value: 10, count: 2, files: 2 },
            { value: 12, count: 1, files: 1 },
            { value: 14, count: 1, files: 1 },
            { value: 16, count: 3, files: 2 },
            { value: 24, count: 1, files: 1 },
            { value: 30, count: 1, files: 1 },
            { value: 32, count: 1, files: 1 },
        ]);
        expect(r.histograms['font-size'].map(h => [h.value, h.count])).toEqual([
            [12, 1],
            [14, 2],
            [16, 2],
            [20, 1],
            [25, 1],
            [31.25, 1],
        ]);
        expect(r.histograms.breakpoint).toEqual([
            { value: 768, count: 2, files: 2 },
            { value: 1023, count: 1, files: 1 },
        ]);
        expect(r.histograms['letter-spacing']).toEqual([]);
    });

    it('rounds histogram values to quarter pixels', () => {
        const css = '.a { padding: 15.9px; margin: 13.3px; top: 0.8125rem; left: 13.4px; }';
        expect(report([analyze('a.css', css)]).histograms.spacing).toEqual([
            { value: 13, count: 1, files: 1 },
            { value: 13.25, count: 1, files: 1 },
            { value: 13.5, count: 1, files: 1 },
            { value: 16, count: 1, files: 1 },
        ]);
    });

    it('measures how much spacing and sizing sits on the 4px and 8px grids', () => {
        const r = report(files());
        // 16 spacing/size samples (hairlines excluded): 11 on the 4px grid (top: 2px counts, being
        // on the 2px grid below 8px), 8 on the 8px grid. The other 5 are the outliers below.
        expect(r.grid.total).toBe(16);
        expect(r.grid.four).toBeCloseTo(11 / 16);
        expect(r.grid.eight).toBeCloseTo(8 / 16);
    });

    it('lists off-grid outliers with occurrences and the nearest grid value', () => {
        const r = report(files());
        expect(r.outliers).toEqual([
            {
                px: 10,
                category: 'spacing',
                count: 2,
                occurrences: [
                    { file: 'card.css', line: 7 },
                    { file: 'layout.scss', line: 4 },
                ],
                nearestGrid: 12,
            },
            { px: 10, category: 'size', count: 1, occurrences: [{ file: 'layout.scss', line: 6 }], nearestGrid: 12 },
            { px: 14, category: 'spacing', count: 1, occurrences: [{ file: 'card.css', line: 22 }], nearestGrid: 16 },
            { px: 30, category: 'spacing', count: 1, occurrences: [{ file: 'card.css', line: 17 }], nearestGrid: 32 },
        ]);
    });

    it('uses a 2px grid below 8px and ignores hairlines and 9999px idioms', () => {
        const css = `.a {
  margin: 2px 6px 3px 5px;
  width: 1px;
  left: -9999px;
  border-radius: 9999px 7px;
}`;
        const r = report([analyze('a.css', css)]);
        expect(r.outliers.map(o => [o.category, o.px, o.nearestGrid])).toEqual([
            ['spacing', 3, 4],
            ['spacing', 5, 6],
            ['radius', 7, 8],
        ]);
        expect(r.grid).toEqual({ four: 0.5, eight: 0, total: 4 });
        expect(r.radiusProposal).toEqual([8, 9999]);
        // With hairlines off, 1px becomes an outlier too.
        expect(report([analyze('a.css', css)], { hairline: 0 }).outliers.map(o => o.px)).toEqual([1, 3, 5, 7]);
    });

    it('sorts outliers by count and caps their number and occurrences', () => {
        const repeated = `.a {\n${Array.from({ length: 25 }, () => '  margin: 10px;').join('\n')}\n}`;
        const many = `.b {\n${Array.from({ length: 60 }, (_, i) => `  padding: ${100 + i * 4 + 1}px;`).join('\n')}\n}`;
        const r = report([analyze('a.css', repeated), analyze('b.css', many)]);
        expect(r.outliers).toHaveLength(50);
        expect(r.outliers[0]).toMatchObject({ px: 10, count: 25, nearestGrid: 12 });
        expect(r.outliers[0].occurrences).toHaveLength(20);
        expect(r.outliers[0].occurrences[19]).toEqual({ file: 'a.css', line: 20 });
        // Ties are sorted by value.
        expect(r.outliers.slice(1, 4).map(o => o.px)).toEqual([101, 105, 109]);
    });

    it('fits the font sizes to a Major Third scale', () => {
        const r = report(files());
        expect(r.typeScale).toEqual({
            name: 'Major Third',
            ratio: 1.25,
            base: 16,
            steps: [8, 10, 13, 16, 20, 25, 31.5, 39, 49, 61, 76.5, 95.5],
            fit: 4 / 6,
            misfits: [12, 14],
        });
        expect(r.fontSizeProposal).toEqual([13, 16, 20, 25, 31.5]);
    });

    it('needs at least three distinct font sizes for a type scale', () => {
        const r = report([analyze('a.css', '.a { font-size: 14px; } .b { font-size: 1rem; } .c { font-size: 14px; }')]);
        expect(r.typeScale).toBeUndefined();
        expect(r.fontSizeProposal).toEqual([14, 16]);
    });

    it('proposes used font sizes when no scale fits well', () => {
        const sizes = [11, 13.4, 15, 18.5, 22.5, 27.5, 35, 43, 55, 69, 85, 107, 135];
        const css = sizes.map((px, i) => `.t${i} { font-size: ${px}px; }`).join('\n') + '\n.x { font-size: 15px; }';
        const r = report([analyze('a.css', css)]);
        expect(r.typeScale!.fit).toBeLessThan(0.5);
        // Rounded to 0.5px, the least used of 13 sizes dropped.
        expect(r.fontSizeProposal).toEqual([11, 13.5, 15, 18.5, 22.5, 27.5, 35, 43, 55, 69, 85, 107]);
    });

    it('proposes a spacing scale from frequent values snapped to the grid', () => {
        expect(report(files()).spacingProposal).toEqual([2, 4, 8, 12, 16, 24, 32]);
        const values = Array.from({ length: 20 }, (_, i) => (i + 1) * 8);
        const css = `.a {\n${values.map((px, i) => `  margin-top: ${px}px;`.repeat(i < 16 ? 2 : 1)).join('\n')}\n  top: 600px;\n}`;
        expect(report([analyze('a.css', css)]).spacingProposal).toEqual(values.slice(0, 16));
    });

    it('proposes radii', () => {
        const css = '.a { border-radius: 4px; } .b { border-radius: 3px 10px; } .c { border-radius: 50%; } .d { --radius-pill: 999px; }';
        expect(report([analyze('a.css', css)]).radiusProposal).toEqual([4, 12, 9999]);
    });
});

describe('fitTypeScale', () => {
    it('prefers the scale the sizes were built on over denser scales that fit by chance', () => {
        const fit = (sizes: number[]) => fitTypeScale(new Map(sizes.map(s => [s, 1])));
        expect(fit([14, 16, 18, 20.25, 22.75])?.name).toBe('Major Second');
        expect(fit([16, 19.2, 23.04, 27.65, 33.18])?.name).toBe('Minor Third');
        expect(fit([12, 16, 21.33, 28.43, 37.9])?.name).toBe('Perfect Fourth');
        expect(fit([16, 24, 36, 54])?.name).toBe('Perfect Fifth');
        expect(fit([16, 25.89, 41.89])?.name).toBe('Golden Ratio');
    });

    it('anchors the scale on the most used size', () => {
        const sizes = new Map([
            [15, 40],
            [18.75, 3],
            [23.44, 2],
            [12, 5],
        ]);
        expect(fitTypeScale(sizes)).toMatchObject({ name: 'Major Third', base: 15, fit: 1, misfits: [] });
    });
});

describe('snapToGrid', () => {
    it('snaps to 2px below 8px and 4px above', () => {
        expect([1, 3, 5, 7, 9, 10, 14, 30, 0.5].map(snapToGrid)).toEqual([2, 4, 6, 8, 8, 12, 16, 32, 2]);
    });
});
