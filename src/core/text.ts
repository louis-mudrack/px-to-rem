/** Zero-based line/character position, the same shape VS Code uses. */
export interface Position {
    line: number;
    character: number;
}

export interface Span {
    start: number;
    end: number;
}

/** Maps between string offsets and line/character positions. */
export class LineIndex {
    private readonly starts: number[];

    constructor(private readonly text: string) {
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) {
                starts.push(i + 1);
            }
        }
        this.starts = starts;
    }

    get lineCount(): number {
        return this.starts.length;
    }

    /** Zero-based line containing `offset`. */
    lineAt(offset: number): number {
        let lo = 0;
        let hi = this.starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (this.starts[mid] <= offset) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }

    positionAt(offset: number): Position {
        const line = this.lineAt(offset);
        return { line, character: offset - this.starts[line] };
    }

    offsetAt(position: Position): number {
        if (position.line >= this.starts.length) {
            return this.text.length;
        }
        return Math.min(this.starts[Math.max(0, position.line)] + position.character, this.lineEnd(position.line));
    }

    lineStart(line: number): number {
        return this.starts[Math.max(0, Math.min(line, this.starts.length - 1))];
    }

    /** Offset of the end of `line`, excluding the line break. */
    lineEnd(line: number): number {
        if (line + 1 < this.starts.length) {
            let end = this.starts[line + 1] - 1;
            if (end > 0 && this.text.charCodeAt(end - 1) === 13) {
                end--;
            }
            return end;
        }
        return this.text.length;
    }

    lineText(line: number): string {
        return this.text.slice(this.lineStart(line), this.lineEnd(line));
    }
}

export function overlaps(a: Span, b: Span): boolean {
    return a.start < b.end && b.start < a.end;
}

export function contains(outer: Span, inner: Span): boolean {
    return outer.start <= inner.start && inner.end <= outer.end;
}

/** A text replacement expressed in offsets of the original text. */
export interface TextEdit extends Span {
    newText: string;
}

/** Applies non-overlapping edits to `text`. Edits may be given in any order. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
    const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
    let out = '';
    let cursor = 0;
    for (const edit of sorted) {
        if (edit.start < cursor) {
            throw new Error(`Overlapping edits at offset ${edit.start}`);
        }
        out += text.slice(cursor, edit.start) + edit.newText;
        cursor = edit.end;
    }
    return out + text.slice(cursor);
}
