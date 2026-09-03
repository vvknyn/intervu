/**
 * Whether /jobs should show a "add your résumé to rank by fit" entry point
 * (the band's ghost word, the sort menu's fourth item, and the résumé-
 * moment card's copy all read this ONE gate — see page.tsx's call sites).
 *
 * `resumeOnFile` is the SERVER-aware tri-state from `useResumePresence`
 * combined with local state (page.tsx's `resumeOnFile` derivation), not
 * local-only state — a returning signed-in user whose résumé lives on the
 * server must not be told to "add" one just because this session hasn't
 * loaded it yet. `null` (server round trip not back yet) reads as "don't
 * know" rather than "missing": inviting on an unresolved answer would flash
 * the entry for someone who actually has a résumé on file.
 */
export function needsResumeEntry({
    signedIn,
    resumeOnFile,
    fitActive,
}: {
    signedIn: boolean;
    resumeOnFile: boolean | null;
    fitActive: boolean;
}): boolean {
    if (fitActive) return false;
    if (resumeOnFile === true) return false;
    if (resumeOnFile === null) return false;
    if (!signedIn) return true;
    return resumeOnFile === false;
}
