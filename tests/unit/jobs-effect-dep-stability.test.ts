import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

/** Where the call starting at `at` ends, by balancing parentheses — so a
 *  nested call inside the body cannot be mistaken for the call's own tail. */
function callEnd(source: string, at: number): number {
    let depth = 0;
    for (let i = source.indexOf("(", at); i < source.length && i !== -1; i++) {
        const ch = source[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** The dependency array of the call starting at `at`, as identifiers. */
function depsOfCallAt(source: string, at: number): string[] | null {
    const end = callEnd(source, at);
    if (end === -1) return null;
    const call = source.slice(at, end);
    // The dependency array is the last bracketed group in the call.
    const open = call.lastIndexOf("[");
    const close = call.lastIndexOf("]");
    if (open === -1 || close < open) return null;
    return call
        .slice(open + 1, close)
        .split(",")
        .map((d) => d.replace(/\/\/.*$/gm, "").trim())
        .filter(Boolean);
}


/** The statement starting at `at`: up to the first `;` outside any bracket. */
function statementAt(source: string, at: number): string {
    let depth = 0;
    for (let i = at; i < source.length; i++) {
        const ch = source[i];
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if ((ch === ";" || (ch === "\n" && depth === 0 && !/[,.?:&|+(=]\s*$|^\s*[.?:&|]/.test(source.slice(source.lastIndexOf("\n", i - 1) + 1, i) + source.slice(i + 1, source.indexOf("\n", i + 1))))) && depth <= 0) return source.slice(at, i);
    }
    return source.slice(at);
}

/** A call whose result is a new array/object on every call. */
const FRESH_CALL =
    /\.(filter|map|slice|concat|sort|toSorted|toSpliced|toReversed|reverse|flat|flatMap|reduce)\(|\bObject\.(entries|keys|values|fromEntries|assign)\(|\bArray\.(from|of)\(|\bstructuredClone\(|\bnew (Set|Map|Date)\(|\.\.\.|=>|^\s*function\b/;
/** The method name of the outermost (last top-level) call in a chain, or the property read. */
function chainTail(v: string): string {
    let depth = 0;
    let tail = "";
    for (let i = 0; i < v.length; i++) {
        const ch = v[i]!;
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === "." && depth === 0) tail = /^\.(\w+)/.exec(v.slice(i))?.[1] ?? "";
    }
    return tail;
}
/** Chain ends that yield a primitive: `x.filter(f).length` and `.map(f).join(",")` are stable. */
const PRIMITIVE_TAILS = new Set(["length", "size", "join", "some", "every", "includes", "indexOf", "findIndex", "find", "at", "toString", "toLocaleString", "getTime"]);

/**
 * Does this declaration's value get a new identity on every render? Judged by
 * MEANING, not spelling: a literal, a conditional that yields one, a spread, an
 * array/object-building call (filter, map, slice, Object.entries, Array.from, ...), a
 * new Set/Map, or an inline function. A primitive derived from any of these
 * (`.length`, `.join(...)`, `.some(...)`) is stable.
 */
export function isFreshValue(rhs: string): boolean {
    const v = rhs.trim();
    if (/^(JSON\.stringify|String|Number|Boolean)\(|^`/.test(v)) return false;
    if (/^[\[{]/.test(v) || /\?\?\s*(\[\s*\]|\{\s*\})$/.test(v)) return true;
    if (/(\?|:)\s*[\[{]/.test(v) && !/\?\.|\?\?/.test(v.replace(/\?\?\s*[\[{]/, ""))) return true;
    return FRESH_CALL.test(v) && !PRIMITIVE_TAILS.has(chainTail(v));
}

/**
 * Names declared at component scope whose value is a NEW reference each render.
 *
 * Two sources of instability:
 *  - a fresh object/array literal (`const x = {`, `const x = [`, `?? []`);
 *  - a `useMemo`/`useCallback` whose OWN dependency list contains something
 *    unstable, which re-runs every render and hands back a new reference. The
 *    hook call reads as a stability guarantee, so this one hides well; it is
 *    resolved to a fixpoint because the chain can be any length.
 *
 * KNOWN LIMIT, stated rather than papered over: instability that arrives as a
 * PROP cannot be seen from inside one file. `LocationPickerSheet` took
 * `state={filterState}` — an object rebuilt by the page above it — memoized on
 * it, and reset the user's in-progress draft on every parent render. Catching
 * that needs the caller, which is a different (and much more expensive) kind
 * of check. Treat a prop in a dep array as suspect by reading, not by grep.
 */
export function unstableDeclarations(source: string): Set<string> {
    const names = new Set<string>();
    const memos: { name: string; deps: string[] }[] = [];
    // `const x = {`, `const x = [`, `const x: T = {`, `const x = expr ?? []`
    const decl =
        /^[ \t]+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.+)$/gm;
    for (const m of source.matchAll(decl)) {
        const name = m[1]!;
        const rhs = m[2]!.trim();
        const hook = /^(?:React\.)?(useMemo|useCallback)\s*\(/.exec(rhs);
        if (hook) {
            const deps = depsOfCallAt(source, m.index! + m[0]!.indexOf(rhs));
            if (deps) memos.push({ name, deps });
            continue;
        }
        // Remaining hook results are referentially stable across renders.
        if (/^(?:React\.)?(useRef|useState|useSyncExternalStore|useContext|useReducer)\s*\(/.test(rhs)) continue;
        if (isFreshValue(statementAt(source, m.index! + m[0]!.indexOf(rhs)))) names.add(name);
    }
    // A memo keyed on something unstable is itself unstable — to a fixpoint,
    // since one such memo can be the key of the next.
    for (let changed = true; changed; ) {
        changed = false;
        for (const memo of memos) {
            if (names.has(memo.name)) continue;
            if (memo.deps.some((d) => names.has(d))) {
                names.add(memo.name);
                changed = true;
            }
        }
    }
    return names;
}

/** Every `useEffect(...)` dependency array in `source`, as arrays of identifiers. */
export function effectDependencyLists(source: string): string[][] {
    const lists: string[][] = [];
    for (const m of source.matchAll(/\buse(?:Layout)?Effect\(/g)) {
        const deps = depsOfCallAt(source, m.index!);
        if (deps) lists.push(deps);
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

test("flags a useMemo keyed on an unstable value — the hook call is not the guarantee it looks like", () => {
    // A memo whose own deps change identity every render re-runs every render
    // and returns a NEW reference, so depending on it is depending on the
    // object underneath. This is the variant found in LocationPickerSheet on
    // 2026-08-24, one file over from the crash.
    const src = `
    const filterState = { facets, salaryMin };
    const seed = useMemo(() => build(filterState), [filterState]);
    useEffect(() => {
        setDraft(seed);
    }, [open, seed]);
`;
    assert.deepEqual(violations(src).map((v) => v.dep), ["seed"]);
});

test("does NOT flag a useMemo keyed only on stable values", () => {
    const src = `
    const seed = useMemo(() => build(open), [open]);
    useEffect(() => {
        setDraft(seed);
    }, [seed]);
`;
    assert.deepEqual(violations(src), []);
});

// ---------------------------------------------------------------------------
// The real file the incident happened in.
// ---------------------------------------------------------------------------

// The incident was in page.tsx, but nothing about the defect is particular to
// that file or that folder: SavedSearchesPanel (components/jobs, 2026-10-25)
// looped on `savedProp.filter(...)` while this gate still read only literals.
// The whole of src/ is scanned.
function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(name) ? [path] : [];
    });
}

test("isFreshValue reads meaning: calls that build arrays/objects, spreads, conditionals, functions", () => {
    for (const rhs of [
        "savedProp.filter((s) => !removed.has(s.id))",
        "rows\n  .map((r) => r.id)",
        "Object.entries(map)",
        "Array.from(set)",
        "{ ...a, b }",
        "cond ? [a] : []",
        "new Set(ids)",
        "(id: string) => go(id)",
        "structuredClone(x)",
    ]) assert.equal(isFreshValue(rhs), true, rhs);
    for (const rhs of ["rows.filter(f).length", "rows.map(f).join(',')", "rows.some(f)", "useFoo()", "a?.b", "x ?? y"]) {
        assert.equal(isFreshValue(rhs), false, rhs);
    }
});

test("flags a filtered copy of a prop as an effect dep (the SavedSearchesPanel shape)", () => {
    const src = `
    const saved = savedProp.filter((s) => !removedIds.has(s.id));
    useEffect(() => { void load(saved); }, [saved]);
`;
    assert.deepEqual(violations(src).map((v) => v.dep), ["saved"]);
});

test("flags a layout effect keyed on a multi-line Object.fromEntries", () => {
    const src = `
    const byId = Object.fromEntries(
        rows.map((r) => [r.id, r]),
    );
    useLayoutEffect(() => { measure(byId); }, [byId]);
`;
    assert.deepEqual(violations(src).map((v) => v.dep), ["byId"]);
});

test("no component in src/ has a per-render value in an effect dep array", () => {
    const found: string[] = [];
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
        const source = readFileSync(file, "utf8");
        for (const v of violations(source)) {
            found.push(`  - ${file.slice(process.cwd().length + 1)}: "${v.dep}" in [${v.deps.join(", ")}]`);
        }
    }
    assert.deepEqual(
        found,
        [],
        `an effect depends on a value rebuilt every render — this is React #185 waiting to happen:\n` +
            found.join("\n"),
    );
});
