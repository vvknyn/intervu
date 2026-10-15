/**
 * Stands in for Node's "zlib" in the extension bundle. The attestation
 * verifier (tinfoil) names it only as a fallback for a browser without
 * DecompressionStream, which every Chrome the extension supports has.
 */
export function gunzipSync(): never {
    throw new Error("zlib is not available in the extension");
}
