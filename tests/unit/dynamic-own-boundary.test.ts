import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
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
 * Judged by meaning, with the type checker, not by spelling: a call is a
 * `next/dynamic` call when its resolved signature is declared by next/dynamic's
 * default export (so an alias, a re-export or a barrel is the same call), and it
 * has a boundary when its options' `ssr` is typed as the literal `false`, or
 * its `loading` is typed as a function that cannot be undefined.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const FIXTURES = join(ROOT, "tests/unit/__dynamic-fixtures__");

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".d.ts") ? [p] : [];
    });
}

/** The repo's own compiler options, over `src/` plus any in-memory files (path -> text). */
function programOver(files: string[], virtual: Map<string, string> = new Map()): ts.Program {
    const { config } = ts.readConfigFile(join(ROOT, "tsconfig.json"), ts.sys.readFile);
    const options = ts.parseJsonConfigFileContent(config, ts.sys, ROOT).options;
    const host = ts.createCompilerHost(options);
    const { getSourceFile, fileExists, readFile, directoryExists } = host;
    host.directoryExists = (d) => [...virtual.keys()].some((f) => f.startsWith(`${d}/`)) || !!directoryExists?.(d);
    host.fileExists = (f) => virtual.has(f) || fileExists(f);
    host.readFile = (f) => virtual.get(f) ?? readFile(f);
    host.getSourceFile = (f, lang, ...rest) =>
        virtual.has(f) ? ts.createSourceFile(f, virtual.get(f)!, lang, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : getSourceFile(f, lang, ...rest);
    return ts.createProgram({ rootNames: [...files, ...virtual.keys()], options, host });
}

/** The declarations of next/dynamic's default export, however the module reaches it. */
function dynamicDeclarations(program: ts.Program): Set<ts.Declaration> {
    const checker = program.getTypeChecker();
    const host = ts.createCompilerHost(program.getCompilerOptions());
    const resolved = ts.resolveModuleName("next/dynamic", join(ROOT, "src/x.ts"), program.getCompilerOptions(), host).resolvedModule;
    const module = resolved && program.getSourceFile(resolved.resolvedFileName);
    const moduleSymbol = module && checker.getSymbolAtLocation(module);
    const def = moduleSymbol && checker.tryGetMemberInModuleExports("default", moduleSymbol);
    assert.ok(def, "next/dynamic's default export resolves");
    return new Set((def.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(def) : def).declarations);
}

/** Violations in one source file: one line per `next/dynamic` call that has no boundary of its own. */
export function dynamicWithoutBoundary(program: ts.Program, decls: Set<ts.Declaration>, sf: ts.SourceFile): string[] {
    const checker = program.getTypeChecker();
    const out: string[] = [];
    const visit = (n: ts.Node) => {
        const declared = ts.isCallExpression(n) ? checker.getResolvedSignature(n)?.declaration : undefined;
        if (ts.isCallExpression(n) && declared && decls.has(declared)) {
            const where = `${sf.fileName}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
            // The options are the second argument, or the first when it is the object form.
            const opts = n.arguments[1] ?? n.arguments[0];
            const typeOf = (key: string) => {
                const prop = opts && checker.getTypeAtLocation(opts).getProperty(key);
                return prop && checker.getTypeOfSymbolAtLocation(prop, opts);
            };
            const ssr = typeOf("ssr");
            const loading = typeOf("loading");
            const ssrOff = !!ssr && !!(ssr.flags & ts.TypeFlags.BooleanLiteral) && checker.typeToString(ssr) === "false";
            const hasLoading = !!loading && (loading.isUnion() ? loading.types : [loading]).every((t) => t.getCallSignatures().length > 0);
            if (!ssrOff && !hasLoading) out.push(`${where} has neither \`loading\` (a function, never undefined) nor \`ssr: false\``);
        }
        ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
}

test("every next/dynamic call in src/ has its own boundary", () => {
    const started = Date.now();
    const program = programOver(sources(join(ROOT, "src")).concat(join(ROOT, "next-env.d.ts")));
    const decls = dynamicDeclarations(program);
    const all = program
        .getSourceFiles()
        .filter((sf) => sf.fileName.startsWith(join(ROOT, "src") + "/"))
        .flatMap((sf) => dynamicWithoutBoundary(program, decls, sf));
    console.log(`dynamic-own-boundary: src checked in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    assert.deepEqual(all, []);
});

/** Violations in `files` (name -> text) type-checked as a tiny project under tests/unit/__dynamic-fixtures__. */
function violations(files: Record<string, string>): string[] {
    const virtual = new Map(Object.entries(files).map(([name, text]) => [join(FIXTURES, name), text]));
    // Anchor: a project that never imports next/dynamic would not load it, and there would be no default export to compare with.
    const program = programOver([], new Map([...virtual, [join(FIXTURES, "anchor.ts"), `import "next/dynamic";`]]));
    const decls = dynamicDeclarations(program);
    return [...virtual.keys()].flatMap((f) => dynamicWithoutBoundary(program, decls, program.getSourceFile(f)!));
}

const IMP = `import dyn from "next/dynamic";\n`;
const bad = (text: string) => violations({ "a.tsx": text }).length;

test("the predicate fails every shape that has no boundary of its own", () => {
    assert.equal(bad(IMP + `const A = dyn(() => import("a"));`), 1, "aliased, no options");
    assert.equal(bad(IMP + `const o = { ssr: true };\nconst A = dyn(() => import("a"), o);`), 1, "options through a variable");
    assert.equal(bad(IMP + `export default dyn(() => import("a"), { ssr: true });`), 1, "export default");
    assert.equal(bad(IMP + `function F() { return dyn(() => import("a"), { loading: undefined }); }`), 1, "inline, loading undefined");
    assert.equal(bad(IMP + `const o = {};\nconst A = dyn(() => import("a"), { ...o });`), 1, "spread of an object with neither");
    assert.equal(bad(`import * as d from "next/dynamic";\nconst A = d.default(() => import("a"));`), 1, "namespace import");
    assert.equal(bad(`import { default as q } from "next/dynamic";\nconst A = q(() => import("a"));`), 1, "named default import");
    assert.equal(bad(IMP + `const A = dyn(() => import("a"), { loading: void 0 });`), 1, "loading: void 0");
    assert.equal(bad(IMP + `declare const loading: (() => null) | undefined;\nconst A = dyn(() => import("a"), { loading });`), 1, "shorthand loading that can be undefined");
    assert.equal(bad(IMP + `const lazy = dyn;\nconst A = lazy(() => import("a"));`), 1, "called through an alias of the function");
    assert.equal(bad(IMP + `declare const on: boolean;\nconst A = dyn(() => import("a"), { loading: on ? () => null : undefined });`), 1, "loading: cond ? fn : undefined");
    assert.equal(bad(IMP + `declare const on: boolean;\nconst A = dyn(() => import("a"), { ssr: on });`), 1, "ssr typed boolean, not false");
    assert.equal(
        violations({
            "barrel.ts": `export { default } from "next/dynamic";`,
            "use.tsx": `import viaBarrel from "./barrel";\nexport const A = viaBarrel(() => import("a"));`,
        }).length,
        1,
        "called through a barrel's re-export",
    );
    assert.equal(bad(`import dyn from "next/dynamic.js";\nconst A = dyn(() => import("a"));`), 1, "imported with the .js extension");
});

test("the predicate passes a call that has a boundary, and a call that is not next/dynamic", () => {
    assert.equal(bad(IMP + `const A = dyn(() => import("a"), { ssr: false });`), 0, "ssr: false");
    assert.equal(bad(IMP + `const A = dyn(() => import("a"), { "loading": () => null });`), 0, "quoted loading key");
    assert.equal(bad(IMP + `declare const loading: () => null;\nconst A = dyn(() => import("a"), { loading });`), 0, "shorthand loading, always a function");
    assert.equal(bad(IMP + `declare const on: boolean;\nconst A = dyn(() => import("a"), { loading: on ? () => null : () => "x" });`), 0, "loading: cond ? fn : fn");
    assert.equal(bad(IMP + `const o = { loading: () => null };\nconst A = dyn(() => import("a"), { ...o });`), 0, "spread of an object that carries loading");
    assert.equal(bad(IMP + `const A = dyn({ loader: () => import("a"), ssr: false });`), 0, "object form");
    assert.equal(bad(`const dynamic = (f: unknown) => f;\nconst A = dynamic(() => 1);`), 0, "a local function with the same name");
});
