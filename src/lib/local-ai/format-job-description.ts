/**
 * Job-description template for every For-you postcard: the posting's own
 * blocks (formatDescription) remapped into hook / do / bring / nice / perks
 * by their headings, so each card reads the same scannable way. Rules only:
 * no model rewrites a posting (Vivek 2026-10-11 removed the on-device models),
 * so every line is the employer's own words.
 */

import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";

export type JdTemplateKey = "hook" | "do" | "bring" | "nice" | "perks";

export interface JdTemplate {
    hook: DescBlock[];
    do: DescBlock[];
    bring: DescBlock[];
    nice: DescBlock[];
    perks: DescBlock[];
}

/** Section chrome — light emoji markers, Swiss/Klein quiet caps elsewhere. */
export const JD_TEMPLATE_LABELS: Record<JdTemplateKey, string> = {
    hook: "✨ The role",
    do: "🎯 What you'll do",
    bring: "🧠 What you bring",
    nice: "🌱 Nice to have",
    perks: "🎁 Perks",
};

/** Stable render order for the postcard. */
export const JD_TEMPLATE_ORDER: JdTemplateKey[] = ["hook", "do", "bring", "nice", "perks"];

function emptyTemplate(): JdTemplate {
    return { hook: [], do: [], bring: [], nice: [], perks: [] };
}

export function jdTemplateHasContent(t: JdTemplate): boolean {
    return JD_TEMPLATE_ORDER.some((k) => t[k].length > 0);
}

/** Count non-empty template sections (hook/do/bring/nice/perks). */
export function jdTemplateFilledSectionCount(t: JdTemplate): number {
    return JD_TEMPLATE_ORDER.filter((k) => t[k].length > 0).length;
}

function templateCharCount(t: JdTemplate): number {
    let n = 0;
    for (const key of JD_TEMPLATE_ORDER) {
        for (const b of t[key]) {
            if (b.type === "list" && b.items) n += b.items.join(" ").length;
            else n += (b.text ?? "").length;
        }
    }
    return n;
}

/**
 * True when the template would render a sparse postcard (hook-only or almost
 * no recovered prose vs the source). Callers must soft-fail — never show a
 * huge empty "✨ The role" card.
 */
export function jdTemplateIsThin(t: JdTemplate, raw?: string | null): boolean {
    if (!jdTemplateHasContent(t)) return true;
    const filled = jdTemplateFilledSectionCount(t);
    const chars = templateCharCount(t);
    // Only a truncated hook → sparse card with empty whitespace beside fit aside.
    if (filled === 1 && t.hook.length > 0) return true;
    if (chars < 80) return true;
    // Substantial recovered prose (≥400 chars across 2+ sections) is never
    // "thin" even when the source is a long ATS dump — the ratio check below
    // was marking HelloFresh-scale bodies as soft-fail and replacing them
    // with a 280-char snippet + Apply link.
    if (filled >= 2 && chars >= 400) return false;
    const rawLen = (raw ?? "").replace(/\s+/g, " ").trim().length;
    if (rawLen >= 200 && chars / rawLen < 0.2 && filled < 3) return true;
    return false;
}

/**
 * Short search-index-style snippet for soft-fail postcard bodies when the
 * template is thin — never invent; just compress the source.
 */
export function jdSearchIndexSnippet(raw: string | null | undefined, max = 280): string {
    const cleaned = (raw ?? "").replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    if (cleaned.length <= max) return cleaned;
    const slice = cleaned.slice(0, max - 1);
    const cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("; "), slice.lastIndexOf(", "), slice.lastIndexOf(" "));
    const base = cut > 80 ? slice.slice(0, cut + (slice[cut] === "." || slice[cut] === ";" ? 1 : 0)) : slice;
    return `${base.trim()}…`;
}

const DO_HEADINGS = new Set([
    "responsibilities",
    "your role",
    "what you'll do",
    "what you will do",
    "what you'll be doing",
    "key responsibilities",
    "what your impact will be",
    "duties",
    "essential functions",
    "essential duties",
    "what success looks like",
    "your impact",
    "role overview",
]);

const BRING_HEADINGS = new Set([
    "requirements",
    "qualifications",
    "what we're looking for",
    "minimum qualifications",
    "your background",
    "what you bring",
    "what you'll bring",
    "what you will bring",
    "required skills",
    "technical skills",
    "education",
    "experience",
    "education/experience",
    "who you are",
    "skills",
]);

const NICE_HEADINGS = new Set([
    "nice to have",
    "preferred qualifications",
    "preferred skills",
    "bonus",
    "bonus points",
    "preferred",
]);

const PERKS_HEADINGS = new Set([
    "what we offer",
    "benefits",
    "perks",
    "compensation",
    "why join",
    "our values",
    "pay range",
    "salary",
    "salary range",
    "compensation range",
]);

function normalizeHeading(text: string | undefined): string {
    return (text ?? "").toLowerCase().replace(/[:.!?]+$/, "").trim();
}

function classifyHeading(text: string | undefined): JdTemplateKey | "skip" | null {
    const key = normalizeHeading(text);
    if (!key) return null;
    // Skip EEO / legal / company-about walls — not the role template.
    if (
        key.includes("equal opportunity") ||
        key.includes("eeo") ||
        key === "about us" ||
        key === "about the company" ||
        key === "about the team" ||
        key === "the company" ||
        key === "the team" ||
        key === "company description" ||
        key === "additional information" ||
        key === "physical requirements" ||
        key === "work environment"
    ) {
        return "skip";
    }
    if (DO_HEADINGS.has(key)) return "do";
    if (NICE_HEADINGS.has(key)) return "nice";
    if (BRING_HEADINGS.has(key)) return "bring";
    if (PERKS_HEADINGS.has(key)) return "perks";
    if (key === "about the role" || key === "the role" || key === "overview" || key === "summary" || key === "position summary" || key === "position purpose" || key === "the opportunity" || key === "job description") {
        return "hook";
    }
    return null;
}

function blockToProse(block: DescBlock): string {
    if (block.type === "list") return (block.items ?? []).join(" ");
    if (block.type === "para") {
        const lead = block.lead ? `${block.lead} ` : "";
        return `${lead}${block.text ?? ""}`.trim();
    }
    return (block.text ?? "").trim();
}

function firstSentence(text: string, max = 160): string {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "";
    const m = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
    const sentence = (m?.[1] ?? cleaned).trim();
    if (sentence.length <= max) return sentence;
    return `${sentence.slice(0, max - 1).trim()}…`;
}

function toListBlocks(items: string[]): DescBlock[] {
    const cleaned = items.map((s) => s.replace(/^[-•*·]\s*/, "").trim()).filter((s) => s.length >= 2);
    if (!cleaned.length) return [];
    return [{ type: "list", items: cleaned }];
}

function collectListItems(blocks: DescBlock[]): string[] {
    const out: string[] = [];
    for (const b of blocks) {
        if (b.type === "list" && b.items) out.push(...b.items);
        else if (b.type === "para" && b.text) {
            // Split glued " - Item" prose into bullets when possible.
            const parts = b.text.split(/\n|(?:^|\s)[-•*·]\s+/).map((p) => p.trim()).filter(Boolean);
            if (parts.length > 1) out.push(...parts);
            else out.push(b.text.trim());
        }
    }
    return out.filter((s) => s.length >= 2);
}

/**
 * Instant, deterministic remapping into the shared template shape.
 * Prefer this as the baseline so every card shares section chrome even
 * when on-device AI is off / slow / unavailable.
 */
export function buildDeterministicJdTemplate(raw: string | null | undefined): JdTemplate {
    if (!raw?.trim()) return emptyTemplate();
    const blocks = formatDescription(raw);
    const out = emptyTemplate();
    let current: JdTemplateKey | "skip" = "hook";
    const hookParas: DescBlock[] = [];

    for (const block of blocks) {
        if (block.type === "heading") {
            const next = classifyHeading(block.text);
            if (next === "skip") {
                current = "skip";
                continue;
            }
            if (next) {
                current = next;
                continue;
            }
            // Unrecognized heading — keep accumulating under current bucket.
            continue;
        }
        if (current === "skip") continue;

        if (block.type === "para" && block.text) {
            // Glued section openers ("What you'll do Own the product…") —
            // common when ATS HTML→text loses the break after the heading.
            const glued = block.text.match(
                /^(What you'?ll do|What you will do|What you'?ll bring|What you will bring|What you bring|Responsibilities|Requirements|Qualifications|Nice to have|What we offer|Benefits)\b[\s:]+(.+)$/i,
            );
            if (glued) {
                const classified = classifyHeading(glued[1]);
                if (classified && classified !== "skip") {
                    current = classified;
                    const rest = (glued[2] ?? "").trim();
                    if (rest) {
                        if (current === "hook") hookParas.push({ type: "para", text: rest });
                        else out[current].push({ type: "para", text: rest });
                    }
                    continue;
                }
            }
            const colon = block.text.match(/^([^:]{2,40}):\s*(.*)$/);
            if (colon) {
                const classified = classifyHeading(colon[1]);
                if (classified && classified !== "skip") {
                    current = classified;
                    const rest = (colon[2] ?? "").trim();
                    if (rest) {
                        if (current === "hook") hookParas.push({ type: "para", text: rest });
                        else out[current].push({ type: "para", text: rest });
                    }
                    continue;
                }
            }
            if (block.lead) {
                const classified = classifyHeading(block.lead.replace(/\.$/, ""));
                if (classified && classified !== "skip") current = classified;
            }
        }

        if (current === "hook") hookParas.push(block);
        else out[current].push(block);
    }

    // Hook = one-line pitch from the first about/hook prose.
    const hookJoined = hookParas.map(blockToProse).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    const hookText = firstSentence(hookJoined);
    if (hookText) out.hook = [{ type: "para", text: hookText }];

    // Leftover hook body beyond the first sentence — previously we only kept
    // hookParas.slice(1), which discarded the rest of a single mega-paragraph
    // and produced hook-only sparse cards (Caseware / Workday flatten).
    if (out.do.length === 0 && hookJoined) {
        let rest = hookJoined;
        if (hookText) {
            const bare = hookText.replace(/…$/, "");
            if (rest.startsWith(bare)) rest = rest.slice(bare.length).replace(/^[.…\s]+/, "").trim();
            else rest = rest.replace(/^.+?[.!?](?:\s+|$)/, "").trim();
        }
        const leftover: string[] = [];
        for (const b of hookParas) {
            if (b.type === "list" && b.items) leftover.push(...b.items);
        }
        if (rest) {
            const sentences = rest.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 12);
            leftover.push(...(sentences.length ? sentences : [rest]));
        }
        if (leftover.length) out.do = toListBlocks(leftover.slice(0, 8));
    }

    // Normalize do/bring/nice/perks to list blocks when we only have paras.
    for (const key of ["do", "bring", "nice", "perks"] as const) {
        if (out[key].length === 0) continue;
        if (out[key].every((b) => b.type === "list")) continue;
        const items = collectListItems(out[key]);
        if (items.length) out[key] = toListBlocks(items.slice(0, 10));
    }

    // Always prefer a one-line hook. If the ATS dump jumped straight into
    // requirements with no About, synthesize from the first available prose
    // so every postcard still opens with the same template shape.
    if (out.hook.length === 0) {
        const fromBuckets = [...out.do, ...out.bring, ...out.nice, ...out.perks]
            .map(blockToProse)
            .find((s) => s.length >= 12);
        const fallback = firstSentence(
            fromBuckets || raw.replace(/\s+/g, " ").trim(),
            200,
        );
        if (fallback) out.hook = [{ type: "para", text: fallback }];
    }

    // If we somehow produced nothing but the source had text, keep a single
    // hook so the card never goes empty.
    if (!jdTemplateHasContent(out)) {
        const fallback = firstSentence(raw.replace(/\s+/g, " ").trim(), 200);
        if (fallback) out.hook = [{ type: "para", text: fallback }];
    }

    return out;
}

/** The template for a description: the deterministic one, or empty. Never throws. */
export function resolveJdTemplateSync(raw: string | null | undefined): { template: JdTemplate; source: "deterministic" | "empty" } {
    if (!raw?.trim()) return { template: emptyTemplate(), source: "empty" };
    return { template: buildDeterministicJdTemplate(raw), source: "deterministic" };
}
