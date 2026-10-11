import { NextResponse } from "next/server";
import { resolveClientIpFromHeaders } from "@/lib/shield/client-ip";
import { allowSealedAiRequest, allowSealedAiServerRequest, SEALED_AI_WINDOW_MS } from "@/lib/shield/rate-limit";
import {
    cappedStream,
    readCappedBody,
    sealedAiKey,
    sealedAiTarget,
    SEALED_AI_MAX_REQUEST_BYTES,
    SEALED_AI_MAX_RESPONSE_BYTES,
    SEALED_AI_UPSTREAM_TIMEOUT_MS,
} from "@/lib/sealed-ai/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/sealed-ai/v1/chat/completions — the browser's sealed-AI request,
 * passed on to the Tinfoil enclave it verified, with our key in place of its
 * placeholder. The body arrives encrypted to that enclave (EHBP) and goes on
 * as it came; the reply comes back the same way. Nothing here can read either,
 * and nothing here logs them.
 */
export async function POST(request: Request): Promise<Response> {
    const headers = { "Cache-Control": "no-store, private" };
    const key = sealedAiKey();
    if (!key) return NextResponse.json({ error: "Sealed AI is off" }, { status: 503, headers });

    // Only velai.app's own pages: a browser on another site sends "cross-site".
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin") return NextResponse.json({ error: "Not allowed" }, { status: 403, headers });

    const ip = resolveClientIpFromHeaders(request.headers);
    if (!allowSealedAiRequest(ip) || !allowSealedAiServerRequest("all")) {
        const retryAfter = Math.ceil(Math.max(allowSealedAiRequest.retryAfterMs(ip), 1_000) / 1_000);
        return NextResponse.json(
            { error: "Too many requests" },
            { status: 429, headers: { ...headers, "Retry-After": String(Math.min(retryAfter, SEALED_AI_WINDOW_MS / 1_000)) } },
        );
    }

    const encapsulatedKey = request.headers.get("ehbp-encapsulated-key") ?? "";
    const target = sealedAiTarget(request.headers.get("x-tinfoil-enclave-url"));
    if (!/^[0-9a-f]{16,512}$/i.test(encapsulatedKey) || !target) {
        return NextResponse.json({ error: "Not a sealed request" }, { status: 400, headers });
    }
    if (Number(request.headers.get("content-length") ?? 0) > SEALED_AI_MAX_REQUEST_BYTES) {
        return NextResponse.json({ error: "Too large" }, { status: 413, headers });
    }
    const body = await readCappedBody(request, SEALED_AI_MAX_REQUEST_BYTES);
    if (!body) return NextResponse.json({ error: "Too large" }, { status: 413, headers });

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: "POST",
            headers: {
                "Content-Type": request.headers.get("content-type") ?? "application/json",
                "Ehbp-Encapsulated-Key": encapsulatedKey,
                Authorization: `Bearer ${key}`,
            },
            body,
            signal: AbortSignal.timeout(SEALED_AI_UPSTREAM_TIMEOUT_MS),
        });
    } catch {
        return NextResponse.json({ error: "Sealed AI didn't answer" }, { status: 502, headers });
    }

    const out = new Headers(headers);
    for (const name of ["content-type", "ehbp-response-nonce"]) {
        const value = upstream.headers.get(name);
        if (value) out.set(name, value);
    }
    if (!upstream.body) return new Response(null, { status: upstream.status, headers: out });
    return new Response(cappedStream(upstream.body, SEALED_AI_MAX_RESPONSE_BYTES), { status: upstream.status, headers: out });
}
