/**
 * Generic multi-row `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`
 * builder, shared by every upsert-replace rollup this codebase runs
 * (`scripts/build-job-features.ts`, `scripts/roll-up-telemetry.ts`). Pure:
 * given a fixed column list, the conflict key, and a batch of rows, it
 * always builds the exact same SQL text and params for the same input —
 * the property an idempotent rollup depends on (upsert-replace, never
 * `count = count + n`).
 */
export function buildUpsert<T extends Record<string, unknown>>(
  table: string,
  columns: readonly (keyof T & string)[],
  conflictColumns: readonly (keyof T & string)[],
  rows: readonly T[],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const valueRows = rows.map((row) => {
    const placeholders = columns.map((col) => {
      params.push(row[col]);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const updateSet = columns
    .filter((c) => !conflictColumns.includes(c))
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  const text = `
    insert into ${table} (${columns.join(", ")})
    values ${valueRows.join(", ")}
    on conflict (${conflictColumns.join(", ")}) do update set ${updateSet}
  `;
  return { text, params };
}
