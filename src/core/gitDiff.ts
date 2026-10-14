/** Parsing of unified diffs (`git diff -U0`, VS Code's `diffWithHEAD`) for git-aware mode. */

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

interface Hunk {
    oldRemaining: number;
    newRemaining: number;
    /** One-based number of the next line on the new side. */
    newLine: number;
}

function parseHunkHeader(line: string): Hunk | undefined {
    const m = HUNK_HEADER.exec(line);
    if (!m) {
        return undefined;
    }
    return {
        oldRemaining: m[2] === undefined ? 1 : Number(m[2]),
        newRemaining: m[4] === undefined ? 1 : Number(m[4]),
        newLine: Number(m[3]),
    };
}

/**
 * Consumes one hunk body line. Returns the zero-based new-side line when the
 * line was added, `null` for other body lines and `undefined` when the line
 * does not belong to the hunk.
 */
function consume(hunk: Hunk, line: string): number | null | undefined {
    const marker = line[0];
    if (marker === '+' && hunk.newRemaining > 0) {
        hunk.newRemaining--;
        return hunk.newLine++ - 1;
    }
    if (marker === '-' && hunk.oldRemaining > 0) {
        hunk.oldRemaining--;
        return null;
    }
    // Context line; an empty line is a context line whose leading space was trimmed.
    if ((marker === ' ' || marker === undefined) && hunk.oldRemaining > 0 && hunk.newRemaining > 0) {
        hunk.oldRemaining--;
        hunk.newRemaining--;
        hunk.newLine++;
        return null;
    }
    return undefined;
}

function done(hunk: Hunk): boolean {
    return hunk.oldRemaining <= 0 && hunk.newRemaining <= 0;
}

/**
 * Zero-based line numbers (new-file side) added or modified in a unified diff
 * for a single file. Handles multiple hunks, omitted counts (`@@ -3 +3 @@`),
 * pure deletions (`+c,0`, no lines), context lines and
 * `\ No newline at end of file` markers. Line counts in the hunk headers
 * decide where a hunk ends, so removed lines that look like headers
 * (`--- a`) are not misread.
 */
export function changedLinesFromDiff(diff: string): Set<number> {
    const changed = new Set<number>();
    let hunk: Hunk | undefined;
    for (const raw of diff.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (line.startsWith('\\')) {
            continue;
        }
        if (hunk && !done(hunk)) {
            const result = consume(hunk, line);
            if (typeof result === 'number') {
                changed.add(result);
            }
            if (result !== undefined) {
                continue;
            }
        }
        hunk = line.startsWith('@@') ? parseHunkHeader(line) : undefined;
    }
    return changed;
}

const ESCAPES: Readonly<Record<string, string>> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07', '"': '"', '\\': '\\' };

/** Unquotes a C-style quoted git path (`"caf\303\251.css"` → `café.css`). Octal escapes are UTF-8 bytes. */
function unquote(path: string): string {
    if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) {
        return path;
    }
    const chars = Array.from(path.slice(1, -1));
    let encoded = '';
    for (let i = 0; i < chars.length; i++) {
        if (chars[i] !== '\\') {
            encoded += encodeURIComponent(chars[i]);
            continue;
        }
        const next = chars[++i] ?? '';
        if (next >= '0' && next <= '7') {
            let octal = next;
            while (octal.length < 3 && chars[i + 1] >= '0' && chars[i + 1] <= '7') {
                octal += chars[++i];
            }
            encoded += '%' + parseInt(octal, 8).toString(16).padStart(2, '0');
            continue;
        }
        encoded += encodeURIComponent(ESCAPES[next] ?? next);
    }
    try {
        return decodeURIComponent(encoded);
    } catch {
        return path.slice(1, -1);
    }
}

/** The path in a `--- a/x` / `+++ b/x` line: unquoted, without the trailing tab git adds to names with spaces. */
function headerPath(line: string): string {
    const rest = line.slice(4);
    if (rest.startsWith('"')) {
        const end = rest.search(/(?<!\\)"(?=\t|$)/u);
        return unquote(end > 0 ? rest.slice(0, end + 1) : rest);
    }
    const tab = rest.indexOf('\t');
    return tab >= 0 ? rest.slice(0, tab) : rest.replace(/\s+$/, '');
}

interface FileSection {
    start: number;
    end: number;
    /** `diff --git` line, when present. */
    gitHeader?: string;
    oldPath?: string;
    newPath?: string;
    renameTo?: string;
    deleted: boolean;
    sawHunk: boolean;
}

/** Strips the destination prefix (`b/`, or `w/`/`i/` with `diff.mnemonicPrefix`) unless the diff was made with `--no-prefix`. */
function stripPrefix(path: string, section: FileSection): string {
    const prefixed = section.gitHeader ? /^diff --git "?[acio]\//.test(section.gitHeader) : /^[bwi]\//.test(path);
    return prefixed ? path.replace(/^[bwi]\//, '') : path;
}

/** New path of a section without `+++` (renames, mode changes, binary files): from `rename to` or the `diff --git` line. */
function pathFromGitHeader(section: FileSection): string | undefined {
    if (section.renameTo !== undefined) {
        return section.renameTo;
    }
    const header = section.gitHeader;
    if (!header) {
        return undefined;
    }
    const rest = header.slice('diff --git '.length);
    const quoted = /"((?:[^"\\]|\\.)*)"$/.exec(rest);
    if (quoted) {
        return stripPrefix(unquote(`"${quoted[1]}"`), section);
    }
    // `a/x b/x`: both names are equal for anything but renames, which have `rename to`.
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest[half] === ' ') {
        return stripPrefix(rest.slice(half + 1), section);
    }
    const m = / ([bwi]\/.*)$/.exec(rest);
    return m ? stripPrefix(m[1], section) : undefined;
}

/**
 * Splits a multi-file unified diff (`git diff -U0 HEAD`) into per-file diffs
 * keyed by the new path (without the `b/` prefix), skipping deleted files.
 * Files without content changes (renames, mode changes, binary files) map to
 * a diff without hunks. Plain `diff -u` output without `diff --git` lines is
 * split at its `---`/`+++` headers.
 */
export function splitDiffByFile(diff: string): Map<string, string> {
    const lines = diff.split('\n');
    const sections: FileSection[] = [];
    let current: FileSection | undefined;
    let hunk: Hunk | undefined;

    const open = (index: number): FileSection => {
        if (current) {
            current.end = index;
        }
        current = { start: index, end: lines.length, deleted: false, sawHunk: false };
        sections.push(current);
        return current;
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line.startsWith('\\')) {
            continue;
        }
        if (hunk && !done(hunk)) {
            if (consume(hunk, line) !== undefined) {
                continue;
            }
        }
        hunk = undefined;

        if (line.startsWith('diff --git ')) {
            open(i).gitHeader = line;
        } else if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
            const section = current && current.oldPath === undefined && !current.sawHunk ? current : open(i);
            section.oldPath = headerPath(line);
        } else if (line.startsWith('+++ ') && current) {
            current.newPath = headerPath(line);
        } else if (line.startsWith('deleted file mode') && current) {
            current.deleted = true;
        } else if (line.startsWith('rename to ') && current) {
            current.renameTo = unquote(line.slice('rename to '.length));
        } else if (line.startsWith('@@') && current) {
            hunk = parseHunkHeader(line);
            current.sawHunk = current.sawHunk || !!hunk;
        }
    }

    const out = new Map<string, string>();
    for (const section of sections) {
        if (section.deleted || section.newPath === '/dev/null') {
            continue;
        }
        const path = section.newPath !== undefined ? stripPrefix(section.newPath, section) : pathFromGitHeader(section);
        if (!path) {
            continue;
        }
        const last = section.end === lines.length;
        const text = lines.slice(section.start, section.end).join('\n') + (last ? '' : '\n');
        out.set(path, text);
    }
    return out;
}
