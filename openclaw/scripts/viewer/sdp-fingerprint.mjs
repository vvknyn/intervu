/**
 * A short, deterministic fingerprint of an SDP blob (D11.1).
 *
 * Not a real SDP field — just enough entropy to let the host tell "the
 * offer the guest actually answered" apart from a different one, and to let
 * the guest report that back. Plain JS with no dependency (no node:crypto,
 * no Web Crypto) so the exact same function runs on both sides: the host
 * (transport-webrtc.mjs, Node) and the guest (watch-canvas.tsx, browser),
 * imported by relative path the same way crop.mjs and input-capture.mjs
 * already are — one implementation, not two that could drift apart.
 */
export function fingerprintSdp(sdp) {
    let hash = 0;
    for (let i = 0; i < sdp.length; i++) {
        hash = (Math.imul(31, hash) + sdp.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}
