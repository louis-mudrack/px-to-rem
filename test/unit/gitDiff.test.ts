import { describe, expect, it } from 'vitest';
import { changedLinesFromDiff, splitDiffByFile } from '../../src/core/gitDiff';

const lines = (diff: string) => [...changedLinesFromDiff(diff)].sort((a, b) => a - b);

describe('changedLinesFromDiff', () => {
    it('reads added and modified lines from multiple -U0 hunks', () => {
        const diff = `diff --git a/src/card.css b/src/card.css
index 83db48f..bf269f4 100644
--- a/src/card.css
+++ b/src/card.css
@@ -2 +2 @@ .card {
-  padding: 16px;
+  padding: 1rem;
@@ -10,0 +11,2 @@ .card__title {
+  margin: 8px;
+  gap: 4px;
@@ -20,3 +22,0 @@ .card__body {
-  top: 1px;
-  left: 2px;
-  right: 3px;
@@ -40,2 +38,3 @@
-  a: 1px;
-  b: 2px;
+  a: 1rem;
+  b: 2rem;
+  c: 3rem;
`;
        expect(lines(diff)).toEqual([1, 10, 11, 37, 38, 39]);
    });

    it('returns no lines for pure deletions', () => {
        expect(lines('@@ -5,2 +4,0 @@\n-a {}\n-b {}\n')).toEqual([]);
    });

    it('defaults omitted counts to one', () => {
        expect(lines('@@ -7 +7 @@\n-x\n+y\n')).toEqual([6]);
        expect(lines('@@ -0,0 +1 @@\n+only line\n')).toEqual([0]);
    });

    it('counts new files from line one', () => {
        expect(lines('--- /dev/null\n+++ b/new.css\n@@ -0,0 +1,3 @@\n+a {\n+  top: 0;\n+}\n')).toEqual([0, 1, 2]);
    });

    it('skips context lines in diffs with context (VS Code diffWithHEAD)', () => {
        const diff = [
            'diff --git a/x.scss b/x.scss',
            '--- a/x.scss',
            '+++ b/x.scss',
            '@@ -1,6 +1,7 @@',
            ' .a {',
            '-  padding: 16px;',
            '+  padding: 1rem;',
            '+  margin: 0;',
            '   color: red;',
            ' }',
            ' ',
            ' .b {',
            '@@ -20,4 +21,4 @@ $gap: 8px;',
            ' .c {',
            '-  top: 4px;',
            '+  top: 0.25rem;',
            ' }',
            ' ',
            '',
        ].join('\n');
        expect(lines(diff)).toEqual([1, 2, 21]);
    });

    it('treats an empty line inside a hunk as a context line with trimmed whitespace', () => {
        expect(lines('@@ -1,3 +1,3 @@\n a\n\n-b\n+c\n')).toEqual([2]);
    });

    it('ignores "No newline at end of file" markers', () => {
        const diff = `--- a/x.css
+++ b/x.css
@@ -3 +3,2 @@
-}
\\ No newline at end of file
+}
+.b { top: 0 }
\\ No newline at end of file
`;
        expect(lines(diff)).toEqual([2, 3]);
    });

    it('does not mistake removed or added lines that look like headers', () => {
        // Removing "-- note" and adding "++ x" / "@@ y" produce lines that start like headers.
        const diff = '@@ -1,2 +1,2 @@\n--- note\n-a\n+++ x\n+@@ y\n';
        expect(lines(diff)).toEqual([0, 1]);
    });

    it('handles CRLF diffs', () => {
        expect(lines('--- a/x.css\r\n+++ b/x.css\r\n@@ -1 +1,2 @@\r\n-a\r\n+b\r\n+c\r\n')).toEqual([0, 1]);
    });

    it('returns nothing for diffs without hunks', () => {
        expect(lines('')).toEqual([]);
        expect(lines('diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n')).toEqual([]);
    });
});

/** `git diff -U0 HEAD` with a modification, a new file, a deletion, a rename and a binary change. */
const MULTI = `diff --git a/src/a.css b/src/a.css
index 83db48f..bf269f4 100644
--- a/src/a.css
+++ b/src/a.css
@@ -2 +2 @@ .a {
-  padding: 16px;
+  padding: 1rem;
@@ -10,0 +11,2 @@ .b {
+  margin: 8px;
+  gap: 4px;
diff --git a/src/new.scss b/src/new.scss
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/new.scss
@@ -0,0 +1,2 @@
+.x { top: 1px; }
+.y { top: 2px; }
\\ No newline at end of file
diff --git a/src/old.less b/src/old.less
deleted file mode 100644
index 1111111..0000000
--- a/src/old.less
+++ /dev/null
@@ -1,2 +0,0 @@
-.a { top: 1px; }
-.b { top: 2px; }
diff --git a/src/from.css b/src/to.css
similarity index 90%
rename from src/from.css
rename to src/to.css
index 2222222..3333333 100644
--- a/src/from.css
+++ b/src/to.css
@@ -4 +4 @@
---- removed comment line
+++++ added comment line
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`;

describe('splitDiffByFile', () => {
    it('splits a multi-file diff by new path and skips deleted files', () => {
        const files = splitDiffByFile(MULTI);
        expect([...files.keys()]).toEqual(['src/a.css', 'src/new.scss', 'src/to.css', 'logo.png']);
        expect(lines(files.get('src/a.css')!)).toEqual([1, 10, 11]);
        expect(lines(files.get('src/new.scss')!)).toEqual([0, 1]);
        expect(lines(files.get('src/to.css')!)).toEqual([3]);
        expect(lines(files.get('logo.png')!)).toEqual([]);
    });

    it('keeps each file diff intact, headers included', () => {
        const files = splitDiffByFile(MULTI);
        expect(files.get('src/new.scss')).toBe(`diff --git a/src/new.scss b/src/new.scss
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/new.scss
@@ -0,0 +1,2 @@
+.x { top: 1px; }
+.y { top: 2px; }
\\ No newline at end of file
`);
        expect(files.get('logo.png')).toBe('diff --git a/logo.png b/logo.png\nindex 4444444..5555555 100644\nBinary files a/logo.png and b/logo.png differ\n');
        // Concatenating the parts (plus the deleted file) gives back the input.
        expect([...files.values()].join('')).toBe(MULTI.replace(/diff --git a\/src\/old\.less[\s\S]*?(?=diff --git a\/src\/from)/, ''));
    });

    it('uses rename targets for renames without content changes', () => {
        const diff = 'diff --git a/a.css b/b.css\nsimilarity index 100%\nrename from a.css\nrename to b.css\n';
        expect([...splitDiffByFile(diff).keys()]).toEqual(['b.css']);
        expect([...splitDiffByFile('diff --git a/x.css b/x.css\nold mode 100644\nnew mode 100755\n').keys()]).toEqual(['x.css']);
    });

    it('decodes quoted paths and paths with spaces', () => {
        const diff = `diff --git "a/caf\\303\\251.css" "b/caf\\303\\251.css"
--- "a/caf\\303\\251.css"
+++ "b/caf\\303\\251.css"
@@ -1 +1 @@
-a
+b
diff --git a/my styles/main file.css b/my styles/main file.css
--- a/my styles/main file.css\t
+++ b/my styles/main file.css\t
@@ -3 +3 @@
-a
+b
diff --git "a/tab\\there.css" "b/tab\\there.css"
new file mode 100644
--- /dev/null
+++ "b/tab\\there.css"
@@ -0,0 +1 @@
+a
`;
        const files = splitDiffByFile(diff);
        expect([...files.keys()]).toEqual(['café.css', 'my styles/main file.css', 'tab\there.css']);
        expect(lines(files.get('my styles/main file.css')!)).toEqual([2]);
    });

    it('handles mnemonic prefixes and --no-prefix diffs', () => {
        const mnemonic = 'diff --git c/src/a.css w/src/a.css\n--- c/src/a.css\n+++ w/src/a.css\n@@ -1 +1 @@\n-a\n+b\n';
        expect([...splitDiffByFile(mnemonic).keys()]).toEqual(['src/a.css']);
        const noPrefix = 'diff --git b/a.css b/a.css\n--- b/a.css\n+++ b/a.css\n@@ -1 +1 @@\n-a\n+b\n';
        expect([...splitDiffByFile(noPrefix).keys()]).toEqual(['b/a.css']);
    });

    it('splits plain unified diffs without git headers', () => {
        const diff = `--- src/a.css\t2026-10-01 10:00:00
+++ src/a.css\t2026-10-02 10:00:00
@@ -1 +1 @@
-a
+b
--- src/b.css\t2026-10-01 10:00:00
+++ src/b.css\t2026-10-02 10:00:00
@@ -5,0 +6 @@
+c
`;
        const files = splitDiffByFile(diff);
        expect([...files.keys()]).toEqual(['src/a.css', 'src/b.css']);
        expect(lines(files.get('src/b.css')!)).toEqual([5]);
    });

    it('returns an empty map for an empty diff', () => {
        expect(splitDiffByFile('').size).toBe(0);
    });
});
