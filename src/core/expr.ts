/**
 * CSS math expressions: a small parser for `calc()`, `clamp()`, `min()`,
 * `max()`, `var()`, Sass/Less variables and user functions such as `rem(16)`,
 * and an evaluator that resolves them to px for a given viewport.
 */

/** A number with its lowercase unit (`px`, `rem`, `vw`, `%`, …); `unit` is empty for unitless numbers. */
export interface NumberExpr {
    kind: 'number';
    value: number;
    unit: string;
}

/** `var(--x[, fallback])`, Sass `$x` (also `ns.$x`) or Less `@x`. */
export interface VariableExpr {
    kind: 'variable';
    /** Name as written: `--space-4`, `$gutter`, `tokens.$gutter`, `@gutter`. */
    name: string;
    /** Parsed fallback of `var(--x, …)`, when it is an expression. */
    fallback?: Expr;
    /** Raw fallback text of `var(--x, …)`, also when it is not an expression. */
    fallbackText?: string;
}

export interface NegateExpr {
    kind: 'negate';
    operand: Expr;
}

export interface BinaryExpr {
    kind: 'binary';
    op: '+' | '-' | '*' | '/';
    left: Expr;
    right: Expr;
}

/** Built-in math: `calc()`, `clamp()`, `min()`, `max()` and Sass `math.div()` (`div`). */
export interface MathExpr {
    kind: 'math';
    name: 'calc' | 'clamp' | 'min' | 'max' | 'div';
    args: Expr[];
}

/** Any other function call, e.g. `rem(16)` or `toRem(16px)`. */
export interface CallExpr {
    kind: 'call';
    /** Lowercase name with namespace (`rem`, `torem`, `fn.rem`), like `FunctionCallNode.name`. */
    name: string;
    /** Parsed arguments; `undefined` where an argument is not an expression. */
    args: (Expr | undefined)[];
    /** Trimmed argument texts. */
    rawArgs: string[];
}

export type Expr = NumberExpr | VariableExpr | NegateExpr | BinaryExpr | MathExpr | CallExpr;

export interface EvalEnv {
    viewportWidth: number;
    viewportHeight: number;
    /** px per rem. */
    rootFontSize: number;
    /** px per em. */
    emBase: number;
    /** px per 100%; undefined → `%` makes the result undefined. */
    percentBase?: number;
    /** For cq units; default viewportWidth. */
    containerWidth?: number;
    /** Raw value text of a variable (`--space-4`, `$gutter`, `@gutter`), or undefined. Evaluated recursively. */
    resolveVariable?(name: string): string | undefined;
    /** px for user functions such as rem(16) → 16; undefined if unknown. `name` is lowercase. */
    resolveFunction?(name: string, args: (number | undefined)[], rawArgs: string[]): number | undefined;
}

/** Maximum depth of variable references that are followed. */
const MAX_VARIABLE_DEPTH = 16;

// ---------------------------------------------------------------------------
// Tokenizer

type TokType = 'num' | 'ident' | 'fn' | 'var' | 'op' | '(' | ')' | ',' | 'other';

interface Tok {
    type: TokType;
    start: number;
    end: number;
    /** Identifier/variable/function name, operator, or `(`/`#{`, `)`/`}`. */
    value: string;
    num?: number;
    unit?: string;
    /** Whitespace (or a comment) precedes the token. */
    space: boolean;
}

const NUMBER = /(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/iy;
const UNIT = /%|[a-z]+/iy;
const IDENT = /-{0,2}[a-z_][\w-]*(?:\.[a-z_][\w-]*)*/iy;
const VARIABLE = /[$@][\w-]*\w/y;

function matchAt(re: RegExp, text: string, at: number): string | undefined {
    re.lastIndex = at;
    const m = re.exec(text);
    return m ? m[0] : undefined;
}

function isDigit(c: string | undefined): boolean {
    return c !== undefined && c >= '0' && c <= '9';
}

function isIdentStart(c: string | undefined): boolean {
    return c !== undefined && (/[a-z_]/i.test(c) || c === '-');
}

function tokenize(text: string): Tok[] {
    const toks: Tok[] = [];
    let i = 0;
    let space = false;
    const push = (type: TokType, start: number, end: number, value: string, extra: Partial<Tok> = {}) => {
        toks.push({ type, start, end, value, space, ...extra });
        space = false;
    };
    while (i < text.length) {
        const c = text[i];
        if (/\s/.test(c)) {
            space = true;
            i++;
            continue;
        }
        if (c === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            i = close < 0 ? text.length : close + 2;
            space = true;
            continue;
        }
        const start = i;
        if (isDigit(c) || (c === '.' && isDigit(text[i + 1]))) {
            const num = matchAt(NUMBER, text, i)!;
            i += num.length;
            const unit = matchAt(UNIT, text, i) ?? '';
            i += unit.length;
            push('num', start, i, num + unit, { num: Number(num), unit: unit.toLowerCase() });
            continue;
        }
        if (c === '#' && text[i + 1] === '{') {
            i += 2;
            push('(', start, i, '#{');
            continue;
        }
        const variable = c === '$' || c === '@' ? matchAt(VARIABLE, text, i) : undefined;
        if (variable) {
            i += variable.length;
            push('var', start, i, variable);
            continue;
        }
        if (/[a-z_]/i.test(c) || (c === '-' && (isIdentStart(text[i + 1]) && (text[i + 1] !== '-' || isIdentStart(text[i + 2]))))) {
            const name = matchAt(IDENT, text, i);
            if (name) {
                i += name.length;
                if (text[i] === '.' && text[i + 1] === '$') {
                    // Sass module member: `tokens.$gutter`.
                    const member = matchAt(VARIABLE, text, i + 1);
                    if (member) {
                        i += 1 + member.length;
                        push('var', start, i, `${name}.${member}`);
                        continue;
                    }
                }
                push(text[i] === '(' ? 'fn' : 'ident', start, i, name);
                continue;
            }
        }
        if (c === '+' || c === '-' || c === '*' || c === '/') {
            i++;
            push('op', start, i, c);
            continue;
        }
        if (c === '(' || c === ')' || c === ',') {
            i++;
            push(c, start, i, c);
            continue;
        }
        if (c === '}') {
            i++;
            push(')', start, i, '}');
            continue;
        }
        if (c === '"' || c === "'") {
            let j = i + 1;
            while (j < text.length && text[j] !== c) {
                j += text[j] === '\\' ? 2 : 1;
            }
            i = Math.min(text.length, j + 1);
            push('other', start, i, text.slice(start, i));
            continue;
        }
        i++;
        push('other', start, i, c);
    }
    return toks;
}

// ---------------------------------------------------------------------------
// Parser

const MATH_ARITY: Record<MathExpr['name'], [number, number]> = {
    calc: [1, 1],
    clamp: [3, 3],
    min: [1, Infinity],
    max: [1, Infinity],
    div: [2, 2],
};

class Parser {
    private pos: number;

    private constructor(
        private readonly text: string,
        private readonly toks: Tok[],
        from: number,
        private readonly end: number,
    ) {
        this.pos = from;
    }

    /** Parses `toks[from, to)` as exactly one expression. */
    static parseRange(text: string, toks: Tok[], from: number, to: number): Expr | undefined {
        if (from >= to) {
            return undefined;
        }
        const parser = new Parser(text, toks, from, to);
        const expr = parser.sum();
        return expr && parser.pos === to ? expr : undefined;
    }

    private peek(offset = 0): Tok | undefined {
        const i = this.pos + offset;
        return i < this.end ? this.toks[i] : undefined;
    }

    private sum(): Expr | undefined {
        let left = this.product();
        while (left) {
            const t = this.peek();
            if (!t || t.type !== 'op' || (t.value !== '+' && t.value !== '-')) {
                break;
            }
            const next = this.peek(1);
            if (t.space && next && !next.space) {
                // `16px -8px` is a list of two values, not a subtraction.
                return undefined;
            }
            this.pos++;
            const right = this.product();
            if (!right) {
                return undefined;
            }
            left = { kind: 'binary', op: t.value, left, right };
        }
        return left;
    }

    private product(): Expr | undefined {
        let left = this.unary();
        while (left) {
            const t = this.peek();
            if (!t || t.type !== 'op' || (t.value !== '*' && t.value !== '/')) {
                break;
            }
            this.pos++;
            const right = this.unary();
            if (!right) {
                return undefined;
            }
            left = { kind: 'binary', op: t.value, left, right };
        }
        return left;
    }

    private unary(): Expr | undefined {
        const t = this.peek();
        if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
            this.pos++;
            const operand = this.unary();
            if (!operand || t.value === '+') {
                return operand;
            }
            return negate(operand);
        }
        return this.primary();
    }

    private primary(): Expr | undefined {
        const t = this.peek();
        if (!t) {
            return undefined;
        }
        switch (t.type) {
            case 'num':
                this.pos++;
                return { kind: 'number', value: t.num!, unit: t.unit! };
            case 'var':
                this.pos++;
                return { kind: 'variable', name: t.value };
            case '(': {
                const close = this.matching(this.pos);
                if (close < 0) {
                    return undefined;
                }
                const inner = Parser.parseRange(this.text, this.toks, this.pos + 1, close);
                this.pos = close + 1;
                return inner;
            }
            case 'fn':
                return this.call();
            default:
                return undefined;
        }
    }

    /** Index of the token closing the group opened at `open`, or -1. */
    private matching(open: number): number {
        const stack: string[] = [];
        for (let i = open; i < this.end; i++) {
            const t = this.toks[i];
            if (t.type === '(') {
                stack.push(t.value);
            } else if (t.type === ')') {
                const opener = stack.pop();
                if ((opener === '#{') !== (t.value === '}')) {
                    return -1;
                }
                if (!stack.length) {
                    return i;
                }
            }
        }
        return -1;
    }

    private raw(from: number, to: number): string {
        return from < to ? this.text.slice(this.toks[from].start, this.toks[to - 1].end).trim() : '';
    }

    private call(): Expr | undefined {
        const fn = this.toks[this.pos];
        const open = this.pos + 1;
        if (this.toks[open]?.value !== '(') {
            return undefined;
        }
        const close = this.matching(open);
        if (close < 0) {
            return undefined;
        }
        this.pos = close + 1;

        // Top-level argument ranges.
        const ranges: [number, number][] = [];
        let depth = 0;
        let argStart = open + 1;
        for (let i = open + 1; i < close; i++) {
            const t = this.toks[i];
            if (t.type === '(') {
                depth++;
            } else if (t.type === ')') {
                depth--;
            } else if (t.type === ',' && depth === 0) {
                ranges.push([argStart, i]);
                argStart = i + 1;
            }
        }
        if (close > open + 1) {
            ranges.push([argStart, close]);
        }

        let name = fn.value.toLowerCase();
        let negated = false;
        if (/^-[a-z_]/.test(name) && !/^-(webkit|moz|ms|o)-/.test(name)) {
            // Sass `-rem(16)`.
            negated = true;
            name = name.slice(1);
        }
        const bare = name.replace(/^-(webkit|moz)-/, '');
        const result = this.callExpr(bare === 'math.div' ? 'div' : bare, name, ranges, close);
        return result && negated ? negate(result) : result;
    }

    private callExpr(bare: string, name: string, ranges: [number, number][], close: number): Expr | undefined {
        if (bare === 'var') {
            const [first, second] = ranges;
            if (!first || first[1] - first[0] !== 1) {
                return undefined;
            }
            const id = this.toks[first[0]];
            if (id.type !== 'ident' || !id.value.startsWith('--')) {
                return undefined;
            }
            const expr: VariableExpr = { kind: 'variable', name: id.value };
            if (second) {
                expr.fallbackText = this.raw(second[0], close);
                const fallback = Parser.parseRange(this.text, this.toks, second[0], close);
                if (fallback) {
                    expr.fallback = fallback;
                }
            }
            return expr;
        }
        if (Object.prototype.hasOwnProperty.call(MATH_ARITY, bare)) {
            const mathName = bare as MathExpr['name'];
            const [min, max] = MATH_ARITY[mathName];
            if (ranges.length < min || ranges.length > max) {
                return undefined;
            }
            const args: Expr[] = [];
            for (const [from, to] of ranges) {
                const arg = Parser.parseRange(this.text, this.toks, from, to);
                if (!arg) {
                    return undefined;
                }
                args.push(arg);
            }
            return { kind: 'math', name: mathName, args };
        }
        return {
            kind: 'call',
            name,
            args: ranges.map(([from, to]) => Parser.parseRange(this.text, this.toks, from, to)),
            rawArgs: ranges.map(([from, to]) => this.raw(from, to)),
        };
    }
}

function negate(operand: Expr): Expr {
    if (operand.kind === 'number') {
        return { ...operand, value: -operand.value };
    }
    return { kind: 'negate', operand };
}

/**
 * Parses a CSS value expression: numbers, lengths (px rem em vw vh vmin vmax
 * svw/dvw/lvw svh/dvh/lvh cqi cqw cqh cqb cqmin cqmax %), + - * /,
 * parentheses, calc(), clamp(a,b,c), min(...), max(...), var(--x[, fallback]),
 * Sass `$var`, Less `@var`, and user function calls like rem(16) / rem(16px) /
 * toRem(16). Sass `#{…}` interpolation and Less `~"…"` escapes are unwrapped,
 * a trailing `!important`/`!default` is ignored. Returns undefined when the
 * text is not an expression it understands (e.g. keywords, multiple
 * space-separated values).
 */
export function parseExpression(text: string): Expr | undefined {
    let source = text.replace(/!\s*(important|default|global)\s*$/i, '').trim();
    const escaped = /^~\s*(["'])([\s\S]*)\1$/.exec(source);
    if (escaped) {
        source = escaped[2];
    }
    const toks = tokenize(source);
    return Parser.parseRange(source, toks, 0, toks.length);
}

// ---------------------------------------------------------------------------
// Evaluation

/** A px length or a unitless number. */
interface Value {
    v: number;
    length: boolean;
}

/** px per unit, or undefined for units that are not lengths or need missing context. */
function unitToPx(value: number, unit: string, env: EvalEnv): number | undefined {
    const w = env.viewportWidth;
    const h = env.viewportHeight;
    const cw = env.containerWidth ?? w;
    switch (unit) {
        case 'px':
            return value;
        case 'rem':
            return value * env.rootFontSize;
        case 'em':
            return value * env.emBase;
        case '%':
            return env.percentBase === undefined ? undefined : (value * env.percentBase) / 100;
        case 'vw':
        case 'svw':
        case 'lvw':
        case 'dvw':
        case 'vi':
        case 'svi':
        case 'lvi':
        case 'dvi':
            return (value * w) / 100;
        case 'vh':
        case 'svh':
        case 'lvh':
        case 'dvh':
        case 'vb':
        case 'svb':
        case 'lvb':
        case 'dvb':
            return (value * h) / 100;
        case 'vmin':
        case 'svmin':
        case 'lvmin':
        case 'dvmin':
            return (value * Math.min(w, h)) / 100;
        case 'vmax':
        case 'svmax':
        case 'lvmax':
        case 'dvmax':
            return (value * Math.max(w, h)) / 100;
        case 'cqw':
        case 'cqi':
            return (value * cw) / 100;
        // There is no container height; like units without a container, fall back to the viewport.
        case 'cqh':
        case 'cqb':
            return (value * h) / 100;
        case 'cqmin':
            return (value * Math.min(cw, h)) / 100;
        case 'cqmax':
            return (value * Math.max(cw, h)) / 100;
        case 'pt':
            return (value * 4) / 3;
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

/** Parsed variable values; expressions are never mutated, so they can be shared. */
const variableCache = new Map<string, Expr | undefined>();
const VARIABLE_CACHE_SIZE = 1000;

function parseCached(text: string): Expr | undefined {
    if (variableCache.has(text)) {
        return variableCache.get(text);
    }
    if (variableCache.size >= VARIABLE_CACHE_SIZE) {
        variableCache.clear();
    }
    const expr = parseExpression(text);
    variableCache.set(text, expr);
    return expr;
}

/** Raw text of a variable, parsed; `null` when it is unknown or part of a reference cycle. */
function lookupVariable(name: string, resolve: ((name: string) => string | undefined) | undefined, stack: readonly string[]): Expr | undefined | null {
    if (!resolve || stack.includes(name)) {
        return null;
    }
    const raw = resolve(name);
    return raw === undefined ? null : parseCached(raw);
}

function sameKind(values: (Value | undefined)[]): values is Value[] {
    return values.every(v => v !== undefined && v.length === values[0]!.length);
}

function divide(a: Value, b: Value): Value | undefined {
    if (b.v === 0) {
        return undefined;
    }
    if (b.length) {
        return a.length ? { v: a.v / b.v, length: false } : undefined;
    }
    return { v: a.v / b.v, length: a.length };
}

function evalValue(expr: Expr, env: EvalEnv, stack: readonly string[]): Value | undefined {
    switch (expr.kind) {
        case 'number': {
            if (expr.unit === '') {
                return { v: expr.value, length: false };
            }
            const px = unitToPx(expr.value, expr.unit, env);
            return px === undefined ? undefined : { v: px, length: true };
        }
        case 'negate': {
            const value = evalValue(expr.operand, env, stack);
            return value && { v: -value.v, length: value.length };
        }
        case 'binary': {
            const a = evalValue(expr.left, env, stack);
            const b = evalValue(expr.right, env, stack);
            if (!a || !b) {
                return undefined;
            }
            switch (expr.op) {
                case '+':
                case '-':
                    if (a.length !== b.length) {
                        return undefined;
                    }
                    return { v: expr.op === '+' ? a.v + b.v : a.v - b.v, length: a.length };
                case '*':
                    return a.length && b.length ? undefined : { v: a.v * b.v, length: a.length || b.length };
                default:
                    return divide(a, b);
            }
        }
        case 'math': {
            const args = expr.args.map(a => evalValue(a, env, stack));
            if (expr.name === 'div') {
                return args[0] && args[1] && divide(args[0], args[1]);
            }
            if (!sameKind(args)) {
                return undefined;
            }
            const length = args[0].length;
            switch (expr.name) {
                case 'calc':
                    return args[0];
                case 'clamp':
                    return { v: Math.max(args[0].v, Math.min(args[1].v, args[2].v)), length };
                case 'min':
                    return { v: Math.min(...args.map(a => a.v)), length };
                default:
                    return { v: Math.max(...args.map(a => a.v)), length };
            }
        }
        case 'variable': {
            if (stack.length >= MAX_VARIABLE_DEPTH) {
                return undefined;
            }
            const resolved = lookupVariable(expr.name, env.resolveVariable, stack);
            if (resolved !== null) {
                return resolved && evalValue(resolved, env, [...stack, expr.name]);
            }
            return expr.fallback && evalValue(expr.fallback, env, stack);
        }
        case 'call': {
            if (!env.resolveFunction) {
                return undefined;
            }
            const args = expr.args.map(a => (a ? evalValue(a, env, stack)?.v : undefined));
            const px = env.resolveFunction(expr.name, args, expr.rawArgs);
            return px === undefined || !Number.isFinite(px) ? undefined : { v: px, length: true };
        }
    }
}

/**
 * Evaluates to px. Unitless numbers stay unitless in * and / (e.g.
 * `2 * 8px` = 16px, `16px / 2` = 8px); `16px + 2` and `16px * 2px` are
 * undefined. A unitless result is undefined, except `0`. Returns undefined if
 * anything is unknown.
 */
export function evaluate(expr: Expr, env: EvalEnv): number | undefined {
    const value = evalValue(expr, env, []);
    if (!value || !Number.isFinite(value.v)) {
        return undefined;
    }
    if (!value.length) {
        return value.v === 0 ? 0 : undefined;
    }
    return value.v;
}

/** Parses and evaluates `text` to px. */
export function evaluateText(text: string, env: EvalEnv): number | undefined {
    const expr = parseExpression(text);
    return expr ? evaluate(expr, env) : undefined;
}

// ---------------------------------------------------------------------------
// Structural questions

type VariableResolver = Pick<EvalEnv, 'resolveVariable'>;

function someTerm(
    expr: Expr,
    unitMatches: (unit: string) => boolean,
    callMatches: (call: CallExpr) => boolean,
    env: VariableResolver | undefined,
    stack: readonly string[],
): boolean {
    const recurse = (e: Expr | undefined, s = stack): boolean => !!e && someTerm(e, unitMatches, callMatches, env, s);
    switch (expr.kind) {
        case 'number':
            return unitMatches(expr.unit);
        case 'negate':
            return recurse(expr.operand);
        case 'binary':
            return recurse(expr.left) || recurse(expr.right);
        case 'math':
            return expr.args.some(a => recurse(a));
        case 'call':
            return callMatches(expr) || expr.args.some(a => recurse(a));
        case 'variable': {
            if (stack.length >= MAX_VARIABLE_DEPTH) {
                return false;
            }
            const resolved = lookupVariable(expr.name, env?.resolveVariable, stack);
            if (resolved !== null) {
                return recurse(resolved, [...stack, expr.name]);
            }
            return recurse(expr.fallback);
        }
    }
}

const VIEWPORT_UNITS = new Set([
    'vw', 'svw', 'lvw', 'dvw', 'vi', 'svi', 'lvi', 'dvi',
    'vh', 'svh', 'lvh', 'dvh', 'vb', 'svb', 'lvb', 'dvb',
    'vmin', 'svmin', 'lvmin', 'dvmin', 'vmax', 'svmax', 'lvmax', 'dvmax',
    'cqw', 'cqi', 'cqh', 'cqb', 'cqmin', 'cqmax',
]);

const FONT_RELATIVE_UNITS = new Set(['rem', 'em', 'ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric', 'lh', 'rlh']);

/** `rem`, `toRem`, `pxToRem`, `px2rem`, `rem-calc`, `em`, `toEm`, … */
function isFontRelativeFunction(call: CallExpr): boolean {
    const local = call.name.slice(call.name.lastIndexOf('.') + 1).replace(/[^a-z]/g, '');
    return /^(px)?(to)?r?em(calc)?$/.test(local);
}

/**
 * Whether the expression's value changes with the viewport or container size
 * (vw/vi/vh/vb/vmin/vmax and their s/l/d variants, cq units). `%` does not
 * count. Variables are followed when `env.resolveVariable` is given.
 */
export function dependsOnViewport(expr: Expr, env?: VariableResolver): boolean {
    return someTerm(expr, unit => VIEWPORT_UNITS.has(unit), () => false, env, []);
}

/**
 * Whether the expression contains any rem/em (or other font-relative) term,
 * i.e. it responds to the user's font-size setting. Calls of rem functions
 * (`rem(16)`, `toRem()`, `pxToRem()`, `rem-calc()`, `em()`) count, since they
 * compile to rem/em. Variables are followed when `env.resolveVariable` is given.
 */
export function respondsToFontSize(expr: Expr, env?: VariableResolver): boolean {
    return someTerm(expr, unit => FONT_RELATIVE_UNITS.has(unit), isFontRelativeFunction, env, []);
}
