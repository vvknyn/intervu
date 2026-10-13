/**
 * Whether a résumé parsed in this browser as a guest should become the
 * account's résumé on sign-in. Pure.
 *
 * It used to be adopted only when the account had NO résumé, so someone whose
 * session had lapsed, who uploaded a new résumé, then signed in, got their old
 * one back and the new one silently dropped ("the résumé I upload doesn't get
 * saved", review 2026-10-13). The newer one wins now: the browser copy is
 * adopted when the account has none, or when the account's copy was saved
 * before this one was parsed. An account copy with no readable date is kept —
 * there is no evidence the browser's is newer.
 */
export function shouldAdoptGuestResume(input: {
    serverHasResume: boolean;
    serverUpdatedAt?: string | null;
    localUpdatedAt: string;
}): boolean {
    if (!input.serverHasResume) return true;
    const server = Date.parse(input.serverUpdatedAt ?? "");
    const local = Date.parse(input.localUpdatedAt);
    if (!Number.isFinite(server) || !Number.isFinite(local)) return false;
    return local > server;
}
