/**
 * Design-token extraction: CSS custom properties, Sass/Less/Stylus variables
 * and Sass maps from parsed stylesheets, and W3C DTCG, Tokens Studio and Style
 * Dictionary JSON files.
 */
import { parseColorFunction, parseHex, type ParsedDocument, type Region } from '../document';
import type { Options } from '../options';
import type { BlockNode, VariableFlavor } from '../parser';
import { categoryForName, escapeRegExp, type Category } from '../properties';
import { LineIndex } from '../text';
import type { TokenDef, TokenKind } from './index';

type RGBA = [number, number, number, number];

/** A resolved token value: a length in px or a colour. */
interface Resolved {
    px?: number;
    color?: RGBA;
    /** A bare `0`: only a length when the name says so. */
    unitless?: boolean;
}

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const SINGLE_LENGTH = new RegExp(`^(${NUMBER})([a-z%]*)$`, 'i');

/** Parses a single number with an optional unit (`16px`, `1.5rem`, `62.5%`, `0`). The unit is lowercased, `''` when absent. */
export function parseSingleLength(text: string): { value: number; unit: string } | undefined {
    const m = SINGLE_LENGTH.exec(text.trim());
    if (!m) {
        return undefined;
    }
    const value = Number(m[1]);
    return Number.isFinite(value) ? { value, unit: m[2].toLowerCase() } : undefined;
}

/** A length that tokens can hold: px, or rem converted at `rootFontSize`. */
function lengthPx(text: string, rootFontSize: number): Resolved | undefined {
    const length = parseSingleLength(text);
    if (!length) {
        return undefined;
    }
    switch (length.unit) {
        case 'px':
            return { px: length.value };
        case 'rem':
            return { px: length.value * rootFontSize };
        case '':
            return length.value === 0 ? { px: 0, unitless: true } : undefined;
        default:
            return undefined;
    }
}

// The 148 CSS named colours, as `name:rrggbb` pairs.
const NAMED_COLOR_DATA =
    'aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 black:000000 ' +
    'blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 cadetblue:5f9ea0 chartreuse:7fff00 ' +
    'chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc crimson:dc143c cyan:00ffff darkblue:00008b ' +
    'darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b ' +
    'darkolivegreen:556b2f darkorange:ff8c00 darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f ' +
    'darkslateblue:483d8b darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 ' +
    'deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 forestgreen:228b22 ' +
    'fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 green:008000 greenyellow:adff2f ' +
    'grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 ivory:fffff0 khaki:f0e68c lavender:e6e6fa ' +
    'lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff ' +
    'lightgoldenrodyellow:fafad2 lightgray:d3d3d3 lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a ' +
    'lightseagreen:20b2aa lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 ' +
    'lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa mediumblue:0000cd ' +
    'mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee mediumspringgreen:00fa9a ' +
    'mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa mistyrose:ffe4e1 moccasin:ffe4b5 ' +
    'navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 orange:ffa500 orangered:ff4500 orchid:da70d6 ' +
    'palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 ' +
    'peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f ' +
    'royalblue:4169e1 saddlebrown:8b4513 salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d ' +
    'silver:c0c0c0 skyblue:87ceeb slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f ' +
    'steelblue:4682b4 tan:d2b48c teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 ' +
    'white:ffffff whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32';

let namedColors: Map<string, string> | undefined;

function namedColor(name: string): RGBA | undefined {
    if (!namedColors) {
        namedColors = new Map(NAMED_COLOR_DATA.split(' ').map(pair => pair.split(':') as [string, string]));
    }
    const hex = namedColors.get(name.toLowerCase());
    return hex ? parseHex(hex) : undefined;
}

/** `#3b82f6`, `rgb(…)`, `rgba(…)`, `hsl(…)`, `hsla(…)` or a named colour. */
function parseColorValue(text: string): RGBA | undefined {
    const value = text.trim();
    if (value.startsWith('#')) {
        return parseHex(value.slice(1));
    }
    const fn = /^(rgba?|hsla?)\(([^()]*)\)$/i.exec(value);
    if (fn) {
        return parseColorFunction(fn[1].toLowerCase(), fn[2]);
    }
    return /^[a-z]+$/i.test(value) ? namedColor(value) : undefined;
}

// ---------------------------------------------------------------------------
// Stylesheets
// ---------------------------------------------------------------------------

const ROOT_BASE = String.raw`(?::root|html|:host(?:\([^()]*\))?)`;
const THEME_SCOPE = String.raw`(?:\[data-[\w-]*(?:theme|mode|scheme)[\w-]*(?:[~|^$*]?=[^\]]*)?\]|\.(?:dark|light|theme-[\w-]+|[\w-]+-theme))`;
const SELECTOR_MODIFIER = String.raw`(?:\[[^\]]*\]|\.[\w-]+|:[\w-]+(?:\([^()]*\))?)`;
/** `:root`, `html`, `:host`, `[data-theme="dark"]`, `:root.dark`, `html[data-mode=x]`, … */
const ROOT_SELECTOR_PART = new RegExp(`^(?:${ROOT_BASE}|${THEME_SCOPE})${SELECTOR_MODIFIER}*$`, 'i');

/** Whether custom properties declared directly in `block` are global design tokens. */
function definesGlobalProperties(block: BlockNode): boolean {
    if (block.kind === 'root') {
        return true;
    }
    if (block.kind === 'atrule') {
        // Tailwind v4 `@theme { … }`.
        return block.name === 'theme';
    }
    if (block.kind !== 'rule' || !block.selector) {
        return false;
    }
    for (let p = block.parent; p; p = p.parent) {
        if (p.kind === 'rule' || p.kind === 'nested-property') {
            return false;
        }
    }
    return block.selector.split(',').every(part => ROOT_SELECTOR_PART.test(part.trim()));
}

const TOKEN_KIND: Record<VariableFlavor, TokenKind> = { css: 'custom-property', scss: 'scss', less: 'less', stylus: 'stylus' };

interface Pending {
    name: string;
    reference: string;
    kind: TokenKind;
    flavor: VariableFlavor;
    rawValue: string;
    /** Name used to infer the category. */
    categoryName: string;
    line: number;
    /** Environment key this entry defines, if it can be referenced. */
    envKey?: string;
    resolved?: Resolved;
}

interface SheetContext {
    rootFontSize: number;
    remCall: RegExp;
    env: Map<string, Resolved>;
}

/** Sass treats `-` and `_` in names as the same character. */
function envKey(name: string, flavor: VariableFlavor): string {
    return flavor === 'scss' ? name.replace(/_/g, '-') : name;
}

function mapKey(mapName: string, keys: string[]): string {
    return `map:${mapName.replace(/_/g, '-')}:${keys.join('\u0000')}`;
}

function unquote(key: string): string {
    return /^(['"]).*\1$/s.test(key) ? key.slice(1, -1) : key;
}

/** Resolves a variable value written in a stylesheet. */
function resolveSheetValue(raw: string, flavor: VariableFlavor, ctx: SheetContext, depth = 0): Resolved | undefined {
    const value = raw.trim();
    if (!value || depth > 8) {
        return undefined;
    }
    // Sass values reach custom properties through interpolation: `--space-4: #{$space-4}`.
    const interpolation = /^#\{([\s\S]*)\}$/.exec(value);
    if (interpolation) {
        return resolveSheetValue(interpolation[1], 'scss', ctx, depth + 1);
    }
    // References to other variables.
    if (/^\$[\w-]+$/.test(value)) {
        return ctx.env.get(envKey(value, flavor === 'stylus' ? 'stylus' : 'scss'));
    }
    if (/^@[\w-]+$/.test(value)) {
        return ctx.env.get(value);
    }
    const cssVar = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value);
    if (cssVar) {
        const found = ctx.env.get(cssVar[1]);
        if (found) {
            return found;
        }
        return cssVar[2] !== undefined ? resolveSheetValue(cssVar[2], flavor, ctx, depth + 1) : undefined;
    }
    if (flavor === 'stylus' && /^[A-Za-z_][\w-]*$/.test(value) && ctx.env.has(value)) {
        return ctx.env.get(value);
    }
    const mapGet = /^(?:[\w-]+\.get|map-get|get)\(\s*(\$[\w-]+)\s*,\s*((['"]?)[\w-]+\3)\s*\)$/.exec(value);
    if (mapGet) {
        return ctx.env.get(mapKey(mapGet[1], [unquote(mapGet[2])]));
    }

    const length = lengthPx(value, ctx.rootFontSize);
    if (length) {
        return length;
    }
    const call = ctx.remCall.exec(value);
    if (call) {
        return { px: Number(call[1]) };
    }
    const color = parseColorValue(value);
    return color ? { color } : undefined;
}

/** Index of the first `ch` outside quotes and brackets, or -1. */
function indexOfTopLevel(text: string, ch: string, from = 0): number {
    let depth = 0;
    let quote = '';
    for (let i = from; i < text.length; i++) {
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
        } else if (c === '(' || c === '[' || c === '{') {
            depth++;
        } else if (c === ')' || c === ']' || c === '}') {
            depth--;
        } else if (c === ch && depth === 0) {
            return i;
        }
    }
    return -1;
}

/** Splits at top-level commas; returns the trimmed parts with their offsets. */
function splitTopLevel(text: string, offset: number): { text: string; start: number }[] {
    const parts: { text: string; start: number }[] = [];
    let from = 0;
    for (;;) {
        const comma = indexOfTopLevel(text, ',', from);
        const end = comma < 0 ? text.length : comma;
        const piece = text.slice(from, end);
        const lead = piece.length - piece.trimStart().length;
        if (piece.trim()) {
            parts.push({ text: piece.trim(), start: offset + from + lead });
        }
        if (comma < 0) {
            return parts;
        }
        from = comma + 1;
    }
}

/** The contents of `( … )` when the parentheses wrap the whole value. */
function parenthesized(value: string): string | undefined {
    if (!value.startsWith('(') || !value.endsWith(')')) {
        return undefined;
    }
    // The opening parenthesis must close at the very end: `(a) + (b)` is not wrapped.
    let depth = 0;
    let quote = '';
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (quote) {
            if (c === '\\') {
                i++;
            } else if (c === quote) {
                quote = '';
            }
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '(') {
            depth++;
        } else if (c === ')' && --depth === 0) {
            return i === value.length - 1 ? value.slice(1, -1) : undefined;
        }
    }
    return undefined;
}

interface MapEntry {
    /** Keys as written (quotes kept), outermost first. */
    keys: string[];
    value: string;
    start: number;
}

/** Entries of a Sass map literal (nested maps are flattened), or undefined if `value` is not a map. */
function sassMapEntries(value: string, offset: number, keys: string[] = []): MapEntry[] | undefined {
    const inner = parenthesized(value.trim());
    if (inner === undefined) {
        return undefined;
    }
    const innerOffset = offset + value.indexOf('(') + 1;
    const entries: MapEntry[] = [];
    const parts = splitTopLevel(inner, innerOffset);
    if (!parts.length) {
        return undefined;
    }
    for (const part of parts) {
        const colon = indexOfTopLevel(part.text, ':');
        if (colon <= 0) {
            return undefined;
        }
        const key = part.text.slice(0, colon).trim();
        const rest = part.text.slice(colon + 1);
        const entryValue = rest.trim();
        const valueStart = part.start + colon + 1 + (rest.length - rest.trimStart().length);
        const nested = sassMapEntries(entryValue, valueStart, [...keys, key]);
        if (nested) {
            entries.push(...nested);
        } else {
            entries.push({ keys: [...keys, key], value: entryValue, start: part.start });
        }
    }
    return entries;
}

/** How map entries are read: `map.get(…)` with `@use "sass:map"`, else `map-get(…)`. */
function sassMapReference(text: string): (map: string, keys: string[]) => string {
    const use = /@use\s+(['"])sass:map\1(?:\s+as\s+([\w-]+|\*))?/.exec(text);
    if (!use) {
        return (map, keys) => keys.reduce((acc, key) => `map-get(${acc}, ${key})`, map);
    }
    const fn = use[2] === '*' ? 'get' : `${use[2] ?? 'map'}.get`;
    return (map, keys) => `${fn}(${map}, ${keys.join(', ')})`;
}

function tokenRegion(region: Region): boolean {
    return region.kind === 'file' || region.kind === 'style-block' || region.kind === 'js-template';
}

/** Design tokens defined in a parsed stylesheet document. */
export function extractTokensFromDocument(doc: ParsedDocument, file: string, options: Options, rootFontSize: number): TokenDef[] {
    const ctx: SheetContext = {
        rootFontSize,
        remCall: new RegExp(`^(?:[\\w-]+\\.)?${escapeRegExp(options.functionName)}\\(\\s*(${NUMBER})(?:px)?\\s*\\)$`, 'i'),
        env: new Map(),
    };
    const mapReference = sassMapReference(doc.text);
    const entries: Pending[] = [];

    const settle = (entry: Pending) => {
        if (entry.envKey && entry.resolved) {
            ctx.env.set(entry.envKey, entry.resolved);
        }
    };

    for (const region of doc.regions) {
        if (!tokenRegion(region)) {
            continue;
        }
        for (const decl of region.stylesheet.declarations) {
            const variable = decl.variable;
            if (!variable) {
                continue;
            }
            const { flavor, name } = variable;
            // In CSS-in-JS templates the top level is the component itself, not the document.
            const global =
                flavor === 'css'
                    ? definesGlobalProperties(decl.parent) && !(region.jsTemplate && decl.parent.kind === 'root')
                    : decl.parent.kind === 'root' && !region.jsTemplate;
            if (!global) {
                continue;
            }
            const rawValue = doc.text.slice(decl.valueSpan.start, decl.valueSpan.end).trim();
            const line = doc.lines.lineAt(decl.start);

            if (flavor === 'scss') {
                const mapEntries = sassMapEntries(rawValue, decl.valueSpan.start);
                if (mapEntries) {
                    for (const entry of mapEntries) {
                        const plainKeys = entry.keys.map(unquote);
                        const pending: Pending = {
                            name: `${name}.${plainKeys.join('.')}`,
                            reference: mapReference(name, entry.keys),
                            kind: 'scss-map',
                            flavor,
                            rawValue: entry.value,
                            categoryName: `${name}-${plainKeys.join('-')}`,
                            line: doc.lines.lineAt(entry.start),
                            envKey: mapKey(name, plainKeys),
                        };
                        pending.resolved = resolveSheetValue(entry.value, flavor, ctx);
                        settle(pending);
                        entries.push(pending);
                    }
                    continue;
                }
            }

            const pending: Pending = {
                name,
                reference: flavor === 'css' ? `var(${name})` : name,
                kind: TOKEN_KIND[flavor],
                flavor,
                rawValue,
                categoryName: name,
                line,
                envKey: envKey(name, flavor),
            };
            pending.resolved = resolveSheetValue(rawValue, flavor, ctx);
            settle(pending);
            entries.push(pending);
        }
    }

    // Forward references (`--a: var(--b)` before `--b`, Less lazy variables).
    let progress = true;
    while (progress) {
        progress = false;
        for (const entry of entries) {
            if (!entry.resolved) {
                entry.resolved = resolveSheetValue(entry.rawValue, entry.flavor, ctx);
                if (entry.resolved) {
                    settle(entry);
                    progress = true;
                }
            }
        }
    }

    const out: TokenDef[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        const token = toToken(entry, file);
        if (!token) {
            continue;
        }
        const key = `${token.reference}\u0000${token.px ?? ''}\u0000${token.color?.join(',') ?? ''}`;
        if (!seen.has(key)) {
            seen.add(key);
            out.push(token);
        }
    }
    return out;
}

function toToken(entry: Pending, file: string): TokenDef | undefined {
    const resolved = entry.resolved;
    if (!resolved) {
        return undefined;
    }
    const base = { name: entry.name, reference: entry.reference, kind: entry.kind, rawValue: entry.rawValue, source: { file, line: entry.line } };
    if (resolved.color) {
        return { ...base, category: 'color', color: resolved.color };
    }
    if (resolved.px === undefined) {
        return undefined;
    }
    const category = categoryForName(entry.categoryName);
    if (resolved.unitless && category === 'other') {
        return undefined;
    }
    return { ...base, category, px: resolved.px };
}

// ---------------------------------------------------------------------------
// JSON token files
// ---------------------------------------------------------------------------

interface JsonToken {
    path: string[];
    /** Path in the file, including a Tokens Studio set name. */
    filePath: string[];
    value: unknown;
    type?: string;
}

/** Token types whose values are lengths. */
const LENGTH_TYPES = new Set([
    'dimension',
    'spacing',
    'sizing',
    'fontSizes',
    'fontSize',
    'lineHeights',
    'lineHeight',
    'letterSpacing',
    'borderRadius',
    'borderWidth',
    'paragraphSpacing',
    'paragraphIndent',
]);
/** Length types where a bare number is a ratio, not px. */
const RATIO_TYPES = new Set(['lineHeights', 'lineHeight']);
const TYPE_CATEGORY: Record<string, Category> = {
    fontSizes: 'font-size',
    fontSize: 'font-size',
    lineHeights: 'line-height',
    lineHeight: 'line-height',
    letterSpacing: 'letter-spacing',
    borderRadius: 'radius',
    borderWidth: 'border',
    spacing: 'spacing',
    paragraphSpacing: 'spacing',
    paragraphIndent: 'spacing',
    sizing: 'size',
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether an object with a `value` key is a Tokens Studio / Style Dictionary token rather than a group. */
function isLegacyToken(node: Record<string, unknown>): boolean {
    if (!('value' in node)) {
        return false;
    }
    const value = node.value;
    return typeof node.type === 'string' || !isRecord(value) || ('value' in value && 'unit' in value);
}

function walkJson(node: unknown, path: string[], filePath: string[], inheritedType: string | undefined, out: JsonToken[]): void {
    if (!isRecord(node)) {
        return;
    }
    if ('$value' in node) {
        out.push({ path, filePath, value: node.$value, type: typeof node.$type === 'string' ? node.$type : inheritedType });
        return;
    }
    if (isLegacyToken(node)) {
        out.push({ path, filePath, value: node.value, type: typeof node.type === 'string' ? node.type : inheritedType });
        return;
    }
    const groupType = typeof node.$type === 'string' ? node.$type : inheritedType;
    for (const [key, child] of Object.entries(node)) {
        if (!key.startsWith('$')) {
            walkJson(child, [...path, key], [...filePath, key], groupType, out);
        }
    }
}

/** Tokens Studio multi-set files keep each set under a top-level key; the set name is not part of token paths. */
function tokenSets(root: Record<string, unknown>): { name?: string; node: unknown }[] {
    const metadata = root.$metadata;
    const order = isRecord(metadata) && Array.isArray(metadata.tokenSetOrder) ? metadata.tokenSetOrder.filter((s): s is string => typeof s === 'string') : undefined;
    if (!order && !Array.isArray(root.$themes)) {
        return [{ node: root }];
    }
    const names = [...(order ?? []), ...Object.keys(root).filter(k => !k.startsWith('$') && !order?.includes(k))];
    return names.filter(name => isRecord(root[name])).map(name => ({ name, node: root[name] }));
}

/** Offset of the token's key in the JSON text (best effort). */
function offsetOfPath(text: string, path: string[]): number {
    let pos = 0;
    let found = 0;
    for (const key of path) {
        const re = new RegExp(escapeRegExp(JSON.stringify(key)) + String.raw`\s*:`, 'g');
        re.lastIndex = pos;
        const m = re.exec(text);
        if (!m) {
            break;
        }
        found = m.index;
        pos = m.index + m[0].length;
    }
    return found;
}

/** Evaluates `+ - * /` arithmetic over px/rem/unitless numbers (Tokens Studio math). Returns px. */
function evaluateArithmetic(expr: string, rootFontSize: number): number | undefined {
    const tokens = expr.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?[a-z%]*|[-+*/()]|\S/gi);
    if (!tokens) {
        return undefined;
    }
    let i = 0;
    const atom = (): number | undefined => {
        const t = tokens[i++];
        if (t === undefined) {
            return undefined;
        }
        if (t === '-' || t === '+') {
            const v = atom();
            return v === undefined ? undefined : t === '-' ? -v : v;
        }
        if (t === '(') {
            const v = sum();
            return tokens[i++] === ')' ? v : undefined;
        }
        const length = parseSingleLength(t);
        if (!length) {
            return undefined;
        }
        if (length.unit === 'rem') {
            return length.value * rootFontSize;
        }
        return length.unit === 'px' || length.unit === '' ? length.value : undefined;
    };
    const product = (): number | undefined => {
        let v = atom();
        while (v !== undefined && (tokens[i] === '*' || tokens[i] === '/')) {
            const op = tokens[i++];
            const rhs = atom();
            v = rhs === undefined || (op === '/' && rhs === 0) ? undefined : op === '*' ? v * rhs : v / rhs;
        }
        return v;
    };
    const sum = (): number | undefined => {
        let v = product();
        while (v !== undefined && (tokens[i] === '+' || tokens[i] === '-')) {
            const op = tokens[i++];
            const rhs = product();
            v = rhs === undefined ? undefined : op === '+' ? v + rhs : v - rhs;
        }
        return v;
    };
    const result = sum();
    return i === tokens.length && result !== undefined && Number.isFinite(result) ? result : undefined;
}

/** DTCG 2025 colour object: `{ colorSpace: 'srgb', components: [r, g, b], alpha, hex }`. */
function colorObject(value: Record<string, unknown>): RGBA | undefined {
    if (typeof value.hex === 'string') {
        const rgba = parseHex(value.hex.replace(/^#/, ''));
        if (rgba && typeof value.alpha === 'number') {
            rgba[3] = value.alpha;
        }
        return rgba;
    }
    const components = value.components;
    if (value.colorSpace === 'srgb' && Array.isArray(components) && components.length === 3 && components.every(c => typeof c === 'number')) {
        const [r, g, b] = components as number[];
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), typeof value.alpha === 'number' ? value.alpha : 1];
    }
    return undefined;
}

interface JsonResolved extends Resolved {
    type?: string;
}

class JsonResolver {
    private readonly byPath = new Map<string, JsonToken>();
    private readonly cache = new Map<JsonToken, JsonResolved | undefined>();
    private readonly visiting = new Set<JsonToken>();

    constructor(
        tokens: JsonToken[],
        private readonly rootFontSize: number,
    ) {
        for (const token of tokens) {
            this.byPath.set(token.path.join('.'), token);
        }
    }

    private target(alias: string): JsonToken | undefined {
        const path = alias.trim();
        // Style Dictionary v3 aliases end in `.value`.
        return this.byPath.get(path) ?? (path.endsWith('.value') ? this.byPath.get(path.slice(0, -6)) : undefined);
    }

    resolve(token: JsonToken): JsonResolved | undefined {
        if (this.cache.has(token)) {
            return this.cache.get(token);
        }
        if (this.visiting.has(token)) {
            return undefined;
        }
        this.visiting.add(token);
        const result = this.resolveValue(token.value, token.type);
        this.visiting.delete(token);
        this.cache.set(token, result);
        return result;
    }

    private resolveAlias(alias: string, type: string | undefined): JsonResolved | undefined {
        const target = this.target(alias);
        const resolved = target && this.resolve(target);
        return resolved && { ...resolved, type: type ?? resolved.type };
    }

    private resolveValue(value: unknown, type: string | undefined): JsonResolved | undefined {
        const unitlessPx = type !== undefined && LENGTH_TYPES.has(type) && !RATIO_TYPES.has(type);
        if (typeof value === 'number') {
            if (unitlessPx) {
                return { px: value, type };
            }
            return value === 0 ? { px: 0, unitless: true, type } : undefined;
        }
        if (isRecord(value)) {
            const ref = value.$ref;
            if (typeof ref === 'string' && ref.startsWith('#/')) {
                const path = ref
                    .slice(2)
                    .split('/')
                    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
                if (path[path.length - 1] === '$value') {
                    path.pop();
                }
                return this.resolveAlias(path.join('.'), type);
            }
            if (typeof value.value === 'number' && typeof value.unit === 'string') {
                const unit = value.unit.toLowerCase();
                if (unit === 'px') {
                    return { px: value.value, type };
                }
                return unit === 'rem' ? { px: value.value * this.rootFontSize, type } : undefined;
            }
            const color = colorObject(value);
            return color ? { color, type } : undefined;
        }
        if (typeof value !== 'string') {
            return undefined;
        }
        const text = value.trim();
        const alias = /^\{([^{}]+)\}$/.exec(text);
        if (alias) {
            return this.resolveAlias(alias[1], type);
        }
        if (text.includes('{')) {
            // Tokens Studio math: `{spacing.base} * 2`.
            let failed = false;
            const expr = text.replace(/\{([^{}]+)\}/g, (_, path: string) => {
                const r = this.resolveAlias(path, undefined);
                if (r?.px === undefined) {
                    failed = true;
                    return '0';
                }
                return String(r.px);
            });
            const px = failed ? undefined : evaluateArithmetic(expr, this.rootFontSize);
            return px === undefined ? undefined : { px, type };
        }
        const length = parseSingleLength(text);
        if (length) {
            switch (length.unit) {
                case 'px':
                    return { px: length.value, type };
                case 'rem':
                    return { px: length.value * this.rootFontSize, type };
                case '':
                    return this.resolveValue(length.value, type);
                default:
                    return undefined;
            }
        }
        const color = parseColorValue(text);
        if (color) {
            return { color, type };
        }
        if (type !== undefined && LENGTH_TYPES.has(type) && /[-+*/]/.test(text) && /^[\d.\s+\-*/()a-z%]+$/i.test(text)) {
            const px = evaluateArithmetic(text, this.rootFontSize);
            return px === undefined ? undefined : { px, type };
        }
        return undefined;
    }
}

/**
 * Tokens from a JSON token file: W3C DTCG (`$value`/`$type`, including the
 * 2025 object form `{"value": 16, "unit": "px"}` and `{alias}` references),
 * Tokens Studio (`value`/`type`; unitless numbers of length types mean px;
 * math such as `{spacing.base} * 2`; multi-set files) and Style Dictionary
 * (`value`). `name` is the dotted path (`space.4`); `reference` comes from
 * `options.tokens.reference` with `{name}` replaced by the path joined with
 * `-`. Invalid JSON gives no tokens.
 */
export function extractTokensFromJson(jsonText: string, file: string, options: Options, rootFontSize: number): TokenDef[] {
    let root: unknown;
    try {
        root = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
    } catch {
        return [];
    }
    if (!isRecord(root)) {
        return [];
    }
    const tokens: JsonToken[] = [];
    for (const set of tokenSets(root)) {
        walkJson(set.node, [], set.name !== undefined ? [set.name] : [], undefined, tokens);
    }
    const resolver = new JsonResolver(tokens, rootFontSize);
    const lines = new LineIndex(jsonText);
    const template = options.tokens.reference || 'var(--{name})';
    const out: TokenDef[] = [];

    for (const token of tokens) {
        const resolved = resolver.resolve(token);
        if (!resolved) {
            continue;
        }
        const type = resolved.type;
        const isLengthType = type === undefined || LENGTH_TYPES.has(type);
        const isColorType = type === undefined || type === 'color';
        const cssName = token.path.map(p => p.trim().replace(/\s+/g, '-')).join('-');
        const base = {
            name: token.path.join('.'),
            reference: template.replace(/\{name\}/g, cssName),
            kind: 'json' as const,
            rawValue: typeof token.value === 'string' ? token.value : JSON.stringify(token.value),
            source: { file, line: lines.lineAt(offsetOfPath(jsonText, token.filePath)) },
        };
        if (resolved.color && isColorType) {
            out.push({ ...base, category: 'color', color: resolved.color });
        } else if (resolved.px !== undefined && isLengthType) {
            const category = (type && TYPE_CATEGORY[type]) || categoryForName(cssName);
            if (resolved.unitless && type === undefined && category === 'other') {
                continue;
            }
            out.push({ ...base, category, px: resolved.px });
        }
    }
    return out;
}
