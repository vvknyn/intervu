import assert from "node:assert/strict";
import { test } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lintCatalog, parseCatalog, summarizeCatalog } from "../../scripts/lib/journey-catalog.mjs";

const ROOT = join(__dirname, "../..");
const SPEC_DIR = join(ROOT, "tests/e2e/journeys");

const row = (id: string, status: string, writes = "no", spec = "a.spec.ts") =>
  `| ${id} | j | p | /x | signed-out | ${writes} | ${status} | ${spec} |`;
const catalog = (...rows: string[]) => parseCatalog(rows.join("\n"));
const spec = (...tagArrays: string[][]) =>
  tagArrays.map((t) => `test("t", { tag: [${t.map((x) => `'@${x}'`).join(", ")}] }, async () => {});`).join("\n");

test("the real catalog and real specs satisfy the contract", () => {
  const rows = parseCatalog(readFileSync(join(ROOT, "tests/journeys/CATALOG.md"), "utf8"));
  const specs = Object.fromEntries(
    readdirSync(SPEC_DIR).filter((f) => f.endsWith(".spec.ts")).map((f) => [f, readFileSync(join(SPEC_DIR, f), "utf8")]),
  );
  assert.ok(rows.length > 0, "catalog parsed to zero rows — the parser is blind");
  assert.deepEqual(lintCatalog(rows, specs), []);
  console.log(summarizeCatalog(rows));
});

test("negative control: a covered row with no tagged spec fails", () => {
  assert.match(lintCatalog(catalog(row("J-A-01", "covered")), { "a.spec.ts": spec([]) }).join("\n"), /J-A-01.*no spec is tagged/);
});

test("negative control: a tag with no catalog row fails", () => {
  assert.match(lintCatalog(catalog(row("J-A-01", "covered")), { "a.spec.ts": spec(["J-A-01"], ["J-B-09"]) }).join("\n"), /@J-B-09 has no catalog row/);
});

test("negative control: duplicate IDs fail", () => {
  const errors = lintCatalog(catalog(row("J-A-01", "covered"), row("J-A-01", "covered")), { "a.spec.ts": spec(["J-A-01"]) });
  assert.match(errors.join("\n"), /duplicate catalog ID J-A-01/);
});

test("negative control: Writes=yes without @writes fails; with @writes passes", () => {
  const rows = catalog(row("J-A-01", "covered", "yes"));
  assert.match(lintCatalog(rows, { "a.spec.ts": spec(["J-A-01"]) }).join("\n"), /Writes=yes/);
  assert.deepEqual(lintCatalog(rows, { "a.spec.ts": spec(["J-A-01", "writes"]) }), []);
});

test("uncovered rows are allowed without a spec, but fail once a spec is tagged", () => {
  assert.deepEqual(lintCatalog(catalog(row("J-A-01", "uncovered", "no", "—")), { "a.spec.ts": spec([]) }), []);
  assert.match(lintCatalog(catalog(row("J-A-01", "uncovered")), { "a.spec.ts": spec(["J-A-01"]) }).join("\n"), /status uncovered but a spec is tagged/);
});

test("known-bug needs a tagged spec like covered does; an unknown status fails", () => {
  assert.match(lintCatalog(catalog(row("J-A-01", "known-bug")), {}).join("\n"), /known-bug but no spec/);
  assert.match(lintCatalog(catalog(row("J-A-01", "done")), { "a.spec.ts": spec(["J-A-01"]) }).join("\n"), /status "done"/);
});

test("summary counts every status", () => {
  const rows = catalog(row("J-A-01", "covered"), row("J-A-02", "uncovered"), row("J-A-03", "uncovered"), row("J-A-04", "known-bug"));
  assert.equal(summarizeCatalog(rows), "journeys: 4 total, 1 covered, 2 uncovered, 1 known-bug");
});
