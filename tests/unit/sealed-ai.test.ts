import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../../src/app/api/sealed-ai/v1/chat/completions/route";
import { GET } from "../../src/app/api/sealed-ai/status/route";
import { cappedStream, readCappedBody, sealedAiTarget, SEALED_AI_MAX_REQUEST_BYTES } from "../../src/lib/sealed-ai/server";
import { resetSealedAiForTests, sealedAiBaseUrl, sealedAiStatus, useSealedAiOrigin, type SealedAiStub } from "../../src/lib/sealed-ai/client";
import { clearRateLimitStateForTests, SEALED_AI_MAX_REQUESTS } from "../../src/lib/shield/rate-limit";
import { useSealedAiAccessDeps } from "../../src/lib/sealed-ai/access";
import { parseResumeLocally, withoutContactDetails } from "../../src/lib/local-ai/parse-resume";

/**
 * Sealed AI (Tinfoil): velai.app's pass-through adds our key to a request the
 * browser encrypted to Tinfoil's attested server, and can't read it; résumé
 * reads send the text without the person's name or contact details. Vivek
 * 2026-10-11: "get rid of the local model and use tinfoil".
 */

const ENCLAVE = "https://inference.tinfoil.sh";
const ENC_KEY = "ab".repeat(32);

function sealedRequest(init: { headers?: Record<string, string>; body?: string } = {}): Request {
    return new Request("https://velai.app/api/sealed-ai/v1/chat/completions", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "ehbp-encapsulated-key": ENC_KEY,
            "x-tinfoil-enclave-url": ENCLAVE,
            "sec-fetch-site": "same-origin",
            authorization: "Bearer velai",
            "x-forwarded-for": "203.0.113.7",
            ...init.headers,
        },
        body: init.body ?? "sealed-bytes",
    });
}

describe("sealedAiTarget: the key only ever goes to Tinfoil", () => {
    it("sends to the verified enclave's chat endpoint on a Tinfoil host", () => {
        assert.equal(sealedAiTarget(ENCLAVE)?.toString(), "https://inference.tinfoil.sh/v1/chat/completions");
        assert.equal(sealedAiTarget("https://router.inf6.tinfoil.sh/anything")?.toString(), "https://router.inf6.tinfoil.sh/v1/chat/completions");
    });

    it("refuses anything else", () => {
        for (const url of [null, "", "not a url", "http://inference.tinfoil.sh", "https://tinfoil.sh.evil.com", "https://eviltinfoil.sh", "https://inference.tinfoil.sh:8443", "https://user:pw@inference.tinfoil.sh", "https://169.254.169.254"]) {
            assert.equal(sealedAiTarget(url), null, String(url));
        }
    });
});

describe("readCappedBody / cappedStream", () => {
    it("reads a body up to the cap and refuses one past it", async () => {
        const ok = await readCappedBody(new Request("https://x", { method: "POST", body: "12345" }), 5);
        assert.equal(new TextDecoder().decode(ok!), "12345");
        assert.equal(await readCappedBody(new Request("https://x", { method: "POST", body: "123456" }), 5), null);
    });

    it("ends a reply stream with an error past the cap", async () => {
        await assert.rejects(new Response(cappedStream(new Response("1234567").body!, 5)).text());
        assert.equal(await new Response(cappedStream(new Response("12345").body!, 5)).text(), "12345");
    });
});

describe("the pass-through route", () => {
    const realFetch = globalThis.fetch;
    let sent: { url: string; init: RequestInit } | null = null;

    beforeEach(() => {
        clearRateLimitStateForTests();
        process.env.TINFOIL_API_KEY = "tk_test_key";
        delete process.env.TINFOIL_MODEL;
        useSealedAiAccessDeps({ uid: async () => "u-paid", isPaid: async () => true });
        sent = null;
        globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
            sent = { url: String(url), init: init ?? {} };
            return new Response("sealed-reply", { status: 200, headers: { "content-type": "application/json", "ehbp-response-nonce": "cd".repeat(16), "set-cookie": "x=1" } });
        }) as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        delete process.env.TINFOIL_API_KEY;
        useSealedAiAccessDeps();
    });

    it("says whether sealed AI is set up, and its model", async () => {
        assert.deepEqual(await (await GET()).json(), { enabled: true, model: "llama3-3-70b" });
        delete process.env.TINFOIL_API_KEY;
        assert.equal((await (await GET()).json()).enabled, false);
    });

    it("is on in the status only for a signed-in account with a paid month", async () => {
        const enabled = async () => (await (await GET()).json()).enabled;
        useSealedAiAccessDeps({ uid: async () => null });
        assert.equal(await enabled(), false, "signed out");
        useSealedAiAccessDeps({ uid: async () => "u-free", isPaid: async () => false });
        assert.equal(await enabled(), false, "signed in, no paid month");
        useSealedAiAccessDeps({ uid: async () => "u-paid", isPaid: async (uid) => uid === "u-paid" });
        assert.equal(await enabled(), true, "paid");
    });

    it("refuses the pass-through to anyone not signed in (401) or without a paid month (402), and sends nothing", async () => {
        useSealedAiAccessDeps({ uid: async () => null });
        assert.equal((await POST(sealedRequest())).status, 401);
        useSealedAiAccessDeps({ uid: async () => "u-free", isPaid: async () => false });
        const unpaid = await POST(sealedRequest());
        assert.equal(unpaid.status, 402);
        assert.equal((await unpaid.json()).code, "payment_required");
        assert.equal(sent, null, "nothing reached Tinfoil");
        useSealedAiAccessDeps({ uid: async () => "u-paid", isPaid: async () => true });
        assert.equal((await POST(sealedRequest())).status, 200);
    });

    it("passes the encrypted body on unchanged, with our key in place of the browser's placeholder", async () => {
        const res = await POST(sealedRequest());
        assert.equal(res.status, 200);
        assert.equal(await res.text(), "sealed-reply");
        assert.equal(res.headers.get("ehbp-response-nonce"), "cd".repeat(16));
        assert.equal(res.headers.get("set-cookie"), null, "only the reply's type and nonce come back");
        assert.equal(sent!.url, "https://inference.tinfoil.sh/v1/chat/completions");
        const headers = sent!.init.headers as Record<string, string>;
        assert.deepEqual(Object.keys(headers).sort(), ["Authorization", "Content-Type", "Ehbp-Encapsulated-Key"]);
        assert.equal(headers.Authorization, "Bearer tk_test_key");
        assert.equal(headers["Ehbp-Encapsulated-Key"], ENC_KEY);
        assert.equal(new TextDecoder().decode(sent!.init.body as ArrayBuffer), "sealed-bytes");
    });

    it("is off without a key, and refuses other sites, unsealed bodies and other hosts", async () => {
        delete process.env.TINFOIL_API_KEY;
        assert.equal((await POST(sealedRequest())).status, 503);
        process.env.TINFOIL_API_KEY = "tk_test_key";
        assert.equal((await POST(sealedRequest({ headers: { "sec-fetch-site": "cross-site" } }))).status, 403);
        assert.equal((await POST(sealedRequest({ headers: { "ehbp-encapsulated-key": "" } }))).status, 400);
        assert.equal((await POST(sealedRequest({ headers: { "x-tinfoil-enclave-url": "https://example.com" } }))).status, 400);
        assert.equal((await POST(sealedRequest({ body: "x".repeat(SEALED_AI_MAX_REQUEST_BYTES + 1) }))).status, 413);
        assert.equal(sent, null, "nothing was sent on");
    });

    it("answers the Chrome extension too, and no other site", async () => {
        // An extension's request carries no Sec-Fetch-Site but "none", and its own origin.
        const fromExtension = { "sec-fetch-site": "none", origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" };
        assert.equal((await POST(sealedRequest({ headers: fromExtension }))).status, 200);
        assert.equal((sent!.init.headers as Record<string, string>).Authorization, "Bearer tk_test_key");
        // "none" from anywhere else (a typed address, a page with no origin) and other origins stay out.
        assert.equal((await POST(sealedRequest({ headers: { "sec-fetch-site": "none" } }))).status, 403);
        assert.equal((await POST(sealedRequest({ headers: { "sec-fetch-site": "none", origin: "https://evil.example" } }))).status, 403);
        assert.equal((await POST(sealedRequest({ headers: { "sec-fetch-site": "cross-site", origin: "chrome-extension://abc" } }))).status, 403);
        assert.equal((await POST(sealedRequest({ headers: { "sec-fetch-site": "same-site", origin: "chrome-extension://abc" } }))).status, 403);
    });

    it("limits one address to its share", async () => {
        for (let i = 0; i < SEALED_AI_MAX_REQUESTS; i++) assert.equal((await POST(sealedRequest())).status, 200);
        const refused = await POST(sealedRequest());
        assert.equal(refused.status, 429);
        assert.ok(Number(refused.headers.get("retry-after")) > 0);
        assert.equal((await POST(sealedRequest({ headers: { "x-forwarded-for": "198.51.100.9" } }))).status, 200);
    });

    it("answers 502 when Tinfoil doesn't", async () => {
        globalThis.fetch = (async () => {
            throw new Error("down");
        }) as typeof fetch;
        assert.equal((await POST(sealedRequest())).status, 502);
    });
});

describe("résumé reads send no name or contact details", () => {
    const RESUME = `Priya Raman
priya.raman@example.com | +44 20 7946 0958 | (416) 555-0199 | linkedin.com/in/priyaraman | https://priya.dev
Toronto, ON

Experience
Registered Nurse, Toronto General Hospital, 2015-2019, 2019 - 2023
Triage up to 40 patients a shift using CTAS.
`;

    afterEach(() => {
        delete (globalThis as { __velaiSealedAi?: unknown }).__velaiSealedAi;
        resetSealedAiForTests();
    });

    it("takes out the email, phone numbers, links and name, and keeps dates and figures", () => {
        const out = withoutContactDetails(RESUME, "Priya Raman");
        for (const gone of ["Priya Raman", "priya.raman@example.com", "7946", "555-0199", "linkedin.com", "priya.dev"]) assert.ok(!out.includes(gone), gone);
        for (const kept of ["Toronto General Hospital", "2015-2019", "2019 - 2023", "40 patients"]) assert.ok(out.includes(kept), kept);
    });

    it("asks only when told to, sends the cleaned text, and keeps the quick read's identity fields", async () => {
        const sentText: string[] = [];
        const stub: SealedAiStub = async (messages) => {
            sentText.push(messages.map((m) => m.content).join("\n"));
            return JSON.stringify({
                profile: { name: "Someone Else", email: "x@y.z", profession: "Registered Nurse" },
                experience: [{ company: "Toronto General Hospital", role: "Registered Nurse", dates: "2015 - 2023", description: "• Triage up to 40 patients a shift using CTAS." }],
            });
        };
        (globalThis as { __velaiSealedAi?: unknown }).__velaiSealedAi = stub;
        const quick = await parseResumeLocally(RESUME);
        assert.equal(sentText.length, 0, "the quick read sends nothing");
        assert.equal(quick.engine, "heuristic");
        const read = await parseResumeLocally(RESUME, { withModel: true });
        assert.equal(sentText.length, 1);
        assert.ok(!sentText[0]!.includes("priya.raman@example.com") && !sentText[0]!.includes("Priya Raman"));
        assert.equal(read.engine, "sealed");
        assert.equal(read.data.parsed.profile.email, quick.data.parsed.profile.email);
        assert.notEqual(read.data.parsed.profile.name, "Someone Else");
    });

    it("keeps the quick read when sealed AI answers nothing", async () => {
        (globalThis as { __velaiSealedAi?: unknown }).__velaiSealedAi = (async () => null) satisfies SealedAiStub;
        const read = await parseResumeLocally(RESUME, { withModel: true });
        assert.equal(read.engine, "heuristic");
    });
});

describe("sealed AI from the Chrome extension", () => {
    const realFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = realFetch;
        delete (globalThis as { __velaiSealedAi?: unknown }).__velaiSealedAi;
        resetSealedAiForTests();
    });

    it("asks velai.app's status from the origin it is given, and the pass-through lives under it", async () => {
        const asked: string[] = [];
        globalThis.fetch = (async (url: string | URL) => {
            asked.push(String(url));
            return new Response(JSON.stringify({ enabled: true, model: "llama3-3-70b" }), { status: 200 });
        }) as typeof fetch;
        assert.deepEqual(await sealedAiStatus(), { enabled: false, model: "" }, "off where there is no velai.app origin to ask");
        assert.deepEqual(asked, []);
        useSealedAiOrigin("https://velai.app/");
        assert.deepEqual(await sealedAiStatus(), { enabled: true, model: "llama3-3-70b" });
        assert.deepEqual(asked, ["https://velai.app/api/sealed-ai/status"]);
        assert.equal(sealedAiBaseUrl("https://velai.app"), "https://velai.app/api/sealed-ai/v1/");
    });

    it("asks again after a status check that failed, instead of staying off", async () => {
        let calls = 0;
        globalThis.fetch = (async () => {
            calls++;
            if (calls === 1) throw new Error("offline");
            return new Response(JSON.stringify({ enabled: true, model: "m" }), { status: 200 });
        }) as typeof fetch;
        useSealedAiOrigin("https://velai.app");
        assert.equal((await sealedAiStatus()).enabled, false);
        assert.equal((await sealedAiStatus()).enabled, true);
        assert.equal(calls, 2);
    });
});
