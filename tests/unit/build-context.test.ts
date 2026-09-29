import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { dockerIgnoreFilter, findStrippedImports, formatOffences } from "../../scripts/lib/build-context.mjs";

const scan = (files: Record<string, string>, dockerignore: string) =>
  findStrippedImports({
    trackedFiles: Object.keys(files),
    isKept: dockerIgnoreFilter(dockerignore),
    readFile: (p: string) => files[p],
    excludeDirs: ["scripts"],
  });

test("dockerignore semantics: root-anchored, last match wins, re-include under excluded dir", () => {
  const kept = dockerIgnoreFilter("docs\n*.png\n**/*.md\n!DEPLOY.md\nopenclaw/x\n!openclaw/**");
  assert.equal(kept("docs/a.ts"), false);
  assert.equal(kept("src/docs/a.ts"), true, "Docker `docs` is root-only, unlike gitignore");
  assert.equal(kept("logo.png"), false);
  assert.equal(kept("public/logo.png"), true, "Docker `*.png` is root-only");
  assert.equal(kept("a/b/README.md"), false);
  assert.equal(kept("DEPLOY.md"), true);
  assert.equal(kept("openclaw/x/SKILL.md"), true);
});

test("instance: a kept root config importing a stripped sibling is reported with file:line", () => {
  const off = scan(
    {
      "playwright.config.ts": "export default {};",
      "playwright.journeys.config.ts": 'import a from "@playwright/test";\nimport base from "./playwright.config";\n',
    },
    "playwright.config.ts",
  );
  assert.deepEqual(off.map((o: { file: string; line: number }) => `${o.file}:${o.line}`), ["playwright.journeys.config.ts:2"]);
  assert.match(formatOffences(off), /playwright\.journeys\.config\.ts:2 .*playwright\.config\.ts/);
});

test("class: kept file importing docs/ or tests/ via relative, alias, dynamic and require forms", () => {
  const off = scan(
    {
      "docs/guide.ts": "export const g = 1;",
      "tests/helpers/fx.ts": "export const f = 1;",
      "src/lib/a.ts": 'import { g } from "../../docs/guide";\n',
      "src/lib/b.ts": 'export const x = () => import("../../tests/helpers/fx");\n',
      "src/lib/c.ts": 'const y = require("../../tests/helpers/fx.ts");\n',
      "next.config.ts": 'import { g } from "./docs/guide";\n',
    },
    "docs\ntests",
  );
  assert.deepEqual(
    off.map((o: { file: string }) => o.file),
    ["next.config.ts", "src/lib/a.ts", "src/lib/b.ts", "src/lib/c.ts"],
  );
});

test("kept-only graph passes; stripped importers, comments and packages are not offences", () => {
  const off = scan(
    {
      "tests/spec.ts": 'import "../playwright.config";',
      "playwright.config.ts": "export default {};",
      "src/a.ts": '// import "../docs/x"\nimport z from "zod";\nimport { b } from "@/b";\n',
      "src/b.ts": "export const b = 1;",
    },
    "tests\nplaywright*.config.ts",
  );
  assert.deepEqual(off, []);
});

test("transitive: a kept .js reached from a kept .ts that imports a stripped file is reported", () => {
  const off = scan(
    {
      "src/a.ts": 'import "./h.js";\n',
      "src/h.js": 'require("../docs/x.js");\n',
      "docs/x.js": "",
    },
    "docs",
  );
  assert.deepEqual(off.map((o: { file: string }) => o.file), ["src/h.js"]);
});

test("real repo: the checked-in .dockerignore leaves no kept file importing a stripped one", () => {
  const trackedFiles = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);
  const off = findStrippedImports({
    trackedFiles,
    isKept: dockerIgnoreFilter(readFileSync(".dockerignore", "utf8")),
    readFile: (p: string) => readFileSync(p, "utf8"),
    excludeDirs: ["node_modules", "scripts", "intervu-main-rd"],
  });
  assert.equal(off.length, 0, formatOffences(off));
});
