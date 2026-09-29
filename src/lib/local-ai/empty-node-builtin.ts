/**
 * Browser stand-in for the Node builtins transformers.js imports (fs, path).
 * Its env.js runs `Object.keys(fs)` at module load to detect a file system;
 * Turbopack's `false` mapping for the package's browser field has no default
 * export, so the import is `undefined` and module evaluation throws (seen on
 * velai.app 2026-09-28: the WASM engine never started). An empty object reads
 * as "no file system", which is what a browser is.
 */
const emptyBuiltin = {};
export default emptyBuiltin;
