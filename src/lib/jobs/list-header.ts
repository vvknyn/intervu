/**
 * What may sit between the search controls and the first job card, in one place (Vivek, 2026-11-01: "I have asked for
 * so many redesigns… this text is overwhelming"; a phone's header held nine blocks of text before the first card, and
 * the first card began 703px down an 844px screen).
 *
 * The rule, for every list state (signed in or out, with or without a résumé, filtered or not, zero results or many):
 *
 *  1. ONE status line says what the list is: the count, how it is ranked, what is new, and the way to change the
 *     résumé it ranks by. A fact the count already says is not said again by a second line.
 *  2. ONE row of controls (the employer scope and the job alert) when there is one to show.
 *  3. At most ONE band (the account's address prompt, the résumé invite, the Chrome tile, or the board's "new since you
 *     were here"; the first that applies) and at most ONE note about how the search was read (the highest priority).
 *  4. ONE quiet disclosure line for what the list left out, closed until tapped.
 *  5. Entry points for someone with no list yet (the hero, browse by field) go once there is a list: they are not
 *     shown above a list ranked against the person's own résumé.
 *
 * A new line joins `LIST_HEADER_LINES` and the budget below, or it does not render: `tests/unit/list-header.test.ts`
 * walks every state and checks that each text block of the list header in JobsContent.tsx is one of these lines, and
 * `tests/e2e/journeys/list-header.spec.ts` reads the rendered page against the same plan on a phone.
 */
export const LIST_HEADER_LINES = ["band", "note", "status", "scope", "disclosure"] as const;
export type ListHeaderLine = (typeof LIST_HEADER_LINES)[number];

/** The most blocks the header holds at once, whatever the state: a band, a note, the status, the controls, one disclosure. */
export const LIST_HEADER_BUDGET = LIST_HEADER_LINES.length;

/** The bands, first that applies wins: what the account needs to work before what we would like to tell it. */
export const HEADER_BAND_PRIORITY = ["prompt", "resume", "extension", "visit"] as const;
export type HeaderBand = (typeof HEADER_BAND_PRIORITY)[number];

/** The notes about how a search was read, highest priority first: the one that changes what the person is looking at leads. */
export const HEADER_NOTE_PRIORITY = ["degraded", "widened", "unmatched", "employer", "understood", "elsewhere", "level"] as const;
export type HeaderNote = (typeof HEADER_NOTE_PRIORITY)[number];

export interface ListHeaderState {
    /** The Search home (search box, filters, rows) is on screen, not the neutral shell that holds the place for an account. */
    homeShown: boolean;
    /** Nothing typed and no job open: the front door's own state. */
    atRest: boolean;
    signedIn: boolean;
    /** The list is ranked against the person's résumé (`fitActive`). */
    ranked: boolean;
    /** The list's rows are on screen (a search, filters, a résumé, or the front door's own rows). */
    rowsShown: boolean;
    /** The one band above the list, if any (`pickHeaderBand`). */
    band: HeaderBand | null;
    /** The list's count has landed, or it carries a résumé to change or something new. */
    status: boolean;
    /** An employer scope or a job alert switch is on offer. */
    scope: boolean;
    /** The notes about how the search was read that apply now. */
    notes: readonly HeaderNote[];
    /** The list has something left out to say (the disclosure, or the one add-detail action for a weak list). */
    disclosure: boolean;
}

export interface ListHeaderPlan {
    /** The marketing hero (eyebrow, headline, privacy line) above the search box. */
    hero: boolean;
    /** "Browse by field" chips under the toolbar. */
    fieldChips: boolean;
    /** The one note about how the search was read, or none. */
    note: HeaderNote | null;
    /** The blocks the header holds, top to bottom. */
    lines: ListHeaderLine[];
}

/** The band that shows when several are eligible: the first in `HEADER_BAND_PRIORITY`. */
export function pickHeaderBand(eligible: Readonly<Record<HeaderBand, boolean>>): HeaderBand | null {
    return HEADER_BAND_PRIORITY.find((id) => eligible[id]) ?? null;
}

/** The note that shows when several apply: the highest priority; the rest explain the same difference from what was typed. */
export function pickHeaderNote(notes: readonly HeaderNote[]): HeaderNote | null {
    return HEADER_NOTE_PRIORITY.find((n) => notes.includes(n)) ?? null;
}

export function listHeaderPlan(s: ListHeaderState): ListHeaderPlan {
    // Entry points are for someone with no list yet: a signed-in account's own résumé list replaces the hero, and any
    // résumé-ranked list replaces the field directory (the list already is what to browse).
    const hero = s.homeShown && s.atRest && !(s.signedIn && s.ranked);
    const fieldChips = s.homeShown && s.atRest && !s.ranked;
    const note = s.rowsShown ? pickHeaderNote(s.notes) : null;
    const lines: ListHeaderLine[] = [];
    if (s.rowsShown) {
        if (s.band) lines.push("band");
        if (note) lines.push("note");
        if (s.status) lines.push("status");
        if (s.scope) lines.push("scope");
        if (s.disclosure) lines.push("disclosure");
    }
    return { hero, fieldChips, note, lines };
}
