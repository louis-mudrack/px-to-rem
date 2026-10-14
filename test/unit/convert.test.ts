import { describe, expect, it } from 'vitest';
import { createContext, type ProjectContext } from '../../src/core/context';
import { alternativesAt, cycleAt, planConversion, planRebase, planReverse } from '../../src/core/convert';
import { parseDocument } from '../../src/core/document';
import { applyOptions, defaultOptions, legacyLayer, type PartialOptions } from '../../src/core/options';
import { DEFAULT_TAILWIND } from '../../src/core/tailwind';
import { applyEdits } from '../../src/core/text';
import { TokenIndex } from '../../src/core/tokens';

function setup(layer: PartialOptions = {}, ctxPartial: Partial<ProjectContext> = {}) {
    const options = applyOptions(defaultOptions(), layer);
    const ctx = createContext(options, ctxPartial);
    return { options, ctx };
}

function convert(text: string, languageId = 'css', layer: PartialOptions = {}, ctxPartial: Partial<ProjectContext> = {}): string {
    const { options, ctx } = setup(layer, ctxPartial);
    const doc = parseDocument(text, languageId, { tailwind: !!ctx.tailwind, jsUnitlessNumbers: options.js.unitlessNumbers });
    return applyEdits(text, planConversion(doc, options, ctx).edits);
}

const simple = { mode: 'simple' };

describe('formats', () => {
    it('converts to rem with precision and trimmed zeros', () => {
        expect(convert('a { padding: 16px 10px 8.5px; }', 'css', simple)).toBe('a { padding: 1rem 0.625rem 0.5313rem; }');
        expect(convert('a { width: 10px }', 'css', { ...simple, precision: 2 })).toBe('a { width: 0.63rem }');
        expect(convert('a { width: 8px }', 'css', { ...simple, leadingZero: false })).toBe('a { width: .5rem }');
    });

    it('keeps the sign and handles .5px', () => {
        expect(convert('a { margin: -16px .5px; }', 'css', simple)).toBe('a { margin: -1rem 0.0313rem; }');
    });

    it('writes 0px as 0', () => {
        expect(convert('a { margin: 0px 16px; }', 'css', simple)).toBe('a { margin: 0 1rem; }');
        expect(convert('a { margin: 0px; }', 'css', { ...simple, preserveZero: false })).toBe('a { margin: 0rem; }');
    });

    it('uses rem() in preprocessors only when asked or when the project defines it', () => {
        const scss = '.a { padding: 16px; }';
        expect(convert(scss, 'scss', simple)).toBe('.a { padding: 1rem; }');
        expect(convert(scss, 'scss', simple, { remFunctions: [{ name: 'rem', syntax: 'scss' }] })).toBe('.a { padding: rem(16); }');
        expect(convert(scss, 'scss', { ...simple, format: 'rem-function-px' })).toBe('.a { padding: rem(16px); }');
        expect(convert(scss, 'scss', { ...simple, format: 'toRem({px})' })).toBe('.a { padding: toRem(16); }');
    });

    it('never writes rem() into plain CSS (the old default produced invalid CSS)', () => {
        expect(convert('a { padding: 16px; }', 'css', { ...simple, format: 'rem-function' })).toBe('a { padding: 1rem; }');
    });

    it('wraps function output in #{} inside calc when asked', () => {
        expect(convert('a { width: calc(100% - 16px); }', 'scss', { ...simple, format: 'rem-function', interpolateInCalc: true })).toBe(
            'a { width: calc(100% - #{rem(16)}); }',
        );
    });

    it('uses ${} in styled-components templates', () => {
        const tsx = 'const A = styled.div`padding: 8px;`;';
        expect(convert(tsx, 'typescriptreact', { ...simple, format: 'rem-function' })).toBe('const A = styled.div`padding: ${rem(8)};`;');
    });

    it('supports vw, rpx and pt', () => {
        expect(convert('a { width: 144px; }', 'css', { ...simple, format: 'vw', designWidth: 1440 })).toBe('a { width: 10vw; }');
        expect(convert('a { width: 375px; }', 'css', { ...simple, format: 'rpx', designWidth: 375 })).toBe('a { width: 750rpx; }');
        expect(convert('a { width: 16px; }', 'css', { ...simple, format: 'pt' })).toBe('a { width: 12pt; }');
    });

    it('respects a detected root font size', () => {
        expect(convert('a { padding: 16px; }', 'css', simple, { rootFontSize: 10 })).toBe('a { padding: 1.6rem; }');
    });
});

describe('what is never converted', () => {
    it('leaves already converted values, comments and disabled lines alone', () => {
        const scss = `.a {
  margin: rem(10px) rem(4);
  /* 16px */
  padding: 8px; // px-to-rem-disable-line
  top: 4PX;
}`;
        expect(convert(scss, 'scss', simple)).toBe(scss);
    });

    it('keeps the rem() function definition intact', () => {
        const scss = '@function rem($px, $base: 16px) { @return math.div($px, $base) * 1rem; }';
        expect(convert(scss, 'scss', simple)).toBe(scss);
    });

    it('respects min/max and property filters', () => {
        expect(convert('a { width: 2px; height: 2000px; top: 8px }', 'css', { ...simple, minValue: 4, maxValue: 999 })).toBe(
            'a { width: 2px; height: 2000px; top: 0.5rem }',
        );
        expect(convert('a { border-width: 2px; padding: 8px; }', 'css', { ...simple, excludeProperties: ['border*'] })).toBe(
            'a { border-width: 2px; padding: 0.5rem; }',
        );
        expect(convert('a { margin: 8px; padding: 8px; }', 'css', { ...simple, includeProperties: ['padding'] })).toBe(
            'a { margin: 8px; padding: 0.5rem; }',
        );
    });

    it('applies legacy excludePatterns', () => {
        expect(convert('a {\n  top: 1px; /* keep */\n  left: 16px;\n}', 'css', { ...simple, excludePatterns: ['keep'] })).toBe(
            'a {\n  top: 1px; /* keep */\n  left: 1rem;\n}',
        );
    });
});

describe('smart mode', () => {
    it('picks a unit per property', () => {
        const css = `.a {
  font-size: 16px;
  line-height: 24px;
  letter-spacing: 0.8px;
  border: 1px solid;
  border-radius: 8px;
  box-shadow: 0 2px 4px #000;
  padding: 12px;
  top: 1px;
}`;
        expect(convert(css)).toBe(`.a {
  font-size: 1rem;
  line-height: 1.5;
  letter-spacing: 0.05em;
  border: 1px solid;
  border-radius: 0.5rem;
  box-shadow: 0 2px 4px #000;
  padding: 0.75rem;
  top: 1px;
}`);
    });

    it('converts media queries to em relative to the browser default', () => {
        expect(convert('@media (min-width: 768px) { a { padding: 20px } }', 'css', {}, { rootFontSize: 10 })).toBe(
            '@media (min-width: 48em) { a { padding: 2rem } }',
        );
        expect(convert('@media (min-width: 768px) {}', 'css', { mediaQueries: 'keep' })).toBe('@media (min-width: 768px) {}');
    });

    it('finds font sizes through nesting and &:hover', () => {
        const scss = `.card {
  font-size: 20px;
  &:hover { letter-spacing: 1px; }
  .title { line-height: 30px; }
  &__body { line-height: 30px; }
}`;
        expect(convert(scss, 'scss')).toBe(`.card {
  font-size: 1.25rem;
  &:hover { letter-spacing: 0.05em; }
  .title { line-height: 1.5; }
  &__body { line-height: 1.875rem; }
}`);
    });

    it('turns the font shorthand line-height unitless', () => {
        expect(convert('a { font: 700 16px/24px Inter; }')).toBe('a { font: 700 1rem/1.5 Inter; }');
    });

    it('keeps border-ish variables and converts the rest', () => {
        expect(convert('$border-width: 2px; $space-md: 16px; --radius-sm: 4px;', 'scss')).toBe('$border-width: 2px; $space-md: 1rem; --radius-sm: 0.25rem;');
    });

    it('lets users override rules', () => {
        expect(convert('a { border: 2px solid; }', 'css', { smartRules: { border: 'convert' } })).toBe('a { border: 0.125rem solid; }');
    });
});

describe('embedded and framework code', () => {
    it('converts Vue SFC styles and attributes', () => {
        const vue = `<div style="padding: 8px"></div>\n<style lang="scss">.a { margin: 16px }</style>`;
        expect(convert(vue, 'vue')).toBe(`<div style="padding: 0.5rem"></div>\n<style lang="scss">.a { margin: 1rem }</style>`);
    });

    it('converts JS style objects and, when enabled, React numbers', () => {
        const jsx = `<div style={{ fontSize: '16px', width: 320 }} />`;
        expect(convert(jsx, 'javascriptreact')).toBe(`<div style={{ fontSize: '1rem', width: 320 }} />`);
        expect(convert(jsx, 'javascriptreact', { 'js.unitlessNumbers': true })).toBe(`<div style={{ fontSize: '1rem', width: '20rem' }} />`);
        expect(convert(jsx, 'javascriptreact', {}, { reactNative: true })).toBe(jsx);
    });

    it('maps Tailwind arbitrary values to scale classes or rem', () => {
        const html = '<div class="p-[16px] md:-mt-[8px] w-[13px] text-[14px] !gap-[24px]"></div>';
        expect(convert(html, 'html', {}, { tailwind: DEFAULT_TAILWIND })).toBe('<div class="p-4 md:-mt-2 w-[0.8125rem] text-sm !gap-6"></div>');
        expect(convert(html, 'html', { 'tailwind.preferScale': false }, { tailwind: DEFAULT_TAILWIND })).toBe(
            '<div class="p-[1rem] md:-mt-[0.5rem] w-[0.8125rem] text-[0.875rem] !gap-[1.5rem]"></div>',
        );
    });
});

describe('tokens', () => {
    it('prefers exact tokens when asked', () => {
        const tokens = new TokenIndex([
            { name: '--space-4', reference: 'var(--space-4)', kind: 'custom-property', category: 'spacing', px: 16, rawValue: '16px' },
        ]);
        expect(convert('a { padding: 16px 12px; }', 'css', { 'tokens.preferTokens': true }, { tokens })).toBe('a { padding: var(--space-4) 0.75rem; }');
    });
});

describe('legacy settings', () => {
    it('maps pre-2.0 settings', () => {
        expect(legacyLayer({ directConversion: true }, new Set())).toEqual({ format: 'rem' });
        expect(legacyLayer({ directConversion: false }, new Set())).toEqual({ format: 'rem-function' });
        expect(legacyLayer({ keepPxInRem: true }, new Set())).toEqual({ format: 'rem-function-px' });
        expect(legacyLayer({ directConversion: true }, new Set(['format']))).toEqual({});
        expect(legacyLayer({ enableDiagnostics: true, diagnosticSeverity: 'warning' }, new Set())).toEqual({ 'diagnostics.rules': { 'px-unit': 'warning' } });
    });
});

describe('reverse, rebase and cycling', () => {
    it('converts back to px without the old bugs', () => {
        const { options, ctx } = setup();
        const scss = 'a { width: 1.5rem; margin: rem(16) #{rem(8)}; height: rem(4px); }\n@media (min-width: 48em) {}';
        const doc = parseDocument(scss, 'scss');
        expect(applyEdits(scss, planReverse(doc, { ...options, reverseUnits: ['rem', 'em', 'function'] }, ctx))).toBe(
            'a { width: 24px; margin: 16px 8px; height: 4px; }\n@media (min-width: 768px) {}',
        );
    });

    it('rebases rem values to a new root size', () => {
        const { options } = setup();
        const css = 'html { font-size: 62.5%; }\na { padding: 1.6rem; }\n@media (min-width: 48rem) {}';
        const doc = parseDocument(css, 'css');
        const plan = planRebase(doc, 10, 16, options);
        expect(applyEdits(css, [...plan.edits, ...plan.rootDeclarations])).toBe('html { font-size: 100%; }\na { padding: 1rem; }\n@media (min-width: 48rem) {}');
    });

    it('cycles px → rem → em → vw', () => {
        const { options, ctx } = setup();
        let css = 'a { font-size: 20px; padding: 16px; }';
        const offset = css.indexOf('16px') + 1;
        const doc = parseDocument(css, 'css');
        expect(alternativesAt(doc, offset, options, ctx)?.options).toEqual(['16px', '1rem', '0.8em', '1.1111vw']);
        const seen: string[] = [];
        for (let i = 0; i < 4; i++) {
            const d = parseDocument(css, 'css');
            const edit = cycleAt(d, css.indexOf('padding: ') + 10, options, ctx)!;
            css = applyEdits(css, [edit]);
            seen.push(edit.newText);
        }
        expect(seen).toEqual(['1rem', '0.8em', '1.1111vw', '16px']);
    });
});
