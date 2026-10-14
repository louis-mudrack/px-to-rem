import { skipJsExpression } from './jsLexer';
import { hasLineComments, type Syntax } from './syntax';

export type TokenType =
    | 'ws'
    | 'comment'
    | 'string'
    | 'url'
    | 'ident'
    | 'function'
    | 'at'
    | 'var'
    | 'hash'
    | 'number'
    | 'dimension'
    | 'percentage'
    | '('
    | ')'
    | '['
    | ']'
    | '{'
    | '}'
    | ';'
    | ':'
    | ','
    | 'interp-open'
    | 'interp-close'
    | 'placeholder'
    | 'delim';

export interface Token {
    type: TokenType;
    start: number;
    end: number;
    /** Numeric value of number, dimension and percentage tokens. */
    num?: number;
    /** Offset where the unit starts (dimension and percentage tokens). */
    unitStart?: number;
    /** Raw unit text, `%` for percentages. */
    unit?: string;
    /** Zero-width tokens inserted for indentation-based syntaxes. */
    synthetic?: boolean;
    /** Whether a line break separates this token from the previous significant token. */
    newlineBefore?: boolean;
}

export interface TokenizeOptions {
    syntax: Syntax;
    /** `${…}` is an opaque JavaScript placeholder (CSS-in-JS templates). */
    jsTemplate?: boolean;
    /** `_` separates values (Tailwind arbitrary values). */
    underscoreIsSpace?: boolean;
}

function isDigit(c: number): boolean {
    return c >= 48 && c <= 57;
}

function isLetter(c: number): boolean {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isIdentStart(c: number): boolean {
    return isLetter(c) || c === 95 || c >= 128 || c === 92;
}

function isIdentChar(c: number): boolean {
    return isIdentStart(c) || isDigit(c) || c === 45;
}

function isWhitespace(c: number): boolean {
    return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

const SINGLE: Record<string, TokenType> = {
    '(': '(',
    ')': ')',
    '[': '[',
    ']': ']',
    ';': ';',
    ':': ':',
    ',': ',',
};

/**
 * Tokenizes `text[start, end)` as a CSS-family stylesheet. Offsets in the
 * returned tokens are absolute positions in `text`.
 */
export function tokenize(text: string, start: number, end: number, options: TokenizeOptions): Token[] {
    const { syntax } = options;
    const lineComments = hasLineComments(syntax);
    const scssInterp = syntax === 'scss' || syntax === 'sass';
    const lessInterp = syntax === 'less';
    const underscoreIsSpace = !!options.underscoreIsSpace;
    const isSpace = (c: number) => isWhitespace(c) || (underscoreIsSpace && c === 95);
    const tokens: Token[] = [];
    const braceStack: ('block' | 'interp')[] = [];
    const code = (i: number) => (i < end ? text.charCodeAt(i) : -1);

    const startsIdent = (i: number): boolean => {
        const c = code(i);
        if (isIdentStart(c)) {
            return true;
        }
        if (c === 45) {
            const n = code(i + 1);
            return isIdentStart(n) || n === 45;
        }
        return false;
    };

    const startsNumber = (i: number): boolean => {
        const c = code(i);
        if (isDigit(c)) {
            return true;
        }
        if (c === 46) {
            return isDigit(code(i + 1));
        }
        if (c === 43 || c === 45) {
            const n = code(i + 1);
            return isDigit(n) || (n === 46 && isDigit(code(i + 2)));
        }
        return false;
    };

    const consumeIdent = (i: number): number => {
        while (i < end) {
            const c = code(i);
            if (c === 92) {
                i += 2;
            } else if (isIdentChar(c)) {
                i++;
            } else {
                break;
            }
        }
        return Math.min(i, end);
    };

    let i = start;
    while (i < end) {
        const c = code(i);
        const ch = text[i];

        if (isSpace(c)) {
            let j = i + 1;
            while (j < end && isSpace(code(j))) {
                j++;
            }
            tokens.push({ type: 'ws', start: i, end: j });
            i = j;
            continue;
        }

        if (ch === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            const j = close < 0 || close + 2 > end ? end : close + 2;
            tokens.push({ type: 'comment', start: i, end: j });
            i = j;
            continue;
        }

        if (lineComments && ch === '/' && text[i + 1] === '/') {
            let j = i + 2;
            while (j < end && code(j) !== 10) {
                j++;
            }
            tokens.push({ type: 'comment', start: i, end: j });
            i = j;
            continue;
        }

        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < end) {
                const cj = text[j];
                if (cj === '\\') {
                    j += 2;
                    continue;
                }
                if (cj === ch) {
                    j++;
                    break;
                }
                if (cj === '\n') {
                    break;
                }
                j++;
            }
            j = Math.min(j, end);
            tokens.push({ type: 'string', start: i, end: j });
            i = j;
            continue;
        }

        if (options.jsTemplate && ch === '$' && text[i + 1] === '{') {
            const j = Math.min(skipJsExpression(text, i + 2, end), end);
            tokens.push({ type: 'placeholder', start: i, end: j });
            i = j;
            continue;
        }

        if ((scssInterp && ch === '#' && text[i + 1] === '{') || (lessInterp && ch === '@' && text[i + 1] === '{')) {
            braceStack.push('interp');
            tokens.push({ type: 'interp-open', start: i, end: i + 2 });
            i += 2;
            continue;
        }

        if (ch === '{') {
            braceStack.push('block');
            tokens.push({ type: '{', start: i, end: i + 1 });
            i++;
            continue;
        }

        if (ch === '}') {
            const kind = braceStack.pop();
            tokens.push({ type: kind === 'interp' ? 'interp-close' : '}', start: i, end: i + 1 });
            i++;
            continue;
        }

        if (startsNumber(i)) {
            let j = i;
            if (ch === '+' || ch === '-') {
                j++;
            }
            while (isDigit(code(j))) {
                j++;
            }
            if (code(j) === 46 && isDigit(code(j + 1))) {
                j++;
                while (isDigit(code(j))) {
                    j++;
                }
            }
            if ((code(j) === 101 || code(j) === 69) && (isDigit(code(j + 1)) || ((code(j + 1) === 43 || code(j + 1) === 45) && isDigit(code(j + 2))))) {
                j += 2;
                while (isDigit(code(j))) {
                    j++;
                }
            }
            const num = Number(text.slice(i, j));
            if (code(j) === 37) {
                tokens.push({ type: 'percentage', start: i, end: j + 1, num, unitStart: j, unit: '%' });
                i = j + 1;
                continue;
            }
            if (isIdentStart(code(j))) {
                const unitStart = j;
                // Units are letter runs; a hyphen continues the unit only when a letter follows,
                // so Sass subtraction such as `10px-2px` stays two values.
                while (j < end) {
                    const cj = code(j);
                    if (isLetter(cj) || isDigit(cj) || (cj === 95 && !underscoreIsSpace) || cj >= 128) {
                        j++;
                    } else if (cj === 92) {
                        j += 2;
                    } else if (cj === 45 && (isLetter(code(j + 1)) || code(j + 1) === 95)) {
                        j++;
                    } else {
                        break;
                    }
                }
                j = Math.min(j, end);
                tokens.push({ type: 'dimension', start: i, end: j, num, unitStart, unit: text.slice(unitStart, j) });
                i = j;
                continue;
            }
            tokens.push({ type: 'number', start: i, end: j, num });
            i = j;
            continue;
        }

        if (startsIdent(i)) {
            const j = consumeIdent(i);
            const word = text.slice(i, j);
            if (text[j] === '(') {
                if (word.toLowerCase() === 'url') {
                    let k = j + 1;
                    while (k < end && isWhitespace(code(k))) {
                        k++;
                    }
                    if (text[k] !== '"' && text[k] !== "'") {
                        // Unquoted url(): opaque up to the closing parenthesis.
                        let depth = 0;
                        while (k < end) {
                            const ck = text[k];
                            if (ck === '{') {
                                depth++;
                            } else if (ck === '}') {
                                depth--;
                            } else if (ck === ')' && depth <= 0) {
                                k++;
                                break;
                            } else if (ck === '\n') {
                                break;
                            }
                            k++;
                        }
                        tokens.push({ type: 'url', start: i, end: Math.min(k, end) });
                        i = Math.min(k, end);
                        continue;
                    }
                }
                tokens.push({ type: 'function', start: i, end: j });
                i = j;
                continue;
            }
            tokens.push({ type: 'ident', start: i, end: j });
            i = j;
            continue;
        }

        if (ch === '@' && startsIdent(i + 1)) {
            const j = consumeIdent(i + 1);
            tokens.push({ type: 'at', start: i, end: j });
            i = j;
            continue;
        }

        if (ch === '$' && startsIdent(i + 1)) {
            const j = consumeIdent(i + 1);
            tokens.push({ type: text[j] === '(' ? 'function' : 'var', start: i, end: j });
            i = j;
            continue;
        }

        if (ch === '#' && i + 1 < end && (isIdentChar(code(i + 1)))) {
            const j = consumeIdent(i + 1);
            tokens.push({ type: 'hash', start: i, end: j });
            i = j;
            continue;
        }

        const single = SINGLE[ch];
        tokens.push({ type: single ?? 'delim', start: i, end: i + 1 });
        i++;
    }
    return tokens;
}

/** Significant tokens (no whitespace or comments), annotated with `newlineBefore`. */
export function significant(text: string, tokens: Token[]): Token[] {
    const out: Token[] = [];
    let sawNewline = true;
    for (const token of tokens) {
        if (token.type === 'ws' || token.type === 'comment') {
            if (!sawNewline && text.slice(token.start, token.end).includes('\n')) {
                sawNewline = true;
            }
            continue;
        }
        // Tokens are freshly created by tokenize(), so annotating in place is safe and avoids copies.
        token.newlineBefore = sawNewline;
        out.push(token);
        sawNewline = false;
    }
    return out;
}
