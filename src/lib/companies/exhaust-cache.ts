import { readCompanyExhaust, type CompanyExhaust } from "@/lib/companies/exhaust";

/**
 * The company page's box-database read, kept per employer in this server
 * process.
 *
 * The page no longer waits for a slow box read (`getCompanyPageData`,
 * get-company.ts): past its budget it renders without the hiring record and
 * the other box bands. The read still finishes, and this is where it lands,
 * so the next visitor gets those bands at once. Company pages are visited a
 * few times a day each, so an entry is served for up to a day while a fresh
 * read replaces it in the background after an hour: the counts move by the
 * day, and a big employer whose read never fits the budget still shows its
 * record to everyone after the first visit.
 *
 * Only complete reads are kept (`readCompanyExhaust`), and a domain has at
 * most one read in flight, so a burst of visits to one page costs one read.
 */

/** After this an entry is still served, and a fresh read replaces it. */
export const EXHAUST_FRESH_MS = 60 * 60_000;
/** After this an entry is not served: the visit waits on a new read. */
export const EXHAUST_MAX_AGE_MS = 24 * 60 * 60_000;
/** Employers kept; the least recently used goes first. */
export const EXHAUST_MAX_ENTRIES = 1_000;

type Read = (domain: string) => Promise<{ exhaust: CompanyExhaust | null; complete: boolean }>;

export function createExhaustCache(
  read: Read,
  options: { now?: () => number; freshMs?: number; maxAgeMs?: number; maxEntries?: number } = {},
): (domain: string) => Promise<CompanyExhaust | null> {
  const now = options.now ?? Date.now;
  const freshMs = options.freshMs ?? EXHAUST_FRESH_MS;
  const maxAgeMs = options.maxAgeMs ?? EXHAUST_MAX_AGE_MS;
  const maxEntries = options.maxEntries ?? EXHAUST_MAX_ENTRIES;
  const entries = new Map<string, { exhaust: CompanyExhaust | null; at: number }>();
  const inFlight = new Map<string, Promise<CompanyExhaust | null>>();

  function load(domain: string): Promise<CompanyExhaust | null> {
    const pending = inFlight.get(domain);
    if (pending) return pending;
    const started = read(domain)
      .then(({ exhaust, complete }) => {
        if (complete) {
          entries.delete(domain);
          entries.set(domain, { exhaust, at: now() });
          if (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
        }
        return exhaust;
      })
      // The page treats a missing box read as "no box data", as it always has.
      .catch(() => null)
      .finally(() => inFlight.delete(domain));
    inFlight.set(domain, started);
    return started;
  }

  return async (domain) => {
    const entry = entries.get(domain);
    const age = entry ? now() - entry.at : Infinity;
    if (!entry || age >= maxAgeMs) return load(domain);
    // Most recently used goes to the back of the eviction order.
    entries.delete(domain);
    entries.set(domain, entry);
    if (age >= freshMs) void load(domain);
    return entry.exhaust;
  };
}

/** The page's shared instance. */
export const getSharedCompanyExhaust = createExhaustCache((domain) => readCompanyExhaust(domain));
