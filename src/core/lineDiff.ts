/**
 * Lines of `newText` (zero-based) that are new or modified compared with
 * `oldText`. Used to compare an editor's unsaved content with HEAD.
 */
export function changedLinesBetween(oldText: string, newText: string): Set<number> {
    const a = oldText.split(/\r?\n/);
    const b = newText.split(/\r?\n/);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
        start++;
    }
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA--;
        endB--;
    }
    const changed = new Set<number>();
    if (endB < start) {
        return changed;
    }
    const midA = a.slice(start, endA + 1);
    const midB = b.slice(start, endB + 1);
    if (midA.length * midB.length > 4_000_000) {
        // Too large for an exact diff: treat the whole changed block as modified.
        for (let i = start; i <= endB; i++) {
            changed.add(i);
        }
        return changed;
    }
    // Longest common subsequence over the middle block.
    const n = midA.length;
    const m = midB.length;
    const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    let i = 0;
    let j = 0;
    while (j < m) {
        if (i < n && midA[i] === midB[j]) {
            i++;
            j++;
        } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
            i++;
        } else {
            changed.add(start + j);
            j++;
        }
    }
    return changed;
}
