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

/** Company-name "forms" this posting's prose might refer to the company by:
 *  the full display name, then each further-truncated prefix formed by
 *  dropping trailing whitespace-delimited tokens one at a time — e.g.
 *  "Greystar Management Services" → ["Greystar Management Services",
 *  "Greystar Management", "Greystar"]. intervu's displayed company name is
 *  often a legal/long form (`displayCompanyName` in get-company.ts — "X
 *  Management Services", "X Inc", "X Holdings") while a company's OWN
 *  posting prose almost always uses the stem ("X") — 1Password only
 *  survived the previous version of this module because its display name
 *  happens to be one token; every multi-token display name nulled out.
 *  Prefix-derivation needs no corporate-suffix vocabulary ("Inc" / "LLC" /
 *  "Holdings" / "Management Services" / …) — every suffix, known or not,
 *  drops off the same way. */
function nameForms(companyName: string): string[] {
  const tokens = companyName.trim().split(/\s+/).filter(Boolean);
  const forms: string[] = [];
  for (let end = tokens.length; end >= 1; end--) forms.push(tokens.slice(0, end).join(" "));
  return forms;
}

/** One name form's regex alternative, or `null` to drop it entirely. A bare
 *  single-token form ("Greystar" — or, worse, "United" stemmed from "United
 *  Something Logistics") is the risky end: a common capitalized English
 *  word must not let a company-name check pass on incidental lowercase
 *  prose ("the united front of our teams"). Guarded two ways: dropped
 *  outright below 3 characters, and — instead of a blanket case-insensitive
 *  flag — only its Title-cased-as-given or ALL-CAPS spelling is accepted
 *  (an ALL-CAPS heading is a real shape this module already handles, see
 *  format-description.ts's glued-heading fix; an all-lowercase mid-sentence
 *  spelling is not). A multi-token form is unambiguous enough on its own to
 *  accept any casing. */
function formPattern(form: string): string | null {
  const isSingleToken = !form.includes(" ");
  if (isSingleToken && form.length < 3) return null;
  const variants = isSingleToken ? [form, form.toUpperCase()] : [form, form.toLowerCase(), form.toUpperCase()];
  return variants.map(escapeForRegex).join("|");
}

/** Raw prefix alternation for the ANCHORED checks below (`aboutHeadingRegex`,
 *  `openingCueRegexes`) — single source of truth for "which forms" (via
 *  `nameForms`), compiled by the caller WITH the `i` flag so "About" /
 *  "about" / "ABOUT" and "Greystar" / "GREYSTAR" all still match exactly as
 *  before this fix. Safe to stay case-insensitive even for a bare
 *  single-token stem here: unlike an unanchored substring scan, these
 *  patterns require the form to sit directly after "about " or directly
 *  before "is/builds/provides/makes/helps/offers" — a sentence literally
 *  starting "united is…" or "about united…" is already a strong,
 *  structurally-anchored signal regardless of case. The collision risk
 *  (a common word matching incidentally) only lives in the UNANCHORED
 *  "mentions the company ANYWHERE" scan, guarded separately below. */
function formAlternation(companyName: string): string {
  return nameForms(companyName).map(escapeForRegex).join("|");
}

/** "About {Company}" — the strongest possible cue a posting can carry, both
 *  as a standalone heading block (see `buildCandidates`' heading walk) and
 *  as literal opening text on a single-posting company's only candidate
 *  paragraph. Single source of truth for that pattern — reused by
 *  `openingCueRegexes` below rather than re-declared. */
function aboutHeadingRegex(companyName: string): RegExp {
  return new RegExp(`^about\\s+(?:${formAlternation(companyName)})\\b`, "i");
}

/** "About {Company}" or "{Company} is/builds/provides/makes/helps/offers" —
 *  the only signal a SINGLE-posting company gets (there's no second posting
 *  to repeat against), and a scoring bonus for every company. */
function openingCueRegexes(companyName: string): RegExp[] {
  return [
    aboutHeadingRegex(companyName),
    new RegExp(`^(?:${formAlternation(companyName)})\\s+(?:is|builds|provides|makes|helps|offers)\\b`, "i"),
  ];
}

/** The guarded alternation for the UNANCHORED "does this text mention the
 *  company ANYWHERE" scan — `mentionRegex` below, itself reused by the
 *  score bonus, rule 4, and `selectSentence`'s name check. This is where
 *  the single-token collision risk (`formPattern`'s guard) actually lives:
 *  no surrounding keyword narrows the match, so a bare word-boundary scan
 *  over arbitrary prose needs the stricter per-form case handling.
 *  `(?!)` — a negative lookahead with nothing to assert against, so it
 *  never matches — is the honest fallback for the degenerate case where
 *  every form was filtered out (e.g. a 1-2 char company name): no match is
 *  correct there, not "matches anything". */
function nameAlternation(companyName: string): string {
  const patterns = nameForms(companyName)
    .map(formPattern)
    .filter((p): p is string => p !== null);
  return patterns.length ? patterns.join("|") : "(?!)";
}

/** Whole-word "does this text mention the company", under ANY name form —
 *  see `nameAlternation`. Reused by the score bonus, rule 4, and
 *  `selectSentence` — compiled once per `extractCompanyAboutLine` call and
 *  threaded through rather than rebuilt per candidate/sentence. */
function mentionRegex(companyName: string): RegExp {
  return new RegExp(`\\b(?:${nameAlternation(companyName)})\\b`);
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

function scoreCandidate(c: Candidate, mentionRe: RegExp, cueRes: RegExp[]): number {
  let score = c.jobIndices.size; // occurrence count across distinct postings
  if (mentionRe.test(c.text.slice(0, 80))) score += 1;
  if (cueRes.some((re) => re.test(c.text))) score += 1;
  if (c.afterAboutHeading) score += 2; // strongest cue — structural, not textual
  for (const noiseRe of NOISE_CUE_RES) {
    if (noiseRe.test(c.text)) score -= 1;
  }
  return score;
}

/** Max score wins; ties broken by more distinct-posting occurrences, then
 *  earliest average paragraph position across the postings it appears in. */
function pickWinner(candidates: Candidate[], mentionRe: RegExp, cueRes: RegExp[]): Candidate | null {
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((c) => ({
      c,
      score: scoreCandidate(c, mentionRe, cueRes),
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
function selectSentence(paragraph: string, mentionRe: RegExp): string | null {
  const sentences = splitSentences(paragraph).filter((s) => s.length <= MAX_SENTENCE_LEN);
  const namesAndDescribes = (s: string) => mentionRe.test(s) && DESCRIPTIVE_CUE_RE.test(s);

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
  const mentionRe = mentionRegex(name);
  const singlePostingCorpus = postings.length === 1;
  const candidates = [...buildCandidates(postings, aboutHeadingRe).values()].filter(
    (c) =>
      c.jobIndices.size >= 2 ||
      (singlePostingCorpus && (c.afterAboutHeading || cueRes.some((re) => re.test(c.text)))),
  );
  if (candidates.length === 0) return null;

  const winner = pickWinner(candidates, mentionRe, cueRes);
  if (!winner || !mentionRe.test(winner.text)) return null;

  return selectSentence(winner.text, mentionRe);
}
