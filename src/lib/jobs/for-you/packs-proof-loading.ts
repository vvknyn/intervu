/** Local Betalist/capture latch — sessionStorage only, never product default. */
export const PACKS_PROOF_LOADING_KEY = "velai.proof.forcePacksLoading";

export function readPacksProofLoading(): boolean {
    if (typeof window === "undefined") return false;
    try {
        return window.sessionStorage.getItem(PACKS_PROOF_LOADING_KEY) === "1";
    } catch {
        return false;
    }
}
