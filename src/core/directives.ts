import type { LineIndex, Span } from './text';

/** Disable comments found in a document. */
export interface Directives {
    fileDisabled: boolean;
    /** Zero-based lines where conversion is disabled. */
    lines: Set<number>;
    /** `disable … enable` ranges. */
    ranges: Span[];
}

const PREFIX = String.raw`(?:px-?to-?rem|pxtorem)`;
const FILE = new RegExp(`${PREFIX}-disable-file\\b`, 'i');
const NEXT_LINE = new RegExp(`${PREFIX}-disable-next-line\\b`, 'i');
const SAME_LINE = new RegExp(`${PREFIX}-disable-line\\b`, 'i');
const DISABLE = new RegExp(`${PREFIX}-disable(?![-\\w])`, 'i');
const ENABLE = new RegExp(`${PREFIX}-enable(?![-\\w])`, 'i');

/** Collects directives from comment spans. */
export function collectDirectives(text: string, comments: readonly Span[], lines: LineIndex): Directives {
    const result: Directives = { fileDisabled: false, lines: new Set(), ranges: [] };
    const sorted = [...comments].sort((a, b) => a.start - b.start);
    let openAt: number | undefined;

    for (const comment of sorted) {
        const body = text.slice(comment.start, comment.end);
        if (!/px-?to-?rem|pxtorem/i.test(body)) {
            continue;
        }
        if (FILE.test(body)) {
            result.fileDisabled = true;
        } else if (NEXT_LINE.test(body)) {
            result.lines.add(lines.lineAt(comment.end) + 1);
        } else if (SAME_LINE.test(body)) {
            result.lines.add(lines.lineAt(comment.start));
        } else if (DISABLE.test(body)) {
            if (openAt === undefined) {
                openAt = comment.end;
            }
        } else if (ENABLE.test(body)) {
            if (openAt !== undefined) {
                result.ranges.push({ start: openAt, end: comment.start });
                openAt = undefined;
            }
        }
    }
    if (openAt !== undefined) {
        result.ranges.push({ start: openAt, end: text.length });
    }
    return result;
}

export function isDisabled(directives: Directives, offset: number, line: number): boolean {
    if (directives.fileDisabled || directives.lines.has(line)) {
        return true;
    }
    return directives.ranges.some(r => offset >= r.start && offset < r.end);
}
