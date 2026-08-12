import type { BoardId } from "@/lib/boards/types";
import type { CompanyNameSource } from "@/lib/companies/company-name";
import type { PublicJob } from "@/lib/jobs/types";

export type CompanyPageData = {
  domain: string;
  slug: string;
  /** Best-supported display name — the corpus's own string or, failing that,
   *  a domain-derived label. Never reconstructed casing; see `nameSource`. */
  name: string;
  /** Where `name` came from, so the renderer can tell an authoritative name
   *  from a case-flattened feed string ("1password") it must not present as
   *  the employer's official rendering. See `resolveCompanyName`. */
  nameSource: CompanyNameSource;
  /** Product blurb when available — never funding stage. */
  oneLiner: string | null;
  /** Funding / stage chip (from job aggregate). */
  stage: string | null;
  opened90d: number | null;
  closed90d: number | null;
  /**
   * True only when BOTH `opened90d` and `closed90d` are known, i.e. there is
   * a real open/close history to show — the renderer must hide the
   * track-record section rather than draw it from two nulls. The pair is read
   * whole from a single hit (see `resolveTrackRecord`), so the two numbers
   * always describe the same 90-day window and this can never be true with a
   * null on either side.
   */
  hasTrackRecord: boolean;
  openCount: number;
  /**
   * True when `openCount` is "at least this many" rather than an exact count
   * — the backend's total was itself capped or unprovable. Render it as
   * "200+", never as a bare exact number. See `resolveOpenCount`.
   */
  openCountIsLowerBound: boolean;
  /** Share of the FETCHED role window flagged likely-ghost — a sample of at
   *  most `COMPANY_JOBS_FETCH_LIMIT` roles, not a company-wide audit. */
  ghostFlaggedPct: number | null;
  jobs: PublicJob[];
  boards: BoardId[];
};
