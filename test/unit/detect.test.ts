import { describe, expect, it } from 'vitest';
import {
    chooseRootFontSize,
    findRemFunctions,
    findRemFunctionsInScript,
    findRootFontSizes,
    parsePostcssPxToRem,
    readPackageJson,
    readTailwindConfigJs,
    readTailwindCss,
    type RootFontSizeCandidate,
} from '../../src/core/detect';
import { parseDocument } from '../../src/core/document';

const rootSizes = (text: string, languageId = 'css') => findRootFontSizes(parseDocument(text, languageId), `styles/base.${languageId}`);
const pxOf = (text: string, languageId = 'css') => rootSizes(text, languageId).map(c => c.px);
const remFns = (text: string, languageId: string, functionName = 'rem') => findRemFunctions(parseDocument(text, languageId), `styles/_functions.${languageId}`, functionName);

describe('findRootFontSizes', () => {
    it('reads the classic 62.5% trick with a readable source', () => {
        const css = `/* base */\nhtml {\n  font-size: 62.5%;\n}\nbody { font-size: 1.6rem; }\n`;
        expect(rootSizes(css)).toEqual([{ px: 10, source: { file: 'styles/base.css', line: 2, description: 'html { font-size: 62.5% }' } }]);
    });

    it('understands px, rem, em, percentages and keywords', () => {
        expect(pxOf(':root { font-size: 10px }')).toEqual([10]);
        expect(pxOf('html { font-size: 1rem }')).toEqual([16]);
        expect(pxOf('html { font-size: 0.625em }')).toEqual([10]);
        expect(pxOf('html { font-size: 100% !important }')).toEqual([16]);
        expect(pxOf('html { font-size: medium }')).toEqual([16]);
        expect(pxOf('html { font-size: small }')).toEqual([13]);
        expect(pxOf('html { font-size: calc(100% + 0.25vw) }')).toEqual([]);
        expect(pxOf('html { font-size: clamp(14px, 1vw + 10px, 18px) }')).toEqual([]);
        expect(pxOf('html { font-size: inherit }')).toEqual([]);
    });

    it('reads the font shorthand', () => {
        const css = 'html { font: normal 400 62.5%/1.5 "Helvetica Neue", Arial, sans-serif; }';
        expect(rootSizes(css)[0]).toMatchObject({ px: 10, source: { description: 'html { font: normal 400 62.5%/1.5 "Helvetica Neue", Arial, sans-serif }' } });
        expect(pxOf(':root { font: 400 1rem/1.5 Inter, sans-serif }')).toEqual([16]);
        expect(pxOf('html { font: 12px / 1.4 Georgia }')).toEqual([12]);
        expect(pxOf('html { font: menu }')).toEqual([]);
    });

    it('only accepts unconditional html/:root rules', () => {
        const css = `
@media (min-width: 768px) { html { font-size: 75%; } }
@supports (font-size: 1cqi) { html { font-size: 50%; } }
@layer base { html { font-size: 62.5%; } }
html, body { font-size: 100%; }
html.dark { font-size: 20px; }
:root .app { font-size: 12px; }
body { font-size: 14px; }
`;
        expect(pxOf(css)).toEqual([10, 16]);
        expect(pxOf('html { font-size: 10px; @media (min-width: 1200px) { font-size: 12px; } }', 'scss')).toEqual([10]);
    });

    it('follows simple variable references', () => {
        expect(pxOf('$root-font-size: 62.5%;\nhtml { font-size: $root-font-size; }', 'scss')).toEqual([10]);
        expect(pxOf('$root_size: 10px;\nhtml { font-size: $root-size; }', 'scss')).toEqual([10]);
        expect(pxOf('@root: 75%;\nhtml { font-size: @root; }', 'less')).toEqual([12]);
        expect(pxOf(':root { --root-size: 10px; font-size: var(--root-size); }')).toEqual([10]);
        expect(pxOf('html { font-size: var(--unknown, 62.5%); }')).toEqual([10]);
        expect(pxOf('html { font-size: $unknown; }', 'scss')).toEqual([]);
    });

    it('works in indented syntaxes and embedded styles, in document order', () => {
        expect(pxOf('html\n  font-size: 62.5%\n', 'sass')).toEqual([10]);
        expect(pxOf('html\n  font-size 62.5%\n', 'stylus')).toEqual([10]);
        expect(pxOf('<template><p/></template>\n<style>\nhtml { font-size: 62.5%; }\n</style>', 'vue')).toEqual([10]);
        expect(pxOf(':root { font-size: 10px }\nhtml { font-size: 100% }\n:root { font-size: 62.5% }')).toEqual([10, 16, 10]);
    });
});

describe('chooseRootFontSize', () => {
    const candidate = (px: number, line: number): RootFontSizeCandidate => ({ px, source: { file: 'a.css', line, description: `html { font-size: ${px}px }` } });
    const postcss = { rootValue: 37.5, source: { file: 'postcss.config.js', line: 3, description: 'postcss-pxtorem rootValue' } };

    it('prefers an explicit setting, then postcss-pxtorem', () => {
        expect(chooseRootFontSize({ explicit: 20, postcss, candidates: [candidate(10, 1)], fallback: 16 })).toEqual({
            px: 20,
            source: { description: 'pxToRem.baseFontSize setting' },
            ambiguous: false,
        });
        expect(chooseRootFontSize({ postcss, candidates: [candidate(10, 1)], fallback: 16 })).toEqual({ px: 37.5, source: postcss.source, ambiguous: false });
    });

    it('falls back to detected candidates when postcss has no rootValue', () => {
        const noRoot = { source: { file: 'postcss.config.js', description: 'postcss-pxtorem' } };
        expect(chooseRootFontSize({ postcss: noRoot, candidates: [candidate(10, 4)], fallback: 16 })).toEqual({ px: 10, source: candidate(10, 4).source, ambiguous: false });
    });

    it('picks the most common candidate (ties → first found) and flags disagreement', () => {
        const result = chooseRootFontSize({ candidates: [candidate(16, 1), candidate(10, 2), candidate(10, 3)], fallback: 16 });
        expect(result).toEqual({ px: 10, source: candidate(10, 2).source, ambiguous: true });
        expect(chooseRootFontSize({ candidates: [candidate(12, 7), candidate(10, 2)], fallback: 16 })).toMatchObject({ px: 12, ambiguous: true });
        expect(chooseRootFontSize({ candidates: [candidate(10, 7), candidate(10, 9)], fallback: 16 })).toMatchObject({ px: 10, ambiguous: false });
    });

    it('uses the fallback when nothing is known', () => {
        expect(chooseRootFontSize({ candidates: [], fallback: 16 })).toEqual({ px: 16, ambiguous: false });
        expect(chooseRootFontSize({ explicit: 0, candidates: [], fallback: 18 })).toEqual({ px: 18, ambiguous: false });
    });
});

describe('findRemFunctions', () => {
    it('finds a Sass @function with a default base', () => {
        const scss = `@use 'sass:math';\n\n@function rem($px, $base: 16px) {\n  @return math.div($px, $base) * 1rem;\n}\n@function em($px, $context: 16px) { @return math.div($px, $context) * 1em; }\n`;
        expect(remFns(scss, 'scss')).toEqual([
            { name: 'rem', syntax: 'scss', base: 16, source: { file: 'styles/_functions.scss', line: 2, description: '@function rem($px, $base: 16px)' } },
        ]);
    });

    it('reads the base from the body or from a global variable', () => {
        expect(remFns('@function rem($size) {\n  @return math.div($size, 10px) * 1rem;\n}', 'scss')[0].base).toBe(10);
        expect(remFns('@function rem($size) { $r: $size / 16px; @return $r * 1rem; }', 'scss')[0].base).toBe(16);
        expect(remFns('$root-font-size: 10px;\n@function rem($px, $base: $root-font-size) { @return math.div($px, $base) * 1rem; }', 'scss')[0].base).toBe(10);
        expect(remFns('$root-font-size: 10px;\n@function rem($px) { @return math.div($px, $root-font-size) * 1rem; }', 'scss')[0].base).toBe(10);
        const unknown = remFns('@function rem($values...) { @return $values; }', 'scss')[0];
        expect(unknown.name).toBe('rem');
        expect(unknown.base).toBeUndefined();
        expect(remFns('@function rem-calc($values, $base: null) { @return $values; }', 'scss', 'rem-calc')[0].base).toBeUndefined();
    });

    it('matches names Sass-style (- and _ are the same) and ignores other functions', () => {
        expect(remFns('@function to_rem($px) { @return $px; }', 'scss', 'to-rem').map(f => f.name)).toEqual(['to_rem']);
        expect(remFns('@function rem-size($px) { @return $px; }', 'scss')).toEqual([]);
    });

    it('finds indented Sass functions', () => {
        const sass = `@use "sass:math"\n@function rem($px, $base: 16)\n  @return math.div($px, $base) * 1rem\n.a\n  padding: rem(8)\n`;
        expect(remFns(sass, 'sass')).toEqual([
            { name: 'rem', syntax: 'sass', base: 16, source: { file: 'styles/_functions.sass', line: 1, description: '@function rem($px, $base: 16)' } },
        ]);
    });

    it('finds Stylus function definitions in both styles', () => {
        const indented = `rem(value, base = 16px)\n  (value / base) rem\n.card\n  padding rem(16)\n`;
        expect(remFns(indented, 'stylus')).toEqual([
            { name: 'rem', syntax: 'stylus', base: 16, source: { file: 'styles/_functions.stylus', line: 0, description: 'rem(value, base = 16px)' } },
        ]);
        const braces = `rem(px) {\n  return (px / 10) rem\n}\n.card {\n  padding: rem(16)\n}\n`;
        expect(remFns(braces, 'stylus').map(f => [f.name, f.base])).toEqual([['rem', 10]]);
    });

    it('finds CSS custom functions and records the name as written', () => {
        const css = `@function --rem(--px <length>, --base <length>: 16px) returns <length> {\n  result: calc(var(--px) / var(--base) * 1rem);\n}`;
        expect(remFns(css, 'css')).toEqual([
            { name: '--rem', syntax: 'css', base: 16, source: { file: 'styles/_functions.css', line: 0, description: '@function --rem(--px <length>, --base <length>: 16px)' } },
        ]);
        expect(remFns(css, 'css', '--rem')).toHaveLength(1);
    });

    it('ignores Less and finds functions in embedded styles', () => {
        expect(remFns('.rem(@px) { width: (@px / 16) * 1rem; }', 'less')).toEqual([]);
        const vue = `<template><div/></template>\n<style lang="scss">\n@function rem($px, $base: 10px) { @return math.div($px, $base) * 1rem; }\n</style>`;
        expect(remFns(vue, 'vue').map(f => [f.syntax, f.base, f.source?.line])).toEqual([['scss', 10, 2]]);
    });
});

describe('findRemFunctionsInScript', () => {
    const find = (text: string, name = 'rem') => findRemFunctionsInScript(text, 'src/utils/rem.ts', name);

    it('finds arrow functions with a default base', () => {
        const ts = "export const rem = (px: number, base = 16): string => `${px / base}rem`;\n";
        expect(find(ts)).toEqual([
            { name: 'rem', syntax: 'js', base: 16, source: { file: 'src/utils/rem.ts', line: 0, description: 'export const rem = (px: number, base = 16): string => `${px / base}rem`;' } },
        ]);
    });

    it('finds function declarations and reads the base from the body', () => {
        const ts = "/** px → rem */\nexport function rem(px: number): string {\n  return `${px / 16}rem`;\n}\n";
        expect(find(ts).map(f => [f.source?.line, f.base])).toEqual([[1, 16]]);
        const generic = 'export default function rem<T extends number>(px: T) {\n  return px / 10 + "rem";\n}';
        expect(find(generic).map(f => f.base)).toEqual([10]);
    });

    it('resolves a named constant divisor', () => {
        const js = 'const BASE_FONT_SIZE = 10;\nexport const rem = (px) => `${px / BASE_FONT_SIZE}rem`;\n';
        expect(find(js).map(f => [f.source?.line, f.base])).toEqual([[1, 10]]);
        expect(find("const rem = px => px / 16 + 'rem';").map(f => f.base)).toEqual([16]);
    });

    it('finds typed constants, object properties and methods', () => {
        expect(find('export const rem: (px: number) => string = (px) => `${px / 16}rem`;')).toHaveLength(1);
        expect(find('export const theme = {\n  space: 4,\n  rem: (px: number) => `${px / 16}rem`,\n};').map(f => f.source?.line)).toEqual([2]);
        expect(find("const helpers = {\n  rem(px) {\n    return px / 20 + 'rem';\n  },\n};").map(f => [f.source?.line, f.base])).toEqual([[1, 20]]);
        expect(find('class Units {\n  static rem(px: number): string {\n    return `${px / 16}rem`;\n  }\n}').map(f => f.source?.line)).toEqual([1]);
        expect(find('const toRem = function (px) { return px / 16 + "rem"; };', 'toRem').map(f => [f.name, f.base])).toEqual([['toRem', 16]]);
    });

    it('ignores calls, comments, strings and other names', () => {
        const js = `
// function rem(px) { return px / 16 }
const doc = "function rem(px) {}";
const remSize = 4;
const padding = rem(16);
rem(8);
export const em = (px) => px / 16 + 'em';
`;
        expect(find(js)).toEqual([]);
        expect(find('const rem = (px) => px / 16;', 'to-rem')).toEqual([]);
    });
});

describe('parsePostcssPxToRem', () => {
    it('reads object-style plugin options', () => {
        const config = `module.exports = {
  plugins: {
    autoprefixer: {},
    'postcss-pxtorem': {
      rootValue: 16,
      unitPrecision: 5,
      propList: ['font', 'font-size', 'line-height', 'letter-spacing', '*margin*'],
      selectorBlackList: ['.ignore', /^body$/],
      replace: true,
      mediaQuery: false,
      minPixelValue: 2,
      exclude: /node_modules/i,
    },
  },
};
`;
        expect(parsePostcssPxToRem(config, 'postcss.config.js')).toEqual({
            rootValue: 16,
            unitPrecision: 5,
            propList: ['font', 'font-size', 'line-height', 'letter-spacing', '*margin*'],
            selectorBlackList: ['.ignore', '/^body$/'],
            mediaQuery: false,
            minPixelValue: 2,
            source: { file: 'postcss.config.js', line: 3, description: 'postcss-pxtorem rootValue' },
        });
    });

    it('reads require() calls, imports and tuples', () => {
        const cjs = "module.exports = {\n  plugins: [require('autoprefixer'), require('postcss-pxtorem')({ rootValue: 37.5, propList: ['*'] })],\n};";
        expect(parsePostcssPxToRem(cjs, 'postcss.config.cjs')).toMatchObject({ rootValue: 37.5, propList: ['*'], source: { line: 1 } });

        const esm = "import pxtorem from 'postcss-pxtorem';\nimport autoprefixer from 'autoprefixer';\n\nexport default {\n  plugins: [autoprefixer(), pxtorem({ rootValue: 10, propList: ['*', '!border*'] })],\n};";
        expect(parsePostcssPxToRem(esm, 'postcss.config.mjs')).toMatchObject({ rootValue: 10, propList: ['*', '!border*'], source: { line: 4 } });

        const minko = "import pxToRem from '@minko-fe/postcss-pxtorem';\nexport default { plugins: [pxToRem({ rootValue: 16, unitPrecision: 3 })] };";
        expect(parsePostcssPxToRem(minko, 'postcss.config.ts')).toMatchObject({
            rootValue: 16,
            unitPrecision: 3,
            source: { description: '@minko-fe/postcss-pxtorem rootValue' },
        });

        const tuple = "module.exports = { plugins: [['postcss-pxtorem', { rootValue: 20 }], 'autoprefixer'] };";
        expect(parsePostcssPxToRem(tuple, '.postcssrc.js')?.rootValue).toBe(20);

        const vite = "import { defineConfig } from 'vite';\nimport pxtorem from 'postcss-pxtorem';\nexport default defineConfig({\n  css: { postcss: { plugins: [pxtorem({ rootValue: 75 })] } },\n});";
        expect(parsePostcssPxToRem(vite, 'vite.config.ts')?.rootValue).toBe(75);
    });

    it('reads JSON configs and the package.json "postcss" key', () => {
        const rc = '{\n  "plugins": {\n    "postcss-pxtorem": { "rootValue": 16, "propList": ["*"] }\n  }\n}';
        expect(parsePostcssPxToRem(rc, '.postcssrc.json')).toEqual({ rootValue: 16, propList: ['*'], source: { file: '.postcssrc.json', line: 2, description: 'postcss-pxtorem rootValue' } });
        const pkg = JSON.stringify(
            { name: 'app', devDependencies: { 'postcss-pxtorem': '^6.1.0' }, postcss: { plugins: { 'postcss-pxtorem': { rootValue: 32 } } } },
            null,
            2,
        );
        expect(parsePostcssPxToRem(pkg, 'package.json')?.rootValue).toBe(32);
        expect(parsePostcssPxToRem(JSON.stringify({ devDependencies: { 'postcss-pxtorem': '^6.1.0' } }), 'package.json')).toBeUndefined();
    });

    it('leaves out values it cannot read without running code', () => {
        const config = `const isMobile = true;
module.exports = {
  plugins: {
    'postcss-pxtorem': {
      rootValue: ({ file }) => (file.includes('vant') ? 37.5 : 75),
      propList: ['*'],
      unitPrecision: isMobile ? 4 : 5,
      // mediaQuery: true,
      mediaQuery: false,
    },
  },
};`;
        expect(parsePostcssPxToRem(config, 'postcss.config.js')).toEqual({
            propList: ['*'],
            mediaQuery: false,
            source: { file: 'postcss.config.js', line: 3, description: 'postcss-pxtorem' },
        });
    });

    it('reports the plugin without options and maps legacy option names', () => {
        expect(parsePostcssPxToRem("module.exports = { plugins: [require('postcss-pxtorem')()] };", 'postcss.config.js')).toEqual({
            source: { file: 'postcss.config.js', line: 0, description: 'postcss-pxtorem' },
        });
        expect(parsePostcssPxToRem("const pxtorem = require('postcss-pxtorem');\nmodule.exports = { plugins: [pxtorem] };", 'postcss.config.js')?.source.line).toBe(0);
        expect(parsePostcssPxToRem("module.exports = { plugins: [require('postcss-pxtorem')({ root_value: 20, prop_white_list: [], selector_black_list: ['html'] })] };", 'p.js')).toMatchObject({
            rootValue: 20,
            propList: ['*'],
            selectorBlackList: ['html'],
        });
    });

    it('returns undefined when the plugin is not configured', () => {
        expect(parsePostcssPxToRem("module.exports = { plugins: { autoprefixer: {} } };", 'postcss.config.js')).toBeUndefined();
        expect(parsePostcssPxToRem("import pxtorem from 'postcss-px-to-viewport';\nexport default { plugins: [pxtorem({ viewportWidth: 375 })] };", 'postcss.config.mjs')).toBeUndefined();
        expect(parsePostcssPxToRem("// require('postcss-pxtorem')({ rootValue: 10 })\nmodule.exports = { plugins: [] };", 'postcss.config.js')).toBeUndefined();
        expect(parsePostcssPxToRem('', 'postcss.config.js')).toBeUndefined();
    });
});

describe('readPackageJson', () => {
    const pkg = (sections: Record<string, unknown>) => JSON.stringify({ name: 'app', version: '1.0.0', ...sections });

    it('detects the Tailwind major version', () => {
        const tw = (range: string) => readPackageJson(pkg({ devDependencies: { tailwindcss: range } }))?.tailwindVersion;
        expect(tw('^3.4.1')).toBe(3);
        expect(tw('~3.3.0')).toBe(3);
        expect(tw('>=3.0.0 <4.0.0')).toBe(3);
        expect(tw('npm:tailwindcss@3.4.17')).toBe(3);
        expect(tw('2.2.19')).toBe(3);
        expect(tw('^4.0.0')).toBe(4);
        expect(tw('4.1')).toBe(4);
        expect(tw('4.0.0-beta.8')).toBe(4);
        expect(tw('latest')).toBe(4);
        expect(tw('workspace:*')).toBe(4);
        expect(readPackageJson(pkg({ devDependencies: { '@tailwindcss/vite': '^4.1.0' } }))?.tailwindVersion).toBe(4);
        expect(readPackageJson(pkg({ dependencies: { react: '^19.0.0' } }))?.tailwindVersion).toBeUndefined();
    });

    it('detects React Native, postcss-pxtorem and CSS-in-JS', () => {
        expect(readPackageJson(pkg({ dependencies: { 'react-native': '0.76.0' } }))).toEqual({ reactNative: true, postcssPxToRem: false, styledComponents: false });
        expect(readPackageJson(pkg({ dependencies: { expo: '~52.0.0', 'styled-components': '^6.1.0' } }))).toMatchObject({ reactNative: true, styledComponents: true });
        expect(readPackageJson(pkg({ devDependencies: { 'postcss-pxtorem': '^6.1.0' } }))?.postcssPxToRem).toBe(true);
        expect(readPackageJson(pkg({ devDependencies: { '@minko-fe/postcss-pxtorem': '^1.5.0' } }))?.postcssPxToRem).toBe(true);
        expect(readPackageJson(pkg({ postcss: { plugins: { 'postcss-pxtorem': { rootValue: 16 } } } }))?.postcssPxToRem).toBe(true);
        expect(readPackageJson(pkg({ peerDependencies: { '@emotion/styled': '^11.0.0' } }))?.styledComponents).toBe(true);
    });

    it('reads all dependency sections and rejects invalid input', () => {
        const full = pkg({
            dependencies: { next: '15.0.0' },
            devDependencies: { tailwindcss: '^3.4.0' },
            peerDependencies: { 'styled-components': '>=5' },
        });
        expect(readPackageJson(full)).toEqual({ tailwindVersion: 3, reactNative: false, postcssPxToRem: false, styledComponents: true });
        expect(readPackageJson('{ "name": ')).toBeUndefined();
        expect(readPackageJson('[]')).toBeUndefined();
        expect(readPackageJson('{}')).toEqual({ reactNative: false, postcssPxToRem: false, styledComponents: false });
    });
});

describe('readTailwindCss', () => {
    const v4 = `@import "tailwindcss";

@theme {
  --spacing: 0.25rem;
  --spacing-18: 4.5rem;
  --spacing-*: initial;
  --text-xs: 0.75rem;
  --text-xs--line-height: calc(1 / 0.75);
  --text-tiny: 10px;
  --text-shadow-sm: 0px 1px 0px rgb(0 0 0 / 0.075);
  --color-brand: #3b82f6;
}
`;

    it('reads a Tailwind v4 theme in px at a 16px root', () => {
        const result = readTailwindCss(parseDocument(v4, 'css'), 16);
        expect(result).toEqual({ present: true, config: { version: 4, spacingPx: 4, spacing: { '18': 72 }, fontSizes: { xs: 12, tiny: 10 } } });
    });

    it('normalises px values by the root font size, but not rem values', () => {
        const result = readTailwindCss(parseDocument(v4, 'css'), 10);
        expect(result.config).toEqual({ version: 4, spacingPx: 4, spacing: { '18': 72 }, fontSizes: { xs: 12, tiny: 16 } });
        expect(readTailwindCss(parseDocument('@theme { --spacing: 4px; }', 'css'), 8).config.spacingPx).toBe(8);
    });

    it('detects v3 directives, v4 imports and directives', () => {
        expect(readTailwindCss(parseDocument('@tailwind base;\n@tailwind components;\n@tailwind utilities;', 'css'), 16)).toEqual({ present: true, config: { version: 3 } });
        expect(readTailwindCss(parseDocument("@import 'tailwindcss/preflight' layer(base);", 'css'), 16)).toEqual({ present: true, config: { version: 4 } });
        expect(readTailwindCss(parseDocument('@import url("tailwindcss") prefix(tw);', 'css'), 16).present).toBe(true);
        expect(readTailwindCss(parseDocument('@source "../components";\n@utility tab-4 { tab-size: 4; }', 'css'), 16)).toEqual({ present: true, config: { version: 4 } });
        expect(readTailwindCss(parseDocument('@config "./tailwind.config.js";', 'css'), 16)).toEqual({ present: true, config: {} });
    });

    it('reports plain CSS as not Tailwind', () => {
        expect(readTailwindCss(parseDocument('@import "./reset.css";\n@import "tailwind-variants";\n.a { padding: 4px; }', 'css'), 16)).toEqual({ present: false, config: {} });
        expect(readTailwindCss(parseDocument('@plugin "my-plugin";', 'less'), 16).present).toBe(false);
    });
});

describe('readTailwindConfigJs', () => {
    const v3 = `/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  // theme: { spacing: { 1: '99px' } },
  theme: {
    spacing: { px: '1px', 0: '0', 1: '4px', 2: '0.5rem', 18: '4.5rem' },
    extend: {
      spacing: { '128': '32rem', gutter: 'var(--gutter)' },
      fontSize: {
        ...defaultTheme.fontSize,
        tiny: ['0.625rem', { lineHeight: '1rem' }],
        huge: ['5rem', '1'],
        body: '16px',
      },
      colors: { brand: '#ff0000' },
      maxWidth: ({ theme }) => ({ ...theme('spacing'), prose: '65ch' }),
    },
  },
  plugins: [require('@tailwindcss/forms')],
};
`;

    it('reads literal spacing and fontSize scales from theme and theme.extend', () => {
        expect(readTailwindConfigJs(v3, 16)).toEqual({
            spacing: { px: 1, '0': 0, '1': 4, '2': 8, '18': 72, '128': 512 },
            fontSizes: { tiny: 10, huge: 80, body: 16 },
        });
    });

    it('expresses px values at a 16px root', () => {
        expect(readTailwindConfigJs(v3, 10)).toMatchObject({ spacing: { px: 1.6, '1': 6.4, '2': 8 }, fontSizes: { body: 25.6, tiny: 10 } });
    });

    it('reads TypeScript configs and skips non-literal scales', () => {
        const ts = `import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.tsx'],
  theme: {
    extend: {
      spacing: ({ theme }) => ({ huge: theme('spacing.96') }),
      fontSize: { xxs: '0.5rem' },
    },
  },
} satisfies Config;
`;
        expect(readTailwindConfigJs(ts, 16)).toEqual({ fontSizes: { xxs: 8 } });
        expect(readTailwindConfigJs("module.exports = { content: [], plugins: [] };", 16)).toEqual({});
        expect(readTailwindConfigJs('not even javascript {{{', 16)).toEqual({});
    });
});
