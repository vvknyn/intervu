import type { BoardId } from "@/lib/boards/types";
import type { PublicJob } from "@/lib/jobs/types";

export type CompanyPageData = {
  domain: string;
  slug: string;
  name: string;
  /** Product blurb when available — never funding stage. */
  oneLiner: string | null;
  /** Funding / stage chip (from job aggregate). */
  stage: string | null;
  opened90d: number | null;
  closed90d: number | null;
  openCount: number;
  ghostFlaggedPct: number | null;
  jobs: PublicJob[];
  boards: BoardId[];
};
