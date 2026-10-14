import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/document';
import { applyOptions, defaultOptions, type Options } from '../../src/core/options';
import { TokenIndex, type TokenDef } from '../../src/core/tokens';
import { extractTokensFromDocument, extractTokensFromJson, parseSingleLength } from '../../src/core/tokens/extract';

const options = defaultOptions();

function fromSheet(text: string, languageId: string, rootFontSize = 16, opts: Options = options): TokenDef[] {
    return extractTokensFromDocument(parseDocument(text, languageId), `styles/tokens.${languageId}`, opts, rootFontSize);
}

/** [name, reference, kind, category, px or colour] */
const summary = (tokens: TokenDef[]) => tokens.map(t => [t.name, t.reference, t.kind, t.category, t.px ?? t.color]);
const byName = (tokens: TokenDef[], name: string) => tokens.find(t => t.name === name);

describe('parseSingleLength', () => {
    it('reads a number with an optional unit', () => {
        expect(parseSingleLength('16px')).toEqual({ value: 16, unit: 'px' });
        expect(parseSingleLength(' 1.5REM ')).toEqual({ value: 1.5, unit: 'rem' });
        expect(parseSingleLength('62.5%')).toEqual({ value: 62.5, unit: '%' });
        expect(parseSingleLength('-.5em')).toEqual({ value: -0.5, unit: 'em' });
        expect(parseSingleLength('0')).toEqual({ value: 0, unit: '' });
        expect(parseSingleLength('16px 8px')).toBeUndefined();
        expect(parseSingleLength('calc(1px)')).toBeUndefined();
    });
});

describe('Sass tokens', () => {
    const designTokens = `@use "sass:map";
@use "sass:math";

// Spacing scale
$space-unit: 4px;
$space-1: $space-unit !default;
$space-2: 8px;
$space-4: 1rem;
$space-6: rem(24);
$gutter: $space_4;
$font-size-base: 16px !default;
$font-size-lg: 1.25rem;
$line-height-base: 1.5;
$letter-spacing-tight: 0.02em;
$radius-md: 6px;
$border-width: 1px;
$brand-primary: #3b82f6;
$brand-danger: rgb(239, 68, 68);
$overlay: rgba(15, 23, 42, 0.5);
$white: white;
$font-stack: ("Inter", sans-serif);
$z-modal: 1000;
$transition: 200ms ease-in-out;
$container: calc(100% - 32px);

$spacing: (
  'xs': 4px,
  sm: 8px,
  md: $space-4,
  lg: 24px,
);

$breakpoints: (sm: 576px, md: 768px, lg: 992px);
$section-gap: map.get($spacing, lg);

.card {
  $local: 99px;
  --card-padding: 12px;
  padding: map.get($spacing, md);
}

@mixin pad {
  $inner: 3px;
}
`;

    it('extracts top-level variables with resolved values', () => {
        const tokens = fromSheet(designTokens, 'scss');
        expect(summary(tokens.filter(t => t.kind === 'scss'))).toEqual([
            ['$space-unit', '$space-unit', 'scss', 'spacing', 4],
            ['$space-1', '$space-1', 'scss', 'spacing', 4],
            ['$space-2', '$space-2', 'scss', 'spacing', 8],
            ['$space-4', '$space-4', 'scss', 'spacing', 16],
            ['$space-6', '$space-6', 'scss', 'spacing', 24],
            ['$gutter', '$gutter', 'scss', 'spacing', 16],
            ['$font-size-base', '$font-size-base', 'scss', 'font-size', 16],
            ['$font-size-lg', '$font-size-lg', 'scss', 'font-size', 20],
            ['$radius-md', '$radius-md', 'scss', 'radius', 6],
            ['$border-width', '$border-width', 'scss', 'border', 1],
            ['$brand-primary', '$brand-primary', 'scss', 'color', [59, 130, 246, 1]],
            ['$brand-danger', '$brand-danger', 'scss', 'color', [239, 68, 68, 1]],
            ['$overlay', '$overlay', 'scss', 'color', [15, 23, 42, 0.5]],
            ['$white', '$white', 'scss', 'color', [255, 255, 255, 1]],
            ['$section-gap', '$section-gap', 'scss', 'spacing', 24],
        ]);
    });

    it('turns Sass maps into one token per entry', () => {
        const tokens = fromSheet(designTokens, 'scss').filter(t => t.kind === 'scss-map');
        expect(summary(tokens)).toEqual([
            ['$spacing.xs', "map.get($spacing, 'xs')", 'scss-map', 'spacing', 4],
            ['$spacing.sm', 'map.get($spacing, sm)', 'scss-map', 'spacing', 8],
            ['$spacing.md', 'map.get($spacing, md)', 'scss-map', 'spacing', 16],
            ['$spacing.lg', 'map.get($spacing, lg)', 'scss-map', 'spacing', 24],
            ['$breakpoints.sm', 'map.get($breakpoints, sm)', 'scss-map', 'breakpoint', 576],
            ['$breakpoints.md', 'map.get($breakpoints, md)', 'scss-map', 'breakpoint', 768],
            ['$breakpoints.lg', 'map.get($breakpoints, lg)', 'scss-map', 'breakpoint', 992],
        ]);
        expect(tokens[1].rawValue).toBe('8px');
        expect(tokens[2].rawValue).toBe('$space-4');
    });

    it('records the file and line of each token (map entries on their own line)', () => {
        const tokens = fromSheet(designTokens, 'scss');
        expect(byName(tokens, '$space-unit')?.source).toEqual({ file: 'styles/tokens.scss', line: 4 });
        const lines = designTokens.split('\n');
        expect(lines[byName(tokens, '$spacing.lg')!.source!.line!]).toBe('  lg: 24px,');
        expect(lines[byName(tokens, '$breakpoints.md')!.source!.line!]).toMatch(/^\$breakpoints:/);
    });

    it('skips values that are not a single length or colour, and local variables', () => {
        const names = fromSheet(designTokens, 'scss').map(t => t.name);
        for (const name of ['$line-height-base', '$letter-spacing-tight', '$font-stack', '$z-modal', '$transition', '$container', '$local', '--card-padding', '$inner']) {
            expect(names).not.toContain(name);
        }
    });

    it('uses map-get() without @use "sass:map", and the module namespace when renamed', () => {
        const legacy = `$sizes: (small: 12px, "large": 20px);\n$theme: (space: (sm: 4px, md: 8px));`;
        expect(fromSheet(legacy, 'scss').map(t => [t.name, t.reference, t.px])).toEqual([
            ['$sizes.small', 'map-get($sizes, small)', 12],
            ['$sizes.large', 'map-get($sizes, "large")', 20],
            ['$theme.space.sm', 'map-get(map-get($theme, space), sm)', 4],
            ['$theme.space.md', 'map-get(map-get($theme, space), md)', 8],
        ]);
        const modern = `@use 'sass:map' as m;\n$theme: (space: (sm: 4px));`;
        expect(fromSheet(modern, 'scss').map(t => t.reference)).toEqual(['m.get($theme, space, sm)']);
        const plain = `@use "sass:map";\n$theme: (space: (sm: 4px));`;
        expect(fromSheet(plain, 'scss').map(t => t.reference)).toEqual(['map.get($theme, space, sm)']);
    });

    it('converts rem at the given root font size and honours a custom functionName', () => {
        const scss = '$space-4: 1rem;\n$space-6: to-rem(24px);\n$space-8: rem(32);';
        const custom = applyOptions(defaultOptions(), { functionName: 'to-rem' });
        expect(fromSheet(scss, 'scss', 10, custom).map(t => [t.name, t.px])).toEqual([
            ['$space-4', 10],
            ['$space-6', 24],
        ]);
    });

    it('resolves Sass values interpolated into custom properties', () => {
        const scss = '$space-4: 16px;\n$spacing: (lg: 24px);\n:root {\n  --space-4: #{$space-4};\n  --space-lg: #{map-get($spacing, lg)};\n  --space-8: #{rem(32)};\n}';
        expect(fromSheet(scss, 'scss').map(t => [t.name, t.px])).toEqual([
            ['$space-4', 16],
            ['$spacing.lg', 24],
            ['--space-4', 16],
            ['--space-lg', 24],
            ['--space-8', 32],
        ]);
    });

    it('reads indented Sass', () => {
        const sass = `@use "sass:map"\n$space-2: 8px\n$spacing: (sm: 8px, md: 16px)\n.a\n  $local: 1px\n`;
        expect(fromSheet(sass, 'sass').map(t => [t.name, t.reference, t.px])).toEqual([
            ['$space-2', '$space-2', 8],
            ['$spacing.sm', 'map.get($spacing, sm)', 8],
            ['$spacing.md', 'map.get($spacing, md)', 16],
        ]);
    });

    it('reads Sass in Vue single-file components', () => {
        const vue = `<template><div /></template>\n<style lang="scss">\n$space-3: 12px;\n.x { padding: $space-3; }\n</style>`;
        expect(summary(fromSheet(vue, 'vue'))).toEqual([['$space-3', '$space-3', 'scss', 'spacing', 12]]);
    });
});

describe('CSS custom properties', () => {
    const tokensCss = `:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: var(--space-base);
  --space-base: 16px;
  --space-0: 0;
  --z-base: 0;
  --font-size-sm: 0.875rem;
  --radius-lg: 12px;
  --color-primary: #2563eb;
  --color-primary-hover: hsl(221, 83%, 53%);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --leading-normal: 1.5;
  --font-sans: "Inter", system-ui, sans-serif;
  --gap: var(--missing, 8px);
}

[data-theme="dark"] {
  --color-primary: #60a5fa;
}

:root.compact, html[data-density="compact"] { --space-2: 6px; }

@media (min-width: 768px) {
  :root { --container-padding: 32px; }
}

.button {
  --button-padding: 10px;
}

:root .nested { --nope: 1px; }
`;

    it('extracts :root, theme and top-level custom properties only', () => {
        const tokens = fromSheet(tokensCss, 'css');
        expect(tokens.map(t => [t.name, t.px ?? t.color?.slice(0, 3)])).toEqual([
            ['--space-1', 4],
            ['--space-2', 8],
            ['--space-4', 16],
            ['--space-base', 16],
            ['--space-0', 0],
            ['--font-size-sm', 14],
            ['--radius-lg', 12],
            ['--color-primary', [37, 99, 235]],
            ['--color-primary-hover', expect.any(Array)],
            ['--gap', 8],
            ['--color-primary', [96, 165, 250]],
            ['--space-2', 6],
            ['--container-padding', 32],
        ]);
        expect(tokens.every(t => t.kind === 'custom-property' && t.reference === `var(${t.name})`)).toBe(true);
        expect(byName(tokens, '--font-size-sm')?.category).toBe('font-size');
        expect(byName(tokens, '--radius-lg')?.category).toBe('radius');
        expect(byName(tokens, '--color-primary')?.category).toBe('color');
        expect(byName(tokens, '--space-4')?.rawValue).toBe('var(--space-base)');
        expect(byName(tokens, '--radius-lg')?.source).toEqual({ file: 'styles/tokens.css', line: 8 });
    });

    it('converts rem at the root font size', () => {
        expect(fromSheet(':root { --space-1: 0.25rem; --space-4: 1rem; }', 'css', 10).map(t => t.px)).toEqual([2.5, 10]);
    });

    it('removes exact duplicates', () => {
        const css = ':root { --gap: 4px; } @media print { :root { --gap: 4px; } } :root, :host { --pad: 2px; }';
        expect(fromSheet(css, 'css').map(t => t.name)).toEqual(['--gap', '--pad']);
    });

    it('reads Tailwind v4 @theme blocks', () => {
        const css = `@import "tailwindcss";

@theme {
  --spacing: 0.25rem;
  --spacing-18: 4.5rem;
  --text-xs: 0.75rem;
  --text-xs--line-height: calc(1 / 0.75);
  --text-tiny: 10px;
  --radius-card: 14px;
  --color-brand-500: oklch(0.62 0.19 259);
  --color-ink: #0f172a;
  --breakpoint-3xl: 120rem;
  --color-*: initial;
}

.btn { --tw-ring-offset-width: 2px; }
`;
        expect(summary(fromSheet(css, 'css'))).toEqual([
            ['--spacing', 'var(--spacing)', 'custom-property', 'spacing', 4],
            ['--spacing-18', 'var(--spacing-18)', 'custom-property', 'spacing', 72],
            ['--text-xs', 'var(--text-xs)', 'custom-property', 'font-size', 12],
            ['--text-tiny', 'var(--text-tiny)', 'custom-property', 'font-size', 10],
            ['--radius-card', 'var(--radius-card)', 'custom-property', 'radius', 14],
            ['--color-ink', 'var(--color-ink)', 'custom-property', 'color', [15, 23, 42, 1]],
            ['--breakpoint-3xl', 'var(--breakpoint-3xl)', 'custom-property', 'breakpoint', 1920],
        ]);
    });

    it('only takes global properties from CSS-in-JS', () => {
        const tsx = `
const Global = createGlobalStyle\`:root { --gap: 4px; }\`;
const Box = styled.div\`--box-gap: 2px; padding: var(--box-gap);\`;
`;
        expect(fromSheet(tsx, 'typescriptreact').map(t => t.name)).toEqual(['--gap']);
        expect(fromSheet('<div style="--inline-gap: 4px"></div>', 'html')).toEqual([]);
    });
});

describe('Less and Stylus tokens', () => {
    it('reads top-level Less variables, including lazy references', () => {
        const less = `@gutter: 16px;
@gutter-lg: @gutter-xl;
@gutter-xl: 32px;
@brand: #ff6600;
@ratio: 1.5;
.card { @local: 4px; }
`;
        expect(summary(fromSheet(less, 'less'))).toEqual([
            ['@gutter', '@gutter', 'less', 'spacing', 16],
            ['@gutter-lg', '@gutter-lg', 'less', 'spacing', 32],
            ['@gutter-xl', '@gutter-xl', 'less', 'spacing', 32],
            ['@brand', '@brand', 'less', 'color', [255, 102, 0, 1]],
        ]);
    });

    it('reads top-level Stylus variables', () => {
        const styl = `base-spacing = 8px
$radius = 4px
gutter = base-spacing
brand = rebeccapurple
.card
  padding gutter
  local = 2px
`;
        expect(summary(fromSheet(styl, 'stylus'))).toEqual([
            ['base-spacing', 'base-spacing', 'stylus', 'spacing', 8],
            ['$radius', '$radius', 'stylus', 'radius', 4],
            ['gutter', 'gutter', 'stylus', 'spacing', 8],
            ['brand', 'brand', 'stylus', 'color', [102, 51, 153, 1]],
        ]);
    });
});

describe('JSON token files', () => {
    const dtcg = JSON.stringify(
        {
            $schema: 'https://www.designtokens.org/schemas/2025.10/format.json',
            $description: 'Acme design tokens',
            space: {
                $type: 'dimension',
                '1': { $value: { value: 4, unit: 'px' } },
                '2': { $value: { value: 0.5, unit: 'rem' } },
                '4': { $value: '16px', $description: 'Legacy string form' },
                gutter: { $value: '{space.4}' },
                section: { $value: { $ref: '#/space/2/$value' } },
            },
            font: {
                size: {
                    $type: 'dimension',
                    body: { $value: { value: 1, unit: 'rem' } },
                    caption: { $value: { value: 0.75, unit: 'em' } },
                },
                weight: { bold: { $type: 'fontWeight', $value: 700 } },
            },
            radius: { md: { $type: 'dimension', $value: '6px' } },
            color: {
                $type: 'color',
                blue: {
                    '500': { $value: { colorSpace: 'srgb', components: [0.231, 0.51, 0.965], alpha: 1, hex: '#3b82f6' } },
                    '600': { $value: '#2563eb' },
                },
                primary: { $value: '{color.blue.500}', $extensions: { 'com.figma': { hiddenFromPublishing: false } } },
                red: { $value: { colorSpace: 'srgb', components: [1, 0, 0] } },
            },
            duration: { fast: { $type: 'duration', $value: { value: 100, unit: 'ms' } } },
            loop: { a: { $type: 'dimension', $value: '{loop.b}' }, b: { $type: 'dimension', $value: '{loop.a}' } },
        },
        null,
        2,
    );

    it('reads W3C DTCG tokens with object dimensions, aliases and $ref', () => {
        const tokens = extractTokensFromJson(dtcg, 'tokens/acme.tokens.json', options, 16);
        expect(summary(tokens)).toEqual([
            ['space.1', 'var(--space-1)', 'json', 'spacing', 4],
            ['space.2', 'var(--space-2)', 'json', 'spacing', 8],
            ['space.4', 'var(--space-4)', 'json', 'spacing', 16],
            ['space.gutter', 'var(--space-gutter)', 'json', 'spacing', 16],
            ['space.section', 'var(--space-section)', 'json', 'spacing', 8],
            ['font.size.body', 'var(--font-size-body)', 'json', 'font-size', 16],
            ['radius.md', 'var(--radius-md)', 'json', 'radius', 6],
            ['color.blue.500', 'var(--color-blue-500)', 'json', 'color', [59, 130, 246, 1]],
            ['color.blue.600', 'var(--color-blue-600)', 'json', 'color', [37, 99, 235, 1]],
            ['color.primary', 'var(--color-primary)', 'json', 'color', [59, 130, 246, 1]],
            ['color.red', 'var(--color-red)', 'json', 'color', [255, 0, 0, 1]],
        ]);
        expect(tokens[0].rawValue).toBe('{"value":4,"unit":"px"}');
        expect(tokens[3].rawValue).toBe('{space.4}');
    });

    it('points sources at the token key', () => {
        const tokens = extractTokensFromJson(dtcg, 'tokens/acme.tokens.json', options, 16);
        const lines = dtcg.split('\n');
        const radius = byName(tokens, 'radius.md')!;
        expect(radius.source?.file).toBe('tokens/acme.tokens.json');
        expect(lines[radius.source!.line!]).toContain('"md"');
        expect(lines[byName(tokens, 'color.blue.600')!.source!.line!]).toContain('"600"');
    });

    it('applies the root font size and the reference template', () => {
        const custom = applyOptions(defaultOptions(), { 'tokens.reference': '$acme-{name}' });
        const tokens = extractTokensFromJson(dtcg, 'acme.json', custom, 10);
        expect(byName(tokens, 'space.2')?.px).toBe(5);
        expect(byName(tokens, 'space.2')?.reference).toBe('$acme-space-2');
        const index = new TokenIndex(tokens);
        expect(index.exactLength(16, 'spacing', 'scss').map(t => t.name)).toEqual(['space.4', 'space.gutter']);
        expect(index.exactLength(16, 'spacing', 'css')).toEqual([]);
    });

    const tokensStudio = JSON.stringify(
        {
            global: {
                spacing: {
                    xs: { value: '4', type: 'spacing' },
                    sm: { value: '{spacing.xs} * 2', type: 'spacing' },
                    md: { value: '16', type: 'spacing' },
                    lg: { value: '{spacing.md} * 1.5', type: 'spacing' },
                },
                fontSizes: {
                    body: { value: '16', type: 'fontSizes' },
                    h1: { value: '2.5rem', type: 'fontSizes' },
                },
                lineHeights: { body: { value: '150%', type: 'lineHeights' }, tight: { value: '1.2', type: 'lineHeights' } },
                borderRadius: { card: { value: 8, type: 'borderRadius' } },
                borderWidth: { thin: { value: '1', type: 'borderWidth' } },
                sizing: { icon: { value: '24', type: 'sizing' } },
                fontWeights: { bold: { value: '700', type: 'fontWeights' } },
                colors: { brand: { value: '#7c3aed', type: 'color', description: 'Primary brand' } },
                typography: { body: { value: { fontFamily: 'Inter', fontSize: '{fontSizes.body}' }, type: 'typography' } },
            },
            dark: {
                colors: { surface: { value: 'rgba(15, 23, 42, 0.9)', type: 'color' } },
            },
            $themes: [],
            $metadata: { tokenSetOrder: ['global', 'dark'] },
        },
        null,
        2,
    );

    it('reads Tokens Studio files: unitless px, math, types and sets', () => {
        const tokens = extractTokensFromJson(tokensStudio, 'tokens.json', options, 16);
        expect(summary(tokens)).toEqual([
            ['spacing.xs', 'var(--spacing-xs)', 'json', 'spacing', 4],
            ['spacing.sm', 'var(--spacing-sm)', 'json', 'spacing', 8],
            ['spacing.md', 'var(--spacing-md)', 'json', 'spacing', 16],
            ['spacing.lg', 'var(--spacing-lg)', 'json', 'spacing', 24],
            ['fontSizes.body', 'var(--fontSizes-body)', 'json', 'font-size', 16],
            ['fontSizes.h1', 'var(--fontSizes-h1)', 'json', 'font-size', 40],
            ['borderRadius.card', 'var(--borderRadius-card)', 'json', 'radius', 8],
            ['borderWidth.thin', 'var(--borderWidth-thin)', 'json', 'border', 1],
            ['sizing.icon', 'var(--sizing-icon)', 'json', 'size', 24],
            ['colors.brand', 'var(--colors-brand)', 'json', 'color', [124, 58, 237, 1]],
            ['colors.surface', 'var(--colors-surface)', 'json', 'color', [15, 23, 42, 0.9]],
        ]);
        // Set names are not part of token paths, but sources still point into the right set.
        const lines = tokensStudio.split('\n');
        const surface = byName(tokens, 'colors.surface')!;
        expect(lines[surface.source!.line!]).toContain('"surface"');
        expect(surface.source!.line!).toBeGreaterThan(lines.findIndex(l => l.includes('"dark"')));
    });

    it('reads Style Dictionary files, including `.value` aliases', () => {
        const styleDictionary = JSON.stringify({
            size: {
                spacing: {
                    small: { value: '8px', comment: 'Tight' },
                    medium: { value: '16px' },
                    large: { value: '{size.spacing.medium.value}' },
                },
                font: { base: { value: '1rem' }, scale: { value: 1.25 } },
            },
            color: {
                base: { red: { value: '#ff0000' } },
                danger: { value: '{color.base.red.value}' },
            },
        });
        expect(summary(extractTokensFromJson(styleDictionary, 'tokens/base.json', options, 16))).toEqual([
            ['size.spacing.small', 'var(--size-spacing-small)', 'json', 'spacing', 8],
            ['size.spacing.medium', 'var(--size-spacing-medium)', 'json', 'spacing', 16],
            ['size.spacing.large', 'var(--size-spacing-large)', 'json', 'spacing', 16],
            ['size.font.base', 'var(--size-font-base)', 'json', 'font-size', 16],
            ['color.base.red', 'var(--color-base-red)', 'json', 'color', [255, 0, 0, 1]],
            ['color.danger', 'var(--color-danger)', 'json', 'color', [255, 0, 0, 1]],
        ]);
    });

    it('ignores invalid JSON and non-object roots', () => {
        expect(extractTokensFromJson('{ "space": ', 'broken.json', options, 16)).toEqual([]);
        expect(extractTokensFromJson('[1, 2]', 'array.json', options, 16)).toEqual([]);
        expect(extractTokensFromJson('', 'empty.json', options, 16)).toEqual([]);
    });

    it('handles a byte order mark and untyped values', () => {
        const json = '﻿{"gap": {"value": "12px"}, "opacity": {"value": "0.5"}, "date": {"value": "2024-01-01"}, "space-0": {"value": 0}}';
        expect(extractTokensFromJson(json, 'bom.json', options, 16).map(t => [t.name, t.px])).toEqual([
            ['gap', 12],
            ['space-0', 0],
        ]);
    });
});
