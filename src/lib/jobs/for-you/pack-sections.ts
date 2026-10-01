import { formatDescription, type DescBlock } from "@/lib/jobs/format-description";

export type PackSectionKey = "about" | "responsibilities" | "requirements";

export interface PackSections {
    about: DescBlock[];
    responsibilities: DescBlock[];
    requirements: DescBlock[];
}

const RESPONSIBILITY_HEADINGS = new Set([
    "responsibilities",
    "your role",
    "what you'll do",
    "what you'll be doing",
    "key responsibilities",
    "what your impact will be",
    "the role",
    "duties",
    "essential functions",
    "essential duties",
    "what success looks like",
    "your impact",
]);

const REQUIREMENT_HEADINGS = new Set([
    "requirements",
    "qualifications",
    "what we're looking for",
    "minimum qualifications",
    "preferred qualifications",
    "nice to have",
    "your background",
    "what you bring",
    "required skills",
    "preferred skills",
    "technical skills",
    "education",
    "experience",
    "education/experience",
    "who you are",
]);

function normalizeHeading(text: string | undefined): string {
    return (text ?? "").toLowerCase().replace(/[:.!?]+$/, "").trim();
}

function classifyHeading(text: string | undefined): PackSectionKey | null {
    const key = normalizeHeading(text);
    if (!key) return null;
    if (RESPONSIBILITY_HEADINGS.has(key)) return "responsibilities";
    if (REQUIREMENT_HEADINGS.has(key)) return "requirements";
    return null;
}

function classifyBlock(block: DescBlock): PackSectionKey | null {
    if (block.type === "heading") return classifyHeading(block.text);
    if (block.type === "para" && block.text) {
        const colonMatch = block.text.match(/^([^:]+):/);
        if (colonMatch) return classifyHeading(colonMatch[1]);
        if (block.lead) return classifyHeading(block.lead.replace(/\.$/, ""));
    }
    return null;
}

/**
 * Split formatted description blocks into About / Responsibilities /
 * Requirements using the same heading vocabulary as `formatDescription`.
 */
export function splitPackSections(description: string | null | undefined): PackSections {
    const blocks = formatDescription(description);
    const sections: PackSections = { about: [], responsibilities: [], requirements: [] };
    let current: PackSectionKey = "about";

    for (const block of blocks) {
        const section = classifyBlock(block);
        // Headings title a section; they are never section content, even
        // one ("About the role", "Benefits") that maps to no section here.
        if (block.type === "heading") {
            if (section) current = section;
            continue;
        }
        if (section && block.type === "para") {
            current = section;
            const colonIdx = block.text?.indexOf(":") ?? -1;
            if (colonIdx >= 0 && block.text) {
                const rest = block.text.slice(colonIdx + 1).trim();
                if (rest) sections[current].push({ ...block, text: rest, lead: undefined });
                else sections[current].push(block);
            } else {
                sections[current].push(block);
            }
            continue;
        }
        sections[current].push(block);
    }

    return sections;
}
