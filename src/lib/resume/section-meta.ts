import type { ResumeData, ResumeSection } from "@/types/resume";

/**
 * Section-order row's mono right-key (docs-mockup.html Comp D `.secrow
 * .mono-k`): the one real countable fact a section carries — role count,
 * skill count, education-entry count. `summary`/`projects` have no such
 * count, so the row renders with no key at all rather than a fabricated one
 * (degrade by omission, same rule as the tracker's truth-line). Pure — no
 * I/O, no React — so it's unit-testable without pulling in the editor UI.
 */
export function sectionMetaLabel(section: ResumeSection, data: ResumeData): string | undefined {
    switch (section) {
        case "experience": {
            const n = data.experience?.length ?? 0;
            return n > 0 ? `${n} role${n === 1 ? "" : "s"}` : undefined;
        }
        case "skills": {
            const n = (data.competencies ?? []).reduce((sum, c) => sum + c.skills.length, 0);
            return n > 0 ? `${n} skill${n === 1 ? "" : "s"}` : undefined;
        }
        case "education": {
            const n = data.education?.length ?? 0;
            return n > 0 ? `${n} ${n === 1 ? "entry" : "entries"}` : undefined;
        }
        default:
            return undefined;
    }
}
