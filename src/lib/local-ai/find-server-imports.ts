export interface ServerImportHit {
    specifier: string;
    line: number;
}

/**
 * Scan `source` for import specifiers that `resolveDirective` classifies as
 * server-only (points into an `actions/` directory, or resolves to a file
 * whose first statement is "use server"). Pure and file-system-free — the
 * caller injects the resolution so this stays unit-testable with synthetic
 * strings instead of real files; `tests/unit/local-ai-no-cloud-imports.test.ts`
 * is the I/O wrapper that walks the real résumé-parse source tree with it.
 */
export function findServerImports(
    source: string,
    resolveDirective: (specifier: string) => boolean,
): ServerImportHit[] {
    const hits: ServerImportHit[] = [];
    const importLineRe = /^\s*import\b/;
    const dynamicImportRe = /\bimport\s*\(/;
    const specifierRe = /(?:from|import)\s*\(?\s*["']([^"']+)["']/;

    source.split("\n").forEach((line, idx) => {
        if (!importLineRe.test(line) && !dynamicImportRe.test(line)) return;
        const match = specifierRe.exec(line);
        if (!match) return;
        const specifier = match[1];
        if (resolveDirective(specifier)) {
            hits.push({ specifier, line: idx + 1 });
        }
    });

    return hits;
}
