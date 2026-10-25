export const POPULAR_COMPANIES = [
    "Google", "Amazon", "Meta", "Apple", "Microsoft", "Netflix",
    "Stripe", "Uber", "Airbnb", "Datadog", "Salesforce", "Oracle",
    "Spotify", "Tesla", "Nvidia", "Adobe", "LinkedIn", "Twitter"
];

export const POPULAR_ROLES = [
    "Software Engineer", "Product Manager", "Data Scientist",
    "Engineering Manager", "Frontend Engineer", "Backend Engineer",
    "Machine Learning Engineer", "Site Reliability Engineer",
    "Technical Program Manager", "System Administrator", "DevOps Engineer"
];

export const POPULAR_ROUNDS = [
    "Technical", "Behavioral", "System Design", "Hiring Manager", "HR Screening", "Coding"
];

export interface SearchSuggestion {
    text: string;
    /** `seed` = a popular/trending-search row shown on an empty, focused
     *  query (SearchAutocomplete's `seeds` prop) — falls through to the
     *  default magnifying-glass icon like `role`/`full`, distinguished only
     *  by the "Popular searches" section header rendered above the list. */
    type: 'company' | 'role' | 'history' | 'full' | 'seed';
}

/**
 * Section header text for each suggestion type — single source of truth for
 * the dropdown's group labels. Keyed off `SearchSuggestion['type']` itself, so
 * a new type can't render without a labeling decision having been made for
 * it. `undefined` = a type deliberately left unlabeled (`'full'`, compound
 * one-off boosted rows, doesn't read as its own group).
 */
export const SECTION_LABELS: Record<SearchSuggestion['type'], string | undefined> = {
    seed: "Popular searches",
    history: "Recent searches",
    role: "Roles",
    company: "Companies",
    full: undefined,
};

export interface SuggestionRow extends SearchSuggestion {
    /** Position in the flat list, which is how a pick is mapped back to its row. */
    id: number;
}

export interface SuggestionSection {
    id: string;
    /** Visible header; absent for an unlabeled type. */
    label: string | undefined;
    rows: SuggestionRow[];
}

/** Splits the flat, ordered list into runs of one type, each run one labeled section — the order the source ranked them in is kept. */
export function groupSuggestions(suggestions: SearchSuggestion[]): SuggestionSection[] {
    const sections: SuggestionSection[] = [];
    suggestions.forEach((suggestion, id) => {
        const last = sections[sections.length - 1];
        if (last && last.rows[0].type === suggestion.type) {
            last.rows.push({ ...suggestion, id });
        } else {
            sections.push({ id: `${suggestion.type}-${id}`, label: SECTION_LABELS[suggestion.type], rows: [{ ...suggestion, id }] });
        }
    });
    return sections;
}

export function getSuggestions(query: string, history: string[] = []): SearchSuggestion[] {
    if (!query || query.trim().length === 0) return history.map(h => ({ text: h, type: 'history' }));

    const lowerQuery = query.toLowerCase();
    const suggestions: SearchSuggestion[] = [];

    // 1. History matches (high priority)
    const historyMatches = history
        .filter(h => h.toLowerCase().includes(lowerQuery))
        .slice(0, 3)
        .map(h => ({ text: h, type: 'history' as const }));

    suggestions.push(...historyMatches);

    // 2. Company Matches
    const companyMatches = POPULAR_COMPANIES
        .filter(c => c.toLowerCase().startsWith(lowerQuery))
        .slice(0, 3)
        .map(c => ({ text: c, type: 'company' as const }));

    suggestions.push(...companyMatches);

    // 3. Role Matches (if query looks like a role or generic)
    const roleMatches = POPULAR_ROLES
        .filter(r => r.toLowerCase().includes(lowerQuery))
        .slice(0, 2)
        .map(r => ({ text: r, type: 'role' as const }));

    suggestions.push(...roleMatches);

    // 4. Combined Suggestions (Company + Generic Role)
    // If the query is a company name, suggest common roles at that company
    const exactCompany = POPULAR_COMPANIES.find(c => c.toLowerCase() === lowerQuery);
    if (exactCompany) {
        suggestions.push(
            { text: `${exactCompany} Software Engineer`, type: 'full' },
            { text: `${exactCompany} Product Manager`, type: 'full' },
            { text: `${exactCompany} System Design`, type: 'full' }
        );
    }

    // 5. Deduplicate
    const uniqueSuggestions = suggestions.filter((v, i, a) => a.findIndex(t => t.text === v.text) === i);

    return uniqueSuggestions.slice(0, 8); // Max 8 suggestions
}
