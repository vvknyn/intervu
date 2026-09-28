/**
 * One `test` for both unit runners: vitest (`npx vitest run <file>`, which
 * exposes it as a global — see vitest.config.ts) and node:test
 * (`npx tsx <file>`, what scripts/run-unit-tests.sh runs). Import from here
 * instead of "vitest", which is not a project dependency.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export const test: typeof import("node:test").test = (globalThis as { test?: never }).test ?? require("node:test").test;
