/**
 * Thousands-separated integer for on-page counts (e.g. "12,345"). One
 * formatter so every count on a given surface renders identically instead of
 * each call site hand-rolling its own `.toLocaleString()`.
 */
export function formatCount(n: number): string {
    return n.toLocaleString("en-US");
}

/**
 * A count of roles with its noun: "1 role", "2 roles", "1,000+ roles".
 * `shown` is the count as the page writes it, when that is not the plain
 * number ("1,000+"). Release 75's live check read "1 roles" on a chip.
 */
export function rolesLabel(n: number, shown: string = formatCount(n)): string {
    return `${shown} ${n === 1 && !shown.endsWith("+") ? "role" : "roles"}`;
}
