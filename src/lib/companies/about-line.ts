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
 * Pipeline: paragraph-split every posting's description (`paragraphsOf`) →
 * group by a normalized match key so near-identical repeats across postings
 * count as the same paragraph (`buildCandidates`) → keep only paragraphs
 * that either repeat across ≥2 distinct postings, or (single-posting
 * companies only) open with an "About {Company}" / "{Company} is/builds/…"
 * cue → score and rank the survivors (`pickWinner`) → require the winner to
 * actually name the company (rule 4 — blocks a mission-statement paragraph
 * that never mentions the company from winning by sheer repetition) → pick
 * one complete, verbatim sentence out of it (`selectSentence`).
 */
import { stripResidualHtml } from "@/lib/jobs/format-description";
import { decodeText } from "@/lib/jobs/presentation";
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

/** "About {Company}" or "{Company} is/builds/provides/makes/helps/offers" —
 *  the only signal a SINGLE-posting company gets (there's no second posting
 *  to repeat against), and a scoring bonus for every company. */
function openingCueRegexes(companyName: string): RegExp[] {
  const name = escapeForRegex(companyName);
  return [
    new RegExp(`^about\\s+${name}\\b`, "i"),
    new RegExp(`^${name}\\s+(?:is|builds|provides|makes|helps|offers)\\b`, "i"),
  ];
}

/**
 * Decodes and paragraph-splits one posting's description. Decoding reuses
 * the same two exported helpers `descriptionLede` (presentation/
 * description.ts) already composes for a different description-derived read
 * surface — `decodeText` then `stripResidualHtml` — rather than inventing a
 * third decode routine; `formatDescription`'s full pipeline is NOT reused
 * here because its heading/bullet/sentence-chunking logic exists to render
 * a structured detail pane, and would fragment a long "about us" paragraph
 * into multiple chunks before we ever get to count it as one candidate.
 *
 * Paragraph boundaries are blank lines OR HTML block edges. A single `<br>`
 * collapses to one newline (a soft wrap, not a paragraph break) — so a
 * DOUBLED `<br><br>` naturally becomes `\n\n` and lands on the same split as
 * a blank line, with no separate HTML-vs-plaintext branch needed. `</p>`
 * and `</div>` are explicit paragraph edges. Remaining tags (opening `<p>`,
 * `<div>`, `<span>`, …) carry no boundary and are dropped by
 * `stripResidualHtml` same as any other residual markup.
 */
function paragraphsOf(raw: string): string[] {
  let text = decodeText(raw).replace(/\r\n?/g, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div)>/gi, "\n\n");
  text = stripResidualHtml(text);
  return text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Normalized identity for grouping near-identical repeats across postings:
 *  casefolded, whitespace-collapsed, trailing punctuation stripped. The
 *  candidate's OUTPUT text stays the original decoded paragraph — this key
 *  only decides "is this the same paragraph as that other posting's". */
function matchKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!?,;:]+$/, "");
}

interface Candidate {
  /** Original decoded paragraph text (first posting it was seen in). */
  text: string;
  /** Indices, into the filtered with-description job list, of every
   *  DISTINCT posting this paragraph appeared in — a Set so a paragraph
   *  repeated twice within one posting still counts as one posting. */
  jobIndices: Set<number>;
  /** This paragraph's position within its own posting's paragraph list,
   *  one entry per distinct posting (first occurrence) — feeds the
   *  earliest-average-position tie-break. */
  positions: number[];
}

/** Groups every posting's paragraphs (length-bounded 80–1000 chars,
 *  post-decode) by match key. `jobs` here is already filtered to postings
 *  that have a description — see the `postingsWithDescription` call site. */
function buildCandidates(jobs: PublicJob[]): Map<string, Candidate> {
  const byKey = new Map<string, Candidate>();
  jobs.forEach((job, jobIdx) => {
    const paragraphs = paragraphsOf(job.description as string);
    const seenKeysThisJob = new Set<string>();
    paragraphs.forEach((text, posIdx) => {
      if (text.length < MIN_PARAGRAPH_LEN || text.length > MAX_PARAGRAPH_LEN) return;
      const key = matchKey(text);
      if (seenKeysThisJob.has(key)) return; // one vote per posting, not per repeat within it
      seenKeysThisJob.add(key);
      const existing = byKey.get(key);
      if (existing) {
        existing.jobIndices.add(jobIdx);
        existing.positions.push(posIdx);
      } else {
        byKey.set(key, { text, jobIndices: new Set([jobIdx]), positions: [posIdx] });
      }
    });
  });
  return byKey;
}

function scoreCandidate(c: Candidate, companyName: string, cueRes: RegExp[]): number {
  let score = c.jobIndices.size; // occurrence count across distinct postings
  if (c.text.slice(0, 80).toLowerCase().includes(companyName.toLowerCase())) score += 1;
  if (cueRes.some((re) => re.test(c.text))) score += 1;
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
  const singlePostingCorpus = postings.length === 1;
  const candidates = [...buildCandidates(postings).values()].filter(
    (c) => c.jobIndices.size >= 2 || (singlePostingCorpus && cueRes.some((re) => re.test(c.text))),
  );
  if (candidates.length === 0) return null;

  const winner = pickWinner(candidates, name, cueRes);
  if (!winner || !winner.text.toLowerCase().includes(name.toLowerCase())) return null;

  return selectSentence(winner.text, name);
}
