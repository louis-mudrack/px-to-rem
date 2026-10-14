import { collectDirectives, isDisabled, type Directives } from './directives';
import { parseStylesheet, type BlockNode, type DeclarationNode, type ParsedStylesheet } from './parser';
import { LENGTH_UNITS } from './properties';
import { extractRegions, type ExtractOptions, type RegionSpec } from './regions';
import { hostForLanguage, type HostInfo } from './syntax';
import { findTailwindClasses } from './tailwind';
import { tokenize, type Token } from './tokenizer';
import { LineIndex, type Span } from './text';

/** Where a length appears. */
export type LengthContext =
    | 'declaration'
    | 'variable'
    | 'custom-property'
    | 'media'
    | 'container'
    | 'supports'
    | 'mixin'
    | 'breakpoint-mixin'
    | 'selector'
    | 'control'
    | 'other';

export interface Region extends RegionSpec {
    stylesheet: ParsedStylesheet;
}

/** A length such as `16px`, `1.5rem` or `-4px`. */
export interface LengthNode extends Span {
    value: number;
    /** Lowercase unit (`px`, `rem`, `%`, …). */
    unit: string;
    /** Unit as written (to detect the uppercase `PX` opt-out). */
    rawUnit: string;
    numberSpan: Span;
    context: LengthContext;
    decl?: DeclarationNode;
    /** Innermost enclosing block (rule, at-rule or root). */
    block: BlockNode;
    /** Enclosing function names, innermost last (`calc`, `clamp`, `var`, `math.div`, …). */
    functions: string[];
    /** Inside Sass/Less interpolation. */
    inInterpolation: boolean;
    region: Region;
    /** At-rule or mixin name for media/mixin contexts. */
    contextName?: string;
    /** For the line-height part of a `font` shorthand: the font-size length before the slash. */
    shorthandFontSize?: LengthNode;
    /** A JS number that React treats as px; replacements must be quoted. */
    implicitPx?: boolean;
    /** Disabled by a directive comment. */
    disabled: boolean;
    line: number;
}

/** A function call such as `rem(16)`, `clamp(…)` or `var(--x)`. */
export interface FunctionCallNode extends Span {
    /** Lowercase name, with namespace (`math.div`). */
    name: string;
    nameSpan: Span;
    /** Between the parentheses. */
    argsSpan: Span;
    /** Top-level arguments (trimmed). */
    args: Span[];
    context: LengthContext;
    decl?: DeclarationNode;
    block: BlockNode;
    functions: string[];
    /** Inside Sass/Less interpolation. */
    inInterpolation: boolean;
    /** Set when the call is the whole content of `#{…}`: the interpolation span. */
    interpolation?: Span;
    region: Region;
    line: number;
}

/** A literal colour (`#3b82f6`, `rgb(…)`, `hsl(…)`). */
export interface ColorNode extends Span {
    rgba: [number, number, number, number];
    context: LengthContext;
    decl?: DeclarationNode;
    block: BlockNode;
    region: Region;
    disabled: boolean;
    line: number;
}

export interface ParsedDocument {
    text: string;
    languageId: string;
    host: HostInfo | undefined;
    lines: LineIndex;
    regions: Region[];
    lengths: LengthNode[];
    functions: FunctionCallNode[];
    colors: ColorNode[];
    declarations: DeclarationNode[];
    blocks: BlockNode[];
    directives: Directives;
}

export type ParseDocumentOptions = ExtractOptions;

/** Parses a document of any supported language into lengths, functions and rule trees. */
export function parseDocument(text: string, languageId: string, options: ParseDocumentOptions = {}): ParsedDocument {
    const lines = new LineIndex(text);
    const host = hostForLanguage(languageId);
    const extracted = extractRegions(text, languageId, options);
    const doc: ParsedDocument = {
        text,
        languageId,
        host,
        lines,
        regions: [],
        lengths: [],
        functions: [],
        colors: [],
        declarations: [],
        blocks: [],
        directives: { fileDisabled: false, lines: new Set(), ranges: [] },
    };

    const comments: Span[] = [...extracted.comments];
    for (const spec of extracted.regions) {
        const stylesheet =
            spec.kind === 'js-object' || spec.kind === 'tailwind'
                ? parseValue(text, spec)
                : parseStylesheet(text, spec.start, spec.end, {
                      syntax: spec.syntax,
                      jsTemplate: spec.jsTemplate,
                      declarationList: spec.declarationList,
                  });
        const region: Region = { ...spec, stylesheet };
        doc.regions.push(region);
        doc.declarations.push(...stylesheet.declarations);
        doc.blocks.push(...stylesheet.blocks);
        comments.push(...stylesheet.comments);
        extractValues(text, lines, region, doc);
    }

    // @apply in stylesheets holds Tailwind classes.
    if (options.tailwind) {
        addApplyRegions(text, lines, doc);
    }

    doc.directives = collectDirectives(text, comments, lines);
    for (const length of doc.lengths) {
        length.disabled = isDisabled(doc.directives, length.start, length.line);
    }
    for (const color of doc.colors) {
        color.disabled = isDisabled(doc.directives, color.start, color.line);
    }
    doc.lengths.sort((a, b) => a.start - b.start);
    doc.functions.sort((a, b) => a.start - b.start);
    doc.colors.sort((a, b) => a.start - b.start);
    return doc;
}

function addApplyRegions(text: string, lines: LineIndex, doc: ParsedDocument): void {
    const applyRegions: Region[] = [];
    for (const region of doc.regions) {
        for (const stmt of region.stylesheet.statements) {
            if (stmt.kind !== 'at-statement' || stmt.name !== 'apply') {
                continue;
            }
            const [from, to] = stmt.argTokens;
            if (from >= to) {
                continue;
            }
            const tokens = region.stylesheet.tokens;
            for (const spec of findApplyClasses(text, tokens[from].start, tokens[to - 1].end)) {
                const stylesheet = parseValue(text, spec);
                const r: Region = { ...spec, stylesheet };
                applyRegions.push(r);
                extractValues(text, lines, r, doc);
            }
        }
    }
    doc.regions.push(...applyRegions);
}

function findApplyClasses(text: string, start: number, end: number): RegionSpec[] {
    return findTailwindClasses(text, start, end).map(cls => ({
        kind: 'tailwind',
        start: cls.valueStart,
        end: cls.valueEnd,
        syntax: 'css',
        property: cls.property,
        tailwind: cls,
    }));
}

/** Parses a single value (JS object value, Tailwind arbitrary value) as a declaration of `spec.property`. */
function parseValue(text: string, spec: RegionSpec): ParsedStylesheet {
    const tokens = tokenize(text, spec.start, spec.end, { syntax: 'css', underscoreIsSpace: spec.kind === 'tailwind' });
    const significantTokens = tokens.filter(t => t.type !== 'ws' && t.type !== 'comment');
    if (spec.implicitPx && significantTokens.length === 1 && significantTokens[0].type === 'number') {
        // `fontSize: 16` — treat the number as px.
        const t = significantTokens[0];
        significantTokens[0] = { ...t, type: 'dimension', unitStart: t.end, unit: 'px' };
    }
    const root: BlockNode = {
        kind: 'root',
        start: spec.start,
        end: spec.end,
        body: { start: spec.start, end: spec.end },
        children: [],
        declarations: [],
        preludeTokens: [0, 0],
        syntax: 'css',
    };
    const decl: DeclarationNode = {
        kind: 'declaration',
        parent: root,
        start: spec.start,
        end: spec.end,
        property: spec.property ?? '',
        propertySpan: { start: spec.start, end: spec.start },
        valueSpan: { start: spec.start, end: spec.end },
        valueTokens: [0, significantTokens.length],
        important: false,
        variable: spec.property?.startsWith('--') ? { name: spec.property, flavor: 'css' } : undefined,
    };
    root.children.push(decl);
    root.declarations.push(decl);
    return {
        root,
        tokens: significantTokens,
        comments: [],
        blocks: [],
        declarations: [decl],
        statements: [],
    };
}

const CONTROL_AT_RULES = new Set([
    'if', 'else', 'each', 'for', 'while', 'function', 'mixin', 'return', 'use', 'forward', 'import', 'at-root',
    'debug', 'warn', 'error', 'extend', 'content', 'charset', 'namespace', 'layer', 'property', 'font-face',
    'keyframes', '-webkit-keyframes', 'page', 'scope', 'starting-style', 'document', 'plugin', 'apply', 'tailwind',
    'config', 'theme', 'source', 'utility', 'variant', 'custom-variant', 'reference',
]);

const BREAKPOINT_MIXIN =
    /^(mq|media|media-query|breakpoint|breakpoint-(up|down|only|between)|media-breakpoint-(up|down|only|between)|respond|respond-(to|above|below|from|until)|bp|screen|from|until|above|below|min-width|max-width|min-screen|max-screen|tablet|desktop|mobile|phone|laptop)$/i;

function mixinName(text: string, tokens: Token[], from: number, to: number): string | undefined {
    for (let i = from; i < to; i++) {
        const t = tokens[i];
        if (t.type === 'ident' || t.type === 'function') {
            return text.slice(t.start, t.end);
        }
    }
    return undefined;
}

function insideFunctionDefinition(block: BlockNode | undefined): boolean {
    for (let b = block; b; b = b.parent) {
        if (b.kind === 'atrule' && (b.name === 'function' || b.name === 'return')) {
            return true;
        }
    }
    return false;
}

function declarationContext(decl: DeclarationNode): LengthContext {
    if (insideFunctionDefinition(decl.parent)) {
        return 'control';
    }
    if (decl.variable) {
        return decl.variable.flavor === 'css' ? 'custom-property' : 'variable';
    }
    return 'declaration';
}

interface ScanContext {
    context: LengthContext;
    contextName?: string;
    decl?: DeclarationNode;
    block: BlockNode;
}

function extractValues(text: string, lines: LineIndex, region: Region, doc: ParsedDocument): void {
    const ss = region.stylesheet;
    for (const decl of ss.declarations) {
        scanTokens(text, lines, region, ss.tokens, decl.valueTokens[0], decl.valueTokens[1], { context: declarationContext(decl), decl, block: decl.parent }, doc);
    }
    for (const block of ss.blocks) {
        if (block.kind !== 'atrule') {
            continue;
        }
        const name = block.name ?? '';
        let context: LengthContext = 'control';
        let contextName: string | undefined = name;
        if (insideFunctionDefinition(block.parent)) {
            context = 'control';
        } else if (name === 'media' || name === 'custom-media') {
            context = 'media';
        } else if (name === 'container') {
            context = 'container';
        } else if (name === 'supports') {
            context = 'supports';
        } else if (name === 'include') {
            contextName = mixinName(text, ss.tokens, block.preludeTokens[0], block.preludeTokens[1]);
            context = contextName && BREAKPOINT_MIXIN.test(contextName) ? 'breakpoint-mixin' : 'mixin';
        } else if (!CONTROL_AT_RULES.has(name)) {
            context = 'other';
        }
        scanTokens(text, lines, region, ss.tokens, block.preludeTokens[0], block.preludeTokens[1], { context, contextName, block }, doc);
    }
    for (const stmt of ss.statements) {
        if (stmt.kind === 'at-statement' && stmt.name === 'apply') {
            // Tailwind classes; handled as their own regions.
            continue;
        }
        let context: LengthContext = 'other';
        let contextName = stmt.name;
        if (insideFunctionDefinition(stmt.parent)) {
            context = 'control';
        } else if (stmt.kind === 'mixin-call' || (stmt.kind === 'at-statement' && stmt.name === 'include')) {
            contextName = stmt.kind === 'mixin-call' ? stmt.name : mixinName(text, ss.tokens, stmt.argTokens[0], stmt.argTokens[1]);
            context = contextName && BREAKPOINT_MIXIN.test(contextName.replace(/^[.#]/, '')) ? 'breakpoint-mixin' : 'mixin';
        } else if (stmt.kind === 'at-statement') {
            context = stmt.name === 'custom-media' ? 'media' : 'control';
        }
        scanTokens(text, lines, region, ss.tokens, stmt.argTokens[0], stmt.argTokens[1], { context, contextName, block: stmt.parent }, doc);
    }
}

interface Frame {
    name: string;
    call?: FunctionCallNode;
    argStart: number;
}

function scanTokens(
    text: string,
    lines: LineIndex,
    region: Region,
    tokens: Token[],
    from: number,
    to: number,
    ctx: ScanContext,
    doc: ParsedDocument,
): void {
    const frames: Frame[] = [];
    const interpStack: { tokenIndex: number; callsBefore: number }[] = [];
    const isFont = ctx.decl?.property === 'font';
    let lastFontLength: LengthNode | undefined;

    const fnNames = () => frames.map(f => f.name).filter(Boolean);

    for (let i = from; i < to; i++) {
        const t = tokens[i];
        switch (t.type) {
            case 'function': {
                if (tokens[i + 1]?.type !== '(') {
                    break;
                }
                let name = text.slice(t.start, t.end).toLowerCase();
                let nameStart = t.start;
                const dot = tokens[i - 1];
                const ns = tokens[i - 2];
                if (i - 2 >= from && dot.type === 'delim' && text[dot.start] === '.' && ns.type === 'ident' && ns.end === dot.start && dot.end === t.start) {
                    name = `${text.slice(ns.start, ns.end).toLowerCase()}.${name}`;
                    nameStart = ns.start;
                }
                const open = tokens[i + 1];
                const call: FunctionCallNode = {
                    name,
                    start: nameStart,
                    end: open.end,
                    nameSpan: { start: nameStart, end: t.end },
                    argsSpan: { start: open.end, end: open.end },
                    args: [],
                    context: ctx.context,
                    decl: ctx.decl,
                    block: ctx.block,
                    functions: fnNames(),
                    inInterpolation: interpStack.length > 0,
                    region,
                    line: lines.lineAt(nameStart),
                };
                frames.push({ name, call, argStart: i + 2 });
                doc.functions.push(call);
                i++;
                break;
            }
            case '(':
            case '[':
                frames.push({ name: '', argStart: i + 1 });
                break;
            case ',': {
                const top = frames[frames.length - 1];
                if (top?.call && i > top.argStart) {
                    top.call.args.push({ start: tokens[top.argStart].start, end: tokens[i - 1].end });
                }
                if (top) {
                    top.argStart = i + 1;
                }
                break;
            }
            case ')':
            case ']': {
                const top = frames.pop();
                if (top?.call) {
                    top.call.end = t.end;
                    top.call.argsSpan.end = t.start;
                    if (i > top.argStart) {
                        top.call.args.push({ start: tokens[top.argStart].start, end: tokens[i - 1].end });
                    }
                }
                break;
            }
            case 'interp-open':
                interpStack.push({ tokenIndex: i, callsBefore: doc.functions.length });
                break;
            case 'interp-close': {
                const open = interpStack.pop();
                if (open) {
                    // `#{rem(16)}`: exactly one top-level call fills the interpolation.
                    const inner = doc.functions.slice(open.callsBefore);
                    const first = inner[0];
                    if (first && tokens[open.tokenIndex + 1]?.start === first.start && tokens[i - 1]?.end === first.end) {
                        first.interpolation = { start: tokens[open.tokenIndex].start, end: t.end };
                    }
                }
                break;
            }
            case 'dimension':
            case 'percentage': {
                const rawUnit = t.unit ?? '';
                const unit = rawUnit.toLowerCase();
                if (unit !== '%' && !LENGTH_UNITS.has(unit)) {
                    break;
                }
                const length: LengthNode = {
                    start: t.start,
                    end: t.end,
                    value: t.num ?? 0,
                    unit,
                    rawUnit,
                    numberSpan: { start: t.start, end: t.unitStart ?? t.end },
                    context: ctx.context,
                    contextName: ctx.contextName,
                    decl: ctx.decl,
                    block: ctx.block,
                    functions: fnNames(),
                    inInterpolation: interpStack.length > 0,
                    region,
                    implicitPx: region.implicitPx && t.unitStart === t.end,
                    disabled: false,
                    line: lines.lineAt(t.start),
                };
                if (isFont && frames.length === 0) {
                    const prev = tokens[i - 1];
                    if (lastFontLength && prev && prev.type === 'delim' && text[prev.start] === '/' && tokens[i - 2]?.end === lastFontLength.end) {
                        length.shorthandFontSize = lastFontLength;
                    }
                    lastFontLength = length;
                }
                doc.lengths.push(length);
                break;
            }
            case 'hash': {
                if (ctx.context === 'declaration' || ctx.context === 'variable' || ctx.context === 'custom-property') {
                    const rgba = parseHex(text.slice(t.start + 1, t.end));
                    if (rgba) {
                        doc.colors.push({ start: t.start, end: t.end, rgba, context: ctx.context, decl: ctx.decl, block: ctx.block, region, disabled: false, line: lines.lineAt(t.start) });
                    }
                }
                break;
            }
        }
    }

    // Function-call colours: rgb(), rgba(), hsl(), hsla().
    if (ctx.context === 'declaration' || ctx.context === 'variable' || ctx.context === 'custom-property') {
        for (const call of doc.functions) {
            if (call.decl !== ctx.decl || call.region !== region || !/^(rgba?|hsla?)$/.test(call.name)) {
                continue;
            }
            if (doc.colors.some(c => c.start === call.start)) {
                continue;
            }
            const rgba = parseColorFunction(call.name, text.slice(call.argsSpan.start, call.argsSpan.end));
            if (rgba) {
                doc.colors.push({ start: call.start, end: call.end, rgba, context: ctx.context, decl: ctx.decl, block: ctx.block, region, disabled: false, line: call.line });
            }
        }
    }
}

export function parseHex(hex: string): [number, number, number, number] | undefined {
    if (!/^[0-9a-f]+$/i.test(hex)) {
        return undefined;
    }
    if (hex.length === 3 || hex.length === 4) {
        const [r, g, b, a = 'f'] = hex.split('');
        return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    if (hex.length === 6 || hex.length === 8) {
        return [
            parseInt(hex.slice(0, 2), 16),
            parseInt(hex.slice(2, 4), 16),
            parseInt(hex.slice(4, 6), 16),
            hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
        ];
    }
    return undefined;
}

export function parseColorFunction(name: string, args: string): [number, number, number, number] | undefined {
    const parts = args
        .replace(/\//g, ' ')
        .split(/[\s,]+/)
        .filter(Boolean);
    if (parts.length < 3 || parts.length > 4) {
        return undefined;
    }
    const num = (s: string, scale: number): number | undefined => {
        if (/^-?[\d.]+%$/.test(s)) {
            return (parseFloat(s) / 100) * scale;
        }
        if (/^-?[\d.]+(deg)?$/.test(s)) {
            return parseFloat(s);
        }
        return undefined;
    };
    if (name.startsWith('rgb')) {
        const r = num(parts[0], 255);
        const g = num(parts[1], 255);
        const b = num(parts[2], 255);
        const a = parts[3] !== undefined ? num(parts[3], 1) : 1;
        if ([r, g, b, a].some(v => v === undefined)) {
            return undefined;
        }
        return [r!, g!, b!, a!];
    }
    const h = num(parts[0], 360);
    const s = num(parts[1], 1);
    const l = num(parts[2], 1);
    const a = parts[3] !== undefined ? num(parts[3], 1) : 1;
    if ([h, s, l, a].some(v => v === undefined) || !parts[1].endsWith('%') || !parts[2].endsWith('%')) {
        return undefined;
    }
    return [...hslToRgb(h!, s!, l!), a!];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Whether a length may be rewritten at all (ignores strategy and filters). */
export function isEditableContext(context: LengthContext): boolean {
    return context === 'declaration' || context === 'variable' || context === 'custom-property' || context === 'media' || context === 'container' || context === 'mixin';
}
