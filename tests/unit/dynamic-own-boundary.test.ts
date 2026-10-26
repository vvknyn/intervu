import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * Every `next/dynamic` call needs its own Suspense boundary.
 *
 * next/dist/shared/lib/lazy-dynamic/loadable.js wraps a dynamic component in
 * its own <Suspense> only when `ssr: false` or `loading` is set. Without
 * either, a late chunk suspends the NEAREST ancestor boundary, which on /jobs
 * is JobsRouteGate's `<Suspense fallback={null}>` around the whole page: the
 * page is hidden until the chunk arrives, and in dev every passive effect
 * re-runs on reveal (the saved-search "N new" asks went from 4 to 6).
 *
 * The verdict is read from the parsed options object, so any import name,
 * `export default dynamic(...)` and inline calls are all judged alike.
 */

/** Violations in one source text: one line per `next/dynamic` call that has no boundary of its own. */
export function dynamicWithoutBoundary(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const names = new Set<string>();
    const spaces = new Set<string>();
    for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "next/dynamic") continue;
        const b = st.importClause?.namedBindings;
        if (st.importClause?.name) names.add(st.importClause.name.text);
        if (b && ts.isNamespaceImport(b)) spaces.add(b.name.text);
        if (b && ts.isNamedImports(b)) for (const e of b.elements) if ((e.propertyName ?? e.name).text === "default") names.add(e.name.text);
    }
    const out: string[] = [];
    const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n)) {
            const c = n.expression;
            const isDynamic =
                (ts.isIdentifier(c) && names.has(c.text)) ||
                (ts.isPropertyAccessExpression(c) && c.name.text === "default" && ts.isIdentifier(c.expression) && spaces.has(c.expression.text));
            if (isDynamic) {
                const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
                // The options are the second argument, or the first when it is the object form.
                const opts = n.arguments.find((a, i) => i === 1 || (i === 0 && ts.isObjectLiteralExpression(a)));
                if (!opts || !ts.isObjectLiteralExpression(opts)) out.push(`${file}:${line} options ${opts ? "are not an object literal" : "missing"}`);
                else if (opts.properties.some((p) => ts.isSpreadAssignment(p))) out.push(`${file}:${line} options spread an unknown object`);
                else {
                    const prop = (k: string) => opts.properties.find((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === k) as ts.PropertyAssignment | undefined;
                    const loading = prop("loading");
                    const ssr = prop("ssr");
                    const hasLoading = !!loading && loading.initializer.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isIdentifier(loading.initializer) && loading.initializer.text === "undefined");
                    const ssrOff = !!ssr && ssr.initializer.kind === ts.SyntaxKind.FalseKeyword;
                    const shorthandLoading = opts.properties.some((p) => ts.isShorthandPropertyAssignment(p) && p.name.text === "loading");
                    if (!hasLoading && !ssrOff && !shorthandLoading) out.push(`${file}:${line} has neither \`loading\` nor \`ssr: false\``);
                }
            }
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
    });
}

test("every next/dynamic call in src/ has its own boundary", () => {
    const files = sources("src");
    const all = files.flatMap((f) => dynamicWithoutBoundary(f, readFileSync(f, "utf8")));
    assert.deepEqual(all, []);
});

test("the predicate sees shapes no current call uses", () => {
    const bad = (s: string) => dynamicWithoutBoundary("x.tsx", s).length;
    const imp = `import dyn from "next/dynamic";\n`;
    assert.equal(bad(imp + `const A = dyn(() => import("a"));`), 1, "aliased, no options");
    assert.equal(bad(imp + `const o = { ssr: true };\nconst A = dyn(() => import("a"), o);`), 1, "options through a variable");
    assert.equal(bad(imp + `export default dyn(() => import("a"), { ssr: true });`), 1, "export default");
    assert.equal(bad(imp + `function F() { return dyn(() => import("a"), { loading: undefined }); }`), 1, "inline, loading undefined");
    assert.equal(bad(imp + `const A = dyn(() => import("a"), { ...o });`), 1, "spread");
    assert.equal(bad(`import * as d from "next/dynamic";\nconst A = d.default(() => import("a"));`), 1, "namespace import");
    assert.equal(bad(`import { default as q } from "next/dynamic";\nconst A = q(() => import("a"));`), 1, "named default import");
    assert.equal(bad(imp + `const A = dyn(() => import("a"), { ssr: false });`), 0);
    assert.equal(bad(imp + `const A = dyn(() => import("a"), { "loading": () => null });`), 0);
    assert.equal(bad(`const dynamic = (f: unknown) => f;\nconst A = dynamic(() => 1);`), 0, "not next/dynamic");
});
