/**
 * Posting-STRUCTURE extractor — SPEC-2-PROFILES.md §2.
 *
 * Pure. No DB, no network. Every field is a fact read directly off a
 * `PublicJob` (either an already-structured field, or a literal pattern
 * found in `description`) — never an inference. NULL means "not stated in
 * the posting" and is itself a finding: it is never coalesced to 0 or
 * false. See `deploy/db-box/telemetry-derived.sql` for the destination
 * columns this mirrors 1:1.
 *
 * Reuses the house description parser (`formatDescription`,
 * `@/lib/jobs/format-description`) for structural counts instead of a
 * second bullet/heading scanner — that parser is already the system of
 * record for "what are the sections/bullets in this posting" (it drives
 * the job detail page's own rendering).
 */
import type { PublicJob } from "@/lib/jobs/types";
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import { descriptionNeedsFill } from "@/lib/jobs/fill-description";

export interface JobFeatures {
  job_id: string;
  computed_at: string;

  description_chars: number | null;
  bullet_count: number | null;
  paragraph_count: number | null;
  section_count: number | null;
  requirement_count: number | null;
  responsibility_count: number | null;
  title_chars: number;
  title_word_count: number;

  has_salary: boolean;
  salary_min: number | null;
  salary_max: number | null;
  salary_span_pct: number | null;
  has_equity_mention: boolean | null;
  has_benefits_section: boolean | null;
  benefit_count: number | null;
  has_visa_statement: boolean | null;
  has_eeo_boilerplate: boolean | null;

  years_experience_min: number | null;
  degree_required: boolean | null;
  degree_level: string | null;
  named_tech_count: number | null;
  has_nice_to_have_section: boolean | null;

  seniority_word: string | null;
  is_remote: boolean | null;
  is_hybrid: boolean | null;
  is_onsite: boolean | null;
  employment_type: string | null;

  apply_method: string;
  screening_question_count: number | null;
  ats_provider: string | null;

  first_seen_at: string | null;
  posted_at: string | null;
  repost_count: number | null;
  days_open: number | null;
}

// The literal words this codebase treats as a stated seniority signal in a
// title, in the order checked (first match wins when more than one is
// present, e.g. "Senior Staff Engineer" reports "Staff" — "Staff" is
// listed ahead of "Senior" deliberately, since "Senior Staff" outranks a
// bare "Staff" on the ladder). This is a fixed vocabulary check for a
// LITERAL word, same class as a unit/currency symbol table — not a
// name-ladder that gates behavior per rule.
const SENIORITY_WORDS = [
  "Principal", "Staff", "Senior", "Lead", "Director", "VP", "Chief", "Head",
  "Manager", "Associate", "Junior", "Entry", "Intern",
];

function findSeniorityWord(title: string): string | null {
  for (const word of SENIORITY_WORDS) {
    if (new RegExp(`\\b${word}\\b`, "i").test(title)) return word;
  }
  return null;
}

const EQUITY_RE = /\bequity\b|\bstock\s+options?\b|\bRSUs?\b|\bstock\s+grants?\b/i;
const VISA_RE = /\bvisa\b|\bsponsorship\b|\bh-?1b\b|\bwork\s+authorization\b/i;
const EEO_RE = /\bequal\s+opportunity\s+employer\b|\beeo\b/i;
const BENEFITS_HEADING_RE = /benefit|perks|compensation/i;
const NICE_TO_HAVE_HEADING_RE = /nice.to.have|preferred\s+qualifications?/i;
const REQUIREMENT_HEADING_RE = /requirement|qualification|what\s+you('|’)ll\s+need|your\s+background|who\s+you\s+are|what\s+you\s+bring/i;
const RESPONSIBILITY_HEADING_RE = /responsibilit|what\s+you('|’)ll\s+do|duties|your\s+impact|your\s+role|the\s+role/i;

// Degree keywords, checked in reading order — the FIRST one found in the
// text is reported as `degree_level`. This is a literal-phrase presence
// check, not a ranking of which degree the posting prefers.
const DEGREE_PATTERNS: Array<{ level: string; re: RegExp }> = [
  { level: "associate", re: /\bassociate('|’)?s?\s+degree\b/i },
  { level: "bachelor", re: /\bbachelor('|’)?s?\b|\bb\.?s\.?\b|\bb\.?a\.?\b|\bundergraduate\s+degree\b/i },
  { level: "master", re: /\bmaster('|’)?s?\b|\bm\.?s\.?\b|\bm\.?b\.?a\.?\b|\bgraduate\s+degree\b/i },
  { level: "phd", re: /\bph\.?d\.?\b|\bdoctorate\b/i },
];
const DEGREE_REQUIRED_RE = /\bdegree\s+(is\s+)?required\b|\brequires?\s+a\b[^.]{0,40}\bdegree\b|\bmust\s+have\b[^.]{0,60}\bdegree\b/i;

function findDegreeLevel(text: string): string | null {
  for (const { level, re } of DEGREE_PATTERNS) {
    if (re.test(text)) return level;
  }
  return null;
}

/** ATS provider parsed structurally out of `PublicJob.source` — no per-name
 *  enumeration. Sources arrive as "<provider>_direct" (see
 *  format-description.ts's module doc for examples); a bare "direct" (or an
 *  empty source) means no identifiable ATS, so `ats_provider` is null and
 *  `apply_method` reports the literal string "direct". Any new provider
 *  value is covered automatically — nothing here names one. */
function parseApplyMethod(source: string): { apply_method: string; ats_provider: string | null } {
  const base = source.replace(/_direct$/, "");
  if (base === "" || base === "direct") return { apply_method: "direct", ats_provider: null };
  return { apply_method: base, ats_provider: base };
}

function countHeadingItems(blocks: DescBlock[], headingRe: RegExp): number {
  let count = 0;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.type !== "heading" || !headingRe.test(block.text ?? "")) continue;
    const next = blocks[i + 1];
    if (next?.type === "list") count += next.items?.length ?? 0;
  }
  return count;
}

function hasHeadingMatching(blocks: DescBlock[], headingRe: RegExp): boolean {
  return blocks.some((b) => b.type === "heading" && headingRe.test(b.text ?? ""));
}

/** Structural facts derivable only from a COMPLETE description body. Null
 *  across the board while the body is still a truncated teaser — a count
 *  off a stub is a count of the stub, not of the posting. */
function extractDescriptionFacts(description: string | null) {
  if (descriptionNeedsFill(description)) {
    return {
      description_chars: null,
      bullet_count: null,
      paragraph_count: null,
      section_count: null,
      requirement_count: null,
      responsibility_count: null,
      has_equity_mention: null,
      has_benefits_section: null,
      benefit_count: null,
      has_visa_statement: null,
      has_eeo_boilerplate: null,
      degree_required: null,
      degree_level: null,
      has_nice_to_have_section: null,
    };
  }

  const text = description as string;
  const blocks = formatDescription(text);
  const headings = blocks.filter((b) => b.type === "heading");
  const bulletCount = blocks.reduce((n, b) => n + (b.type === "list" ? (b.items?.length ?? 0) : 0), 0);
  const paragraphCount = blocks.filter((b) => b.type === "para").length;
  const hasBenefits = hasHeadingMatching(blocks, BENEFITS_HEADING_RE);

  return {
    description_chars: text.length,
    bullet_count: bulletCount,
    paragraph_count: paragraphCount,
    section_count: headings.length,
    requirement_count: countHeadingItems(blocks, REQUIREMENT_HEADING_RE),
    responsibility_count: countHeadingItems(blocks, RESPONSIBILITY_HEADING_RE),
    has_equity_mention: EQUITY_RE.test(text),
    has_benefits_section: hasBenefits,
    benefit_count: hasBenefits ? countHeadingItems(blocks, BENEFITS_HEADING_RE) || null : null,
    has_visa_statement: VISA_RE.test(text),
    has_eeo_boilerplate: EEO_RE.test(text) || hasHeadingMatching(blocks, /equal\s+opportunity|eeo\s+statement/i),
    degree_required: DEGREE_REQUIRED_RE.test(text),
    degree_level: findDegreeLevel(text),
    has_nice_to_have_section: hasHeadingMatching(blocks, NICE_TO_HAVE_HEADING_RE),
  };
}

/** `now` is injected (epoch ms) so `computed_at`/`days_open` are
 *  deterministic under test, matching the house clock-injection pattern
 *  (`SearchLogContext.now` in `@/lib/jobs/search-log`). */
export function extractJobFeatures(job: PublicJob, now: number): JobFeatures {
  const descriptionFacts = extractDescriptionFacts(job.description);

  const hasSalary = job.salary_min != null || job.salary_max != null;
  const salarySpanPct =
    job.salary_min != null && job.salary_max != null && job.salary_min > 0
      ? ((job.salary_max - job.salary_min) / job.salary_min) * 100
      : null;

  const workType = job.work_type === "unknown" ? null : job.work_type;
  const { apply_method, ats_provider } = parseApplyMethod(job.source);

  const firstSeenMs = job.first_seen_at ? Date.parse(job.first_seen_at) : NaN;
  const daysOpen = Number.isFinite(firstSeenMs) ? Math.floor((now - firstSeenMs) / 86_400_000) : null;

  return {
    job_id: job.id,
    computed_at: new Date(now).toISOString(),

    ...descriptionFacts,
    title_chars: job.title.length,
    title_word_count: job.title.trim().split(/\s+/).filter(Boolean).length,

    has_salary: hasSalary,
    salary_min: job.salary_min,
    salary_max: job.salary_max,
    salary_span_pct: salarySpanPct,

    years_experience_min: job.min_years_experience ?? null,
    named_tech_count: job.tech_stack ? job.tech_stack.length : null,

    seniority_word: findSeniorityWord(job.title),
    is_remote: workType == null ? null : workType === "remote",
    is_hybrid: workType == null ? null : workType === "hybrid",
    is_onsite: workType == null ? null : workType === "onsite",
    employment_type: job.employment_type === "unknown" ? null : job.employment_type,

    apply_method,
    screening_question_count: null, // PublicJob carries no ATS screening-question data today.
    ats_provider,

    first_seen_at: job.first_seen_at,
    posted_at: job.posted_at,
    repost_count: null, // requires cross-job_id matching; see column comment in the DDL.
    days_open: daysOpen,
  };
}
