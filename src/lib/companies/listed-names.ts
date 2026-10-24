import { companyRolesParams } from "@/lib/companies/company-roles-query";
import { meiliSearchEach } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

/** What the name, the internal-posting filter and the title+location dedupe read from a role row (the directory's evidence): a wider payload took 199 s for 3600 domains on the box sequentially; with 4 chunks in flight 4200 domains took 107 s (2026-10-23). */
const EVIDENCE_ATTRIBUTES = ["company", "title", "location", "location_city", "location_state", "location_country"] as const;

/** Queries per /multi-search request. */
const BATCH = 50;

/** Domains per chunk: reading the whole directory at once times Meilisearch out at 3000 domains. */
const CHUNK = 150;

/** Chunks read at the same time; more than this and Meilisearch starts timing out again. */
const CHUNK_CONCURRENCY = 4;

type BatchReader = typeof meiliSearchEach;

/**
 * Every batch is read once, then once more if it fails (a transient Meilisearch blip). A batch that
 * fails twice is logged with its index and size — prod masks Server Components errors to a digest —
 * and rethrown, so a failed read is never papered over.
 */
const readChunk = async (domains: readonly string[], read: BatchReader): Promise<PublicJob[][]> => {
  const batches: string[][] = [];
  for (let i = 0; i < domains.length; i += BATCH) batches.push(domains.slice(i, i + BATCH));
  const readBatch = (batch: string[]) => read(batch.map((domain) => ({ params: companyRolesParams(domain), attributesToRetrieve: EVIDENCE_ATTRIBUTES })));
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

/** `fn` over `items` with at most `limit` running at once; results in the order of `items`, the first failure rejects. */
const mapLimit = async <T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

/** Rows per domain, in the order asked: the company page's own roles query, fewer attributes. */
export const fetchNameEvidence = async (domains: readonly string[], read: BatchReader = meiliSearchEach): Promise<PublicJob[][]> => {
  const chunks: string[][] = [];
  for (let i = 0; i < domains.length; i += CHUNK) chunks.push(domains.slice(i, i + CHUNK));
  return (await mapLimit(chunks, CHUNK_CONCURRENCY, (chunk) => readChunk(chunk, read))).flat();
};
