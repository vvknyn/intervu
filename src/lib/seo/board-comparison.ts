/**
 * One comparison table, three column variants. About uses "typical job board";
 * the alternative pages name Indeed / LinkedIn Jobs. Row labels and the velai
 * column are the same facts in every place they appear.
 */
export type ComparisonBoard = "typical" | "indeed" | "linkedin";

export const COMPARISON_HEADERS: Record<ComparisonBoard, string> = {
  typical: "typical job board",
  indeed: "Indeed",
  linkedin: "LinkedIn Jobs",
};

export const COMPARISON_ROWS: ReadonlyArray<{
  label: string;
  velai: string;
  typical: string;
  indeed: string;
  linkedin: string;
}> = [
  {
    label: "listings come from",
    velai: "employers' own career pages",
    typical: "employer ads + resold feeds",
    indeed: "paid ads mixed with scraped copies",
    linkedin: "recruiter posts, company pages, leftover Easy Apply reqs",
  },
  {
    label: "when a role closes",
    velai: "gone, usually within a day",
    typical: "lingers until the ad lapses",
    indeed: "stays until the advertiser stops paying",
    linkedin: "stays until someone remembers to take it down",
  },
  {
    label: "screening",
    velai: "posting check on every role",
    typical: "none disclosed",
    indeed: "none you can inspect",
    linkedin: "none you can inspect",
  },
  {
    label: "match scores",
    velai: "transparent match receipts (no pay-to-win badges)",
    typical: "invented percentages",
    indeed: '"be an early applicant" theater',
    linkedin: '"you\'re a top applicant" badges',
  },
];
