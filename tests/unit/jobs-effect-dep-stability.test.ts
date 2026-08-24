import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards a whole BUG CLASS: a value that is rebuilt on every render listed in
 * a `useEffect` dependency array.
 *
 * The incident (2026-08-24, prod): the /jobs docked-search effect was changed
 * to depend on `filterState` — an object literal reassembled every render —
 * while its own body called `setDocked(...)`, whose provider lives above the
 * page. Effect runs → provider state changes → page re-renders → `filterState`
 * is a NEW object → effect runs again. React threw #185 ("Maximum update depth
 * exceeded") and the SERP fell into its error boundary.
 *
 * It only fired once `searchOutOfView` turned true, because until then the
 * effect returned early at an idempotent `setDocked(null)`. That is why it read
 * as "the page crashes when I scroll" and why every static gate passed: `tsc`,
 * the unit suite and `next build` all check that the code is well-typed and
 * well-formed, and this code was both. Reference IDENTITY across renders is a
 * runtime property, so only running the component — or a check like this one —
 * can see it.
 *
 * The check derives the unstable names FROM THE SOURCE rather than looking for
 * `filterState` by name: a rule that enumerates the one identifier that already
 * bit us would not have caught this one before it shipped, and will not catch
 * the next one. Anything declared at component scope as a fresh object/array
 * literal is unstable by construction; `useMemo`/`useCallback`/`useRef`/
 * `useState` results are stable and are deliberately not flagged.
 */

/** Names declared at component scope whose value is a NEW reference each render. */
export function unstableDeclarations(source: string): Set<string> {
    const names = new Set<string>();
    // `const x = {`, `const x = [`, `const x: T = {`, `const x = expr ?? []`
    const decl =
        /^[ \t]+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.+)$/gm;
    for (const m of source.matchAll(decl)) {
        const name = m[1]!;
        const rhs = m[2]!.trim();
        // Hook results are referentially stable across renders by contract.
        if (/^(useMemo|useCallback|useRef|useState|useSyncExternalStore)\s*\(/.test(rhs)) continue;
        const isFreshLiteral = rhs.startsWith("{") || rhs.startsWith("[");
        const isNullishToLiteral = /\?\?\s*(\[\s*\]|\{\s*\})\s*;?$/.test(rhs);
        if (isFreshLiteral || isNullishToLiteral) names.add(name);
    }
    return names;
}

/** Every `useEffect(...)` dependency array in `source`, as arrays of identifiers. */
export function effectDependencyLists(source: string): string[][] {
    const lists: string[][] = [];
    const marker = "useEffect(";
    for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
        // Balance parentheses to find where this call ends, so a nested call
        // inside the effect body cannot be mistaken for the effect's own tail.
        let depth = 0;
        let end = -1;
        for (let i = at + marker.length - 1; i < source.length; i++) {
            const ch = source[i];
            if (ch === "(") depth++;
            else if (ch === ")") {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }
        if (end === -1) continue;
        const call = source.slice(at, end);
        // The dependency array is the last bracketed group in the call.
        const open = call.lastIndexOf("[");
        const close = call.lastIndexOf("]");
        if (open === -1 || close < open) continue;
        lists.push(
            call
                .slice(open + 1, close)
                .split(",")
                .map((d) => d.replace(/\/\/.*$/gm, "").trim())
                .filter(Boolean),
        );
    }
    return lists;
}

function violations(source: string): { dep: string; deps: string[] }[] {
    const unstable = unstableDeclarations(source);
    const found: { dep: string; deps: string[] }[] = [];
    for (const deps of effectDependencyLists(source)) {
        for (const dep of deps) {
            if (unstable.has(dep)) found.push({ dep, deps });
        }
    }
    return found;
}

// ---------------------------------------------------------------------------
// The scanner itself, on synthetic sources — a case OTHER than the one that
// surfaced the bug, so this gate is proven to work on code it has never seen.
// ---------------------------------------------------------------------------

test("flags an object literal rebuilt every render used as an effect dep", () => {
    const src = `
    const payload = { a, b };
    useEffect(() => {
        push(payload);
    }, [payload]);
`;
    assert.deepEqual(violations(src).map((v) => v.dep), ["payload"]);
});

test("flags the `?? []` idiom — the empty-array default is a new array each render", () => {
    const src = `
    const rows = data.rows ?? [];
    useEffect(() => {
        sync(rows);
    }, [rows]);
`;
    assert.deepEqual(violations(src).map((v) => v.dep), ["rows"]);
});

test("does NOT flag useMemo/useCallback/useRef/useState results", () => {
    const src = `
    const memoized = useMemo(() => ({ a }), [a]);
    const handler = useCallback(() => {}, []);
    const [state, setState] = useState({ a: 1 });
    useEffect(() => {
        run(memoized, handler, state);
    }, [memoized, handler, state]);
`;
    assert.deepEqual(violations(src), []);
});

test("does NOT flag a primitive derived from an unstable object", () => {
    // This is the shape the fix uses: derive a string, depend on the string.
    const src = `
    const filterState = { facets, salaryMin };
    const label = labelFor(filterState);
    useEffect(() => {
        setDocked(label);
    }, [label]);
`;
    assert.deepEqual(violations(src), []);
});

test("a nested call inside the effect body is not mistaken for the dep array", () => {
    const src = `
    const thing = { a };
    useEffect(() => {
        items.forEach((x) => register(x, [1, 2]));
    }, [stable]);
`;
    assert.deepEqual(violations(src), []);
});

// ---------------------------------------------------------------------------
// The real file the incident happened in.
// ---------------------------------------------------------------------------

test("src/app/jobs/page.tsx has no per-render value in any useEffect dep array", () => {
    const source = readFileSync(join(process.cwd(), "src/app/jobs/page.tsx"), "utf8");
    const found = violations(source);
    assert.deepEqual(
        found,
        [],
        `useEffect depends on a value rebuilt every render — this is React #185 waiting to happen:\n` +
            found.map((v) => `  - "${v.dep}" in [${v.deps.join(", ")}]`).join("\n"),
    );
});
