/**
 * Retired (Sep 28, approved by Vivek): the deck no longer drops Canada roles.
 * Location is an eligibility filter on the pack's own search, the same for
 * every country. This no-op remains only so `JobsContent.tsx`, which still
 * calls it, compiles; delete it together with that call site.
 */
export function isCanadaDeckJob(_job: unknown): false {
    return false;
}
