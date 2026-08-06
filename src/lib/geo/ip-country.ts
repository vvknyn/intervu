/**
 * IP -> country ISO2, backed by db-ip's free "country lite" mmdb
 * (https://db-ip.com/db/download/ip-to-country-lite, CC BY 4.0, no account
 * or API key — see README.md's "Location data" section for attribution).
 *
 * The mmdb file itself is NOT committed (see scripts/download-mmdb.mjs and
 * .gitignore) — it's a deploy-time download, refreshed monthly. Every
 * failure mode here (file missing, corrupt, unreadable; IP absent/private/
 * unresolvable) fails OPEN to `null`: callers must treat "no default" as a
 * normal outcome, never surface an error over it.
 */
import { open, type CountryResponse, type Reader } from "maxmind";
import { join } from "node:path";

/** ISO2 for an IP, or null when it can't be resolved. */
export type CountryLookup = (ip: string) => Promise<string | null>;

const DEFAULT_MMDB_PATH = join(process.cwd(), "data", "geo", "dbip-country-lite.mmdb");

/**
 * Builds a `CountryLookup` backed by a real mmdb file, opened lazily and
 * memoized for the life of the process — mirrors the gazetteer's own
 * load-once-per-instance pattern. A missing/corrupt file is cached as "no
 * reader" so every subsequent call fails open without retrying a file that
 * isn't coming back until the next deploy.
 */
export function createMmdbCountryLookup(mmdbPath: string = DEFAULT_MMDB_PATH): CountryLookup {
  let readerPromise: Promise<Reader<CountryResponse> | null> | null = null;

  function loadReader(): Promise<Reader<CountryResponse> | null> {
    if (!readerPromise) {
      readerPromise = open<CountryResponse>(mmdbPath).catch(() => null);
    }
    return readerPromise;
  }

  return async (ip: string): Promise<string | null> => {
    if (!ip || ip === "unknown") return null;
    const reader = await loadReader();
    if (!reader) return null;
    try {
      return reader.get(ip)?.country?.iso_code ?? null;
    } catch {
      return null;
    }
  };
}
