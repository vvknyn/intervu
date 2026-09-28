import nextTs from "eslint-config-next/typescript";

// Preflight gate (`npm run lint:promises`), separate from the advisory `npm run lint`
// (which carries ~200 unrelated findings and cannot gate yet).
//
// A Promise in a condition is always truthy: `if (!isAdminUser(user))` without `await`
// let every signed-in user render /admin. Type-aware, so it covers every async function
// by construction -- no list of names to maintain. Void-return checks stay off (async
// event handlers are idiomatic React).
export default [
  // eslint-config-next's parser + plugin registration, minus its rules: this gate
  // enforces exactly one rule.
  ...nextTs.map(({ rules: _rules, ...config }) => config),
  // tsconfig's `include` globs skip dot-directories (src/app/.well-known/**), so the
  // project service cannot type them -- tsc does not check them either.
  { ignores: ["src/**/.*/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-misused-promises": ["error", { checksConditionals: true, checksVoidReturn: false }],
    },
  },
];
