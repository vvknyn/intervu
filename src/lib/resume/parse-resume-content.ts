/**
 * Pure text -> structure parser for résumé content (R4/R5, 2026-08-09 user
 * report: variant downloads were a bare .md, never a designed PDF). The
 * content this parses is free text an LLM (via the MCP `save_resume_variant`
 * tool, `lib/agent/tools.ts`) or the "Structure with AI" step wrote — no
 * enforced schema, so this is a tolerant, best-effort structural read, never
 * a strict validator: anything it doesn't recognize degrades to plain
 * paragraph text rather than being dropped. Nothing here calls an LLM or
 * invents content — it only reshapes what's already there (mechanical, per
 * the binding no-AI-on-this-path rule, `lib/resume/set-resume.ts`'s doc).
 *
 * `resumeDataToParsedDocument` is the second adapter into the same shape,
 * for the STRUCTURED `ResumeData` a base résumé may carry instead of free
 * text (`YourResumeSection.tsx`'s résumé card) — a direct field mapping,
 * not a heuristic, since `ResumeData` is already structured.
 *
 * `render-pdf.ts` is the one consumer of `ParsedResumeDocument` — it never
 * touches raw content or `ResumeData` directly, only this shape, so the
 * renderer stays agnostic to which of the two adapters produced it.
 */
import { buildContactLine, isContactOrPlaceLine, sanitizeContactLine, sanitizeLocation } from "@/lib/resume/contact-line";
import { descriptionToBullets, shouldAppendAsBulletContinuation } from "@/lib/resume/merge-bullet-lines";
import { normalizeCompetencyCategories } from "@/lib/resume/structure-resume-text";
import type { ResumeData } from "@/types/resume";

export type ParsedResumeBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "competency"; category: string; items: string }
  | { kind: "entry"; title: string; dateRight: string | null; bullets: string[] };

export interface ParsedResumeSection {
  /** Uppercased display heading ("PROFESSIONAL SUMMARY"); "" for the
   *  fallback single section a headerless document collapses into. */
  heading: string;
  blocks: ParsedResumeBlock[];
}

export interface ParsedResumeDocument {
  name: string | null;
  contactLine: string | null;
  sections: ParsedResumeSection[];
}

const BULLET_RE = /^[-*•−●◦▪]\s+(.+)$/;
const MD_HEADING_RE = /^(#{1,6})\s+(.+)$/;
const BOLD_ENTRY_RE = /^\*\*(.+?)\*\*\s*(.*)$/;
/** Unbolded "Title | Company    date-ish tail" — a two-or-more-space gap is
 *  the same visual break a right-aligned date leaves in flattened plain
 *  text; whether the tail actually IS a date is DATE_ISH_RE's job, kept
 *  separate so it's the one place — shared with the markdown entry-heading
 *  splitter below — that decides "does this look like a date." */
const LOOSE_ENTRY_GAP_RE = /^(.{3,}?)\s{2,}(\S.*)$/;
/** The ONE "does this look like a date" test — a bare 4-digit year, an
 *  apostrophe'd 2-digit year ("'21", the founder's own reference resume's
 *  convention — "September '21 — Present", "July '19 — February '20"), or
 *  "present"/"current" (the only two non-numeric date words a résumé's
 *  date range ever ends in). Reused by both the plain-text loose-entry gap
 *  check above and `splitEntryTitleAndDate` below, so neither can drift
 *  from what the other considers date-ish. */
const DATE_ISH_RE = /\d{4}|'\d{2}\b|present|current/i;
/** "Category: comma, separated, list" — bold or plain label followed by a
 *  colon and free text; used for the competencies-style block wherever it
 *  appears (not gated on a specific section name — the shape alone is the
 *  signal, so a future section using the same pattern is covered too). */
const COMPETENCY_RE = /^\*{0,2}([^*:]{2,60}?):\*{0,2}\s+(.+)$/;

interface HeadingMatch {
  /** Markdown `#` count (1-6); the plain-text ALL-CAPS heuristic has no
   *  level marker of its own, so it's always treated as level 2 ("section")
   *  — the only kind of header that shape can express. */
  level: number;
  text: string;
}

/**
 * Markdown ATX heading OR the plain-text ALL-CAPS heuristic. Level decides
 * what a heading MEANS to the caller (see `parseResumeContent`'s heading
 * dispatch): 1 = name (only meaningful at the very top of the document),
 * 2 = section, 3+ = an experience entry's title/dates line. A markdown
 * heading is recognized regardless of case/length — the writer marked it
 * as a heading explicitly — but the plain-text heuristic stays cautious
 * (ALL-CAPS, <=60 chars) so an ordinary capitalized sentence is never
 * misread as one; this is why "# Vivek Narayanan" (mixed case, H1) reaches
 * the name slot while a bare, undecorated "Vivek Narayanan" line also does
 * (via the name-slot's own "first non-heading line" rule, not this
 * function) — the plain-text shape has no heading marker for name at all.
 */
function matchHeading(line: string): HeadingMatch | null {
  const md = line.match(MD_HEADING_RE);
  if (md) {
    const text = md[2].trim();
    return text ? { level: md[1].length, text } : null;
  }
  const body = line.trim();
  if (!body) return null;
  const letters = body.replace(/[^A-Za-z]/g, "");
  if (!letters) return null;
  // ALL-CAPS (no lowercase letters) and short enough to be a heading, not a
  // shouted sentence — real résumé section labels never run past ~60 chars.
  if (letters !== letters.toUpperCase() || body.length > 60) return null;
  return { level: 2, text: body };
}

/**
 * Splits a markdown entry heading's text ("Client-facing Product Manager |
 * TELUS Health Wellbeing | September '21 — Present") into its title and a
 * trailing date component, on the LAST "|" or " — " separator — whichever
 * is present — but only when the trailing piece actually looks date-ish
 * (DATE_ISH_RE); otherwise the whole heading is the title and there's no
 * date, same graceful degrade every other entry shape here has. Splitting
 * on the LAST separator (not the first) is what keeps "Title | Company"
 * itself intact when a third, later segment is the date.
 */
function splitEntryTitleAndDate(text: string): { title: string; dateRight: string | null } {
  for (const sep of [" | ", " — "]) {
    const idx = text.lastIndexOf(sep);
    if (idx === -1) continue;
    const before = text.slice(0, idx).trim();
    const after = text.slice(idx + sep.length).trim();
    if (before && DATE_ISH_RE.test(after)) return { title: before, dateRight: after };
  }
  return { title: text.trim(), dateRight: null };
}

/** Pure: free-text résumé content -> structured sections. See module doc. */
export function parseResumeContent(content: string): ParsedResumeDocument {
  const rawLines = content.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const skipBlank = () => {
    while (i < rawLines.length && rawLines[i].trim() === "") i++;
  };

  skipBlank();
  let name: string | null = null;
  if (i < rawLines.length && !BULLET_RE.test(rawLines[i].trim())) {
    const h = matchHeading(rawLines[i]);
    // Not a heading at all (the plain-text shape's unadorned name line) OR
    // a markdown H1 (the ONLY level that means "name," and only here, at
    // the very top) — anything level 2+ is a real section/entry heading
    // and must NOT be consumed as a name.
    if (h === null || h.level === 1) {
      name = (h?.text ?? rawLines[i].trim()).replace(/\*\*/g, "").trim();
      i++;
    }
  }
  skipBlank();
  let contactLine: string | null = null;
  if (i < rawLines.length && !BULLET_RE.test(rawLines[i].trim()) && matchHeading(rawLines[i]) === null) {
    const candidate = rawLines[i].trim();
    if (isContactOrPlaceLine(candidate)) {
      contactLine = sanitizeContactLine(candidate);
      i++;
    }
  }

  const sections: ParsedResumeSection[] = [];
  let current: ParsedResumeSection | null = null;
  let openEntry: Extract<ParsedResumeBlock, { kind: "entry" }> | null = null;
  let openParagraph: Extract<ParsedResumeBlock, { kind: "paragraph" }> | null = null;

  const ensureSection = () => {
    if (!current) {
      current = { heading: "", blocks: [] };
      sections.push(current);
    }
    return current;
  };
  const closeOpenBlocks = () => {
    openEntry = null;
    openParagraph = null;
  };

  for (; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const trimmed = raw.trim();

    if (trimmed === "") {
      closeOpenBlocks();
      continue;
    }

    const heading = matchHeading(raw);
    if (heading !== null) {
      closeOpenBlocks();
      if (heading.level <= 2) {
        current = { heading: heading.text.toUpperCase(), blocks: [] };
        sections.push(current);
      } else {
        // H3+ — an experience entry's title/dates line, never a section
        // (the bug this whole fix round exists for: "### Title | Company |
        // Dates" used to become a ruled, all-caps section header).
        const { title, dateRight } = splitEntryTitleAndDate(heading.text);
        const entry: Extract<ParsedResumeBlock, { kind: "entry" }> = { kind: "entry", title, dateRight, bullets: [] };
        ensureSection().blocks.push(entry);
        openEntry = entry;
      }
      continue;
    }

    if (openEntry) {
      const boldEntryInOpen = trimmed.match(BOLD_ENTRY_RE);
      const looseGapInOpen = !boldEntryInOpen ? trimmed.match(LOOSE_ENTRY_GAP_RE) : null;
      const looseEntryInOpen = looseGapInOpen && DATE_ISH_RE.test(looseGapInOpen[2]) ? looseGapInOpen : null;
      if (boldEntryInOpen || looseEntryInOpen) {
        const [, title, rest] = (boldEntryInOpen ?? looseEntryInOpen)!;
        const entry: Extract<ParsedResumeBlock, { kind: "entry" }> = {
          kind: "entry",
          title: title.replace(/\*\*/g, "").trim(),
          dateRight: rest.trim() || null,
          bullets: [],
        };
        ensureSection().blocks.push(entry);
        openEntry = entry;
        openParagraph = null;
        continue;
      }

      const bulletMatch = trimmed.match(BULLET_RE);
      if (bulletMatch) {
        openEntry.bullets.push(bulletMatch[1].trim());
        openParagraph = null;
        continue;
      }

      const lastBullet = openEntry.bullets.at(-1);
      if (lastBullet !== undefined && shouldAppendAsBulletContinuation(trimmed, lastBullet)) {
        openEntry.bullets[openEntry.bullets.length - 1] = `${lastBullet} ${trimmed}`.replace(/\s+/g, " ").trim();
        openParagraph = null;
        continue;
      }

      openEntry.bullets.push(trimmed);
      openParagraph = null;
      continue;
    }

    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      const section = ensureSection();
      const last = section.blocks.at(-1);
      if (last && last.kind === "bullets") last.items.push(bulletMatch[1].trim());
      else section.blocks.push({ kind: "bullets", items: [bulletMatch[1].trim()] });
      continue;
    }

    const competencyMatch = trimmed.match(COMPETENCY_RE);
    if (competencyMatch) {
      ensureSection().blocks.push({ kind: "competency", category: competencyMatch[1].trim(), items: competencyMatch[2].trim() });
      closeOpenBlocks();
      continue;
    }

    const boldEntry = trimmed.match(BOLD_ENTRY_RE);
    const looseGap = !boldEntry ? trimmed.match(LOOSE_ENTRY_GAP_RE) : null;
    const looseEntry = looseGap && DATE_ISH_RE.test(looseGap[2]) ? looseGap : null;
    if (boldEntry || looseEntry) {
      const [, title, rest] = (boldEntry ?? looseEntry)!;
      const entry: Extract<ParsedResumeBlock, { kind: "entry" }> = {
        kind: "entry",
        title: title.replace(/\*\*/g, "").trim(),
        dateRight: rest.trim() || null,
        bullets: [],
      };
      ensureSection().blocks.push(entry);
      openEntry = entry;
      openParagraph = null;
      continue;
    }

    // Plain paragraph text — collapses consecutive non-blank lines into one
    // wrapped paragraph, same as a normal prose block.
    const section = ensureSection();
    if (openParagraph) {
      openParagraph.text += ` ${trimmed}`;
    } else {
      openParagraph = { kind: "paragraph", text: trimmed };
      section.blocks.push(openParagraph);
    }
    openEntry = null;
  }

  return { name, contactLine, sections };
}

/** Pure: structured `ResumeData` -> the same `ParsedResumeDocument` shape a
 *  free-text variant parses into — a direct field mapping (already
 *  structured, no heuristics needed), so the base résumé's "Download .pdf"
 *  button (YourResumeSection.tsx) renders through the identical layout path
 *  as a tailored variant's. `sectionOrder` (when present) decides section
 *  order; otherwise the fixed summary/competencies/experience/education
 *  order matches the reference design. */
export function resumeDataToParsedDocument(data: ResumeData): ParsedResumeDocument {
  const sections: ParsedResumeSection[] = [];

  if (data.generatedSummary.trim()) {
    sections.push({ heading: "PROFESSIONAL SUMMARY", blocks: [{ kind: "paragraph", text: data.generatedSummary.trim() }] });
  }
  const competencies = normalizeCompetencyCategories(data.competencies);
  if (competencies.length > 0) {
    sections.push({
      heading: "CORE COMPETENCIES",
      blocks: competencies.map((c) => ({ kind: "competency" as const, category: c.category, items: c.skills.join(", ") })),
    });
  }
  if (data.experience.length > 0) {
    sections.push({
      heading: "PROFESSIONAL EXPERIENCE",
      blocks: data.experience.map((e) => ({
        kind: "entry" as const,
        title: `${e.role} | ${e.company}`,
        dateRight: e.dates || null,
        bullets: descriptionToBullets(e.description),
      })),
    });
  }
  if ((data.projects?.length ?? 0) > 0) {
    sections.push({
      heading: "INDEPENDENT PROJECTS",
      blocks: (data.projects ?? []).map((e) => ({
        kind: "entry" as const,
        title: e.company ? `${e.role} | ${e.company}` : e.role,
        dateRight: e.dates || null,
        bullets: descriptionToBullets(e.description),
      })),
    });
  }
  if (data.education.length > 0) {
    sections.push({
      heading: "EDUCATION & PROFESSIONAL DEVELOPMENT",
      blocks: [
        {
          kind: "bullets",
          items: data.education.map((e) => {
            const degree = e.degree.trim();
            const institution = e.institution.trim();
            const year = e.year?.trim() ?? "";
            if (institution && year) return `${degree} | ${institution} | ${year}`;
            if (institution) return `${degree} | ${institution}`;
            if (year) return `${degree} | ${year}`;
            return degree;
          }),
        },
      ],
    });
  }

  const contactLine = buildContactLine([
    sanitizeLocation(data.profile.location),
    data.profile.phone,
    data.profile.email,
    data.profile.linkedin,
    data.profile.website,
  ]);
  return {
    name: data.profile.name || data.profile.profession || null,
    contactLine,
    sections,
  };
}
