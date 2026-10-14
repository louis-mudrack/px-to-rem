/**
 * Zero-config project detection: root font size, user-defined rem()
 * functions, postcss-pxtorem options, package.json facts and Tailwind themes.
 * Everything works on text; nothing is executed.
 */
import type { RemFunctionDef } from './context';
import type { ParsedDocument } from './document';
import { scanJs, skipJsExpression } from './jsLexer';
import type { BlockNode } from './parser';
import { escapeRegExp } from './properties';
import type { Syntax } from './syntax';
import type { TailwindConfig } from './tailwind';
import { LineIndex } from './text';
import type { SourceRef } from './tokens';
import { parseSingleLength } from './tokens/extract';

/** Browsers' default font size, which `%`, `em` and `rem` on the root element are relative to. */
const BROWSER_DEFAULT = 16;

/** Absolute-size keywords as browsers resolve them at the default font size. */
const FONT_SIZE_KEYWORDS: Readonly<Record<string, number>> = {
    'xx-small': 9,
    'x-small': 10,
    small: 13,
    medium: 16,
    large: 18,
    'x-large': 24,
    'xx-large': 32,
    'xxx-large': 48,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collapse(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Root font size
// ---------------------------------------------------------------------------

export interface RootFontSizeCandidate {
    px: number;
    source: SourceRef;
}

/** An unconditional `html` / `:root` rule (top level, or only inside `@layer`). */
function isRootRule(block: BlockNode): boolean {
    if (block.kind !== 'rule' || !block.selector) {
        return false;
    }
    for (let p = block.parent; p && p.kind !== 'root'; p = p.parent) {
        if (p.kind !== 'atrule' || p.name !== 'layer') {
            return false;
        }
    }
    return block.selector.split(',').some(part => /^(?:html|:root)$/i.test(part.trim()));
}

/** Raw values of global variables (`$x`, `@x`, Stylus `x`, `--x` on the root), for simple lookups. */
function globalVariables(doc: ParsedDocument): Map<string, string> {
    const vars = new Map<string, string>();
    for (const decl of doc.declarations) {
        const variable = decl.variable;
        if (!variable || !(decl.parent.kind === 'root' || (variable.flavor === 'css' && isRootRule(decl.parent)))) {
            continue;
        }
        vars.set(normalizeVariable(variable.name), doc.text.slice(decl.valueSpan.start, decl.valueSpan.end).trim());
    }
    return vars;
}

function normalizeVariable(name: string): string {
    return name.startsWith('$') ? name.replace(/_/g, '-') : name;
}

/** Replaces a value that is just a variable reference with the variable's value. */
function substituteVariable(value: string, vars: Map<string, string>, depth = 0): string {
    const v = value.trim();
    if (depth > 8) {
        return v;
    }
    let name: string | undefined;
    let fallback: string | undefined;
    const cssVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(v);
    if (cssVar) {
        name = cssVar[1];
        fallback = cssVar[2];
    } else if (/^[$@][\w-]+$/.test(v) || (/^[A-Za-z_][\w-]*$/.test(v) && vars.has(v))) {
        name = normalizeVariable(v);
    }
    if (name === undefined) {
        return v;
    }
    const found = vars.get(name) ?? fallback;
    return found === undefined ? v : substituteVariable(found, vars, depth + 1);
}

/** px of a root `font-size` value: `62.5%` → 10, `10px`, `1rem`/`1em` → 16, `medium` → 16. */
function rootSizePx(value: string): number | undefined {
    const v = value.trim().toLowerCase();
    if (Object.hasOwn(FONT_SIZE_KEYWORDS, v)) {
        return FONT_SIZE_KEYWORDS[v];
    }
    const length = parseSingleLength(v);
    let px: number | undefined;
    switch (length?.unit) {
        case '%':
            px = (length.value / 100) * BROWSER_DEFAULT;
            break;
        case 'px':
            px = length.value;
            break;
        case 'rem':
        case 'em':
            px = length.value * BROWSER_DEFAULT;
            break;
    }
    return px !== undefined && px > 0 && Number.isFinite(px) ? px : undefined;
}

/** The font-size part of a `font` shorthand (`italic 62.5%/1.5 Inter, sans-serif`). */
function fontShorthandSize(value: string, vars: Map<string, string>): number | undefined {
    const beforeFamilies = value.split(',')[0];
    for (const word of beforeFamilies.trim().split(/\s+/)) {
        const size = word.split('/')[0];
        if (!size) {
            continue;
        }
        const resolved = substituteVariable(size, vars);
        const lower = resolved.toLowerCase();
        if (Object.hasOwn(FONT_SIZE_KEYWORDS, lower)) {
            return FONT_SIZE_KEYWORDS[lower];
        }
        if (parseSingleLength(resolved)?.unit) {
            return rootSizePx(resolved);
        }
    }
    return undefined;
}

/**
 * Root font sizes set by unconditional `html` / `:root` rules (`font-size`
 * or the `font` shorthand): percentages (62.5% → 10 at the 16px browser
 * default), px, rem/em (× 16) and absolute-size keywords. Simple variable
 * references (`$root-size`, `var(--x)`) are followed. Rules inside `@media`
 * and other conditional at-rules are ignored. Returned in document order.
 */
export function findRootFontSizes(doc: ParsedDocument, file: string): RootFontSizeCandidate[] {
    const vars = globalVariables(doc);
    const out: { at: number; candidate: RootFontSizeCandidate }[] = [];
    for (const decl of doc.declarations) {
        if ((decl.property !== 'font-size' && decl.property !== 'font') || !isRootRule(decl.parent)) {
            continue;
        }
        const raw = doc.text.slice(decl.valueSpan.start, decl.valueSpan.end);
        const px = decl.property === 'font' ? fontShorthandSize(raw, vars) : rootSizePx(substituteVariable(raw, vars));
        if (px === undefined) {
            continue;
        }
        out.push({
            at: decl.start,
            candidate: {
                px,
                source: { file, line: doc.lines.lineAt(decl.start), description: `${decl.parent.selector} { ${decl.property}: ${collapse(raw)} }` },
            },
        });
    }
    return out.sort((a, b) => a.at - b.at).map(o => o.candidate);
}

/**
 * Picks the root font size: an explicit setting wins, then a postcss-pxtorem
 * `rootValue`, then the most common detected value (ties → the first found),
 * else `fallback`. `ambiguous` is set when candidates disagree.
 */
export function chooseRootFontSize(input: {
    explicit?: number;
    postcss?: PostcssPxToRem;
    candidates: RootFontSizeCandidate[];
    fallback: number;
}): { px: number; source?: SourceRef; ambiguous: boolean } {
    const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;
    if (valid(input.explicit)) {
        return { px: input.explicit, source: { description: 'pxToRem.baseFontSize setting' }, ambiguous: false };
    }
    if (valid(input.postcss?.rootValue)) {
        return { px: input.postcss.rootValue, source: input.postcss.source, ambiguous: false };
    }
    const counts = new Map<number, { count: number; first: RootFontSizeCandidate }>();
    for (const candidate of input.candidates) {
        if (!valid(candidate.px)) {
            continue;
        }
        const key = Math.round(candidate.px * 1e4) / 1e4;
        const entry = counts.get(key);
        if (entry) {
            entry.count++;
        } else {
            counts.set(key, { count: 1, first: candidate });
        }
    }
    let best: { count: number; first: RootFontSizeCandidate } | undefined;
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) {
            best = entry;
        }
    }
    if (!best) {
        return { px: input.fallback, ambiguous: false };
    }
    return { px: best.first.px, source: best.first.source, ambiguous: counts.size > 1 };
}

// ---------------------------------------------------------------------------
// rem() functions
// ---------------------------------------------------------------------------

/** Index of the bracket matching the one at `open`, or -1. Skips quoted strings. */
function matchingBracket(text: string, open: number): number {
    const openCh = text[open];
    const closeCh = openCh === '(' ? ')' : openCh === '[' ? ']' : openCh === '{' ? '}' : '>';
    let depth = 0;
    let quote = '';
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') {
                i++;
            } else if (c === quote) {
                quote = '';
            }
            continue;
        }
        if (c === '"' || c === "'") {
            quote = c;
        } else if (c === openCh) {
            depth++;
        } else if (c === closeCh && !(closeCh === '>' && text[i - 1] === '=') && --depth === 0) {
            return i;
        }
    }
    return -1;
}

/** Splits at top-level commas (outside quotes and brackets). */
function splitArgs(text: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote = '';
    let from = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') {
                i++;
            } else if (c === quote) {
                quote = '';
            }
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '(' || c === '[' || c === '{') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}') {
            depth--;
        } else if (c === ',' && depth === 0) {
            parts.push(text.slice(from, i));
            from = i + 1;
        }
    }
    parts.push(text.slice(from));
    return parts.map(p => p.trim()).filter(Boolean);
}

interface Param {
    name: string;
    default?: string;
}

/** Parameters with defaults: `$base: 16px` (Sass, CSS) or `base = 16` (Stylus, JS; TS types skipped). */
function parseParams(inner: string, separator: ':' | '='): Param[] {
    const re = separator === ':' ? /^(?:\.\.\.)?([$\w-]+)[^:]*(?::\s*([\s\S]*))?$/ : /^(?:\.\.\.)?([$\w-]+)[^=]*(?:=\s*([\s\S]*))?$/;
    const out: Param[] = [];
    for (const part of splitArgs(inner)) {
        const m = re.exec(part);
        if (m) {
            out.push({ name: m[1].replace(/\.{3}$/, ''), default: m[2]?.trim() || undefined });
        }
    }
    return out;
}

/** The parameter that holds the base font size: named like one, or the only extra parameter. */
function baseParam(params: Param[]): Param | undefined {
    const rest = params.slice(1);
    return rest.find(p => /base|root|context|font|size/i.test(p.name)) ?? (rest.length === 1 ? rest[0] : undefined);
}

/** A base value in px: `16px`, `16`, `'16px'`, or a variable holding one. */
function baseValue(text: string | undefined, vars: Map<string, string>): number | undefined {
    if (text === undefined) {
        return undefined;
    }
    const value = substituteVariable(text.trim().replace(/^(['"])(.*)\1$/, '$2'), vars);
    const length = parseSingleLength(value);
    return length && (length.unit === 'px' || length.unit === '') && length.value > 0 ? length.value : undefined;
}

/** Finds `px / 16`, `math.div($px, 16px)` or `div($px, $base)` in a function body; returns the divisor's px. */
function baseFromBody(body: string, params: Param[], vars: Map<string, string>): number | undefined {
    const first = params[0];
    if (!first) {
        return undefined;
    }
    const p = escapeRegExp(first.name);
    const patterns = [
        new RegExp(String.raw`(?:math\.)?div\(\s*${p}\s*,\s*([^,()]+?)\s*\)`),
        new RegExp(String.raw`(?<![\w$-])${p}\s*\/\s*([$\w.-]+)`),
    ];
    for (const re of patterns) {
        const m = re.exec(body);
        if (!m) {
            continue;
        }
        const divisor = m[1].trim();
        const param = params.find(q => q.name === divisor);
        const value = param ? baseValue(param.default, vars) : baseValue(divisor, vars);
        if (value !== undefined) {
            return value;
        }
    }
    return undefined;
}

function normalizeFunctionName(name: string): string {
    return name.replace(/^--/, '').replace(/_/g, '-').toLowerCase();
}

/**
 * User-defined px-to-rem functions named `functionName` in a stylesheet:
 * Sass `@function rem(…)` (SCSS and indented syntax), Stylus `rem(…)`
 * definitions at the top level and CSS custom functions `@function --rem(…)`
 * (recorded as written). Less has none. Sass `-`/`_` and a leading `--` are
 * ignored when comparing names. A default base such as `$base: 16px` is read
 * from the parameters, else from a division in the body (`math.div($px, 16px)`).
 */
export function findRemFunctions(doc: ParsedDocument, file: string, functionName: string): RemFunctionDef[] {
    const wanted = normalizeFunctionName(functionName);
    const vars = globalVariables(doc);
    const out: RemFunctionDef[] = [];
    for (const block of doc.blocks) {
        const syntax: Syntax = block.syntax;
        // Sass/CSS `@function name(…)`, or a Stylus definition `name(…)` that the parser reads as a rule.
        const isAtFunction = block.kind === 'atrule' && block.name === 'function' && syntax !== 'less';
        const isStylusFunction = block.kind === 'rule' && syntax === 'stylus' && block.parent?.kind === 'root';
        if (!(isAtFunction || isStylusFunction) || !block.prelude) {
            continue;
        }
        const prefix = isAtFunction ? '@function ' : '';
        const signature = doc.text.slice(block.prelude.start, block.prelude.end);
        const m = /^\s*([-\w]+)\s*\(/.exec(signature);
        if (!m || normalizeFunctionName(m[1]) !== wanted) {
            continue;
        }
        const open = signature.indexOf('(', m.index);
        const close = matchingBracket(signature, open);
        if (close < 0) {
            continue;
        }
        const inner = signature.slice(open + 1, close);
        const params = parseParams(inner, syntax === 'stylus' ? '=' : ':');
        const param = baseParam(params);
        const base = param?.default !== undefined ? baseValue(param.default, vars) : baseFromBody(doc.text.slice(block.body.start, block.body.end), params, vars);
        const def: RemFunctionDef = {
            name: m[1],
            syntax,
            source: { file, line: doc.lines.lineAt(block.start), description: `${prefix}${m[1]}(${collapse(inner)})` },
        };
        if (base !== undefined) {
            def.base = base;
        }
        out.push(def);
    }
    return out;
}

/** JavaScript with comments (and, unless `keepStrings`, strings and templates) blanked out; offsets are kept. */
function maskJs(text: string, keepStrings: boolean): string {
    const scan = scanJs(text);
    const blank = (s: string) => s.replace(/[^\n]/g, ' ');
    if (keepStrings) {
        let out = '';
        let cursor = 0;
        for (const c of scan.comments) {
            out += text.slice(cursor, c.start) + blank(text.slice(c.start, c.end));
            cursor = c.end;
        }
        return out + text.slice(cursor);
    }
    const chars = blank(text).split('');
    for (const span of scan.code) {
        for (let i = span.start; i < span.end; i++) {
            chars[i] = text[i];
        }
    }
    return chars.join('');
}

function skipWs(text: string, i: number): number {
    while (i < text.length && /\s/.test(text[i])) {
        i++;
    }
    return i;
}

function startsWord(text: string, i: number, word: string): boolean {
    return text.startsWith(word, i) && !/[\w$]/.test(text[i + word.length] ?? '');
}

interface JsFunctionShape {
    /** `(` of the parameter list, or undefined for `px => …`. */
    open?: number;
    close?: number;
    single?: string;
    bodyStart: number;
}

/** Recognises a function value at `i`: `function (…)`, `(…) =>`, `px =>`, optionally `async`/generic. */
function jsFunctionAt(code: string, i: number): JsFunctionShape | undefined {
    let j = skipWs(code, i);
    if (startsWord(code, j, 'async')) {
        j = skipWs(code, j + 5);
    }
    if (startsWord(code, j, 'function')) {
        j = skipWs(code, j + 8);
        if (code[j] === '*') {
            j = skipWs(code, j + 1);
        }
        const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(j, j + 200));
        if (id) {
            j = skipWs(code, j + id[0].length);
        }
    }
    if (code[j] === '<') {
        const end = matchingBracket(code, j);
        if (end < 0) {
            return undefined;
        }
        j = skipWs(code, end + 1);
    }
    if (code[j] === '(') {
        const close = matchingBracket(code, j);
        if (close < 0) {
            return undefined;
        }
        let k = skipWs(code, close + 1);
        if (code.startsWith('=>', k)) {
            return { open: j, close, bodyStart: k + 2 };
        }
        if (code[k] === ':') {
            // Return type: `(px: number): string => …` or `function rem(px): string { … }`.
            const arrow = code.indexOf('=>', k);
            const brace = code.indexOf('{', k);
            k = arrow >= 0 && (brace < 0 || arrow < brace) ? arrow : brace;
            if (k < 0) {
                return undefined;
            }
            return { open: j, close, bodyStart: code[k] === '=' ? k + 2 : k };
        }
        return code[k] === '{' && /function\s*\*?\s*[\w$]*\s*(?:<[^>]*>\s*)?$/.test(code.slice(Math.max(0, j - 200), j)) ? { open: j, close, bodyStart: k } : undefined;
    }
    const id = /^[A-Za-z_$][\w$]*/.exec(code.slice(j, j + 200));
    if (id) {
        const k = skipWs(code, j + id[0].length);
        if (code.startsWith('=>', k)) {
            return { single: id[0], bodyStart: k + 2 };
        }
    }
    return undefined;
}

/** Offset after the `=` of `const name[: Type] = …`, or undefined. */
function assignmentAfter(code: string, i: number): number | undefined {
    let depth = 0;
    for (let k = i; k < code.length && k < i + 500; k++) {
        const c = code[k];
        if (c === '(' || c === '[' || c === '{' || c === '<') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}' || (c === '>' && code[k - 1] !== '=')) {
            if (--depth < 0) {
                return undefined;
            }
        } else if ((c === ';' || c === ',') && depth === 0) {
            return undefined;
        } else if (c === '=' && depth === 0 && code[k + 1] !== '>' && code[k + 1] !== '=') {
            return k + 1;
        }
    }
    return undefined;
}

/** The function body starting at `i`: a `{ … }` block or an expression up to the end of the statement. */
function jsBody(code: string, i: number): string {
    const j = skipWs(code, i);
    if (code[j] === '{') {
        const close = matchingBracket(code, j);
        return code.slice(j, close < 0 ? code.length : close + 1);
    }
    let depth = 0;
    let k = j;
    for (; k < code.length; k++) {
        const c = code[k];
        if (c === '(' || c === '[' || c === '{') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}') {
            if (depth === 0) {
                break;
            }
            depth--;
        } else if (depth === 0 && (c === ';' || c === ',' || (c === '\n' && code.slice(j, k).trim()))) {
            break;
        }
    }
    return code.slice(j, k);
}

/**
 * JavaScript/TypeScript px-to-rem helpers named `functionName`:
 * `function rem(…)`, `const rem = (…) =>`, `export const rem: Fn = …`,
 * `rem: (px) =>` properties and `rem(px) { … }` methods. Comments and strings
 * are ignored. A base is read from a parameter default (`base = 16`) or a
 * division in the body (`px / 16`, `px / BASE` with `const BASE = 16`).
 */
export function findRemFunctionsInScript(text: string, file: string, functionName: string): RemFunctionDef[] {
    if (!/^[A-Za-z_$][\w$]*$/.test(functionName)) {
        return [];
    }
    const code = maskJs(text, false);
    const lines = new LineIndex(text);
    const name = escapeRegExp(functionName);
    const out: RemFunctionDef[] = [];
    const seenLines = new Set<number>();

    const constant = (id: string): string | undefined =>
        new RegExp(String.raw`(?<![\w$.])(?:const|let|var)\s+${escapeRegExp(id)}\s*(?::\s*number\s*)?=\s*(\d+(?:\.\d+)?)(?![\w.])`).exec(code)?.[1];

    const add = (at: number, shape: JsFunctionShape) => {
        const line = lines.lineAt(at);
        if (seenLines.has(line)) {
            return;
        }
        seenLines.add(line);
        const params: Param[] =
            shape.open !== undefined && shape.close !== undefined ? parseParams(text.slice(shape.open + 1, shape.close), '=') : [{ name: shape.single ?? '' }];
        const vars = new Map<string, string>();
        for (const p of params) {
            const value = p.default !== undefined && /^[A-Za-z_$][\w$]*$/.test(p.default) ? constant(p.default) : undefined;
            if (value !== undefined) {
                vars.set(p.default!, value);
            }
        }
        const param = baseParam(params);
        let base = param?.default !== undefined ? baseValue(param.default, vars) : undefined;
        if (base === undefined && !param?.default) {
            const body = jsBody(code, shape.bodyStart);
            const divisor = params[0]?.name ? new RegExp(String.raw`(?<![\w$.])${escapeRegExp(params[0].name)}\s*\/\s*([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)`).exec(body)?.[1] : undefined;
            if (divisor !== undefined) {
                const asParam = params.find(p => p.name === divisor);
                base = asParam ? baseValue(asParam.default, vars) : baseValue(/^\d/.test(divisor) ? divisor : constant(divisor), vars);
            }
        }
        const lineText = collapse(lines.lineText(line));
        const def: RemFunctionDef = {
            name: functionName,
            syntax: 'js',
            source: { file, line, description: lineText.length > 80 ? lineText.slice(0, 79) + '…' : lineText },
        };
        if (base !== undefined) {
            def.base = base;
        }
        out.push(def);
    };

    // function rem(…) / export function rem<T>(…)
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])function\s*\*?\s*${name}(?![\w$])`, 'g'))) {
        const shape = jsFunctionAt(code, m.index);
        if (shape) {
            add(m.index, shape);
        }
    }
    // const rem = (…) => …, export const rem: (px: number) => string = …
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])(?:const|let|var)\s+${name}(?![\w$])`, 'g'))) {
        const assign = assignmentAfter(code, m.index + m[0].length);
        const shape = assign !== undefined ? jsFunctionAt(code, assign) : undefined;
        if (shape) {
            add(m.index, shape);
        }
    }
    // { rem: (px) => …, rem: function (…) { … } }
    for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.?])${name}\s*:`, 'g'))) {
        const shape = jsFunctionAt(code, m.index + m[0].length);
        if (shape) {
            add(m.index, shape);
        }
    }
    // Methods: { rem(px) { … } } / class X { static rem(px: number): string { … } }
    for (const m of code.matchAll(new RegExp(String.raw`(?:^|[{,;}])\s*(?:(?:static|async|public|private|protected)\s+)*(${name})\s*\(`, 'gm'))) {
        const open = m.index + m[0].length - 1;
        const close = matchingBracket(code, open);
        if (close < 0) {
            continue;
        }
        let k = skipWs(code, close + 1);
        if (code[k] === ':') {
            k = code.indexOf('{', k);
        }
        if (k >= 0 && code[k] === '{') {
            add(m.index + m[0].indexOf(m[1]), { open, close, bodyStart: k });
        }
    }
    return out.sort((a, b) => (a.source?.line ?? 0) - (b.source?.line ?? 0));
}

// ---------------------------------------------------------------------------
// Literal JavaScript objects (no evaluation)
// ---------------------------------------------------------------------------

/**
 * Reads JavaScript/JSON literals (objects, arrays, strings, numbers, booleans,
 * regex literals). Anything else (calls, identifiers, functions, spreads) is
 * skipped and read as `undefined`.
 */
class LiteralReader {
    constructor(
        private readonly text: string,
        public pos: number,
    ) {}

    skipTrivia(): void {
        const t = this.text;
        while (this.pos < t.length) {
            const c = t[this.pos];
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
                this.pos++;
            } else if (c === '/' && t[this.pos + 1] === '/') {
                const nl = t.indexOf('\n', this.pos);
                this.pos = nl < 0 ? t.length : nl;
            } else if (c === '/' && t[this.pos + 1] === '*') {
                const close = t.indexOf('*/', this.pos + 2);
                this.pos = close < 0 ? t.length : close + 2;
            } else {
                return;
            }
        }
    }

    peek(): string | undefined {
        this.skipTrivia();
        return this.text[this.pos];
    }

    value(): unknown {
        this.skipTrivia();
        const start = this.pos;
        const c = this.text[this.pos];
        let result: unknown;
        let ok = true;
        if (c === '{') {
            result = this.object();
        } else if (c === '[') {
            result = this.array();
        } else if (c === '"' || c === "'") {
            result = this.string();
        } else if (c === '`') {
            result = this.template();
            ok = result !== undefined;
        } else if (c === '/') {
            result = this.regex();
        } else {
            const m = /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|true|false|null)(?![\w$])/.exec(this.text.slice(this.pos, this.pos + 40));
            if (m) {
                this.pos += m[0].length;
                result = m[0] === 'true' ? true : m[0] === 'false' ? false : m[0] === 'null' ? null : Number(m[0]);
            } else {
                ok = false;
            }
        }
        const next = this.peek();
        if (ok && (next === undefined || next === ',' || next === '}' || next === ']' || next === ')')) {
            return result;
        }
        this.pos = start;
        this.skipExpression();
        return undefined;
    }

    private object(): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        this.pos++;
        for (;;) {
            const c = this.peek();
            if (c === undefined || c === ')' || c === ']') {
                return out;
            }
            if (c === '}') {
                this.pos++;
                return out;
            }
            if (c === ',') {
                this.pos++;
                continue;
            }
            if (this.text.startsWith('...', this.pos)) {
                this.pos += 3;
                this.skipExpression();
                continue;
            }
            let key: string | undefined;
            if (c === '"' || c === "'") {
                key = this.string();
            } else if (c === '[') {
                const close = matchingBracket(this.text, this.pos);
                this.pos = close < 0 ? this.text.length : close + 1;
            } else {
                const m = /^(?:\d+(?:\.\d+)?|[A-Za-z_$][\w$]*)/.exec(this.text.slice(this.pos, this.pos + 200));
                if (!m) {
                    this.skipExpression();
                    if (this.text[this.pos] === c) {
                        this.pos++;
                    }
                    continue;
                }
                key = /^\d/.test(m[0]) ? String(Number(m[0])) : m[0];
                this.pos += m[0].length;
            }
            if (this.peek() === ':') {
                this.pos++;
                const value = this.value();
                if (key !== undefined && value !== undefined) {
                    out[key] = value;
                }
            } else if (this.peek() !== ',' && this.peek() !== '}') {
                // Methods, getters, `key = default` in patterns.
                this.skipExpression();
            }
        }
    }

    private array(): unknown[] {
        const out: unknown[] = [];
        this.pos++;
        for (;;) {
            const c = this.peek();
            if (c === undefined || c === ')' || c === '}') {
                return out;
            }
            if (c === ']') {
                this.pos++;
                return out;
            }
            if (c === ',') {
                this.pos++;
                continue;
            }
            if (this.text.startsWith('...', this.pos)) {
                this.pos += 3;
                this.skipExpression();
                continue;
            }
            out.push(this.value());
        }
    }

    private string(): string {
        const t = this.text;
        const quote = t[this.pos++];
        let out = '';
        while (this.pos < t.length) {
            const c = t[this.pos++];
            if (c === '\\') {
                const n = t[this.pos++] ?? '';
                out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
                continue;
            }
            if (c === quote || c === '\n') {
                break;
            }
            out += c;
        }
        return out;
    }

    /** A template literal without `${}` as a string; undefined otherwise. */
    private template(): string | undefined {
        const t = this.text;
        const start = this.pos;
        this.skipTemplate();
        const content = t.slice(start + 1, Math.max(start + 1, this.pos - 1));
        return content.includes('${') ? undefined : content.replace(/\\(.)/g, '$1');
    }

    private skipTemplate(): void {
        const t = this.text;
        this.pos++;
        while (this.pos < t.length) {
            const c = t[this.pos];
            if (c === '\\') {
                this.pos += 2;
            } else if (c === '`') {
                this.pos++;
                return;
            } else if (c === '$' && t[this.pos + 1] === '{') {
                this.pos = skipJsExpression(t, this.pos + 2, t.length);
            } else {
                this.pos++;
            }
        }
    }

    /** A regex literal, returned as written (`/^body$/i`). */
    private regex(): string {
        const t = this.text;
        const start = this.pos++;
        let inClass = false;
        while (this.pos < t.length) {
            const c = t[this.pos];
            if (c === '\\') {
                this.pos += 2;
                continue;
            }
            if (c === '\n') {
                break;
            }
            if (c === '[') {
                inClass = true;
            } else if (c === ']') {
                inClass = false;
            } else if (c === '/' && !inClass) {
                this.pos++;
                while (/[a-z]/i.test(t[this.pos] ?? '')) {
                    this.pos++;
                }
                break;
            }
            this.pos++;
        }
        return t.slice(start, this.pos);
    }

    /** Skips an arbitrary expression up to the next top-level `,`, `}`, `]` or `)`. */
    skipExpression(): void {
        const t = this.text;
        let depth = 0;
        while (this.pos < t.length) {
            const c = t[this.pos];
            if (c === '"' || c === "'") {
                this.string();
                continue;
            }
            if (c === '`') {
                this.skipTemplate();
                continue;
            }
            if (c === '/' && (t[this.pos + 1] === '/' || t[this.pos + 1] === '*')) {
                this.skipTrivia();
                continue;
            }
            if (c === '(' || c === '[' || c === '{') {
                depth++;
            } else if (c === ')' || c === ']' || c === '}') {
                if (depth === 0) {
                    return;
                }
                depth--;
            } else if (c === ',' && depth === 0) {
                return;
            }
            this.pos++;
        }
    }
}

// ---------------------------------------------------------------------------
// postcss-pxtorem
// ---------------------------------------------------------------------------

export interface PostcssPxToRem {
    rootValue?: number;
    propList?: string[];
    minPixelValue?: number;
    selectorBlackList?: string[];
    unitPrecision?: number;
    mediaQuery?: boolean;
    source: SourceRef;
}

const PXTOREM_MODULE = String.raw`(?:@minko-fe\/)?postcss-pxtorem`;
const JS_ID = String.raw`[A-Za-z_$][\w$]*`;

function pxToRemOptions(raw: Record<string, unknown> | undefined, source: SourceRef): PostcssPxToRem {
    const out: PostcssPxToRem = { source };
    if (!raw) {
        return out;
    }
    const num = (v: unknown): number | undefined => {
        if (typeof v === 'number' && Number.isFinite(v)) {
            return v;
        }
        return typeof v === 'string' && /^\d+(?:\.\d+)?$/.test(v.trim()) ? Number(v) : undefined;
    };
    const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : undefined);
    // Current option names, then the pre-5.0 snake_case ones.
    const rootValue = num(raw.rootValue ?? raw.root_value);
    if (rootValue !== undefined && rootValue > 0) {
        out.rootValue = rootValue;
    }
    const precision = num(raw.unitPrecision ?? raw.unit_precision);
    if (precision !== undefined) {
        out.unitPrecision = precision;
    }
    const minPixelValue = num(raw.minPixelValue ?? raw.min_pixel_value);
    if (minPixelValue !== undefined) {
        out.minPixelValue = minPixelValue;
    }
    const legacyProps = strings(raw.prop_white_list);
    const propList = strings(raw.propList) ?? (legacyProps && (legacyProps.length ? legacyProps : ['*']));
    if (propList) {
        out.propList = propList;
    }
    const selectors = strings(raw.selectorBlackList ?? raw.selector_black_list);
    if (selectors) {
        out.selectorBlackList = selectors;
    }
    const mediaQuery = raw.mediaQuery ?? raw.media_query;
    if (typeof mediaQuery === 'boolean') {
        out.mediaQuery = mediaQuery;
    }
    return out;
}

/**
 * Finds postcss-pxtorem (or `@minko-fe/postcss-pxtorem`) options in a
 * PostCSS config (postcss.config.js/.cjs/.mjs/.ts, .postcssrc(.json/.js),
 * package.json `"postcss"`, or a Vite config) without running it: the literal
 * object after `'postcss-pxtorem': `, `['postcss-pxtorem', `,
 * `require('postcss-pxtorem')(` or a call of the imported plugin
 * (`pxtorem(`). Non-literal values (functions, variables) are left out.
 * Returns undefined when the plugin is not configured.
 */
export function parsePostcssPxToRem(text: string, file: string): PostcssPxToRem | undefined {
    const code = maskJs(text, true);
    interface Hit {
        index: number;
        module: string;
        options?: Record<string, unknown>;
    }
    const hits: Hit[] = [];
    const reader = (at: number) => new LiteralReader(text, at);

    // `'postcss-pxtorem': { … }` in object-style plugin lists and JSON configs.
    for (const m of code.matchAll(new RegExp(String.raw`(['"])(${PXTOREM_MODULE})\1\s*:`, 'g'))) {
        const value = reader(m.index + m[0].length).value();
        if (isRecord(value) || value === true) {
            hits.push({ index: m.index, module: m[2], options: isRecord(value) ? value : undefined });
        }
    }
    // `['postcss-pxtorem', { … }]`
    for (const m of code.matchAll(new RegExp(String.raw`\[\s*(['"])(${PXTOREM_MODULE})\1\s*([,\]])`, 'g'))) {
        const value = m[3] === ',' ? reader(m.index + m[0].length).value() : undefined;
        if (m[3] === ']' || isRecord(value)) {
            hits.push({ index: m.index, module: m[2], options: isRecord(value) ? value : undefined });
        }
    }
    const callAt = (index: number, at: number, module: string) => {
        const r = reader(at);
        if (r.peek() === ')') {
            hits.push({ index, module });
            return;
        }
        const value = r.value();
        if (isRecord(value)) {
            hits.push({ index, module, options: value });
        } else if (r.peek() === ')') {
            hits.push({ index, module });
        }
    };
    // `require('postcss-pxtorem')({ … })`
    for (const m of code.matchAll(new RegExp(String.raw`require\(\s*(['"])(${PXTOREM_MODULE})\1\s*\)\s*\(`, 'g'))) {
        callAt(m.index, m.index + m[0].length, m[2]);
    }
    // Calls of the imported plugin: `import pxtorem from 'postcss-pxtorem'` … `pxtorem({ … })`.
    const bindings = new Map<string, string>();
    const bindingPatterns = [
        new RegExp(String.raw`import\s+(?:\*\s+as\s+)?(${JS_ID})\s+from\s*(['"])([^'"]+)\2`, 'g'),
        new RegExp(String.raw`(?:const|let|var)\s+(${JS_ID})\s*=\s*(?:require|await\s+import)\(\s*(['"])([^'"]+)\2\s*\)(?!\s*\()`, 'g'),
    ];
    let imported: Hit | undefined;
    for (const re of bindingPatterns) {
        for (const m of code.matchAll(re)) {
            bindings.set(m[1], m[3]);
            if (!imported && new RegExp(`^${PXTOREM_MODULE}$`).test(m[3])) {
                imported = { index: m.index, module: m[3] };
            }
        }
    }
    const callees = [...bindings].filter(([, module]) => new RegExp(`^${PXTOREM_MODULE}$`).test(module)).map(([id, module]) => ({ id, module }));
    if (!bindings.has('pxtorem')) {
        callees.push({ id: 'pxtorem', module: 'postcss-pxtorem' });
    }
    for (const { id, module } of callees) {
        for (const m of code.matchAll(new RegExp(String.raw`(?<![\w$.])${escapeRegExp(id)}\s*\(`, 'g'))) {
            if (!/function\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) {
                callAt(m.index, m.index + m[0].length, module);
            }
        }
    }
    if (!hits.length && imported) {
        hits.push(imported);
    }
    if (!hits.length) {
        return undefined;
    }
    hits.sort((a, b) => a.index - b.index);
    const hit = hits[0];
    const line = new LineIndex(text).lineAt(hit.index);
    const result = pxToRemOptions(hit.options, { file, line, description: hit.module });
    if (result.rootValue !== undefined) {
        result.source.description = `${hit.module} rootValue`;
    }
    return result;
}

// ---------------------------------------------------------------------------
// package.json
// ---------------------------------------------------------------------------

export interface PackageFacts {
    tailwindVersion?: 3 | 4;
    reactNative: boolean;
    postcssPxToRem: boolean;
    styledComponents: boolean;
}

/** Packages that only exist for Tailwind v4. */
const TAILWIND_V4_PACKAGES = ['@tailwindcss/postcss', '@tailwindcss/vite', '@tailwindcss/cli', '@tailwindcss/node', '@tailwindcss/webpack'];
/** CSS-in-JS libraries with styled-components-style template literals. */
const CSS_IN_JS_PACKAGES = ['styled-components', '@emotion/styled', '@emotion/react', '@emotion/css', '@linaria/core', '@linaria/react', 'goober'];

/** Tailwind major version from a dependency range: `^3.4.1` → 3, `4.1`/`latest`/unknown → 4. */
function tailwindMajor(range: string): 3 | 4 {
    const m = /(\d+)(?:[.\sx*]|$)/.exec(range.replace(/^npm:(?:@[^/]+\/)?[^@]+@/, ''));
    return m && Number(m[1]) <= 3 ? 3 : 4;
}

/**
 * Facts from package.json (dependencies, devDependencies, peerDependencies,
 * optionalDependencies): Tailwind major version, React Native (`react-native`
 * or `expo`), postcss-pxtorem (a dependency or a `"postcss"` config entry) and
 * CSS-in-JS template libraries (styled-components, emotion, linaria, goober).
 * Undefined for invalid JSON.
 */
export function readPackageJson(text: string): PackageFacts | undefined {
    let json: unknown;
    try {
        json = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
        return undefined;
    }
    if (!isRecord(json)) {
        return undefined;
    }
    const deps = new Map<string, string>();
    for (const section of ['optionalDependencies', 'peerDependencies', 'devDependencies', 'dependencies']) {
        const entries = json[section];
        if (isRecord(entries)) {
            for (const [name, range] of Object.entries(entries)) {
                deps.set(name, typeof range === 'string' ? range : '');
            }
        }
    }
    const has = (name: string) => deps.has(name);
    const facts: PackageFacts = {
        reactNative: has('react-native') || has('expo'),
        postcssPxToRem:
            has('postcss-pxtorem') || has('@minko-fe/postcss-pxtorem') || (isRecord(json.postcss) && parsePostcssPxToRem(JSON.stringify(json.postcss), 'package.json') !== undefined),
        styledComponents: CSS_IN_JS_PACKAGES.some(has),
    };
    if (has('tailwindcss')) {
        facts.tailwindVersion = tailwindMajor(deps.get('tailwindcss') ?? '');
    } else if (TAILWIND_V4_PACKAGES.some(has)) {
        facts.tailwindVersion = 4;
    }
    return facts;
}

// ---------------------------------------------------------------------------
// Tailwind
// ---------------------------------------------------------------------------

/** Tailwind scales are rem based: express a theme length in px at a 16px root. */
function tailwindPx(value: string, rootFontSize: number): number | undefined {
    const length = parseSingleLength(value);
    switch (length?.unit) {
        case 'rem':
            return length.value * 16;
        case 'px':
            return (length.value * 16) / rootFontSize;
        case '':
            return length.value === 0 ? 0 : undefined;
        default:
            return undefined;
    }
}

const TAILWIND_IMPORT = /^@import\s+(?:url\(\s*)?(['"])tailwindcss(?:\/[^'"]*)?\1/;
/** At-rules that only Tailwind v4 understands. */
const TAILWIND_V4_AT_RULES = new Set(['theme', 'plugin', 'source', 'utility', 'custom-variant']);

/**
 * Tailwind in a stylesheet: `@import "tailwindcss"` or v4 directives (v4),
 * `@tailwind base` (v3), `@config`. Reads the v4 `@theme` blocks:
 * `--spacing` → `spacingPx`, `--spacing-NAME` → `spacing`, `--text-NAME` →
 * `fontSizes`. Values are px at a 16px root (see `TailwindConfig`): rem × 16,
 * px × 16 / `rootFontSize`.
 */
export function readTailwindCss(doc: ParsedDocument, rootFontSize: number): { present: boolean; config: Partial<TailwindConfig> } {
    let v3 = false;
    let v4 = false;
    let present = false;
    for (const region of doc.regions) {
        if (region.syntax === 'less' || region.kind === 'js-object' || region.kind === 'tailwind' || region.kind === 'style-attribute') {
            continue;
        }
        for (const stmt of region.stylesheet.statements) {
            if (stmt.kind !== 'at-statement') {
                continue;
            }
            if (stmt.name === 'import' && TAILWIND_IMPORT.test(doc.text.slice(stmt.start, stmt.end))) {
                present = v4 = true;
            } else if (stmt.name === 'tailwind') {
                present = v3 = true;
            } else if (stmt.name === 'config') {
                present = true;
            } else if (stmt.name !== undefined && TAILWIND_V4_AT_RULES.has(stmt.name)) {
                present = v4 = true;
            }
        }
        for (const block of region.stylesheet.blocks) {
            if (block.kind === 'atrule' && block.name !== undefined && TAILWIND_V4_AT_RULES.has(block.name)) {
                present = v4 = true;
            }
        }
    }

    const config: Partial<TailwindConfig> = {};
    const spacing: Record<string, number> = {};
    const fontSizes: Record<string, number> = {};
    for (const block of doc.blocks) {
        if (block.kind !== 'atrule' || block.name !== 'theme') {
            continue;
        }
        for (const decl of block.declarations) {
            if (decl.variable?.flavor !== 'css') {
                continue;
            }
            const name = decl.variable.name;
            const px = tailwindPx(doc.text.slice(decl.valueSpan.start, decl.valueSpan.end), rootFontSize);
            if (px === undefined) {
                continue;
            }
            const scale = /^--(spacing|text)(?:-(.+))?$/.exec(name);
            if (!scale || scale[2]?.includes('--')) {
                continue;
            }
            if (scale[1] === 'spacing') {
                if (scale[2] === undefined) {
                    config.spacingPx = px;
                } else {
                    spacing[scale[2]] = px;
                }
            } else if (scale[2] !== undefined) {
                fontSizes[scale[2]] = px;
            }
        }
    }
    if (Object.keys(spacing).length) {
        config.spacing = spacing;
    }
    if (Object.keys(fontSizes).length) {
        config.fontSizes = fontSizes;
    }
    if (v4) {
        config.version = 4;
    } else if (v3) {
        config.version = 3;
    }
    return { present, config };
}

/** Named lengths from a literal theme scale (`{ 18: '4.5rem', sm: ['0.875rem', { lineHeight: … }] }`). */
function themeScale(value: unknown, rootFontSize: number): Record<string, number> {
    const out: Record<string, number> = {};
    if (!isRecord(value)) {
        return out;
    }
    for (const [key, entry] of Object.entries(value)) {
        const first = Array.isArray(entry) ? entry[0] : entry;
        const px = typeof first === 'string' ? tailwindPx(first, rootFontSize) : first === 0 ? 0 : undefined;
        if (px !== undefined) {
            out[key] = px;
        }
    }
    return out;
}

/**
 * Tailwind v3 JS/TS config, best effort without executing it: literal
 * `spacing` and `fontSize` objects in `theme` and `theme.extend` (font sizes
 * may be `['1rem', { … }]` / `['1rem', '1.5rem']` tuples). Values are px at a
 * 16px root: rem × 16, px × 16 / `rootFontSize`.
 */
export function readTailwindConfigJs(text: string, rootFontSize: number): Partial<TailwindConfig> {
    const code = maskJs(text, false);
    for (const m of code.matchAll(/(?<![\w$.])theme\s*:/g)) {
        const theme = new LiteralReader(text, m.index + m[0].length).value();
        if (!isRecord(theme)) {
            continue;
        }
        const extend = isRecord(theme.extend) ? theme.extend : {};
        const config: Partial<TailwindConfig> = {};
        const spacing = { ...themeScale(theme.spacing, rootFontSize), ...themeScale(extend.spacing, rootFontSize) };
        const fontSizes = { ...themeScale(theme.fontSize, rootFontSize), ...themeScale(extend.fontSize, rootFontSize) };
        if (Object.keys(spacing).length) {
            config.spacing = spacing;
        }
        if (Object.keys(fontSizes).length) {
            config.fontSizes = fontSizes;
        }
        return config;
    }
    return {};
}
