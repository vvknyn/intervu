import type { BoardId } from "@/lib/boards/types";
import type { CompanyNameSource } from "@/lib/companies/company-name";
import type { PublicJob } from "@/lib/jobs/types";

export interface CompanyFundingInfo {
  totalRaisedText: string | null;
  stage: string | null;
  valuationText: string | null;
  investors: string[];
}

export interface CompanyVisaInfo {
  h1bFilingsCount: number | null;
  approvalRatePct: number | null;
  sponsoredRolesRatioPct: number | null;
  permSponsored: boolean;
  topSponsoredRoles: { title: string; salaryRange: string }[];
}

export interface CompanyTechStackInfo {
  languages: string[];
  frameworks: string[];
  infrastructure: string[];
  aiMlTools: string[];
}

export interface CompanyWorkModesInfo {
  remotePct: number;
  hybridPct: number;
  onsitePct: number;
}

/** One article as returned by the Subspace `/companies/{domain}/news` endpoint — see fetchCompanyNews. */
export interface CompanyNewsArticle {
  title: string;
  url: string;
  summary: string | null;
  publisher: string;
  published_at: string | null;
  is_funding_event: boolean;
  /** The match tier the API published this under. The server owns the gate
   *  (high/medium, anchored matches only) — this is carried for provenance,
   *  NOT re-filtered here. Two gates in two repos drift apart. */
  confidence: "high" | "medium";
}

/** One published entry from Subspace's change-event ledger, already scoped to
 *  this company (the API strips the ledger's `"<domain> — "` title prefix). */
export interface CompanyChangeEvent {
  /** Ledger taxonomy: hiring_surge | hiring_freeze | funding | layoff |
   *  verdict_changed | needs_outside_firm_emerged. Typed as a string rather
   *  than a union on purpose — the vocabulary is owned by the projector in the
   *  other repo, and a union here would turn a new event type into a
   *  cross-repo type error instead of a row this page can simply render. */
  event_type: string;
  direction: "improving" | "declining" | "neutral";
  /** The projected sentence, e.g. "hiring has stalled: 167 new roles in 14d,
   *  down from 485". Already carries every number a reader needs. */
  headline: string;
  /** ISO-8601 — when the underlying change occurred, not when we saw it. */
  occurred_at: string;
  confidence: number | null;
  /**
   * The facts that BACK the headline, read out of the event's payload by the
   * API. Optional because a company page must still render against an older
   * API build that predates it — but a card with no evidence is a claim with
   * no proof, which is the whole reason this field exists.
   */
  evidence?: CompanyChangeEventEvidence | null;
}

/** Display-ready proof for one change-event. Mirrors the API's `evidence`. */
export interface CompanyChangeEventEvidence {
  /** Stats backing the claim, e.g. "44 new roles in 14 days, vs 13 in the 14 before". */
  metrics: { label: string; value: string }[];
  /** The window the claim was measured over — calendar dates, not timestamps. */
  window: { start: string; end: string } | null;
  /** A citable external source (SEC EDGAR, a state WARN portal). */
  sourceUrl: string | null;
  /** Where the observation came from, in plain words. */
  provenance: string | null;
}

export interface CompanyIntelligence {
  funding: CompanyFundingInfo | null;
  visa: CompanyVisaInfo | null;
  techStack: CompanyTechStackInfo | null;
  workModes: CompanyWorkModesInfo | null;
  news: CompanyNewsArticle[];
}

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
  /** Subspace enrichment intelligence suite (Funding, Visa & H1B, Tech DNA, Signals) */
  intelligence?: CompanyIntelligence;
  /** Published change-events from Subspace's ledger, newest first. Empty
   *  whenever the upstream call fails or the company has none — the two are
   *  deliberately indistinguishable here, because the page renders the same
   *  thing (nothing) either way rather than guessing at a reason. */
  changeEvents: CompanyChangeEvent[];
  /**
   * The clock read at the async I/O boundary (`getCompanyPageData`), not
   * inside the server component's render body — server components must stay
   * pure during render (a `Date.now()` call there is exactly the seam that
   * lets a cached/revalidated render bake in a stale value). Threaded to
   * `buildCompanyHiringAnswer`/`buildFreshnessFact` (presentation.ts), which
   * stay pure functions taking an explicit timestamp so they're
   * unit-testable without mocking the clock.
   */
  nowMs: number;
};
