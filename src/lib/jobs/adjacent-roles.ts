/**
 * Deterministic adjacent-role suggestions — no LLM.
 *
 * Fallback for Explore broadening when cloud adjacency is unavailable.
 * `suggestAdjacentRolesLocal` is exported for future UI wiring; today
 * `buildExploreBroadenQuery` in resume-match.ts handles the skills path.
 */

const ROLE_ADJACENCY: Record<string, string[]> = {
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

function normalizeToken(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9+#]/g, "");
}

/**
 * Suggest up to `max` adjacent job titles from profession + skills.
 * Pure, deterministic — same inputs always yield the same ordered list.
 */
export function suggestAdjacentRolesLocal(
    profession: string,
    skills: string[],
    max = 4,
): string[] {
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

    const profLower = profession.toLowerCase();
    for (const [keyword, titles] of Object.entries(ROLE_ADJACENCY)) {
        if (profLower.includes(keyword)) {
            for (const t of titles) add(t);
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
    if (out.length === 0 && profession.trim()) {
        add(profession.trim());
        if (profLower.includes("senior")) add(profession.replace(/senior/i, "Staff").trim());
        if (profLower.includes("lead")) add(profession.replace(/lead/i, "Manager").trim());
    }

    return out.slice(0, max);
}
