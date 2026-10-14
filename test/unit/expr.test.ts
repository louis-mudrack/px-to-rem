import { describe, expect, it } from 'vitest';
import { dependsOnViewport, evaluate, evaluateText, parseExpression, respondsToFontSize, type EvalEnv } from '../../src/core/expr';

const env: EvalEnv = { viewportWidth: 1000, viewportHeight: 800, rootFontSize: 16, emBase: 20 };

function at(text: string, extra: Partial<EvalEnv> = {}): number | undefined {
    return evaluateText(text, { ...env, ...extra });
}

function variables(map: Record<string, string>): Partial<EvalEnv> {
    return { resolveVariable: name => map[name] };
}

const remFunction: Partial<EvalEnv> = {
    resolveFunction: (name, args) => (['rem', 'torem'].includes(name) && args.length === 1 ? args[0] : undefined),
};

describe('parseExpression', () => {
    it('parses numbers and lengths', () => {
        expect(parseExpression('16px')).toEqual({ kind: 'number', value: 16, unit: 'px' });
        expect(parseExpression('-.5REM')).toEqual({ kind: 'number', value: -0.5, unit: 'rem' });
        expect(parseExpression('1.5')).toEqual({ kind: 'number', value: 1.5, unit: '' });
        expect(parseExpression('50%')).toEqual({ kind: 'number', value: 50, unit: '%' });
    });

    it('builds a tree with operator precedence', () => {
        expect(parseExpression('calc(1px + 2px * 3)')).toEqual({
            kind: 'math',
            name: 'calc',
            args: [
                {
                    kind: 'binary',
                    op: '+',
                    left: { kind: 'number', value: 1, unit: 'px' },
                    right: { kind: 'binary', op: '*', left: { kind: 'number', value: 2, unit: 'px' }, right: { kind: 'number', value: 3, unit: '' } },
                },
            ],
        });
    });

    it('parses var() with and without fallback', () => {
        expect(parseExpression('var(--gap)')).toEqual({ kind: 'variable', name: '--gap' });
        expect(parseExpression('var(--gap, 8px)')).toEqual({
            kind: 'variable',
            name: '--gap',
            fallback: { kind: 'number', value: 8, unit: 'px' },
            fallbackText: '8px',
        });
        // A fallback that is not an expression keeps its text.
        expect(parseExpression('var(--font, "Inter", sans-serif)')).toEqual({ kind: 'variable', name: '--font', fallbackText: '"Inter", sans-serif' });
    });

    it('parses Sass and Less variables and user functions', () => {
        expect(parseExpression('$gutter')).toEqual({ kind: 'variable', name: '$gutter' });
        expect(parseExpression('tokens.$space-4')).toEqual({ kind: 'variable', name: 'tokens.$space-4' });
        expect(parseExpression('@gutter')).toEqual({ kind: 'variable', name: '@gutter' });
        expect(parseExpression('toRem(16px)')).toEqual({ kind: 'call', name: 'torem', args: [{ kind: 'number', value: 16, unit: 'px' }], rawArgs: ['16px'] });
        expect(parseExpression('-rem(16)')).toEqual({
            kind: 'negate',
            operand: { kind: 'call', name: 'rem', args: [{ kind: 'number', value: 16, unit: '' }], rawArgs: ['16'] },
        });
    });

    it('rejects keywords, lists and malformed input', () => {
        for (const text of ['', 'auto', '16px 8px', '16px -8px', 'solid 1px red', 'calc(1px', 'calc(1px))', 'clamp(1px, 2px)', 'calc()', 'calc(1px, 2px)', '#fff', '"16px"', '--x', 'var(16px)', '1px +']) {
            expect(parseExpression(text), text).toBeUndefined();
        }
    });

    it('accepts interpolation, Less escapes, comments and flags', () => {
        expect(parseExpression('calc(100% - #{rem(16)})')).toBeDefined();
        expect(parseExpression('#{$a} + 1px')).toBeDefined();
        expect(parseExpression('~"calc(100% - 10px)"')).toBeDefined();
        expect(parseExpression('16px /* base */ !important')).toEqual({ kind: 'number', value: 16, unit: 'px' });
        expect(parseExpression('#{1px)')).toBeUndefined();
    });
});

describe('evaluate', () => {
    it('converts units to px', () => {
        expect(at('16px')).toBe(16);
        expect(at('1.5rem')).toBe(24);
        expect(at('2em')).toBe(40);
        expect(at('10vw')).toBe(100);
        expect(at('10vh')).toBe(80);
        expect(at('10dvh')).toBe(80);
        expect(at('10svw')).toBe(100);
        expect(at('10vmin')).toBe(80);
        expect(at('10vmax')).toBe(100);
        expect(at('12pt')).toBe(16);
        expect(at('1in')).toBe(96);
        expect(at('-8px')).toBe(-8);
        expect(at('0')).toBe(0);
    });

    it('evaluates vw at different widths', () => {
        expect(at('10vw', { viewportWidth: 375 })).toBe(37.5);
        expect(at('10vw', { viewportWidth: 1440 })).toBe(144);
    });

    it('uses the container width for cq units, defaulting to the viewport', () => {
        expect(at('10cqi')).toBe(100);
        expect(at('10cqw', { containerWidth: 400 })).toBe(40);
        expect(at('10cqh')).toBe(80);
        expect(at('10cqmin', { containerWidth: 400 })).toBe(40);
    });

    it('needs a percent base for %', () => {
        expect(at('50%')).toBeUndefined();
        expect(at('calc(100% - 16px)')).toBeUndefined();
        expect(at('50%', { percentBase: 600 })).toBe(300);
        expect(at('calc(100% - 16px)', { percentBase: 1000 })).toBe(984);
    });

    it('evaluates nested calc()', () => {
        expect(at('calc(2 * (8px + calc(1rem / 2)))')).toBe(32);
        expect(at('calc(calc(1rem + 4px) * 2 - 0.5em)')).toBe(30);
        expect(at('calc((100vw - 2rem) / 3)')).toBeCloseTo(322.667, 3);
        expect(at('-webkit-calc(10px + 2px)')).toBe(12);
    });

    it('evaluates clamp(), min() and max()', () => {
        const fluid = 'clamp(1rem, 0.5rem + 2vw, 3rem)';
        expect(at(fluid, { viewportWidth: 320 })).toBe(16);
        expect(at(fluid, { viewportWidth: 1000 })).toBe(28);
        expect(at(fluid, { viewportWidth: 2560 })).toBe(48);
        expect(at('min(50vw, 600px)')).toBe(500);
        expect(at('min(50vw, 600px)', { viewportWidth: 1600 })).toBe(600);
        expect(at('max(1rem, 2vw, 10px)')).toBe(20);
        expect(at('min(1px)')).toBe(1);
        // clamp() with MIN > MAX resolves to MIN, like browsers.
        expect(at('clamp(30px, 10px, 20px)')).toBe(30);
        expect(at('max(10px, 2)')).toBeUndefined();
    });

    it('tracks units through + - * /', () => {
        expect(at('16px * 2')).toBe(32);
        expect(at('2 * 8px')).toBe(16);
        expect(at('16px / 2')).toBe(8);
        expect(at('16px * 2px')).toBeUndefined();
        expect(at('16px / 2px')).toBeUndefined();
        expect(at('16px / 2px * 1rem')).toBe(128);
        expect(at('2 / 1px')).toBeUndefined();
        expect(at('16px + 2')).toBeUndefined();
        expect(at('2 + 16px')).toBeUndefined();
        expect(at('16px / 0')).toBeUndefined();
        expect(at('2 * 3')).toBeUndefined();
        expect(at('16px-4px')).toBe(12);
        expect(at('16px - -4px')).toBe(20);
        expect(at('-(4px + 2px)')).toBe(-6);
    });

    it('leaves unknown units undefined', () => {
        expect(at('2ch')).toBeUndefined();
        expect(at('90deg')).toBeUndefined();
        expect(at('calc(1px + 1fr)')).toBeUndefined();
    });

    it('resolves var() with fallbacks and a resolver', () => {
        expect(at('var(--gap, 8px)')).toBe(8);
        expect(at('var(--gap)')).toBeUndefined();
        expect(at('var(--gap, 8px)', variables({ '--gap': '12px' }))).toBe(12);
        expect(at('var(--a)', variables({ '--a': 'calc(var(--b) * 2)', '--b': '1rem' }))).toBe(32);
        expect(at('var(--a, 4px)', variables({ '--a': 'auto' }))).toBeUndefined();
        expect(at('calc(-1 * var(--gap))', variables({ '--gap': '12px' }))).toBe(-12);
        expect(at('var(--gap, var(--fallback, 2px))')).toBe(2);
    });

    it('guards against reference cycles and deep chains', () => {
        expect(at('var(--a)', variables({ '--a': 'var(--b)', '--b': 'var(--a)' }))).toBeUndefined();
        expect(at('$a', variables({ $a: '$a + 1px' }))).toBeUndefined();
        const chain: Record<string, string> = { '--v0': '1px' };
        for (let i = 1; i <= 40; i++) {
            chain[`--v${i}`] = `var(--v${i - 1})`;
        }
        expect(at('var(--v10)', variables(chain))).toBe(1);
        expect(at('var(--v40)', variables(chain))).toBeUndefined();
    });

    it('resolves Sass and Less variables', () => {
        const vars = variables({ $gutter: '12px !default', $ratio: '1.5', 'tokens.$space': '0.5rem', '@gutter': '12px' });
        expect(at('$gutter * 2', vars)).toBe(24);
        expect(at('$ratio * 16px', vars)).toBe(24);
        expect(at('math.div($gutter, 2)', vars)).toBe(6);
        expect(at('-$gutter', vars)).toBe(-12);
        expect(at('tokens.$space', vars)).toBe(8);
        expect(at('@gutter + 4px', vars)).toBe(16);
        expect(at('~"calc(100% - @{gutter})"', vars)).toBeUndefined();
        expect(at('calc(100% - #{$gutter})', { ...vars, percentBase: 100 })).toBe(88);
    });

    it('resolves user functions through resolveFunction', () => {
        expect(at('rem(16)')).toBeUndefined();
        expect(at('rem(16)', remFunction)).toBe(16);
        expect(at('rem(16px) + toRem(8)', remFunction)).toBe(24);
        expect(at('-rem(4)', remFunction)).toBe(-4);
        expect(at('#{rem(24)}', remFunction)).toBe(24);
        expect(at('calc(100% - #{rem(16)})', { ...remFunction, percentBase: 100 })).toBe(84);
        expect(at('unknown(16)', remFunction)).toBeUndefined();

        const calls: unknown[] = [];
        evaluateText('fn.rem($x, "a")', {
            ...env,
            ...variables({ $x: '2rem' }),
            resolveFunction: (name, args, rawArgs) => {
                calls.push({ name, args, rawArgs });
                return 1;
            },
        });
        expect(calls).toEqual([{ name: 'fn.rem', args: [32, undefined], rawArgs: ['$x', '"a"'] }]);
    });

    it('evaluates a parsed expression repeatedly', () => {
        const expr = parseExpression('clamp(1rem, 4vw, 2rem)')!;
        expect([320, 600, 1000].map(w => evaluate(expr, { ...env, viewportWidth: w }))).toEqual([16, 24, 32]);
    });
});

describe('dependsOnViewport', () => {
    const depends = (text: string, extra?: Partial<EvalEnv>) => dependsOnViewport(parseExpression(text)!, extra);

    it('detects viewport and container units', () => {
        expect(depends('10vw')).toBe(true);
        expect(depends('clamp(1rem, 0.5rem + 2vw, 2rem)')).toBe(true);
        expect(depends('min(5cqi, 2rem)')).toBe(true);
        expect(depends('3dvh')).toBe(true);
        expect(depends('16px')).toBe(false);
        expect(depends('calc(100% - 1rem)')).toBe(false);
        expect(depends('rem(16)')).toBe(false);
    });

    it('follows variables when a resolver is given', () => {
        expect(depends('var(--fluid)')).toBe(false);
        expect(depends('var(--fluid)', variables({ '--fluid': '4vw' }))).toBe(true);
        expect(depends('var(--x, 2vw)')).toBe(true);
        expect(depends('$a', variables({ $a: '$b', $b: '$a' }))).toBe(false);
    });
});

describe('respondsToFontSize', () => {
    const responds = (text: string, extra?: Partial<EvalEnv>) => respondsToFontSize(parseExpression(text)!, extra);

    it('detects rem and em terms', () => {
        expect(responds('1rem')).toBe(true);
        expect(responds('max(1em, 10px)')).toBe(true);
        expect(responds('clamp(1rem, 4vw, 2rem)')).toBe(true);
        expect(responds('clamp(16px, 4vw, 32px)')).toBe(false);
        expect(responds('16px')).toBe(false);
        expect(responds('4vw')).toBe(false);
    });

    it('counts rem functions, which compile to rem', () => {
        expect(responds('rem(16)')).toBe(true);
        expect(responds('toRem(16px)')).toBe(true);
        expect(responds('px2rem(16)')).toBe(true);
        expect(responds('rem-calc(16)')).toBe(true);
        expect(responds('-rem(16)')).toBe(true);
        expect(responds('lighten(16)')).toBe(false);
    });

    it('follows variables when a resolver is given', () => {
        expect(responds('calc(var(--step) + 2vw)', variables({ '--step': '1rem' }))).toBe(true);
        expect(responds('calc(var(--step) + 2vw)', variables({ '--step': '16px' }))).toBe(false);
    });
});
