import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * `deploy/supabase/identity-schema.sql` is applied manually, never by CI or
 * app code (see the file's own header). Until this fix, the intervu_web
 * GRANT statements lived inside a `-- ROLE SETUP` COMMENT, so they were
 * never re-run when new intervu.* tables shipped (Aug 27:
 * resume_parse_counters, company_read_budgets) — prod got
 * `permission denied for table ...` until the grants were applied by hand.
 *
 * These guard the SHAPE, not the current table list: the grant must be
 * executable SQL (uncommented), must cover every table via
 * `ON ALL TABLES IN SCHEMA` rather than an enumerated list, and must sit
 * after every CREATE TABLE so a table added above is always in scope.
 */
const SCHEMA_PATH = "deploy/supabase/identity-schema.sql";
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

/** Strip SQL line comments (`-- ...` to end of line), preserving line breaks
 *  and character offsets elsewhere on each line, so position comparisons
 *  (e.g. "does X appear before Y") stay meaningful on the stripped text. */
const stripSqlComments = (src: string) =>
  src
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");

const ALL_TABLES_GRANT = /GRANT[\s\S]*?ON ALL TABLES IN SCHEMA intervu\b/i;

describe("identity-schema.sql: intervu_web grants are executable and enumerate no tables", () => {
  const stripped = stripSqlComments(read(SCHEMA_PATH));

  it("an uncommented GRANT ... ON ALL TABLES IN SCHEMA intervu actually runs", () => {
    assert.match(
      stripped,
      ALL_TABLES_GRANT,
      "the schema-wide grant must be live SQL, not documentation inside a comment"
    );
  });

  it("no uncommented CREATE TABLE appears after the ALL TABLES grant — every table is in scope", () => {
    const grantIdx = stripped.search(ALL_TABLES_GRANT);
    assert.ok(grantIdx >= 0, "grant must exist for this check to be meaningful");

    const createTableRe = /CREATE TABLE\b/gi;
    let match: RegExpExecArray | null;
    while ((match = createTableRe.exec(stripped))) {
      assert.ok(
        match.index < grantIdx,
        `a CREATE TABLE at offset ${match.index} follows the ALL TABLES grant at offset ${grantIdx} — ` +
          "it would ship without intervu_web privileges again"
      );
    }
  });

  it("no uncommented GRANT lists an intervu table by name (schema-wide only, no allowlist to fall behind)", () => {
    const grantStatements = stripped.match(/GRANT\b[^;]*;/gi) ?? [];
    assert.ok(grantStatements.length > 0, "expected at least one executable GRANT statement");
    for (const stmt of grantStatements) {
      assert.doesNotMatch(
        stmt,
        /intervu\.[a-zA-Z_]/,
        `GRANT statement names a specific table instead of the whole schema: ${stmt.trim()}`
      );
    }
  });
});
