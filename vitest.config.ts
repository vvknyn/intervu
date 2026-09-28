import path from "node:path";

/**
 * Minimal vitest config so `npx vitest run <file>` can resolve the same
 * `@/*` → `./src/*` alias tsconfig.json declares (see its `compilerOptions.paths`)
 * — without this, vitest can't import any module that reaches into `src` via
 * `@/...`, which is most of the app. Mirrors tsconfig's one alias rather than
 * pulling in a tsconfig-paths plugin for a single entry.
 *
 * The project's unit tests are written against `node:test` (see `test:design`
 * and friends in package.json, all `npx tsx --test ...`); vitest can still
 * import and execute those files (they run as an import side effect and print
 * their own TAP `ok`/`not ok` lines), it just also reports "no test suite
 * found" afterward since it never sees its own `describe`/`it`. The per-file
 * `ok` lines are the real result for those files.
 *
 * Plain object export (not `defineConfig` from `vitest/config`) — vitest
 * itself isn't a project dependency (it's fetched on demand via `npx`,
 * per this repo's mandated `npx vitest run <file>` invocation), so
 * `vitest/config` isn't resolvable from this project's own node_modules at
 * config-load time. A plain Vite-shaped config object works identically.
 */
export default {
  // Exposes `test` as a global under vitest so tests/support/unit-test.ts can
  // serve one file to both runners; existing node:test files are unaffected.
  test: { globals: true },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
};
