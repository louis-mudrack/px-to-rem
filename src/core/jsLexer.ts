import type { Span } from './text';

/** A string literal in JavaScript/TypeScript source. */
export interface JsString extends Span {
    quote: '"' | "'";
    contentStart: number;
    contentEnd: number;
}

/** A template literal. `tagEnd` is where the tag expression (if any) ends. */
export interface JsTemplate extends Span {
    contentStart: number;
    contentEnd: number;
    /** `${…}` ranges, delimiters included. */
    expressions: Span[];
}

export interface JsScanResult {
    strings: JsString[];
    templates: JsTemplate[];
    comments: Span[];
    /** Code outside strings, templates and comments. */
    code: Span[];
}

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

function isIdentChar(code: number): boolean {
    return (
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        code === 36 ||
        code === 95 ||
        code > 127
    );
}

/**
 * A small JavaScript lexer: finds strings, template literals (including ones
 * nested in `${…}`), comments and code. It does not build an AST; it only
 * needs to be precise enough to find CSS embedded in JS.
 */
export function scanJs(text: string, start = 0, end = text.length): JsScanResult {
    const result: JsScanResult = { strings: [], templates: [], comments: [], code: [] };
    scanCode(text, start, end, false, result);
    result.strings.sort((a, b) => a.start - b.start);
    result.templates.sort((a, b) => a.start - b.start);
    return result;
}

/**
 * Skips a JavaScript expression that starts right after `${` and returns the
 * offset just after the matching `}`.
 */
export function skipJsExpression(text: string, i: number, end: number): number {
    const scratch: JsScanResult = { strings: [], templates: [], comments: [], code: [] };
    return scanCode(text, i, end, true, scratch);
}

function scanCode(text: string, i: number, end: number, stopAtBrace: boolean, out: JsScanResult): number {
    let depth = 0;
    let codeStart = i;
    let lastSig = '';
    let lastWord = '';

    const flush = (upTo: number) => {
        if (upTo > codeStart) {
            out.code.push({ start: codeStart, end: upTo });
        }
    };

    while (i < end) {
        const c = text[i];
        const next = text[i + 1];

        if (c === '"' || c === "'") {
            flush(i);
            i = scanString(text, i, end, out);
            codeStart = i;
            lastSig = 'a';
            lastWord = '';
            continue;
        }
        if (c === '`') {
            flush(i);
            i = scanTemplate(text, i, end, out);
            codeStart = i;
            lastSig = 'a';
            lastWord = '';
            continue;
        }
        if (c === '/' && next === '/') {
            flush(i);
            let j = i + 2;
            while (j < end && text[j] !== '\n') {
                j++;
            }
            out.comments.push({ start: i, end: j });
            i = j;
            codeStart = i;
            continue;
        }
        if (c === '/' && next === '*') {
            flush(i);
            const close = text.indexOf('*/', i + 2);
            const j = close < 0 || close + 2 > end ? end : close + 2;
            out.comments.push({ start: i, end: j });
            i = j;
            codeStart = i;
            continue;
        }
        if (c === '/' && (lastSig === '' || REGEX_PRECEDERS.has(lastSig) || REGEX_KEYWORDS.has(lastWord))) {
            const j = scanRegex(text, i, end);
            if (j > 0) {
                i = j;
                lastSig = 'a';
                lastWord = '';
                continue;
            }
        }
        if (c === '{') {
            depth++;
        } else if (c === '}') {
            if (stopAtBrace && depth === 0) {
                flush(i);
                return i + 1;
            }
            depth--;
        }

        const code = text.charCodeAt(i);
        if (isIdentChar(code)) {
            let j = i;
            while (j < end && isIdentChar(text.charCodeAt(j))) {
                j++;
            }
            lastWord = text.slice(i, j);
            lastSig = 'a';
            i = j;
            continue;
        }
        if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
            lastSig = c;
            lastWord = '';
        }
        i++;
    }
    flush(i);
    return i;
}

function scanString(text: string, i: number, end: number, out: JsScanResult): number {
    const quote = text[i] as '"' | "'";
    const start = i;
    i++;
    while (i < end) {
        const c = text[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === quote) {
            out.strings.push({ start, end: i + 1, quote, contentStart: start + 1, contentEnd: i });
            return i + 1;
        }
        if (c === '\n') {
            // Unterminated: JSX text such as `it's` lands here. Do not swallow the rest of the file.
            return start + 1;
        }
        i++;
    }
    return start + 1;
}

function scanTemplate(text: string, i: number, end: number, out: JsScanResult): number {
    const start = i;
    const expressions: Span[] = [];
    i++;
    while (i < end) {
        const c = text[i];
        if (c === '\\') {
            i += 2;
            continue;
        }
        if (c === '`') {
            out.templates.push({ start, end: i + 1, contentStart: start + 1, contentEnd: i, expressions });
            return i + 1;
        }
        if (c === '$' && text[i + 1] === '{') {
            const exprStart = i;
            i = scanCode(text, i + 2, end, true, out);
            expressions.push({ start: exprStart, end: i });
            continue;
        }
        i++;
    }
    out.templates.push({ start, end, contentStart: start + 1, contentEnd: end, expressions });
    return end;
}

/** Returns the offset after a regex literal, or -1 if `/` does not start one. */
function scanRegex(text: string, i: number, end: number): number {
    let j = i + 1;
    let inClass = false;
    while (j < end) {
        const c = text[j];
        if (c === '\n' || c === '\r') {
            return -1;
        }
        if (c === '\\') {
            j += 2;
            continue;
        }
        if (c === '[') {
            inClass = true;
        } else if (c === ']') {
            inClass = false;
        } else if (c === '/' && !inClass) {
            j++;
            while (j < end && /[a-z]/i.test(text[j])) {
                j++;
            }
            return j;
        }
        j++;
    }
    return -1;
}
