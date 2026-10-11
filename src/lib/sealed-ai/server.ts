/**
 * The server half of sealed AI: velai.app passes a browser's request on to
 * Tinfoil's attested inference server with our key added. The request body is
 * encrypted in the browser to that server's attested key (EHBP), so this hop
 * can read neither the résumé lines nor the answer: it only adds the key,
 * counts, and caps. https://docs.tinfoil.sh/guides/proxy-server
 */

/** Tinfoil's model; `TINFOIL_MODEL` on the box picks another from their catalog. */
export function sealedAiModel(): string {
    return process.env.TINFOIL_MODEL?.trim() || "llama3-3-70b";
}

/** The key is only ever read here, on the server. */
export function sealedAiKey(): string | null {
    return process.env.TINFOIL_API_KEY?.trim() || null;
}

/** One rewrite request is a few KB and a résumé read about 10 KB; past this isn't ours. */
export const SEALED_AI_MAX_REQUEST_BYTES = 96 * 1024;
/** A reply past this is no rewrite or résumé read: the pass-through cuts it off. */
export const SEALED_AI_MAX_RESPONSE_BYTES = 256 * 1024;
export const SEALED_AI_UPSTREAM_TIMEOUT_MS = 60_000;

/**
 * Where to send a request: the enclave the browser verified, as its
 * `X-Tinfoil-Enclave-Url` names it. Only an https Tinfoil host (no port, no
 * credentials) is accepted, so the key can never be sent anywhere else.
 */
export function sealedAiTarget(enclaveUrl: string | null): URL | null {
    if (!enclaveUrl) return null;
    let url: URL;
    try {
        url = new URL(enclaveUrl);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    if (host !== "tinfoil.sh" && !host.endsWith(".tinfoil.sh")) return null;
    return new URL("/v1/chat/completions", url.origin);
}

/** The body, or null past `max` bytes: read in chunks so a large body is never buffered whole. */
export async function readCappedBody(request: Request, max: number): Promise<ArrayBuffer | null> {
    if (!request.body) return new ArrayBuffer(0);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
            await reader.cancel().catch(() => {});
            return null;
        }
        chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out.buffer;
}

/** `body`, ended with an error once it passes `max` bytes. */
export function cappedStream(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
    let size = 0;
    return body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                size += chunk.byteLength;
                if (size > max) controller.error(new Error("sealed-ai reply too large"));
                else controller.enqueue(chunk);
            },
        }),
    );
}
