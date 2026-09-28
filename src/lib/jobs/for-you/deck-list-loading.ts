/**
 * The For you deck list mounts as soon as browse hits exist.
 * Fit ranking can still be resolving, or there can be no résumé at all.
 * A non-empty pack must not stay on the ranking shell waiting for fitActive.
 * An empty pack stays a skeleton only while a fetch or fit pass is in flight.
 */
export function deckListLoading(input: {
    proofLoading: boolean;
    fitResolving: boolean;
    loading: boolean;
    packCount: number;
}): boolean {
    if (input.proofLoading) return true;
    if (input.packCount > 0) return false;
    return input.fitResolving || input.loading;
}
