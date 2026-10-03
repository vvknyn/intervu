/**
 * Where a job description says the person must be: "candidates must be based
 * in India", "open to applicants located in the EU", "must be authorized to
 * work in the United States", "This is a remote role in Canada",
 * "Location: Remote (Brazil)". A remote posting whose title and place fields
 * name no country used to read as open to anyone, so a role for people in
 * India was a Today pick for a résumé in Canada (2026-10-02).
 *
 * Only sentences that state a requirement count. Offices, headquarters and
 * customers named in passing ("offices in London and Bangalore") never do,
 * and neither does a sentence that lifts the limit ("you don't need to be
 * based in the US", "based anywhere"). A place counts only when the whole
 * phrase is one (`placeNamed`, or the caller's `resolveCity` for a city);
 * a phrase with a place inside other words counts for nothing.
 *
 * Citizenship and clearance requirements count too ("must be a U.S.
 * citizen", "Canadian citizenship required", "active TS/SCI clearance"), and
 * a dotted country ("the U.S.", "the U.K.") reads as the country, not as a
 * sentence that ends at "U" (2026-10-03: "authorized to work in the U.S."
 * read as no limit).
 *
 * A description that says the role is open anywhere ("work from anywhere in
 * the world", "open to candidates located anywhere") reads as
 * `{ label: "anywhere", countries: [] }`, so nothing weaker (the pay's
 * currency, `pay-place.ts`) overrides what the employer wrote.
 *
 * Isomorphic and pure: the server passes a gazetteer-backed `resolveCity`.
 */
import { jobCountries, placeNamed, resumeCountriesFromLocation, titlePlace } from "./resume-location";
import type { PlaceRestriction, PublicJob } from "./types";

/** The most rows one place-notes request reads: Today checks its first picks, not a page. */
export const PLACE_NOTES_MAX_IDS = 24;

/** How many rows ahead of the one in view a ranked list wants read before it asks again. */
export const PLACE_CHECK_LEAD = 8;

/**
 * A row that names no place of its own (country field, place text or title)
 * and hasn't been read yet: only its description can still say where the
 * person must be (`/api/jobs/place-notes`).
 */
export function needsPlaceCheck(job: PublicJob): boolean {
    return job.place_restriction === undefined && jobCountries(job).length === 0 && !titlePlace(job.title);
}

/**
 * The rows of a ranked list to read next, for a person at row `from`: none
 * while every row from there to `lead` rows on is read (`isRead`) or names a
 * place, else up to `max` unread rows from `from` on. Reading a stretch at a
 * time keeps it to one request per stretch of rows, not one per step.
 */
export function nextPlaceCheckIds(
    jobs: readonly PublicJob[],
    from: number,
    isRead: (id: string) => boolean,
    { lead = PLACE_CHECK_LEAD, max = PLACE_NOTES_MAX_IDS }: { lead?: number; max?: number } = {},
): string[] {
    const start = Math.max(0, from);
    const unread = (job: PublicJob) => !isRead(job.id) && needsPlaceCheck(job);
    if (!jobs.slice(start, start + lead).some(unread)) return [];
    const ids: string[] = [];
    for (let i = start; i < jobs.length && ids.length < max; i++) if (unread(jobs[i]!)) ids.push(jobs[i]!.id);
    return ids;
}

/** A city or other place `placeNamed` doesn't know, to the canonical country it is in. */
export type ResolvePlace = (phrase: string) => string | null;

const PLACE_TEXT = String.raw`([^.;:!?\n()]{2,80})`;

/** Requirement sentences, each capturing the place phrase that follows. */
const REQUIREMENT_PATTERNS: RegExp[] = [
    // "must be based in", "need to reside in", "are required to be located within"
    new RegExp(
        String.raw`\b(?:must|should|will need to|need to|needs to|are required to|is required to|required to)\s+(?:currently\s+|already\s+)?(?:be\s+)?(?:physically\s+)?(?:based|located|living|residing|reside|live)\s+(?:in|within)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "open to candidates based in", "available only to residents of", "only accepting applicants located in"
    new RegExp(
        String.raw`\b(?:open|available|limited|restricted|accepting\s+applications?)\s+(?:only\s+)?(?:to|from)\s+(?:candidates|applicants|residents|people|individuals|those|talent)\s+(?:who\s+(?:are|live|reside)\s+)?(?:currently\s+)?(?:based\s+|located\s+|living\s+|residing\s+)?(?:in|within|of)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "authorized to work in", "eligible to work in", "the right to work in"
    new RegExp(
        String.raw`\b(?:(?:legally\s+)?(?:authori[sz]ed|eligible|entitled|permitted)|(?:the\s+)?right)\s+to\s+work\s+(?:in|within)\s+` + PLACE_TEXT,
        "gi",
    ),
    // "This is a remote role based in", "The position is fully remote within", "this job is remote in"
    new RegExp(
        String.raw`\b(?:this|the)\s+(?:is\s+an?\s+)?(?:(?:fully|100%)\s+)?(?:remote\s+)?(?:role|position|job|opportunity)\s+(?:is\s+)?(?:(?:fully|100%)\s+)?(?:remote\s+)?(?:based\s+)?(?:in|within)\s+` +
            PLACE_TEXT,
        "gi",
    ),
    // "remote within the US", "remote across Europe", "remote, US only"
    new RegExp(String.raw`\bremote\s+(?:within|across|throughout)\s+` + PLACE_TEXT, "gi"),
    // "Location: Remote (India)" on its own line
    /(?:^|\n)\s*(?:job\s+|work\s+)?location\s*[:\-–]\s*([^\n]{2,80})/gi,
];

/** Words before a requirement that lift it: "you don't need to be based in", "regardless of where". */
const LIFTED = /(?:\b(?:not|no need|never|regardless|wherever|irrespective)\b|n['’]t\b)[^.!?;\n]*$/i;
/** After a negated requirement, words that keep it a requirement: "applicants not authorized to work in the US will not be considered". */
const STILL_REQUIRED = /^[^.!?;\n]*\b(?:will\s+not|won['’]t|cannot|can['’]t|can\s+not|are\s+not|is\s+not)\s+(?:be\s+)?(?:considered|eligible|accepted|reviewed)\b/i;

/** What a requirement reads when the description says the role is open to people anywhere. */
export const OPEN_ANYWHERE: PlaceRestriction = { label: "anywhere", countries: [] };

/**
 * Sentences that open a role to people anywhere: "work from anywhere in the
 * world", "we hire globally". Not "anywhere in the US", a perk that only says
 * "work from anywhere", or a product "available worldwide".
 */
const OPEN_ANYWHERE_PATTERNS: RegExp[] = [
    /\b(?:work|working|live|living|based|located|from|reside|residing|hire|hiring|recruit(?:ing)?)\s+(?:\w+\s+){0,2}anywhere\s+in\s+the\s+world\b/i,
    /\b(?:hire|hiring|recruit(?:ing)?)\s+(?:candidates\s+|talent\s+|people\s+)?(?:worldwide|globally|everywhere|from\s+any\s+country)\b/i,
    /\b(?:open|available)\s+to\s+(?:candidates|applicants|people|talent|anyone)\s+(?:who\s+(?:are|live)\s+)?(?:located\s+|based\s+|living\s+|residing\s+)?anywhere\b(?!\s*\(?\s*(?:in|within|across|inside)\s+(?!the\s+world\b))/i,
];

/**
 * Requirements to be a country's citizen or to hold its security clearance,
 * each capturing the words before "citizen" ("a U.S. citizen", "US or
 * Canadian citizens"). Only the country words at the end of the capture count
 * (`citizenPlace`).
 */
const CITIZEN_WORD = String.raw`(?:citizens?|citizenship|nationals?|nationality|passport\s+holders?|persons?)`;
const CITIZEN_PATTERNS: RegExp[] = [
    // "must be a U.S. citizen", "need to hold Canadian citizenship"
    new RegExp(
        String.raw`\b(?:must|should|will need to|need to|needs to|are required to|is required to|required to)\s+(?:be|hold|have|possess)\s+(?:an?\s+)?(?:current\s+|valid\s+)?([A-Za-z][A-Za-z '’&-]{1,40}?)\.?\s+` +
            CITIZEN_WORD +
            String.raw`\b`,
        "gi",
    ),
    // "U.S. citizenship is required", "Canadian citizens only"
    new RegExp(
        String.raw`\b([A-Za-z][A-Za-z '’&-]{1,40}?)\.?\s+` + CITIZEN_WORD + String.raw`\s+(?:is\s+|are\s+)?(?:required|mandatory|needed|necessary|only)\b`,
        "gi",
    ),
    // "requires U.S. citizenship", "open only to UK nationals"
    new RegExp(
        String.raw`\b(?:requires?|requiring|open\s+(?:only\s+)?to|limited\s+to|restricted\s+to|only)\s+([A-Za-z][A-Za-z '’&-]{1,40}?)\.?\s+` +
            CITIZEN_WORD +
            String.raw`\b`,
        "gi",
    ),
    // "must be a citizen of Canada"
    new RegExp(
        String.raw`\b(?:must|should|need to|needs to|required to)\s+be\s+(?:an?\s+)?citizens?\s+of\s+([^.;:!?\n()]{2,40})`,
        "gi",
    ),
];

/**
 * Citizenship said the other way round, counted only when the sentence goes on
 * to rule people out (`STILL_REQUIRED`): "applicants who are not U.S.
 * citizens will not be considered", "non-US citizens are not eligible".
 */
const NEGATED_CITIZEN_PATTERNS: RegExp[] = [
    new RegExp(String.raw`\bnot\s+(?:an?\s+)?([A-Za-z][A-Za-z '’&-]{1,40}?)\.?\s+` + CITIZEN_WORD + String.raw`\b`, "gi"),
    new RegExp(String.raw`\bnon[-\s]?([A-Za-z][A-Za-z '’&-]{0,40}?)\.?\s+` + CITIZEN_WORD + String.raw`\b`, "gi"),
];

/** Clearances only one country grants: holding one means being that country's citizen. */
const CLEARANCES: Array<[RegExp, string]> = [
    [/\bTS\s*\/\s*SCI\b|\bTop\s+Secret\s*\/\s*SCI\b|\bPublic\s+Trust\s+(?:clearance|position|background)/i, "United States"],
    [/\b(?:SC|DV|NPPV\s*\d?)\s+(?:level\s+)?(?:security\s+)?clearance\b/, "United Kingdom"],
    [/\b(?:NV1|NV2|AGSVA)\b|\bBaseline\s+(?:security\s+)?clearance\b/, "Australia"],
    [/\b(?:Enhanced\s+)?Reliability\s+Status\b/i, "Canada"],
];

/** A country's people as written before "citizen": "Canadian", "British". `placeNamed` reads country names and codes. */
const DEMONYMS: Record<string, string> = {
    american: "United States", canadian: "Canada", british: "United Kingdom", indian: "India", australian: "Australia",
    german: "Germany", french: "France", irish: "Ireland", brazilian: "Brazil", mexican: "Mexico", spanish: "Spain",
    italian: "Italy", dutch: "Netherlands", swiss: "Switzerland", swedish: "Sweden", norwegian: "Norway", danish: "Denmark",
    finnish: "Finland", polish: "Poland", portuguese: "Portugal", japanese: "Japan", chinese: "China", korean: "South Korea",
    singaporean: "Singapore", israeli: "Israel", filipino: "Philippines", emirati: "United Arab Emirates", saudi: "Saudi Arabia",
    nigerian: "Nigeria", kenyan: "Kenya", egyptian: "Egypt", argentine: "Argentina", argentinian: "Argentina", chilean: "Chile",
    colombian: "Colombia", turkish: "Turkey", austrian: "Austria", belgian: "Belgium", greek: "Greece", czech: "Czechia",
    romanian: "Romania", hungarian: "Hungary", ukrainian: "Ukraine", pakistani: "Pakistan", vietnamese: "Vietnam",
    thai: "Thailand", malaysian: "Malaysia", indonesian: "Indonesia", "new zealand": "New Zealand", "south african": "South Africa",
};
/** "Latin American", "African American": words before a demonym that make it something else. */
const NOT_A_DEMONYM_BEFORE = /\b(?:latin|south|central|north|african|native|asian)\s*$/i;

/** "a citizen of Canada" or "of the United States or Canada": read like any place phrase. */
function citizenOf(phrase: string, resolvePlace?: ResolvePlace): PlaceRestriction[] {
    const places = phrasePlaces(phrase, resolvePlace);
    return places === "anywhere" ? [] : places;
}

/** The country the last words of a captured phrase name: "a U.S." → US, "eligible Canadian" → Canada. */
function citizenPlace(phrase: string): PlaceRestriction[] {
    const out: PlaceRestriction[] = [];
    for (const part of phrase.split(/\s+(?:or|and|&)\s+|[,/]/i)) {
        const words = part.trim().split(/\s+/).filter(Boolean);
        for (let n = Math.min(3, words.length); n >= 1; n--) {
            const tail = words.slice(-n).join(" ");
            const head = words.slice(0, -n).join(" ");
            const named = placeNamed(tail.replace(/^(?:an?|the)\s+/i, ""));
            const demonym = DEMONYMS[tail.toLowerCase()];
            if (named) {
                out.push(named);
                break;
            }
            if (demonym && !NOT_A_DEMONYM_BEFORE.test(head)) {
                const canonical = resumeCountriesFromLocation(demonym)[0];
                if (canonical) out.push({ label: canonical, countries: [canonical] });
                break;
            }
        }
    }
    return out;
}

/** Where a place phrase stops: the next clause ("India and will report to…"). */
const CLAUSE_BREAK = /\s+(?:with|who|whom|to|for|where|while|that|which|as|at|during|on|by|and\s+(?:will|be|have|are|must)|will|won['’]t|cannot|can['’]t|may|must|should|are|is|unless|except|without|excluding|but)\s+/i;

function stripHtml(text: string): string {
    return text
        .replace(/<\s*(?:br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/[ \t]+/g, " ");
}

/**
 * "the U.S." → "the US", "U. K." → "UK", "U.S.A." → "USA": a place phrase
 * stops at a period, so a dotted country read as "U". Where a capitalised
 * word follows, the period may have ended the sentence too ("work in the
 * U.S. We offer…"), so one stays after the letters.
 */
function undotAbbreviations(text: string): string {
    return text.replace(/\b([A-Z])\.\s?([A-Z])\.(?:\s?([A-Z])\.)?(\s+(?=[A-Z]))?/g, (_m, a: string, b: string, c: string | undefined, gap: string | undefined) =>
        `${a}${b}${c ?? ""}${gap ? `.${gap}` : ""}`,
    );
}

/** The places one captured phrase names: "the US or Canada", "India", "EMEA", "Toronto"; "anywhere" when it opens the role to everyone. */
function phrasePlaces(phrase: string, resolvePlace?: ResolvePlace): PlaceRestriction[] | "anywhere" {
    const out: PlaceRestriction[] = [];
    const pieces = phrase
        .split(/\s+(?:or|and|&)\s+|[,/|]|\s[-–—]\s/i)
        .map((piece) => piece.split(CLAUSE_BREAK)[0]!.trim())
        .filter(Boolean);
    for (const piece of pieces) {
        const short = piece.split(/\s+/).length <= 5;
        // "anywhere in the UK" is the UK; "anywhere in the world" opens the role.
        const named = short ? placeNamed(piece) : null;
        if (named) {
            out.push(named);
            continue;
        }
        if (/\banywhere\b|\bworld(?:wide)?\b|\bglobal(?:ly)?\b/i.test(piece)) return "anywhere";
        if (!short) continue;
        const country = resolvePlace?.(piece.replace(/^(?:the|remote)\s+/i, ""));
        if (country) out.push({ label: country, countries: [country] });
    }
    return out;
}

/**
 * The place a description limits the role to; `OPEN_ANYWHERE` when it says
 * the role is open to people anywhere and names no limit; `null` when it
 * states neither.
 */
export function readPlaceRestriction(description: string | null | undefined, resolvePlace?: ResolvePlace): PlaceRestriction | null {
    if (!description) return null;
    const text = undotAbbreviations(stripHtml(description));
    const found: PlaceRestriction[] = [];
    let open = OPEN_ANYWHERE_PATTERNS.some((pattern) => pattern.test(text));
    // The words before a requirement and its own opening words read together, so "no need to be based in" is lifted
    // though the requirement's match starts at "need to".
    const lifted = (match: RegExpMatchArray) => {
        const at = match.index ?? 0;
        const lead = text.slice(Math.max(0, at - 60), at) + match[0].slice(0, match[0].length - match[1]!.length);
        return LIFTED.test(lead) && !STILL_REQUIRED.test(text.slice(at + match[0].length - match[1]!.length));
    };
    for (const pattern of REQUIREMENT_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            if (lifted(match)) continue;
            const isLocationLine = /location\s*[:\-–]/i.test(match[0]);
            const pieces = isLocationLine ? match[1]!.split(/[(),;|]|\s[-–—]\s|\s+or\s+/i) : [match[1]!];
            for (const piece of pieces) {
                const places = phrasePlaces(piece, resolvePlace);
                if (places === "anywhere") open = true;
                else found.push(...places);
            }
        }
    }
    for (const pattern of CITIZEN_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            if (lifted(match) || /^\s*(?:is\s+|are\s+)?not\b/i.test(text.slice((match.index ?? 0) + match[0].length))) continue;
            found.push(...(/citizens?\s+of\s/i.test(match[0]) ? citizenOf(match[1]!, resolvePlace) : citizenPlace(match[1]!)));
        }
    }
    for (const pattern of NEGATED_CITIZEN_PATTERNS) {
        pattern.lastIndex = 0;
        for (const match of text.matchAll(pattern)) {
            if (STILL_REQUIRED.test(text.slice((match.index ?? 0) + match[0].length))) found.push(...citizenPlace(match[1]!));
        }
    }
    for (const [pattern, country] of CLEARANCES) {
        const match = text.match(pattern);
        const before = match ? text.slice(Math.max(0, (match.index ?? 0) - 60), match.index ?? 0) : "";
        if (match && !LIFTED.test(before)) found.push({ label: country, countries: [country] });
    }
    if (found.length === 0) return open ? OPEN_ANYWHERE : null;
    const countries = [...new Set(found.flatMap((place) => place.countries))];
    const labels = [...new Set(found.map((place) => place.label))];
    return { label: labels.slice(0, 3).join(" or "), countries };
}
