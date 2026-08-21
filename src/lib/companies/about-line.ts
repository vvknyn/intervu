/**
 * `extractCompanyAboutLine`: the /co hero's about line, sourced ONLY from
 * the company's own job postings — their words, never invented. Founding-
 * wound law (see `founding-wound-ai-autofill-burnt` — the product never
 * fabricates or paraphrases into a claim): this function either returns a
 * VERBATIM sentence lifted from posting text, or `null`. There is no third
 * option and no "best guess" fallback.
 *
 * Why postings, not a dedicated field: the index carries no product-tagline
 * column (see the comment this replaced in get-company.ts). But companies
 * routinely paste the same "About {Company}" paragraph into every posting —
 * that's boilerplate REPETITION, and repetition across DISTINCT postings is
 * the signal a paragraph is company-authored copy rather than role-specific
 * content. A different kind of paragraph also repeats across postings (EEO
 * notices, apply instructions) — the noise-cue penalties below down-rank
 * those so the genuine "about us" paragraph wins the vote.
 *
 * Pipeline: block-split every posting's description into the SAME display-
 * form blocks the SERP detail pane renders (`blocksOf`, via
 * `formatDescription`) → group `para` blocks by a normalized match key so
 * near-identical repeats across postings count as the same paragraph, and
 * flag any paragraph that sat right after an "About {Company}" heading
 * block (`buildCandidates`) → keep only paragraphs that either repeat
 * across ≥2 distinct postings, or (single-posting companies only) carry the
 * heading flag or open with an "About {Company}" / "{Company} is/builds/…"
 * cue → score and rank the survivors (`pickWinner`) → require the winner to
 * actually name the company (rule 4 — blocks a mission-statement paragraph
 * that never mentions the company from winning by sheer repetition) → pick
 * one complete, verbatim sentence out of it (`selectSentence`).
 */
import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";
import type { PublicJob } from "@/lib/jobs/types";

const MIN_PARAGRAPH_LEN = 80;
const MAX_PARAGRAPH_LEN = 1000;
const MIN_SENTENCE_LEN = 60;
const MAX_SENTENCE_LEN = 200;

/** Paragraph text that reads as ATS/HR boilerplate rather than "about the
 *  company" prose. These also tend to repeat verbatim across a company's
 *  postings (an EEO notice or apply-instructions block is copy-pasted just
 *  like a real about-paragraph is) — they are scoring inputs that pull a
 *  candidate's rank DOWN, not an identity gate; any paragraph can carry
 *  more than one of these and loses a point per match. */
const NOISE_CUE_RES: RegExp[] = [
  /equal opportunit/i,
  /reasonable accommodat/i,
  /benefits (?:include|package)/i,
  /E-Verify/i,
  /background check/i,
  /how to apply/i,
];

/** A sentence carries enough substance to stand alone as the hero's about
 *  line — as opposed to a true-but-empty opener like "1Password is
 *  growing." (rejected below on length, not on this cue: it DOES match
 *  "is"). Reused both to score a candidate paragraph's opening line and to
 *  pick the winning sentence within it. */
const DESCRIPTIVE_CUE_RE = /\b(?:is|builds|provides|platform|software|company|provider|leader|manages?)\b/i;

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "About {Company}" — the strongest possible cue a posting can carry, both
 *  as a standalone heading block (see `buildCandidates`' heading walk) and
 *  as literal opening text on a single-posting company's only candidate
 *  paragraph. Single source of truth for that pattern — reused by
 *  `openingCueRegexes` below rather than re-declared. */
function aboutHeadingRegex(companyName: string): RegExp {
  return new RegExp(`^about\\s+${escapeForRegex(companyName)}\\b`, "i");
}

/** "About {Company}" or "{Company} is/builds/provides/makes/helps/offers" —
 *  the only signal a SINGLE-posting company gets (there's no second posting
 *  to repeat against), and a scoring bonus for every company. */
function openingCueRegexes(companyName: string): RegExp[] {
  const name = escapeForRegex(companyName);
  return [
    aboutHeadingRegex(companyName),
    new RegExp(`^${name}\\s+(?:is|builds|provides|makes|helps|offers)\\b`, "i"),
  ];
}

/**
 * Block-splits one posting's description via `formatDescription` — the SAME
 * segmentation the SERP detail pane renders to the user (JobDetail.tsx calls
 * it on this identical `job.description` field). Reusing it here, instead of
 * a second hand-rolled splitter, is the whole fix for this module: real
 * index descriptions are single-block, zero-newline text (markdown markers
 * collapsed onto one line, or an ALL-CAPS heading glued straight to its
 * body — `formatDescription` already reconstructs structure for exactly
 * these ATS shapes), so a naive `\n{2,}` split saw one >1000-char blob and
 * produced zero candidates for every real company. Only `para` blocks are
 * candidate paragraphs; `heading` and `list` blocks are structural, not
 * "about us" prose — see `buildCandidates` for how a heading still feeds the
 * scoring bonus.
 */
function blocksOf(raw: string): DescBlock[] {
  return formatDescription(raw);
}

/** Normalized identity for grouping near-identical repeats across postings:
 *  casefolded, whitespace-collapsed, trailing punctuation stripped. The
 *  candidate's OUTPUT text stays the original decoded paragraph — this key
 *  only decides "is this the same paragraph as that other posting's". */
function matchKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}

interface Candidate {
  /** Original display-form paragraph text (first posting it was seen in). */
  text: string;
  /** Indices, into the filtered with-description job list, of every
   *  DISTINCT posting this paragraph appeared in — a Set so a paragraph
   *  repeated twice within one posting still counts as one posting. */
  jobIndices: Set<number>;
  /** This paragraph's position within its own posting's paragraph list,
   *  one entry per distinct posting (first occurrence) — feeds the
   *  earliest-average-position tie-break. */
  positions: number[];
  /** True if, in at least one posting, this paragraph block sat immediately
   *  after an "About {Company}"-matching heading block — the strongest
   *  possible structural cue a posting can carry (stronger than the textual
   *  opening-cue regex, which only catches company names spelled exactly at
   *  the start of the paragraph itself). See `buildCandidates`'s heading
   *  walk. */
  afterAboutHeading: boolean;
}

/** Groups every posting's paragraph BLOCKS (length-bounded 80–1000 chars,
 *  display-form text) by match key. `jobs` here is already filtered to
 *  postings that have a description — see the `postingsWithDescription` call
 *  site. Walks each posting's block list in order so a `heading` block
 *  matching "About {Company}" can flag every `para` block that follows it —
 *  up to the next `heading` or `list` block, since a long about-paragraph
 *  sentence-chunks into several consecutive `para` blocks under one heading
 *  (see `formatDescription`'s `sentenceGroup`). */
function buildCandidates(jobs: PublicJob[], aboutHeadingRe: RegExp): Map<string, Candidate> {
  const byKey = new Map<string, Candidate>();
  jobs.forEach((job, jobIdx) => {
    const blocks = blocksOf(job.description as string);
    const seenKeysThisJob = new Set<string>();
    let posIdx = 0;
    let afterAboutHeading = false;
    for (const block of blocks) {
      if (block.type === "heading") {
        afterAboutHeading = aboutHeadingRe.test(block.text ?? "");
        continue;
      }
      if (block.type !== "para") {
        afterAboutHeading = false;
        continue;
      }
      const text = (block.text ?? "").trim();
      const thisPos = posIdx++;
      if (text.length < MIN_PARAGRAPH_LEN || text.length > MAX_PARAGRAPH_LEN) continue;
      const key = matchKey(text);
      if (seenKeysThisJob.has(key)) continue; // one vote per posting, not per repeat within it
      seenKeysThisJob.add(key);
      const existing = byKey.get(key);
      if (existing) {
        existing.jobIndices.add(jobIdx);
        existing.positions.push(thisPos);
        existing.afterAboutHeading ||= afterAboutHeading;
      } else {
        byKey.set(key, { text, jobIndices: new Set([jobIdx]), positions: [thisPos], afterAboutHeading });
      }
    }
  });
  return byKey;
}

function scoreCandidate(c: Candidate, companyName: string, cueRes: RegExp[]): number {
  let score = c.jobIndices.size; // occurrence count across distinct postings
  if (c.text.slice(0, 80).toLowerCase().includes(companyName.toLowerCase())) score += 1;
  if (cueRes.some((re) => re.test(c.text))) score += 1;
  if (c.afterAboutHeading) score += 2; // strongest cue — structural, not textual
  for (const noiseRe of NOISE_CUE_RES) {
    if (noiseRe.test(c.text)) score -= 1;
  }
  return score;
}

/** Max score wins; ties broken by more distinct-posting occurrences, then
 *  earliest average paragraph position across the postings it appears in. */
function pickWinner(candidates: Candidate[], companyName: string, cueRes: RegExp[]): Candidate | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((c) => ({
      c,
      score: scoreCandidate(c, companyName, cueRes),
      avgPos: c.positions.reduce((sum, p) => sum + p, 0) / c.positions.length,
    }))
    .sort((a, b) => b.score - a.score || b.c.jobIndices.size - a.c.jobIndices.size || a.avgPos - b.avgPos);
  return ranked[0]!.c;
}

/** Same split shape `format-description.ts`'s (private, unexported)
 *  `sentenceGroup` uses to segment long paragraphs — mirrored here rather
 *  than duplicated-and-diverged, since that helper isn't exported and does
 *  strictly more (re-chunking) than a plain sentence split. */
function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Picks one complete, verbatim sentence out of the winning paragraph.
 * Prefers the first sentence that both names the company and carries a
 * descriptive cue; a match that's too short to be informative on its own
 * ("1Password is growing.") is rejected and the search continues. Falls
 * back to the paragraph's first sufficiently-long sentence when no sentence
 * satisfies both cues. Never truncates — a candidate over MAX_SENTENCE_LEN
 * is skipped entirely rather than cut mid-sentence.
 */
function selectSentence(paragraph: string, companyName: string): string | null {
  const sentences = splitSentences(paragraph).filter((s) => s.length <= MAX_SENTENCE_LEN);
  const nameLower = companyName.toLowerCase();
  const namesAndDescribes = (s: string) => s.toLowerCase().includes(nameLower) && DESCRIPTIVE_CUE_RE.test(s);

  for (const s of sentences) {
    if (namesAndDescribes(s) && s.length >= MIN_SENTENCE_LEN) return s;
  }
  for (const s of sentences) {
    if (s.length >= MIN_SENTENCE_LEN) return s;
  }
  return null;
}

/**
 * Pure and deterministic — no I/O, no clock, no randomness. See the module
 * doc above for the full pipeline; `jobs` should be the same public-facing
 * hit set the rest of the /co page reads (ghosts included is fine, internal
 * postings should already be filtered by the caller same as everywhere
 * else on that page).
 */
export function extractCompanyAboutLine(jobs: PublicJob[], companyName: string): string | null {
  const name = companyName.trim();
  if (!name) return null;

  const postings = jobs.filter((j) => !!j.description);
  if (postings.length === 0) return null;

  const cueRes = openingCueRegexes(name);
  const aboutHeadingRe = aboutHeadingRegex(name);
  const singlePostingCorpus = postings.length === 1;
  const candidates = [...buildCandidates(postings, aboutHeadingRe).values()].filter(
    (c) =>
      c.jobIndices.size >= 2 ||
      (singlePostingCorpus && (c.afterAboutHeading || cueRes.some((re) => re.test(c.text)))),
  );
  if (candidates.length === 0) return null;

  const winner = pickWinner(candidates, name, cueRes);
  if (!winner || !winner.text.toLowerCase().includes(name.toLowerCase())) return null;

  return selectSentence(winner.text, name);
}
