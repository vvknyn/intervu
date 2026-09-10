/**
 * Subspace Jobs API client (SERVER-ONLY).
 *
 * Read-only typed client for `GET /api/v1/jobs/{snapshot,changed}`. Keyset
 * pagination on the uuid `id`; envelope `{ data, meta: { next_cursor } }`;
 * auth via the `x-api-key` header.
 *
 * SERVER-ONLY: reads `SUBSPACE_API_KEY` (never a `NEXT_PUBLIC_*` var, so it is
 * not exposed to the browser). Import this only from server actions / route
 * handlers / scripts — never from a client component.
 *
 * Full contract: docs/intervu-jobs-api.md in the Subspace repo.
 */
import type { JobsApiEnvelope, PublicJob } from "./types";

const DEFAULT_BASE_URL = "https://www.thesubspace.io/api/v1";

export class SubspaceJobsError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "SubspaceJobsError";
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string {
  return (process.env.SUBSPACE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requireApiKey(): string {
  const key = process.env.SUBSPACE_API_KEY;
  if (!key) {
    throw new SubspaceJobsError(
      "SUBSPACE_API_KEY is not set — the Jobs API client cannot authenticate. " +
        "Add it to the server environment (never NEXT_PUBLIC).",
      undefined,
      "missing_api_key",
    );
  }
  return key;
}

export function hasSubspaceApiKey(): boolean {
  return Boolean(process.env.SUBSPACE_API_KEY);
}

/** True when `e` is a `SubspaceJobsError` raised because a request hit its
 *  `timeoutMs` deadline (as opposed to a real network/server failure). */
export function isSubspaceTimeout(e: unknown): boolean {
  return e instanceof SubspaceJobsError && e.code === "timeout";
}

interface FillDescriptionsEnvelope {
  data: Array<{ id: string; description: string | null }>;
}

async function postJson<T>(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<T> {
  const url = new URL(`${baseUrl()}${path}`);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "x-api-key": requireApiKey(),
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      ...(opts?.timeoutMs != null ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new SubspaceJobsError(`Timed out after ${opts?.timeoutMs} ms calling ${path}`, undefined, "timeout");
    }
    throw new SubspaceJobsError(
      `Network error calling ${path}: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      "network_error",
    );
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const errBody = (await res.json()) as { error?: { message?: string; code?: string } };
      if (errBody?.error) {
        message = errBody.error.message ?? message;
        code = errBody.error.code;
      }
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new SubspaceJobsError(`Jobs API ${path} failed: ${message}`, res.status, code);
  }

  return (await res.json()) as T;
}

async function getJson(
  path: string,
  params: Record<string, string | number | undefined>,
  opts?: { timeoutMs?: number },
): Promise<JobsApiEnvelope> {
  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "x-api-key": requireApiKey(), accept: "application/json" },
      // Always read the source of truth; intervu does its own caching/indexing.
      cache: "no-store",
      ...(opts?.timeoutMs != null ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new SubspaceJobsError(`Timed out after ${opts?.timeoutMs} ms calling ${path}`, undefined, "timeout");
    }
    throw new SubspaceJobsError(
      `Network error calling ${path}: ${e instanceof Error ? e.message : String(e)}`,
      undefined,
      "network_error",
    );
  }

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let code: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body?.error) {
        message = body.error.message ?? message;
        code = body.error.code;
      }
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new SubspaceJobsError(`Jobs API ${path} failed: ${message}`, res.status, code);
  }

  return (await res.json()) as JobsApiEnvelope;
}

export interface SnapshotPage {
  jobs: PublicJob[];
  nextCursor: string | null;
}

/** One page of the full active corpus. `limit` default 500, max 1000. */
export async function getSnapshot(
  opts: { cursor?: string; limit?: number } = {},
): Promise<SnapshotPage> {
  const env = await getJson("/jobs/snapshot", { cursor: opts.cursor, limit: opts.limit });
  return { jobs: env.data ?? [], nextCursor: env.meta?.next_cursor ?? null };
}

/** One page of the incremental delta since `since` (inclusive ISO-8601). */
export async function getChanged(
  opts: { since: string; cursor?: string; limit?: number },
): Promise<SnapshotPage> {
  const env = await getJson("/jobs/changed", {
    since: opts.since,
    cursor: opts.cursor,
    limit: opts.limit,
  });
  return { jobs: env.data ?? [], nextCursor: env.meta?.next_cursor ?? null };
}

/** Async-iterate the entire snapshot, following `next_cursor`. `maxPages` caps the walk. */
export async function* iterateSnapshot(
  opts: { limit?: number; maxPages?: number } = {},
): AsyncGenerator<PublicJob[]> {
  let cursor: string | undefined;
  let pages = 0;
  const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
  do {
    const { jobs, nextCursor } = await getSnapshot({ cursor, limit: opts.limit });
    yield jobs;
    cursor = nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < maxPages);
}

/** Demand-fill empty descriptions for visible hit ids (Subspace ladder/Postgres). */
export async function fillVisibleDescriptions(
  ids: string[],
  opts?: { mode?: "visible"; timeoutMs?: number },
): Promise<Array<{ id: string; description: string | null }>> {
  const capped = ids.slice(0, 20);
  if (capped.length === 0) return [];
  const body: { ids: string[]; mode?: "visible" } = { ids: capped };
  if (opts?.mode === "visible") {
    body.mode = "visible";
  }
  const env = await postJson<FillDescriptionsEnvelope>("/jobs/fill-descriptions", body, {
    timeoutMs: opts?.timeoutMs,
  });
  return env.data ?? [];
}

/** Async-iterate the delta since `since`, following `next_cursor`. */
export async function* iterateChanged(
  opts: { since: string; limit?: number; maxPages?: number },
): AsyncGenerator<PublicJob[]> {
  let cursor: string | undefined;
  let pages = 0;
  const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
  do {
    const { jobs, nextCursor } = await getChanged({ since: opts.since, cursor, limit: opts.limit });
    yield jobs;
    cursor = nextCursor ?? undefined;
    pages += 1;
  } while (cursor && pages < maxPages);
}
