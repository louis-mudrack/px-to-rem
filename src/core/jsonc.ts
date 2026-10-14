/** Parses JSON with comments and trailing commas (`.pxtoremrc.json`). Returns undefined on error. */
export function parseJsonc(text: string): unknown {
    const stripped = stripJsonc(text);
    try {
        return JSON.parse(stripped);
    } catch {
        return undefined;
    }
}

function skipTrivia(text: string, i: number): number {
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') {
                i++;
            }
        } else if (c === '/' && text[i + 1] === '*') {
            const close = text.indexOf('*/', i + 2);
            i = close < 0 ? n : close + 2;
        } else {
            break;
        }
    }
    return i;
}

function stripJsonc(text: string): string {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '"') {
            let j = i + 1;
            while (j < n && text[j] !== '"') {
                j += text[j] === '\\' ? 2 : 1;
            }
            out += text.slice(i, j + 1);
            i = j + 1;
        } else if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
            i = skipTrivia(text, i);
            out += ' ';
        } else if (c === ',') {
            const next = skipTrivia(text, i + 1);
            if (text[next] !== '}' && text[next] !== ']') {
                out += c;
            }
            i++;
        } else {
            out += c;
            i++;
        }
    }
    return out;
}
