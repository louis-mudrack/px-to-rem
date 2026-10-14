import { scanJs } from './jsLexer';
import { camelToKebab, LENGTH_PROPERTIES, REACT_UNITLESS } from './properties';
import { hostForLanguage, syntaxForStyleLang, type Syntax } from './syntax';
import { findTailwindClasses, type TailwindClass } from './tailwind';
import type { Span } from './text';

export type RegionKind = 'file' | 'style-block' | 'style-attribute' | 'js-template' | 'js-object' | 'tailwind';

/** A piece of a document that contains CSS. */
export interface RegionSpec extends Span {
    kind: RegionKind;
    syntax: Syntax;
    /** `${…}` placeholders are JavaScript (CSS-in-JS templates). */
    jsTemplate?: boolean;
    /** Bare declaration list (style="" attributes). */
    declarationList?: boolean;
    /** For single values (JS objects, Tailwind): the property they belong to. */
    property?: string;
    /** A bare JS number that React treats as px (`fontSize: 16`). */
    implicitPx?: boolean;
    /** Tailwind class the value belongs to. */
    tailwind?: TailwindClass;
}

export interface ExtractOptions {
    tailwind?: boolean;
    jsObjects?: boolean;
    jsUnitlessNumbers?: boolean;
    jsTemplates?: boolean;
}

export interface ExtractResult {
    regions: RegionSpec[];
    /** Comments outside CSS regions (JS and HTML), for directives. */
    comments: Span[];
}

/** Tags of CSS-in-JS template literals: styled.div``, styled(Button)``, css``, createGlobalStyle``, keyframes``… */
const STYLED_TAG =
    /(?:\bstyled(?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\((?:[^()]|\([^()]*\))*\))(?:\s*\.\s*(?:attrs|withConfig)\s*\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*|\bcss|\bcreateGlobalStyle|\bkeyframes|\binjectGlobal|\bglob)\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*$/;
const TW_TAG = /\btw(?:\.[\w$]+|\([^()]*\))?\s*$/;
const OBJECT_KEY = /(?:^|[{,(\s])(?:(["'])([\w-]+)\1|([A-Za-z_$][\w$]*))\s*:\s*$/;

export function extractRegions(text: string, languageId: string, options: ExtractOptions = {}): ExtractResult {
    const host = hostForLanguage(languageId);
    const result: ExtractResult = { regions: [], comments: [] };
    if (!host) {
        return result;
    }
    if (host.kind === 'stylesheet') {
        result.regions.push({ kind: 'file', start: 0, end: text.length, syntax: host.syntax ?? 'css' });
    } else if (host.kind === 'script') {
        scanScript(text, 0, text.length, options, result);
    } else {
        scanMarkup(text, languageId, options, result);
    }
    result.regions.sort((a, b) => a.start - b.start);
    return result;
}

function scanScript(text: string, start: number, end: number, options: ExtractOptions, out: ExtractResult): void {
    const js = scanJs(text, start, end);
    out.comments.push(...js.comments);

    for (const tpl of js.templates) {
        const before = text.slice(Math.max(start, tpl.start - 240), tpl.start);
        if (options.jsTemplates !== false && STYLED_TAG.test(before)) {
            out.regions.push({ kind: 'js-template', start: tpl.contentStart, end: tpl.contentEnd, syntax: 'scss', jsTemplate: true });
            continue;
        }
        if (options.tailwind) {
            // Static parts of other templates may hold class names (`tw\`…\``, `\`p-[16px] ${x}\``).
            let cursor = tpl.contentStart;
            for (const expr of [...tpl.expressions, { start: tpl.contentEnd, end: tpl.contentEnd }]) {
                addTailwind(text, cursor, expr.start, out);
                cursor = expr.end;
            }
            if (TW_TAG.test(before)) {
                continue;
            }
        }
    }

    for (const str of js.strings) {
        if (options.jsObjects !== false) {
            const property = objectKeyBefore(text, str.start);
            if (property && LENGTH_PROPERTIES.has(property) && /\d/.test(text.slice(str.contentStart, str.contentEnd))) {
                out.regions.push({ kind: 'js-object', start: str.contentStart, end: str.contentEnd, syntax: 'css', property });
                continue;
            }
        }
        if (options.tailwind) {
            addTailwind(text, str.contentStart, str.contentEnd, out);
        }
    }

    if (options.jsUnitlessNumbers) {
        const numberRe = /:\s*(-?(?:\d+\.?\d*|\.\d+))(?=\s*[,}\n\r])/g;
        for (const code of js.code) {
            numberRe.lastIndex = 0;
            const slice = text.slice(code.start, code.end);
            let m: RegExpExecArray | null;
            while ((m = numberRe.exec(slice))) {
                const colonAt = code.start + m.index;
                const property = objectKeyBefore(text, colonAt + m[0].indexOf(m[1]));
                if (!property || !LENGTH_PROPERTIES.has(property) || REACT_UNITLESS.has(property) || Number(m[1]) === 0) {
                    continue;
                }
                const numStart = colonAt + m[0].indexOf(m[1]);
                out.regions.push({ kind: 'js-object', start: numStart, end: numStart + m[1].length, syntax: 'css', property, implicitPx: true });
            }
        }
    }
}

/** If `text[offset]` is the value of an object property `key: …`, returns the kebab-cased key. */
function objectKeyBefore(text: string, offset: number): string | undefined {
    const m = OBJECT_KEY.exec(text.slice(Math.max(0, offset - 120), offset));
    if (!m) {
        return undefined;
    }
    return camelToKebab(m[2] ?? m[3]);
}

function addTailwind(text: string, start: number, end: number, out: ExtractResult): void {
    if (end <= start || text.indexOf('[', start) < 0 || text.indexOf('[', start) >= end) {
        return;
    }
    for (const cls of findTailwindClasses(text, start, end)) {
        out.regions.push({ kind: 'tailwind', start: cls.valueStart, end: cls.valueEnd, syntax: 'css', property: cls.property, tailwind: cls });
    }
}

interface Attribute {
    name: string;
    valueStart: number;
    valueEnd: number;
    quote: string;
}

function scanMarkup(text: string, languageId: string, options: ExtractOptions, out: ExtractResult): void {
    let i = 0;
    const n = text.length;

    // Astro and MDX frontmatter is code.
    if ((languageId === 'astro' || languageId === 'mdx') && text.startsWith('---')) {
        const close = text.indexOf('\n---', 3);
        if (close > 0) {
            scanScript(text, 3, close, options, out);
            i = close + 4;
        }
    }

    while (i < n) {
        const lt = text.indexOf('<', i);
        if (lt < 0) {
            break;
        }
        if (text.startsWith('<!--', lt)) {
            const close = text.indexOf('-->', lt + 4);
            const end = close < 0 ? n : close + 3;
            out.comments.push({ start: lt, end });
            i = end;
            continue;
        }
        const nameMatch = /^<([A-Za-z][\w:.-]*)/.exec(text.slice(lt, lt + 64));
        if (!nameMatch) {
            i = lt + 1;
            continue;
        }
        const tagName = nameMatch[1].toLowerCase();
        const { attributes, end: tagEnd, selfClosing } = scanAttributes(text, lt + nameMatch[0].length);

        for (const attr of attributes) {
            handleAttribute(text, attr, options, out);
        }

        if ((tagName === 'style' || tagName === 'script') && !selfClosing) {
            const closeRe = new RegExp(`</${tagName}\\s*>`, 'ig');
            closeRe.lastIndex = tagEnd;
            const close = closeRe.exec(text);
            const contentEnd = close ? close.index : n;
            if (tagName === 'style') {
                const lang = attributes.find(a => a.name === 'lang' || a.name === 'type');
                const langValue = lang ? text.slice(lang.valueStart, lang.valueEnd) : undefined;
                out.regions.push({ kind: 'style-block', start: tagEnd, end: contentEnd, syntax: syntaxForStyleLang(langValue) });
            } else {
                const type = attributes.find(a => a.name === 'type');
                const typeValue = type ? text.slice(type.valueStart, type.valueEnd).toLowerCase() : '';
                if (!typeValue || /javascript|typescript|module|babel|jsx|tsx/.test(typeValue)) {
                    scanScript(text, tagEnd, contentEnd, options, out);
                }
            }
            i = close ? close.index + close[0].length : n;
            continue;
        }
        i = tagEnd;
    }
}

function handleAttribute(text: string, attr: Attribute, options: ExtractOptions, out: ExtractResult): void {
    const name = attr.name;
    const isJs = attr.quote === '{' || name.startsWith(':') || name.startsWith('v-bind:');
    const bare = name.replace(/^(v-bind)?:/, '');
    if (bare === 'style') {
        if (isJs) {
            scanScript(text, attr.valueStart, attr.valueEnd, options, out);
        } else {
            out.regions.push({ kind: 'style-attribute', start: attr.valueStart, end: attr.valueEnd, syntax: 'css', declarationList: true });
        }
        return;
    }
    if (options.tailwind && (bare === 'class' || bare === 'classname' || bare === 'class:list')) {
        if (isJs) {
            scanScript(text, attr.valueStart, attr.valueEnd, options, out);
        } else {
            addTailwind(text, attr.valueStart, attr.valueEnd, out);
        }
    }
}

/** Scans tag attributes starting after the tag name. */
function scanAttributes(text: string, i: number): { attributes: Attribute[]; end: number; selfClosing: boolean } {
    const attributes: Attribute[] = [];
    const n = text.length;
    while (i < n) {
        while (i < n && /\s/.test(text[i])) {
            i++;
        }
        if (text[i] === '>') {
            return { attributes, end: i + 1, selfClosing: false };
        }
        if (text[i] === '/' && text[i + 1] === '>') {
            return { attributes, end: i + 2, selfClosing: true };
        }
        if (text[i] === '{') {
            // Svelte/JSX spread or shorthand: `{...props}`.
            i = skipBraces(text, i);
            continue;
        }
        const nameStart = i;
        while (i < n && !/[\s=>/]/.test(text[i])) {
            i++;
        }
        if (i === nameStart) {
            i++;
            continue;
        }
        const name = text.slice(nameStart, i).toLowerCase();
        while (i < n && /\s/.test(text[i])) {
            i++;
        }
        if (text[i] !== '=') {
            continue;
        }
        i++;
        while (i < n && /\s/.test(text[i])) {
            i++;
        }
        const q = text[i];
        if (q === '"' || q === "'") {
            const close = text.indexOf(q, i + 1);
            const end = close < 0 ? n : close;
            attributes.push({ name, valueStart: i + 1, valueEnd: end, quote: q });
            i = end + 1;
        } else if (q === '{') {
            const end = skipBraces(text, i);
            attributes.push({ name, valueStart: i + 1, valueEnd: Math.max(i + 1, end - 1), quote: '{' });
            i = end;
        } else {
            const valueStart = i;
            while (i < n && !/[\s>]/.test(text[i])) {
                i++;
            }
            attributes.push({ name, valueStart, valueEnd: i, quote: '' });
        }
    }
    return { attributes, end: n, selfClosing: false };
}

/** Returns the offset after the brace group starting at `i`, honouring JS strings. */
function skipBraces(text: string, i: number): number {
    let depth = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"' || c === "'" || c === '`') {
            const close = text.indexOf(c, i + 1);
            i = close < 0 ? n : close + 1;
            continue;
        }
        if (c === '{') {
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                return i + 1;
            }
        }
        i++;
    }
    return n;
}
