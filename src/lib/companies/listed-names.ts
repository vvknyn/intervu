import { companyRolesParams, PUBLIC_ROLES_ATTRIBUTES } from "@/lib/companies/company-roles-query";
import { meiliSearchEach, type EachResult } from "@/lib/jobs/meilisearch";

/** Queries per /multi-search request. */
const BATCH = 50;

/** Domains per chunk: reading the whole directory at once times Meilisearch out at 3000 domains. */
const CHUNK = 150;

/** Chunks read at the same time; more than this and Meilisearch starts timing out again. */
const CHUNK_CONCURRENCY = 4;

/**
 * Per-attempt timeout of a batch read. Measured on the box 2026-10-24: a 50-domain batch (about 4,400 rows)
 * takes 3.8-5.4 s alone and 6.2-9.1 s with 12 in flight, past the 8 s search default, so a cold build
 * aborted batch after batch. Three times the worst measured, so a loaded box still finishes.
 */
export const EVIDENCE_TIMEOUT_MS = 30_000;

type BatchReader = typeof meiliSearchEach;

/**
 * Every batch is read once, then once more if it fails (a transient Meilisearch blip). A batch that
 * fails twice is logged with its index and size — prod masks Server Components errors to a digest —
 * and rethrown, so a failed read is never papered over.
 */
const readChunk = async (domains: readonly string[], read: BatchReader): Promise<EachResult[]> => {
  const batches: string[][] = [];
  for (let i = 0; i < domains.length; i += BATCH) batches.push(domains.slice(i, i + BATCH));
  const readBatch = (batch: string[]) => read(batch.map((domain) => ({ params: companyRolesParams(domain), attributesToRetrieve: PUBLIC_ROLES_ATTRIBUTES })), EVIDENCE_TIMEOUT_MS);
  const rows = await Promise.all(
    batches.map((batch, index) =>
      readBatch(batch)
        .catch(() => readBatch(batch))
        .catch((error: unknown) => {
          console.error(`directory evidence: batch ${index} (${batch.length} domains) failed twice: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        }),
    ),
  );
  return rows.flat();
};

/** `fn` over `items` with at most `limit` running at once; results in the order of `items`. The first failure rejects and no further item is started. */
const mapLimit = async <T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    for (let i = next++; !failed && i < items.length; i = next++) {
      try {
        results[i] = await fn(items[i]!);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** Rows and count fields per domain, in the order asked: the company page's own roles query, fewer attributes. */
export const fetchNameEvidence = async (domains: readonly string[], read: BatchReader = meiliSearchEach): Promise<EachResult[]> => {
  const chunks: string[][] = [];
  for (let i = 0; i < domains.length; i += CHUNK) chunks.push(domains.slice(i, i + CHUNK));
  return (await mapLimit(chunks, CHUNK_CONCURRENCY, (chunk) => readChunk(chunk, read))).flat();
};
