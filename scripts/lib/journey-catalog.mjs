// Pure parse / compare / summarise for tests/journeys/CATALOG.md and the
// `@J-*` tags in tests/e2e/journeys/*.spec.ts. No I/O: the vitest lint
// (tests/unit/journey-catalog.test.ts), scripts/journey-summary.mjs and the
// coverage gate (scripts/lib/journey-coverage.mjs) all read the catalog
// through this one parser.

export const STATUSES = ["covered", "uncovered", "known-bug"];
// Two digits, or three once an area passes 99 (J-JOBS-101).
const ID_RE = /^J-[A-Z]+-\d{2,3}$/;
const TAG_ARRAY_RE = /tag:\s*\[([^\]]*)\]/g;
const TAG_RE = /['"`]@([^'"`]+)['"`]/g;

/** Catalog rows = markdown table rows whose first cell is a journey ID. */
export function parseCatalog(markdown) {
  const rows = [];
  for (const line of markdown.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (!ID_RE.test(cells[0])) continue;
    const [id, journey, persona, entry, auth, writes, status, spec] = cells;
    rows.push({ id, journey, persona, entry, auth, writes: writes.toLowerCase() === "yes", status, spec });
  }
  return rows;
}

/** Every tag array on a test declaration → its set of tags (without the @). */
export function extractTagSets(specSource) {
  const sets = [];
  for (const [, body] of specSource.matchAll(TAG_ARRAY_RE)) {
    sets.push(new Set([...body.matchAll(TAG_RE)].map((m) => m[1])));
  }
  return sets;
}

/** rows: parseCatalog output. specs: { fileName: source }. Returns error strings. */
export function lintCatalog(rows, specs) {
  const errors = [];
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.id)) errors.push(`duplicate catalog ID ${r.id}`);
    seen.add(r.id);
    if (!STATUSES.includes(r.status)) errors.push(`${r.id}: status "${r.status}" is not one of ${STATUSES.join(" | ")}`);
  }
  const tagSets = Object.values(specs).flatMap(extractTagSets);
  const tagged = new Set(tagSets.flatMap((s) => [...s].filter((t) => ID_RE.test(t))));
  for (const id of tagged) if (!seen.has(id)) errors.push(`spec tag @${id} has no catalog row`);
  for (const r of rows) {
    const hasSpec = tagged.has(r.id);
    if (r.status !== "uncovered" && !hasSpec) errors.push(`${r.id}: status ${r.status} but no spec is tagged @${r.id}`);
    if (r.status === "uncovered" && hasSpec) errors.push(`${r.id}: status uncovered but a spec is tagged @${r.id} — update the status`);
    if (r.writes && hasSpec && !tagSets.some((s) => s.has(r.id) && s.has("writes"))) {
      errors.push(`${r.id}: Writes=yes but its test is not tagged @writes`);
    }
  }
  return errors;
}

export function summarizeCatalog(rows) {
  const n = (s) => rows.filter((r) => r.status === s).length;
  return `journeys: ${rows.length} total, ${n("covered")} covered, ${n("uncovered")} uncovered, ${n("known-bug")} known-bug`;
}
