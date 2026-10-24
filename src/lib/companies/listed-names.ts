import { companyRolesParams } from "@/lib/companies/company-roles-query";
import { meiliSearchEach } from "@/lib/jobs/meilisearch";
import type { PublicJob } from "@/lib/jobs/types";

/** What the name, the internal-posting filter and the title+location dedupe read from a role row (the directory's evidence): a wider payload took 199 s for 3600 domains on the box. */
const EVIDENCE_ATTRIBUTES = ["company", "title", "location", "location_city", "location_state", "location_country"] as const;

/** Queries per /multi-search request. */
const BATCH = 50;

/** Domains per sequential round: concurrent reads of the whole directory time Meilisearch out at 3000 domains. */
const CHUNK = 150;

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

/** Rows per domain, in the order asked: the company page's own roles query, fewer attributes. */
export const fetchNameEvidence = async (domains: readonly string[], read: BatchReader = meiliSearchEach): Promise<PublicJob[][]> => {
  const rows: PublicJob[][] = [];
  for (let i = 0; i < domains.length; i += CHUNK) rows.push(...(await readChunk(domains.slice(i, i + CHUNK), read)));
  return rows;
};
