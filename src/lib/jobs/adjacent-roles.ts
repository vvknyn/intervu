/**
 * Deterministic adjacent-role suggestions — no LLM.
 *
 * Fallback for Explore broadening when cloud adjacency is unavailable.
 * `suggestAdjacentRolesLocal` is exported for Rank/`sort=fit` retrieval
 * (via `buildMatchQuery`) and Explore broadening.
 */

const ROLE_ADJACENCY: Record<string, string[]> = {
    "customer success operations": [
        "Customer Success Manager",
        "Technical Account Manager",
        "Product Manager",
        "Implementation Manager",
    ],
    "cs ops": [
        "Customer Success Manager",
        "Technical Account Manager",
        "Product Manager",
        "Implementation Manager",
    ],
    csops: [
        "Customer Success Manager",
        "Technical Account Manager",
        "Product Manager",
        "Implementation Manager",
    ],
    "customer success": [
        "Customer Success Manager",
        "Technical Account Manager",
        "Implementation Manager",
        "Product Manager",
    ],
    csm: [
        "Customer Success Manager",
        "Technical Account Manager",
        "Implementation Manager",
        "Product Manager",
    ],
    "technical account": [
        "Technical Account Manager",
        "Customer Success Manager",
        "Product Manager",
        "Implementation Manager",
    ],
    tam: [
        "Technical Account Manager",
        "Customer Success Manager",
        "Product Manager",
        "Implementation Manager",
    ],
    "account management": [
        "Technical Account Manager",
        "Customer Success Manager",
        "Account Manager",
        "Product Manager",
    ],
    implementation: [
        "Implementation Manager",
        "Technical Account Manager",
        "Customer Success Manager",
        "Program Manager",
    ],
    revops: [
        "Revenue Operations Manager",
        "Customer Success Manager",
        "Program Manager",
        "Product Manager",
    ],
    "revenue operations": [
        "Revenue Operations Manager",
        "Customer Success Manager",
        "Program Manager",
        "Product Manager",
    ],
    engineer: ["Software Engineer", "Backend Engineer", "Platform Engineer", "DevOps Engineer"],
    developer: ["Software Developer", "Full Stack Developer", "Frontend Developer", "Application Developer"],
    frontend: ["Frontend Engineer", "UI Engineer", "Web Developer", "React Developer"],
    backend: ["Backend Engineer", "API Engineer", "Platform Engineer", "Systems Engineer"],
    fullstack: ["Full Stack Engineer", "Software Engineer", "Web Developer", "Product Engineer"],
    devops: ["Site Reliability Engineer", "Platform Engineer", "Cloud Engineer", "Infrastructure Engineer"],
    sre: ["DevOps Engineer", "Platform Engineer", "Reliability Engineer", "Cloud Engineer"],
    product: ["Product Manager", "Technical Product Manager", "Program Manager", "Product Owner"],
    designer: ["UX Designer", "Product Designer", "UI Designer", "Visual Designer"],
    data: ["Data Analyst", "Data Engineer", "Analytics Engineer", "Business Intelligence Analyst"],
    analyst: ["Business Analyst", "Data Analyst", "Product Analyst", "Operations Analyst"],
    manager: ["Engineering Manager", "Technical Lead", "Team Lead", "Program Manager"],
    architect: ["Solutions Architect", "Software Architect", "Cloud Architect", "Principal Engineer"],
    scientist: ["Machine Learning Engineer", "Research Scientist", "Data Scientist", "Applied Scientist"],
    marketing: ["Growth Marketing Manager", "Product Marketing Manager", "Digital Marketing Specialist", "Content Strategist"],
    sales: ["Account Executive", "Business Development Representative", "Sales Engineer", "Customer Success Manager"],
};

/** Keys that denote CS/TAM/product-adjacent families — when one matches, skip generic `manager`. */
const SPECIFIC_FAMILY_KEYS = new Set([
    "customer success operations",
    "cs ops",
    "csops",
    "customer success",
    "csm",
    "technical account",
    "tam",
    "account management",
    "implementation",
    "revops",
    "revenue operations",
    "product",
]);

const SKILL_TO_ROLE: Record<string, string[]> = {
    react: ["Frontend Engineer", "React Developer", "UI Engineer"],
    typescript: ["Software Engineer", "Full Stack Engineer", "Frontend Engineer"],
    python: ["Backend Engineer", "Data Engineer", "Machine Learning Engineer"],
    java: ["Backend Engineer", "Software Engineer", "Platform Engineer"],
    aws: ["Cloud Engineer", "DevOps Engineer", "Platform Engineer"],
    kubernetes: ["DevOps Engineer", "Platform Engineer", "Site Reliability Engineer"],
    sql: ["Data Analyst", "Analytics Engineer", "Backend Engineer"],
    figma: ["Product Designer", "UX Designer", "UI Designer"],
};

/** Longest keywords first so "customer success operations" wins over "customer success" / "manager". */
const ADJACENCY_KEYWORDS = Object.keys(ROLE_ADJACENCY).sort((a, b) => b.length - a.length);

function normalizeToken(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

/** Split pipe / middle-dot / slash profession blobs into distinct title phrases. */
export function splitRoleTitles(blob: string): string[] {
    return blob
        .split(/\s*[|·/]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function normalizeTitlesInput(titles: string | string[]): string[] {
    const raw = Array.isArray(titles) ? titles : [titles];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
        for (const part of splitRoleTitles(item ?? "")) {
            const key = part.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(part);
        }
    }
    return out;
}

/**
 * Suggest up to `max` adjacent job titles from one or more title strings + skills.
 * Pure, deterministic — same inputs always yield the same ordered list.
 *
 * Generic `manager` is skipped when a more specific family key (CS/TAM/product/etc.)
 * already contributed, so CS/TAM headlines are not drowned by Engineering Manager.
 * The `product` key still runs independently when any title contains "product".
 */
export function suggestAdjacentRolesLocal(
    titles: string | string[],
    skills: string[] = [],
    max = 4,
): string[] {
    const titleParts = normalizeTitlesInput(titles);
    const out: string[] = [];
    const seen = new Set<string>();

    const add = (title: string) => {
        const t = title.trim();
        if (!t) return;
        const key = t.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(t);
    };

    let matchedSpecificFamily = false;

    for (const title of titleParts) {
        const profLower = title.toLowerCase();
        for (const keyword of ADJACENCY_KEYWORDS) {
            if (keyword === "manager" && matchedSpecificFamily) continue;
            if (!profLower.includes(keyword)) continue;
            if (SPECIFIC_FAMILY_KEYS.has(keyword)) matchedSpecificFamily = true;
            for (const t of ROLE_ADJACENCY[keyword]) add(t);
        }
    }

    for (const rawSkill of skills) {
        const token = normalizeToken(rawSkill);
        const mapped = SKILL_TO_ROLE[token];
        if (mapped) {
            for (const t of mapped) add(t);
        }
    }

    // Generic widen when nothing matched
    const primary = titleParts[0] ?? "";
    if (out.length === 0 && primary.trim()) {
        add(primary.trim());
        const profLower = primary.toLowerCase();
        if (profLower.includes("senior")) add(primary.replace(/senior/i, "Staff").trim());
        if (profLower.includes("lead")) add(primary.replace(/lead/i, "Manager").trim());
    }

    return out.slice(0, max);
}
