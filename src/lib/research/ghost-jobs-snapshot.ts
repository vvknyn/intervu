/**
 * /research/ghost-jobs' single source of truth for every printed number and
 * the article's JSON-LD dateModified. Before this module, the page hand-typed
 * each count/percentage/lift as a literal string — three of those literals
 * disagreed with the tables sitting right next to them ("24.5% better" under
 * a 0.677-vs-0.598 pair that is actually +13.2%; a "6%" dek under an 8.7%
 * table; a hand-typed dateModified nobody kept current). Fix: one committed
 * JSON snapshot (`data/research/ghost-jobs-snapshot.json`, same pattern as
 * `data/geo/gazetteer.json` — see `lib/geo/gazetteer.ts`) plus the pure
 * derivation functions below computing every share/lift the page prints.
 * Refresh the corpus by re-running the grading queries and editing that one
 * JSON file — never the page. Every printed number and the JSON-LD date move
 * together because they read from the same object.
 */
import snapshot from "../../../data/research/ghost-jobs-snapshot.json";

interface GradeBucket {
  count: number;
  description: string;
}

interface ScoredGroup {
  count: number;
  avgScore: number;
}

interface CompanySizeBucket {
  label: string;
  companies: number;
  jobs: number;
  avgScore: number;
}

interface GhostJobsSnapshotData {
  asOf: string;
  dateModified: string;
  totalScored: number;
  companiesCount: number;
  grades: { A: GradeBucket; B: GradeBucket; C: GradeBucket; DF: GradeBucket };
  salary: { posted: ScoredGroup; notPosted: ScoredGroup };
  remote: { remote: ScoredGroup; nonRemote: ScoredGroup };
  companySize: CompanySizeBucket[];
  staleness: { withPostedDate: number; over60d: number };
}

const raw = snapshot as GhostJobsSnapshotData;

/** Pure: share of `part` in `whole` as a fixed-decimal percentage string —
 *  the one rounding rule every printed share on this page goes through, so
 *  two call sites never round the same ratio two different ways. */
export function pct(part: number, whole: number, decimals = 1): string {
  if (whole <= 0) {
    throw new Error(`research-snapshot: cannot compute a share of a non-positive whole (${whole})`);
  }
  return ((part / whole) * 100).toFixed(decimals);
}

/** Pure: signed relative lift of `a` over `b` as a percentage string —
 *  "0.677 vs 0.598" becomes "+13.2", not a hand-typed guess next to it. */
export function liftPct(a: number, b: number, decimals = 1): string {
  if (b === 0) throw new Error("research-snapshot: cannot compute a lift over a zero baseline");
  const lift = ((a - b) / b) * 100;
  return `${lift >= 0 ? "+" : ""}${lift.toFixed(decimals)}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Pure: "2026-07-01" -> "July 2026" — the as-of line's month label, derived
 *  from the same date the snapshot itself is dated, never typed separately. */
export function formatMonthYear(isoDate: string): string {
  const [year, month] = isoDate.split("-");
  const monthName = MONTH_NAMES[Number(month) - 1];
  if (!monthName || !year) throw new Error(`research-snapshot: unparseable date "${isoDate}"`);
  return `${monthName} ${year}`;
}

/**
 * Fails loudly rather than rendering a silently wrong page: every breakdown
 * must sum to the same headline corpus size the grade table reports, or the
 * page is disagreeing with itself again — the exact bug this module exists
 * to close out. No lying fallbacks: a torn snapshot fails the build, it
 * never renders as 0 or gets silently dropped.
 */
function assertReconciled(snap: GhostJobsSnapshotData): void {
  const checks: Array<[string, number]> = [
    ["grades", snap.grades.A.count + snap.grades.B.count + snap.grades.C.count + snap.grades.DF.count],
    ["salary", snap.salary.posted.count + snap.salary.notPosted.count],
    ["remote", snap.remote.remote.count + snap.remote.nonRemote.count],
    ["companySize", snap.companySize.reduce((sum, b) => sum + b.jobs, 0)],
  ];
  for (const [name, sum] of checks) {
    if (sum !== snap.totalScored) {
      throw new Error(
        `research-snapshot: "${name}" breakdown sums to ${sum}, corpus total is ${snap.totalScored} — reconcile the source data before shipping this page`,
      );
    }
  }
}

assertReconciled(raw);

export interface GhostJobsStats {
  asOf: string;
  asOfLabel: string;
  dateModified: string;
  totalScored: number;
  companiesCount: number;
  grades: GhostJobsSnapshotData["grades"];
  gradePct: { A: string; B: string; C: string; DF: string };
  ambiguousOrWorsePct: string;
  salary: GhostJobsSnapshotData["salary"];
  salaryPostedSharePct: string;
  salaryLiftPct: string;
  remote: GhostJobsSnapshotData["remote"];
  remoteLiftPct: string;
  companySize: CompanySizeBucket[];
  companySizeLiftPct: string;
  staleness: GhostJobsSnapshotData["staleness"];
  stalenessPct: string;
}

/** The one call site the page renders from — computed once at module load
 *  (this is a fully static page: no request-time work, no per-render cost). */
export function getGhostJobsStats(): GhostJobsStats {
  const { totalScored, grades, salary, remote, companySize, staleness } = raw;
  const biggest = companySize[0]!;
  const smallest = companySize[companySize.length - 1]!;
  return {
    asOf: raw.asOf,
    asOfLabel: formatMonthYear(raw.asOf),
    dateModified: raw.dateModified,
    totalScored,
    companiesCount: raw.companiesCount,
    grades,
    gradePct: {
      A: pct(grades.A.count, totalScored),
      B: pct(grades.B.count, totalScored),
      C: pct(grades.C.count, totalScored),
      DF: pct(grades.DF.count, totalScored),
    },
    ambiguousOrWorsePct: pct(grades.C.count + grades.DF.count, totalScored),
    salary,
    salaryPostedSharePct: pct(salary.posted.count, totalScored, 0),
    salaryLiftPct: liftPct(salary.posted.avgScore, salary.notPosted.avgScore),
    remote,
    remoteLiftPct: liftPct(remote.remote.avgScore, remote.nonRemote.avgScore),
    companySize,
    companySizeLiftPct: liftPct(biggest.avgScore, smallest.avgScore),
    staleness,
    stalenessPct: pct(staleness.over60d, staleness.withPostedDate),
  };
}
