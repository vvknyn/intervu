/**
 * Generic multi-row `INSERT ... ON CONFLICT (...) DO UPDATE SET ...`
 * builder, shared by every upsert-replace rollup this codebase runs
 * (`scripts/build-job-features.ts`, `scripts/roll-up-telemetry.ts`). Pure:
 * given a fixed column list, the conflict key, and a batch of rows, it
 * always builds the exact same SQL text and params for the same input —
 * the property an idempotent rollup depends on (upsert-replace, never
 * `count = count + n`).
 *
 * `touchColumns` (optional, default none) names columns to stamp with
 * `now()` on the UPDATE branch only — for a column like `computed_at` that
 * has a `default now()` in the DDL (covering INSERT) but is never itself
 * one of the row's data `columns`, so the base `columns minus
 * conflictColumns` update set never touches it and it freezes at its
 * first-insert value on every later UPDATE. Not added to the insert column
 * list (the DDL default already covers INSERT) and not added to `params`
 * (`now()` is evaluated server-side, at the same transaction timestamp the
 * DDL default itself uses).
 */
import type { Queryable } from "@/lib/pg/pool";

/** Postgres's wire protocol carries the bind-parameter count in an Int16, so a
 *  single statement can bind at most 65535 values; past that it fails with
 *  "bind message has N parameter formats but 0 parameters". */
export const MAX_BIND_PARAMS = 65535;

/** Pure: split `rows` into the fewest batches whose rows x columns stays within
 *  `MAX_BIND_PARAMS`. The batch size is derived from the column count, so a
 *  wide table gets smaller batches than a narrow one. */
export function chunkRowsForBind<T>(rows: readonly T[], columnCount: number): T[][] {
  const rowsPerChunk = Math.floor(MAX_BIND_PARAMS / columnCount);
  if (rowsPerChunk < 1) {
    throw new Error(`${columnCount} columns exceed the ${MAX_BIND_PARAMS}-parameter limit for even one row`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += rowsPerChunk) chunks.push(rows.slice(i, i + rowsPerChunk));
  return chunks;
}

// `object`, not `Record<string, unknown>`: the body only needs `keyof T`
// (column lists) and `row[col]` (both work on any object type), and a
// `Record` index signature is stronger than that. Row types declared with
// `interface` (JobFeatures, JobDailyRow, ...) get no implicit index
// signature — TS keeps that open for future declaration merging — so
// `Record<string, unknown>` rejects them with TS2344. `object` still
// excludes primitives, which is all the exclusion this helper needs.
export function buildUpsert<T extends object>(
  table: string,
  columns: readonly (keyof T & string)[],
  conflictColumns: readonly (keyof T & string)[],
  rows: readonly T[],
  touchColumns: readonly string[] = [],
): { text: string; params: unknown[] } {
  const params: unknown[] = [];
  const valueRows = rows.map((row) => {
    const placeholders = columns.map((col) => {
      params.push(row[col]);
      return `$${params.length}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const updateSet = [
    ...columns
      .filter((c) => !conflictColumns.includes(c))
      .map((c) => `${c} = excluded.${c}`),
    ...touchColumns.map((c) => `${c} = now()`),
  ].join(", ");
  const text = `
    insert into ${table} (${columns.join(", ")})
    values ${valueRows.join(", ")}
    on conflict (${conflictColumns.join(", ")}) do update set ${updateSet}
  `;
  return { text, params };
}

/** The one way to write a batch: `buildUpsert` per bind-safe chunk. Returns the
 *  number of rows written (`rows.length`, since each chunk either executes in
 *  full or throws). Chunks are separate statements, not one transaction — safe
 *  because upsert-replace makes a rerun of the whole batch idempotent. */
export async function upsertRows<T extends object>(
  db: Queryable,
  table: string,
  columns: readonly (keyof T & string)[],
  conflictColumns: readonly (keyof T & string)[],
  rows: readonly T[],
  touchColumns: readonly string[] = [],
): Promise<number> {
  for (const chunk of chunkRowsForBind(rows, columns.length)) {
    const { text, params } = buildUpsert<T>(table, columns, conflictColumns, chunk, touchColumns);
    await db.query(text, params);
  }
  return rows.length;
}
