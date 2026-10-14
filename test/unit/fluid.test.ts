import { describe, expect, it } from 'vitest';
import { createContext, type ProjectContext } from '../../src/core/context';
import { parseDocument } from '../../src/core/document';
import { evaluateText, type EvalEnv } from '../../src/core/expr';
import { checkZoom, explainValue, findBreakpointMerges, generateClamp, type ClampSpec } from '../../src/core/fluid';
import { applyOptions, defaultOptions, type PartialOptions } from '../../src/core/options';
import { applyEdits } from '../../src/core/text';

const spec: ClampSpec = { minPx: 16, maxPx: 24, minViewport: 375, maxViewport: 1440, rootFontSize: 16, unit: 'vw', precision: 4, leadingZero: true };
const EXAMPLE = 'clamp(1rem, 0.8239rem + 0.7512vw, 1.5rem)';

const env: Omit<EvalEnv, 'viewportWidth' | 'viewportHeight'> = { rootFontSize: 16, emBase: 16 };
const sizeAt = (text: string) => (w: number) => evaluateText(text, { ...env, viewportWidth: w, viewportHeight: (w * 9) / 16 });

describe('generateClamp', () => {
    it('interpolates between two viewports with rem endpoints', () => {
        expect(generateClamp(spec)).toBe(EXAMPLE);
    });

    it('swaps the bounds and uses a negative slope when shrinking', () => {
        expect(generateClamp({ ...spec, minPx: 24, maxPx: 16 })).toBe('clamp(1rem, 1.6761rem - 0.7512vw, 1.5rem)');
    });

    it('returns the rem value when nothing changes', () => {
        expect(generateClamp({ ...spec, maxPx: 16 })).toBe('1rem');
        expect(generateClamp({ ...spec, minViewport: 1440 })).toBe('1.5rem');
    });

    it('handles negative and zero intercepts', () => {
        expect(generateClamp({ ...spec, minPx: 12, maxPx: 48 })).toBe('clamp(0.75rem, -0.0423rem + 3.3803vw, 3rem)');
        expect(generateClamp({ ...spec, minPx: 8, maxPx: 16, minViewport: 800, maxViewport: 1600 })).toBe('clamp(0.5rem, 1vw, 1rem)');
    });

    it('respects unit, precision, leading zero and root font size', () => {
        expect(generateClamp({ ...spec, unit: 'cqi' })).toBe('clamp(1rem, 0.8239rem + 0.7512cqi, 1.5rem)');
        expect(generateClamp({ ...spec, precision: 2 })).toBe('clamp(1rem, 0.82rem + 0.75vw, 1.5rem)');
        expect(generateClamp({ ...spec, leadingZero: false })).toBe('clamp(1rem, .8239rem + .7512vw, 1.5rem)');
        expect(generateClamp({ ...spec, rootFontSize: 10 })).toBe('clamp(1.6rem, 1.3183rem + 0.7512vw, 2.4rem)');
    });

    it('hits the endpoints when evaluated', () => {
        const clamp = generateClamp({ ...spec, minPx: 18, maxPx: 40, minViewport: 320, maxViewport: 1280 });
        expect(sizeAt(clamp)(320)).toBeCloseTo(18, 2);
        expect(sizeAt(clamp)(800)).toBeCloseTo(29, 2);
        expect(sizeAt(clamp)(1280)).toBeCloseTo(40, 2);
        expect(sizeAt(clamp)(200)).toBe(18);
        expect(sizeAt(clamp)(2000)).toBe(40);
    });
});

describe('checkZoom', () => {
    it('passes a fixed size, which scales with zoom', () => {
        expect(checkZoom(() => 16)).toEqual({ passes: true, worstViewport: 320, worstScale: 5 });
        expect(checkZoom(sizeAt('1rem')).passes).toBe(true);
    });

    it('fails pure viewport units, which never grow with zoom', () => {
        const result = checkZoom(sizeAt('4vw'));
        expect(result.passes).toBe(false);
        expect(result.worstScale).toBeCloseTo(1, 6);
    });

    it('fails an aggressive clamp (max/min > 2.5)', () => {
        const result = checkZoom(sizeAt('clamp(1rem, 0.5rem + 2vw, 3rem)'));
        expect(result.passes).toBe(false);
        expect(result.worstViewport).toBe(2000);
        expect(result.worstScale).toBeCloseTo(80 / 48, 6);
    });

    it('passes gentle clamps', () => {
        expect(checkZoom(sizeAt(EXAMPLE)).passes).toBe(true);
        const gentle = checkZoom(sizeAt('clamp(1rem, 0.9rem + 0.5vw, 1.25rem)'));
        expect(gentle.passes).toBe(true);
        expect(gentle.worstScale).toBeGreaterThan(2);
        expect(checkZoom(sizeAt('calc(1rem + 1vw)')).passes).toBe(true);
    });

    it('ignores viewports where the size is unknown', () => {
        expect(checkZoom(w => (w > 2000 ? undefined : 16))).toEqual({ passes: true, worstViewport: 320, worstScale: 5 });
        // Zooming in at 1000px only reaches unknown sizes, so the best scale stays 1.
        expect(checkZoom(w => (w < 1000 ? undefined : 16))).toEqual({ passes: false, worstViewport: 1000, worstScale: 1 });
        expect(checkZoom(() => undefined)).toEqual({ passes: true, worstViewport: 0, worstScale: Infinity });
    });
});

describe('explainValue', () => {
    const breakpoints = [320, 375, 768, 1440, 1920];

    it('evaluates a clamp at each breakpoint and checks zoom for font sizes', () => {
        const explanation = explainValue(EXAMPLE, env, breakpoints, true, true)!;
        expect(explanation.rows.map(r => r.viewport)).toEqual(breakpoints);
        const px = explanation.rows.map(r => r.px!);
        expect(px[0]).toBe(16);
        expect(px[1]).toBe(16);
        expect(px[2]).toBeCloseTo(18.952, 2);
        expect(px[3]).toBeCloseTo(24, 2);
        expect(px[4]).toBe(24);
        expect(explanation.viewportDependent).toBe(true);
        expect(explanation.respondsToFontSize).toBe(true);
        expect(explanation.zoom?.passes).toBe(true);
    });

    it('only checks zoom for viewport-dependent font sizes when enabled', () => {
        expect(explainValue(EXAMPLE, env, breakpoints, false, true)!.zoom).toBeUndefined();
        expect(explainValue(EXAMPLE, env, breakpoints, true, false)!.zoom).toBeUndefined();
        const fixed = explainValue('calc(1rem + 4px)', env, breakpoints, true, true)!;
        expect(fixed.zoom).toBeUndefined();
        expect(fixed.viewportDependent).toBe(false);
        expect(fixed.rows.every(r => r.px === 20)).toBe(true);
    });

    it('flags pure vw font sizes', () => {
        const explanation = explainValue('4vw', env, [375, 1440], true, true)!;
        expect(explanation.rows).toEqual([
            { viewport: 375, px: 15 },
            { viewport: 1440, px: 57.6 },
        ]);
        expect(explanation.respondsToFontSize).toBe(false);
        expect(explanation.zoom?.passes).toBe(false);
    });

    it('follows variables and functions from the environment', () => {
        const withVars = { ...env, resolveVariable: (name: string) => (name === '--step' ? 'clamp(1rem, 4vw, 3rem)' : undefined) };
        const explanation = explainValue('var(--step)', withVars, [400, 800], true, true)!;
        expect(explanation.rows.map(r => r.px)).toEqual([16, 32]);
        expect(explanation.viewportDependent).toBe(true);
        expect(explanation.zoom?.passes).toBe(false);
        expect(explainValue('var(--missing)', withVars, [400], false, false)!.rows).toEqual([{ viewport: 400, px: undefined }]);
    });

    it('uses 9/16 of the width as the height unless a height is given', () => {
        expect(explainValue('10vh', env, [1600], false, false)!.rows[0].px).toBe(90);
        expect(explainValue('10vh', { ...env, viewportHeight: 800 }, [1600], false, false)!.rows[0].px).toBe(80);
    });

    it('returns undefined for values that are not expressions', () => {
        expect(explainValue('auto', env, breakpoints, true, true)).toBeUndefined();
        expect(explainValue('1px solid red', env, breakpoints, false, true)).toBeUndefined();
    });
});

describe('findBreakpointMerges', () => {
    function run(text: string, languageId = 'scss', layer: PartialOptions = {}, ctxPartial: Partial<ProjectContext> = {}) {
        const options = applyOptions(defaultOptions(), layer);
        const ctx = createContext(options, ctxPartial);
        const merges = findBreakpointMerges(parseDocument(text, languageId), options, ctx);
        return { merges, apply: (index = 0) => applyEdits(text, merges[index].edits) };
    }

    const points = (merge: { points: { viewport: number; px: number }[] }) => merge.points.map(p => [p.viewport, p.px]);

    it('merges nested SCSS media queries and removes them', () => {
        const scss = `.title {
    font-size: 16px;
    color: red;

    @media (min-width: 768px) {
        font-size: 20px;
    }

    @media (min-width: 1440px) {
        font-size: 24px;
    }
}
`;
        const { merges, apply } = run(scss);
        expect(merges).toHaveLength(1);
        const [merge] = merges;
        expect(merge.property).toBe('font-size');
        expect(merge.decl.property).toBe('font-size');
        expect(merge.clamp).toBe(EXAMPLE);
        expect(points(merge)).toEqual([
            [375, 16],
            [768, 20],
            [1440, 24],
        ]);
        expect(merge.points[0].decl).toBe(merge.decl);
        expect(merge.maxDeviation?.viewport).toBe(768);
        expect(merge.maxDeviation?.expected).toBe(20);
        expect(merge.maxDeviation?.actual).toBeCloseTo(18.952, 3);
        expect(apply()).toBe(`.title {
    font-size: ${EXAMPLE};
    color: red;
}
`);
    });

    it('merges a one-line nested rule', () => {
        const { merges, apply } = run('.a { font-size: 16px; @media (min-width: 1024px) { font-size: 24px } }');
        expect(merges).toHaveLength(1);
        expect(merges[0].maxDeviation).toBeUndefined();
        const clamp = generateClamp({ ...spec, maxViewport: 1024 });
        expect(merges[0].clamp).toBe(clamp);
        expect(apply()).toBe(`.a { font-size: ${clamp}; }`);
    });

    it('keeps other content of a nested media block', () => {
        const scss = `.a {
    font-size: 16px;
    @media (min-width: 1440px) {
        font-size: 24px;
        color: red;
    }
}`;
        expect(run(scss).apply()).toBe(`.a {
    font-size: ${EXAMPLE};
    @media (min-width: 1440px) {
        color: red;
    }
}`);
    });

    it('removes a media block that only keeps comments', () => {
        const scss = `.a {
    font-size: 16px;
    @media (min-width: 1440px) {
        // bigger on desktop
        font-size: 24px;
    }
}`;
        expect(run(scss).apply()).toBe(`.a {
    font-size: ${EXAMPLE};
}`);
    });

    it('merges top-level CSS media blocks with the same selector', () => {
        const css = `.card { padding: 16px; color: red; }

@media (min-width: 768px) {
  .card { padding: 24px; }
}

@media (min-width: 1440px) {
  .card {
    padding: 32px;
  }
  .other { margin: 0; }
}
`;
        const { merges, apply } = run(css, 'css');
        expect(merges).toHaveLength(1);
        expect(points(merges[0])).toEqual([
            [375, 16],
            [768, 24],
            [1440, 32],
        ]);
        const clamp = generateClamp({ ...spec, maxPx: 32 });
        expect(merges[0].clamp).toBe(clamp);
        expect(apply()).toBe(`.card { padding: ${clamp}; color: red; }

@media (min-width: 1440px) {
  .other { margin: 0; }
}
`);
    });

    it('removes the whole media block once it is empty', () => {
        const css = `.card { padding: 16px; }

@media (min-width: 1440px) {
  /* desktop */
  .card { padding: 24px; }
}
`;
        expect(run(css, 'css').apply()).toBe(`.card { padding: ${EXAMPLE}; }
`);
    });

    it('keeps other declarations of the overriding rule', () => {
        const css = `.card { padding: 16px; }
@media (min-width: 1440px) {
  .card { padding: 24px; color: red; }
}`;
        expect(run(css, 'css').apply()).toBe(`.card { padding: ${EXAMPLE}; }
@media (min-width: 1440px) {
  .card { color: red; }
}`);
    });

    it('matches selectors with different whitespace', () => {
        const css = `.list > li,
.item { margin-top: 16px; }
@media (min-width: 1440px) { .list>li, .item { margin-top: 24px; } }`;
        const { merges, apply } = run(css, 'css');
        expect(merges).toHaveLength(1);
        expect(apply()).toBe(`.list > li,
.item { margin-top: ${EXAMPLE}; }
`);
    });

    it('merges desktop-first max-width queries', () => {
        const css = `.a { font-size: 24px; }
@media (max-width: 767px) { .a { font-size: 16px; } }
`;
        const { merges, apply } = run(css, 'css');
        expect(merges).toHaveLength(1);
        expect(points(merges[0])).toEqual([
            [767, 16],
            [1440, 24],
        ]);
        const clamp = generateClamp({ ...spec, minViewport: 767 });
        expect(merges[0].clamp).toBe(clamp);
        expect(apply()).toBe(`.a { font-size: ${clamp}; }
`);
    });

    it('merges several desktop-first steps that shrink', () => {
        const scss = `.a {
  margin: 48px;
  @media (max-width: 1023px) { margin: 32px; }
  @media (max-width: 47.9375em) { margin: 16px; }
}`;
        const { merges } = run(scss);
        expect(points(merges[0])).toEqual([
            [767, 16],
            [1023, 32],
            [1440, 48],
        ]);
    });

    it('handles shrinking mobile-first values', () => {
        const { merges } = run('.a { padding: 24px; @media (min-width: 1440px) { padding: 16px; } }');
        expect(merges[0].clamp).toBe('clamp(1rem, 1.6761rem - 0.7512vw, 1.5rem)');
    });

    it('skips values that are not monotonic', () => {
        const scss = `.a {
  font-size: 16px;
  @media (min-width: 768px) { font-size: 24px; }
  @media (min-width: 1440px) { font-size: 20px; }
}`;
        expect(run(scss).merges).toEqual([]);
        expect(run('.a { font-size: 16px; @media (min-width: 768px) { font-size: 16px; } }').merges).toEqual([]);
    });

    it('accepts screen and range queries, em and rem breakpoints', () => {
        const at = (query: string) => run(`.a { gap: 16px; @media ${query} { gap: 24px; } }`).merges[0]?.points[1].viewport;
        expect(at('screen and (min-width: 48em)')).toBe(768);
        expect(at('only screen and (min-width:768px)')).toBe(768);
        expect(at('(min-width: 90rem)')).toBe(1440);
        expect(at('(width >= 1024px)')).toBe(1024);
        expect(at('(1024px <= width)')).toBe(1024);
        expect(run('.a { gap: 16px; @media (min-width: 48em) { gap: 24px; } }', 'scss', { mediaQueryBase: 20 }).merges[0].points[1].viewport).toBe(960);
    });

    it('skips media queries with other conditions', () => {
        for (const query of ['(min-width: 768px) and (max-width: 1023px)', 'print', '(orientation: landscape)', 'print and (min-width: 768px)', '(min-width: $md)', '(min-width: 40ch)']) {
            expect(run(`.a { gap: 16px; @media ${query} { gap: 24px; } }`).merges, query).toEqual([]);
        }
    });

    it('ignores unsupported media blocks but merges the others', () => {
        const scss = `.a {
  gap: 16px;
  @media print { gap: 0; }
  @media (min-width: 1440px) { gap: 24px; }
}`;
        expect(run(scss).apply()).toBe(`.a {
  gap: ${EXAMPLE};
  @media print { gap: 0; }
}`);
    });

    it('skips mixed min-width and max-width overrides', () => {
        const scss = `.a {
  gap: 16px;
  @media (max-width: 600px) { gap: 8px; }
  @media (min-width: 1440px) { gap: 24px; }
}`;
        expect(run(scss).merges).toEqual([]);
    });

    it('skips overrides that are not single lengths', () => {
        expect(run('.a { font-size: 16px; @media (min-width: 1440px) { font-size: 2vw; } }').merges).toEqual([]);
        expect(run('.a { margin: 16px 8px; @media (min-width: 1440px) { margin: 24px 8px; } }').merges).toEqual([]);
        expect(run('.a { font-size: 2em; @media (min-width: 1440px) { font-size: 24px; } }').merges).toEqual([]);
    });

    it('skips breakpoints at or below the minimum viewport', () => {
        expect(run('.a { gap: 16px; @media (min-width: 320px) { gap: 24px; } }').merges).toEqual([]);
        expect(run('.a { gap: 16px; @media (min-width: 320px) { gap: 24px; } }', 'scss', { 'fluid.minViewport': 300 }).merges).toHaveLength(1);
    });

    it('converts rem values and rem() calls', () => {
        expect(run('.a { font-size: 1rem; @media (min-width: 1440px) { font-size: 1.5rem; } }').merges[0].clamp).toBe(EXAMPLE);
        expect(run('.a { font-size: rem(16); @media (min-width: 1440px) { font-size: rem(24px); } }').merges[0].clamp).toBe(EXAMPLE);
        const custom = run('.a { font-size: toRem(16); @media (min-width: 1440px) { font-size: toRem(24); } }', 'scss', {}, { remFunctions: [{ name: 'toRem', syntax: 'scss' }] });
        expect(custom.merges[0].clamp).toBe(EXAMPLE);
        const root10 = run('.a { font-size: 1.6rem; @media (min-width: 1440px) { font-size: 24px; } }', 'scss', {}, { rootFontSize: 10 });
        expect(points(root10.merges[0])).toEqual([
            [375, 16],
            [1440, 24],
        ]);
        expect(root10.merges[0].clamp).toBe('clamp(1.6rem, 1.3183rem + 0.7512vw, 2.4rem)');
    });

    it('uses fluid.unit and number formatting options', () => {
        const { merges } = run('.a { font-size: 16px; @media (min-width: 1440px) { font-size: 24px; } }', 'scss', { 'fluid.unit': 'cqi', precision: 2, leadingZero: false });
        expect(merges[0].clamp).toBe('clamp(1rem, .82rem + .75cqi, 1.5rem)');
    });

    it('only uses the last declaration of a property and overrides after it', () => {
        const fallback = run('.a { font-size: 16px; font-size: 1rem; @media (min-width: 1440px) { font-size: 24px; } }');
        expect(fallback.merges).toHaveLength(1);
        expect(fallback.apply()).toBe(`.a { font-size: 16px; font-size: ${EXAMPLE}; }`);
        expect(run('.a { @media (min-width: 1440px) { font-size: 24px; } font-size: 16px; }').merges).toEqual([]);
        expect(run('@media (min-width: 1440px) { .a { font-size: 24px; } }\n.a { font-size: 16px; }', 'css').merges).toEqual([]);
    });

    it('lets the later override win at equal breakpoints', () => {
        const css = `.a { gap: 16px; }
@media (min-width: 1440px) { .a { gap: 20px; } }
@media (min-width: 1440px) { .a { gap: 24px; } }
`;
        const { merges, apply } = run(css, 'css');
        expect(points(merges[0])).toEqual([
            [375, 16],
            [1440, 24],
        ]);
        expect(apply()).toBe(`.a { gap: ${EXAMPLE}; }
`);
    });

    it('skips !important mismatches', () => {
        expect(run('.a { gap: 16px; @media (min-width: 1440px) { gap: 24px !important; } }').merges).toEqual([]);
        const both = run('.a { gap: 16px !important; @media (min-width: 1440px) { gap: 24px !important; } }');
        expect(both.apply()).toBe(`.a { gap: ${EXAMPLE} !important; }`);
    });

    it('merges custom properties but not preprocessor variables', () => {
        const css = `:root { --step: 16px; }
@media (min-width: 1440px) { :root { --step: 24px; } }`;
        const { merges, apply } = run(css, 'css');
        expect(merges[0].property).toBe('--step');
        expect(apply()).toBe(`:root { --step: ${EXAMPLE}; }
`);
        expect(run('.a { $x: 16px; @media (min-width: 1440px) { $x: 24px; } }').merges).toEqual([]);
    });

    it('does not use declarations inside media queries as a base', () => {
        expect(run('@media (min-width: 768px) { .a { gap: 16px; @media (min-width: 1440px) { gap: 24px; } } }').merges).toEqual([]);
    });

    it('returns one merge per base declaration, each applicable on its own or together', () => {
        const scss = `.a {
  font-size: 16px;
  line-height: 20px;
  @media (min-width: 1440px) {
    font-size: 24px;
    line-height: 28px;
  }
}`;
        const { merges, apply } = run(scss);
        expect(merges.map(m => m.property)).toEqual(['font-size', 'line-height']);
        expect(apply(0)).toBe(`.a {
  font-size: ${EXAMPLE};
  line-height: 20px;
  @media (min-width: 1440px) {
    line-height: 28px;
  }
}`);
        expect(() => applyEdits(scss, merges.flatMap(m => m.edits))).not.toThrow();
    });

    it('works with nested rules (b) at the same nesting level', () => {
        const scss = `.page {
  .a { gap: 16px; }
  @media (min-width: 1440px) {
    .a { gap: 24px; }
  }
}`;
        expect(run(scss).apply()).toBe(`.page {
  .a { gap: ${EXAMPLE}; }
}`);
    });

    it('works in Less and indented Sass', () => {
        const less = '.a { font-size: 16px; @media (min-width: 1440px) { font-size: 24px; } }';
        expect(run(less, 'less').apply()).toBe(`.a { font-size: ${EXAMPLE}; }`);
        const sass = `.a
  font-size: 16px
  @media (min-width: 1440px)
    font-size: 24px
.b
  color: red
`;
        expect(run(sass, 'sass').apply()).toBe(`.a
  font-size: ${EXAMPLE}
.b
  color: red
`);
    });

    it('works with CRLF line endings', () => {
        const css = '.a {\r\n  gap: 16px;\r\n  @media (min-width: 1440px) {\r\n    gap: 24px;\r\n  }\r\n}\r\n';
        expect(run(css, 'scss').apply()).toBe(`.a {\r\n  gap: ${EXAMPLE};\r\n}\r\n`);
    });

    it('finds nothing without media queries', () => {
        expect(run('.a { font-size: 16px; } .b { font-size: 24px; }', 'css').merges).toEqual([]);
    });
});
