/**
 * Which words of a rewritten line are new, so the line can show them: the
 * rewrite split into runs, each marked `added` when the original didn't have
 * those words in that place (a longest-common-subsequence over words).
 * Pure.
 */
export interface WordRun {
    text: string;
    added: boolean;
}

export function addedWordRuns(before: string, after: string): WordRun[] {
    const a = before.split(/(\s+)/).filter((t) => t.length > 0);
    const b = after.split(/(\s+)/).filter((t) => t.length > 0);
    const n = a.length;
    const m = b.length;
    // lcs[i][j]: common length of a[i..] and b[j..].
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const runs: WordRun[] = [];
    const push = (text: string, added: boolean) => {
        const last = runs[runs.length - 1];
        // Spaces join whichever run they sit in, so a run of new words reads as one.
        const isSpace = /^\s+$/.test(text);
        if (last && (last.added === added || isSpace)) last.text += text;
        else runs.push({ text, added: isSpace ? false : added });
    };
    let i = 0;
    let j = 0;
    while (j < m) {
        if (i < n && a[i] === b[j]) {
            push(b[j], false);
            i++;
            j++;
        } else if (i < n && lcs[i + 1][j] >= lcs[i][j + 1]) {
            i++;
        } else {
            push(b[j], true);
            j++;
        }
    }
    return runs;
}
