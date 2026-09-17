/**
 * Comment-stripping for source-literal sweeps (e.g. "no file hard-codes a
 * retired domain"), so historical documentation of a migration doesn't
 * false-positive as a live reference. One implementation per comment
 * syntax, shared by every sweep that needs it.
 */

/** TS/TSX: block comments, JSX comment expressions, and full-line `//`. */
export function stripTsComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
        .replace(/^\s*\/\/.*$/gm, "");
}

/** Shell: full-line `#` comments (shebang included — it never carries a
 *  URL worth checking). */
export function stripShellComments(src: string): string {
    return src.replace(/^\s*#.*$/gm, "");
}
