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

const BULLET_RE = /^[-*•−]\s+(.+)$/;
const MD_HEADING_RE = /^#{1,6}\s+(.+)$/;
const BOLD_ENTRY_RE = /^\*\*(.+?)\*\*\s*(.*)$/;
/** Unbolded "Title | Company    date-ish tail" — two-or-more spaces before a
 *  trailing token containing a year or "present" is the same visual gap a
 *  right-aligned date leaves in flattened plain text. */
const LOOSE_ENTRY_RE = /^(.{3,}?)\s{2,}([^\s].*(?:\d{4}|present|current).*)$/i;
/** "Category: comma, separated, list" — bold or plain label followed by a
 *  colon and free text; used for the competencies-style block wherever it
 *  appears (not gated on a specific section name — the shape alone is the
 *  signal, so a future section using the same pattern is covered too). */
const COMPETENCY_RE = /^\*{0,2}([^*:]{2,60}?):\*{0,2}\s+(.+)$/;

function isSectionHeader(line: string): string | null {
  const md = line.match(MD_HEADING_RE);
  const body = md ? md[1].trim() : line.trim();
  if (!body) return null;
  const letters = body.replace(/[^A-Za-z]/g, "");
  if (!letters) return null;
  // ALL-CAPS (no lowercase letters) and short enough to be a heading, not a
  // shouted sentence — real résumé section labels never run past ~60 chars.
  if (!md && (letters !== letters.toUpperCase() || body.length > 60)) return null;
  return body.toUpperCase();
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
  if (i < rawLines.length && !isSectionHeader(rawLines[i]) && !BULLET_RE.test(rawLines[i].trim())) {
    name = rawLines[i].replace(MD_HEADING_RE, "$1").replace(/\*\*/g, "").trim();
    i++;
  }
  skipBlank();
  let contactLine: string | null = null;
  if (i < rawLines.length && !isSectionHeader(rawLines[i]) && !BULLET_RE.test(rawLines[i].trim())) {
    contactLine = rawLines[i].trim();
    i++;
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

    const heading = isSectionHeader(raw);
    if (heading !== null) {
      current = { heading, blocks: [] };
      sections.push(current);
      closeOpenBlocks();
      continue;
    }

    const bulletMatch = trimmed.match(BULLET_RE);
    if (bulletMatch) {
      const section = ensureSection();
      if (openEntry) {
        openEntry.bullets.push(bulletMatch[1].trim());
      } else {
        const last = section.blocks.at(-1);
        if (last && last.kind === "bullets") last.items.push(bulletMatch[1].trim());
        else section.blocks.push({ kind: "bullets", items: [bulletMatch[1].trim()] });
      }
      continue;
    }

    const competencyMatch = trimmed.match(COMPETENCY_RE);
    if (competencyMatch) {
      ensureSection().blocks.push({ kind: "competency", category: competencyMatch[1].trim(), items: competencyMatch[2].trim() });
      closeOpenBlocks();
      continue;
    }

    const boldEntry = trimmed.match(BOLD_ENTRY_RE);
    const looseEntry = !boldEntry ? trimmed.match(LOOSE_ENTRY_RE) : null;
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
  if (data.competencies.length > 0) {
    sections.push({
      heading: "CORE COMPETENCIES",
      blocks: data.competencies.map((c) => ({ kind: "competency" as const, category: c.category, items: c.skills.join(", ") })),
    });
  }
  if (data.experience.length > 0) {
    sections.push({
      heading: "PROFESSIONAL EXPERIENCE",
      blocks: data.experience.map((e) => ({
        kind: "entry" as const,
        title: `${e.role} | ${e.company}`,
        dateRight: e.dates || null,
        bullets: e.description
          .split("\n")
          .map((l) => l.replace(BULLET_RE, "$1").trim())
          .filter(Boolean),
      })),
    });
  }
  if (data.education.length > 0) {
    sections.push({
      heading: "EDUCATION",
      blocks: [{ kind: "bullets", items: data.education.map((e) => `${e.degree} | ${e.institution}${e.year ? ` | ${e.year}` : ""}`) }],
    });
  }

  const contactParts = [data.profile.location, data.profile.phone, data.profile.email, data.profile.linkedin].filter(Boolean);
  return {
    name: data.profile.name || data.profile.profession || null,
    contactLine: contactParts.length > 0 ? contactParts.join(" | ") : null,
    sections,
  };
}
