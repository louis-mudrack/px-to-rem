import { describe, expect, it } from 'vitest';
import { parseDocument, type ParseDocumentOptions } from '../../src/core/document';

function lengths(text: string, languageId = 'scss', options: ParseDocumentOptions = {}) {
    const doc = parseDocument(text, languageId, options);
    return doc.lengths.map(l => ({
        raw: text.slice(l.start, l.end),
        context: l.context,
        property: l.decl?.property,
        functions: l.functions.join('>'),
        disabled: l.disabled,
    }));
}

const raws = (text: string, languageId = 'scss', options: ParseDocumentOptions = {}) => lengths(text, languageId, options).map(l => l.raw);

describe('tokenizing and scanning', () => {
    it('finds lengths in declarations with their property', () => {
        const out = lengths('.a { padding: 16px 24px; font-size: 1.5rem; }', 'css');
        expect(out).toEqual([
            { raw: '16px', context: 'declaration', property: 'padding', functions: '', disabled: false },
            { raw: '24px', context: 'declaration', property: 'padding', functions: '', disabled: false },
            { raw: '1.5rem', context: 'declaration', property: 'font-size', functions: '', disabled: false },
        ]);
    });

    it('handles one-line rules (old version lost the property)', () => {
        expect(lengths('a { padding: 4px }', 'css')[0].property).toBe('padding');
    });

    it('does not treat .5px as 5px', () => {
        expect(raws('.a { margin: .5px -.5px; }', 'css')).toEqual(['.5px', '-.5px']);
    });

    it('ignores comments, strings, urls and class names', () => {
        const css = `
/* 16px in a comment */
.mt-16px, .icon-24px { content: "16px"; background: url(img-16px.png); }
// line comment 8px
$size-10px: 4px;`;
        expect(raws(css, 'scss')).toEqual(['4px']);
    });

    it('treats // as a comment only outside plain CSS', () => {
        expect(raws('a { b: 1px; } // 2px', 'scss')).toEqual(['1px']);
        expect(raws('a { background: url(//cdn.example.com/x-2px.png); width: 3px }', 'css')).toEqual(['3px']);
    });

    it('records enclosing functions', () => {
        const out = lengths('a { width: calc(100% - clamp(8px, 2vw, 24px)); }', 'css');
        expect(out.find(l => l.raw === '8px')?.functions).toBe('calc>clamp');
    });

    it('skips lengths inside rem() calls for later reverse conversion', () => {
        const doc = parseDocument('a { margin: rem(16px) 0; padding: #{rem(8)}; }', 'scss');
        const rem = doc.functions.filter(f => f.name === 'rem');
        expect(rem).toHaveLength(2);
        expect(doc.text.slice(rem[1].interpolation!.start, rem[1].interpolation!.end)).toBe('#{rem(8)}');
        expect(doc.lengths.find(l => l.unit === 'px')?.functions).toEqual(['rem']);
    });

    it('marks media queries, containers and selectors', () => {
        const out = lengths('@media (min-width: 768px) { .a { gap: 8px } } @container card (width > 400px) { b { top: 1px } }', 'css');
        expect(out.map(l => [l.raw, l.context])).toEqual([
            ['768px', 'media'],
            ['8px', 'declaration'],
            ['400px', 'container'],
            ['1px', 'declaration'],
        ]);
    });

    it('does not touch Sass function definitions or control flow', () => {
        const scss = `
@use 'sass:math';
@function rem($px, $base: 16px) { @return math.div($px, $base) * 1rem; }
@mixin pad($x: 8px) { padding: $x; margin: 2px; }
@if $a > 10px { .x { width: 3px } }
@include mq($from: 768px) { .y { left: 4px } }
@include button-size(12px, 24px);
`;
        const out = lengths(scss);
        expect(out.map(l => [l.raw, l.context])).toEqual([
            ['16px', 'control'],
            ['1rem', 'control'],
            ['8px', 'control'],
            ['2px', 'declaration'],
            ['10px', 'control'],
            ['3px', 'declaration'],
            ['768px', 'breakpoint-mixin'],
            ['4px', 'declaration'],
            ['12px', 'mixin'],
            ['24px', 'mixin'],
        ]);
    });

    it('distinguishes Sass, Less and custom property variables', () => {
        expect(lengths('$a: 4px; --b: 8px;')[0].context).toBe('variable');
        expect(lengths('$a: 4px; --b: 8px;')[1].context).toBe('custom-property');
        expect(lengths('@gutter: 16px; .a { .mixin(8px); }', 'less').map(l => [l.raw, l.context])).toEqual([
            ['16px', 'variable'],
            ['8px', 'mixin'],
        ]);
    });

    it('handles nested rules and nested properties', () => {
        const out = lengths('.a { &:hover { padding: 1px } font: { size: 12px; } .b { margin: 2px } }');
        expect(out.map(l => [l.raw, l.property])).toEqual([
            ['1px', 'padding'],
            ['12px', 'font-size'],
            ['2px', 'margin'],
        ]);
    });

    it('detects the line-height part of the font shorthand', () => {
        const doc = parseDocument('a { font: italic 16px/24px Inter, sans-serif; }', 'css');
        const lh = doc.lengths[1];
        expect(doc.text.slice(lh.start, lh.end)).toBe('24px');
        expect(lh.shorthandFontSize?.value).toBe(16);
    });

    it('strips !important from the value span', () => {
        const doc = parseDocument('a { margin: 4px !important; }', 'css');
        expect(doc.declarations[0].important).toBe(true);
        expect(doc.text.slice(doc.declarations[0].valueSpan.start, doc.declarations[0].valueSpan.end)).toBe('4px');
    });
});

describe('indentation syntaxes', () => {
    it('parses indented Sass', () => {
        const sass = `.card
  padding: 16px
  &:hover
    margin: 4px
  +mq($from: 768px)
    gap: 8px
$x: 2px
`;
        expect(lengths(sass, 'sass').map(l => [l.raw, l.property, l.context])).toEqual([
            ['16px', 'padding', 'declaration'],
            ['4px', 'margin', 'declaration'],
            ['768px', undefined, 'breakpoint-mixin'],
            ['8px', 'gap', 'declaration'],
            ['2px', '$x', 'variable'],
        ]);
    });

    it('parses indented Stylus with and without colons', () => {
        const styl = `.card
  padding 16px
  margin: 4px 8px
  .inner
    width 100px
size = 12px
`;
        expect(lengths(styl, 'stylus').map(l => [l.raw, l.property])).toEqual([
            ['16px', 'padding'],
            ['4px', 'margin'],
            ['8px', 'margin'],
            ['100px', 'width'],
            ['12px', 'size'],
        ]);
    });

    it('parses brace-style Stylus without semicolons', () => {
        const styl = `.card {
  padding 16px
  .inner {
    margin 4px
  }
}`;
        expect(lengths(styl, 'stylus').map(l => [l.raw, l.property])).toEqual([
            ['16px', 'padding'],
            ['4px', 'margin'],
        ]);
    });
});

describe('embedded regions', () => {
    it('finds <style> blocks with lang and style attributes in Vue/HTML', () => {
        const vue = `<template>
  <div style="padding: 8px; margin: 0 4px" class="x"></div>
  <p>Don't convert 12px in text</p>
</template>
<style lang="scss" scoped>
.a { width: 100px; .b { gap: 2px } }
</style>`;
        expect(lengths(vue, 'vue').map(l => [l.raw, l.property])).toEqual([
            ['8px', 'padding'],
            ['4px', 'margin'],
            ['100px', 'width'],
            ['2px', 'gap'],
        ]);
    });

    it('finds styled-components and css`` templates, skipping ${} expressions', () => {
        const tsx = `
const Button = styled.button<{ big: boolean }>\`
  padding: 8px \${p => (p.big ? '20px' : '10px')};
  font-size: 14px;
  \${media.tablet\`margin: 3px;\`}
\`;
const Title = styled(Heading).attrs({ as: 'h2' })\`margin-bottom: 24px;\`;
const g = css\`gap: 6px\`;
const notCss = \`width: 99px\`;
`;
        expect(raws(tsx, 'typescriptreact')).toEqual(['8px', '14px', '24px', '6px']);
    });

    it('finds JS style objects', () => {
        const jsx = `<div style={{ fontSize: '16px', padding: "8px 12px", lineHeight: 1.5, width: 300 }} />`;
        expect(lengths(jsx, 'javascriptreact').map(l => [l.raw, l.property])).toEqual([
            ['16px', 'font-size'],
            ['8px', 'padding'],
            ['12px', 'padding'],
        ]);
        const withNumbers = parseDocument(jsx, 'javascriptreact', { jsUnitlessNumbers: true });
        const implicit = withNumbers.lengths.filter(l => l.implicitPx);
        expect(implicit.map(l => [jsx.slice(l.start, l.end), l.decl?.property])).toEqual([['300', 'width']]);
    });

    it('finds Tailwind arbitrary values only when enabled', () => {
        const html = `<div class="p-[16px] md:-mt-[8px] text-[14px] bg-[#fff] [margin:4px_2px] w-full"></div>`;
        expect(raws(html, 'html')).toEqual([]);
        expect(lengths(html, 'html', { tailwind: true }).map(l => [l.raw, l.property])).toEqual([
            ['16px', 'padding'],
            ['8px', 'margin-top'],
            ['14px', 'font-size'],
            ['4px', 'margin'],
            ['2px', 'margin'],
        ]);
        expect(raws('.a { @apply p-[12px] flex; }', 'css', { tailwind: true })).toEqual(['12px']);
    });
});

describe('directives', () => {
    it('honours disable comments and the uppercase PX opt-out marker', () => {
        const css = `a {
  /* px-to-rem-disable-next-line */
  width: 10px;
  height: 11px; /* px-to-rem-disable-line */
  /* px-to-rem-disable */
  top: 12px;
  /* px-to-rem-enable */
  left: 13PX;
  right: 14px;
}`;
        const out = lengths(css, 'css');
        expect(out.map(l => [l.raw, l.disabled])).toEqual([
            ['10px', true],
            ['11px', true],
            ['12px', true],
            ['13PX', false],
            ['14px', false],
        ]);
    });

    it('supports // comments in SCSS and JS', () => {
        expect(lengths('a {\n  // pxtorem-disable-next-line\n  width: 1px;\n}').map(l => l.disabled)).toEqual([true]);
        expect(
            lengths('// px-to-rem-disable-file\nconst a = css`width: 1px`;', 'typescript').map(l => l.disabled),
        ).toEqual([true]);
    });
});
