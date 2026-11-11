import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
    DOMAIN_REASONS,
    LISTING_REASONS,
    cleanDomainInput,
    parseListingRef,
} from "../../src/lib/admin/moderation";
import { createModeration, type Gate, type ModerationDeps } from "../../src/lib/admin/moderation-core";
import { REJECT_DOMAIN_TIMEOUT_MS, getModerationLog, hasModerationKey, postModeration } from "../../src/lib/jobs/subspace-moderation";

const ID = "11111111-1111-4111-8111-111111111111";

/* ------------------------------ vocabularies ------------------------------ */

describe("reason lists", () => {
    // These two lists are Subspace's closed vocabularies
    // (src/lib/admin-moderation/contract.ts there). A reason Subspace does not
    // know is a 400 on every submit, so a change here without the same change
    // there fails this test, not the admin.
    it("match the Subspace contract exactly", () => {
        assert.deepEqual([...LISTING_REASONS], ["not_a_job", "wrong_company", "spam", "duplicate", "other"]);
        assert.deepEqual([...DOMAIN_REASONS], ["classifieds_or_marketplace", "aggregator", "job_board", "staffing_agency", "not_an_employer", "other"]);
    });
});

describe("parseListingRef", () => {
    it("takes a bare id, in any case", () => {
        assert.equal(parseListingRef(ID), ID);
        assert.equal(parseListingRef(` ${ID.toUpperCase()} `), ID);
    });

    it("takes the authoritative trailing id from a Velai job link, not the decorative slug", () => {
        assert.equal(parseListingRef(`https://velai.app/jobs/used-sofa-at-kijiji-canada-${ID}`), ID);
        assert.equal(parseListingRef(`/jobs/${ID}?utm=x`), ID);
        const other = "22222222-2222-4222-8222-222222222222";
        assert.equal(parseListingRef(`/jobs/${other}-title-${ID}`), ID);
    });

    it("is null when there is no id", () => {
        for (const raw of ["", "kijiji", "https://velai.app/jobs", "1234-5678", "not-a-uuid-at-all"]) {
            assert.equal(parseListingRef(raw), null, raw);
        }
    });
});

describe("cleanDomainInput", () => {
    it("reduces what an admin pastes to a bare host", () => {
        for (const raw of ["Kijiji.ca", "https://www.kijiji.ca/b-jobs/canada?x=1", "  www.KIJIJI.ca. ", "http://kijiji.ca#top", "ftp://kijiji.ca/a"]) {
            assert.equal(cleanDomainInput(raw), "kijiji.ca", raw);
        }
        assert.equal(cleanDomainInput(""), "");
        assert.equal(cleanDomainInput("   "), "");
    });
});

/* ----------------------------- gate and rules ----------------------------- */

function harness(opts: { admin?: boolean; configured?: boolean; reply?: unknown } = {}) {
    const calls: Array<{ kind: "post" | "log"; arg: unknown }> = [];
    const gate: Gate = opts.admin === false ? { ok: false } : { ok: true, actor: "vivek.nar87@gmail.com" };
    const reply = opts.reply ?? { ok: true, status: 200, data: { marker: true } };
    const deps = {
        requireAdmin: async () => gate,
        configured: () => opts.configured !== false,
        post: async (body: unknown) => (calls.push({ kind: "post", arg: body }), reply),
        log: async (limit: number) => (calls.push({ kind: "log", arg: limit }), reply),
    } as unknown as ModerationDeps;
    return { m: createModeration(deps), calls };
}

describe("who may ask", () => {
    it("a non-admin gets forbidden from every action and Subspace is never contacted", async () => {
        const { m, calls } = harness({ admin: false });
        const results = [
            await m.previewListing(ID),
            await m.removeListing({ jobId: ID, reason: "spam" }),
            await m.previewDomain({ domain: "kijiji.ca", reason: "aggregator" }),
            await m.rejectDomain({ domain: "kijiji.ca", reason: "aggregator", expectOpenListings: 3 }),
            await m.undo({ logId: 1, kind: "close_listing" }),
            await m.list(),
        ];
        for (const r of results) assert.deepEqual(r, { kind: "forbidden" });
        assert.equal(calls.length, 0);
        assert.equal(await m.available(), false);
    });

    it("the controls are available only to an admin on a configured server", async () => {
        assert.equal(await harness({ admin: true, configured: true }).m.available(), true);
        assert.equal(await harness({ admin: true, configured: false }).m.available(), false);
        assert.equal(await harness({ admin: false, configured: true }).m.available(), false);
    });

    it("the admin check runs on every call, not once", async () => {
        let asked = 0;
        const m = createModeration({
            requireAdmin: async () => (asked++, { ok: true, actor: "a" } as Gate),
            configured: () => true,
            post: async () => ({ ok: true, status: 200, data: {} }) as never,
            log: async () => ({ ok: true, status: 200, data: [] }) as never,
        });
        await m.removeListing({ jobId: ID, reason: "spam" });
        await m.removeListing({ jobId: ID, reason: "spam" });
        await m.list();
        assert.equal(asked, 3);
    });
});

describe("what is sent to Subspace", () => {
    it("removeListing: the admin as actor, the id out of a pasted link, a trimmed capped note", async () => {
        const { m, calls } = harness();
        const r = await m.removeListing({ jobId: `https://velai.app/jobs/x-${ID}`, reason: "not_a_job", note: `  ${"n".repeat(900)}  ` });
        assert.equal(r.kind, "ok");
        const body = calls[0].arg as Record<string, unknown>;
        assert.deepEqual({ ...body, note: undefined }, { action: "close_listing", actor: "vivek.nar87@gmail.com", listing_id: ID, reason: "not_a_job", note: undefined });
        assert.equal((body.note as string).length, 500);
    });

    it("previewListing is a dry run", async () => {
        const { m, calls } = harness();
        await m.previewListing(`/jobs/t-${ID}`);
        assert.deepEqual(calls[0].arg, { action: "close_listing", actor: "vivek.nar87@gmail.com", listing_id: ID, reason: "other", dry_run: true });
    });

    it("previewDomain cleans the domain and is a dry run; rejectDomain quotes the preview's count", async () => {
        const { m, calls } = harness();
        await m.previewDomain({ domain: "https://www.Kijiji.ca/b-jobs", reason: "classifieds_or_marketplace" });
        assert.deepEqual(calls[0].arg, { action: "reject_domain", actor: "vivek.nar87@gmail.com", domain: "kijiji.ca", reason: "classifieds_or_marketplace", dry_run: true });
        await m.rejectDomain({ domain: "kijiji.ca", reason: "classifieds_or_marketplace", note: "ads", expectOpenListings: 1234 });
        assert.deepEqual(calls[1].arg, { action: "reject_domain", actor: "vivek.nar87@gmail.com", domain: "kijiji.ca", reason: "classifieds_or_marketplace", note: "ads", expect_open_listings: 1234 });
    });

    it("undo maps each kind to its restore action, by log id", async () => {
        const { m, calls } = harness();
        await m.undo({ logId: 7, kind: "close_listing" });
        await m.undo({ logId: 8, kind: "reject_domain" });
        assert.deepEqual(calls.map((c) => c.arg), [
            { action: "restore_listing", actor: "vivek.nar87@gmail.com", log_id: 7 },
            { action: "restore_domain", actor: "vivek.nar87@gmail.com", log_id: 8 },
        ]);
    });
});

describe("what is refused before Subspace is contacted", () => {
    it("bad input never leaves the server", async () => {
        const { m, calls } = harness();
        const bad = [
            await m.previewListing("no id here"),
            await m.removeListing({ jobId: "nope", reason: "spam" }),
            await m.removeListing({ jobId: ID, reason: "because" }),
            await m.previewDomain({ domain: "  ", reason: "aggregator" }),
            await m.previewDomain({ domain: "kijiji.ca", reason: "bogus" }),
            await m.rejectDomain({ domain: "kijiji.ca", reason: "aggregator", expectOpenListings: -1 }),
            await m.rejectDomain({ domain: "kijiji.ca", reason: "aggregator", expectOpenListings: 1.5 }),
            await m.rejectDomain({ domain: "kijiji.ca", reason: "aggregator", expectOpenListings: undefined as unknown as number }),
            await m.undo({ logId: 0, kind: "close_listing" }),
            await m.undo({ logId: 3, kind: "delete" as never }),
        ];
        for (const r of bad) assert.equal(r.kind === "error" && r.code, "invalid_input");
        assert.equal(calls.length, 0);
    });
});

describe("how Subspace's answer comes back", () => {
    it("ok, unavailable and error keep their meaning", async () => {
        assert.deepEqual(await harness().m.list(), { kind: "ok", data: { marker: true } });
        assert.deepEqual(await harness({ reply: { ok: false, status: 0, code: "unavailable", message: "x" } }).m.list(), { kind: "unavailable" });
        assert.deepEqual(
            await harness({ reply: { ok: false, status: 409, code: "preview_stale", message: "now 40" } }).m.rejectDomain({ domain: "kijiji.ca", reason: "aggregator", expectOpenListings: 3 }),
            { kind: "error", message: "now 40", code: "preview_stale" },
        );
    });
});

/* ------------------------------ Subspace client ------------------------------ */

describe("Subspace moderation client", () => {
    const realFetch = globalThis.fetch;
    const saved = { admin: process.env.SUBSPACE_ADMIN_API_KEY, key: process.env.SUBSPACE_API_KEY, base: process.env.SUBSPACE_API_BASE_URL };
    let seen: Array<{ url: string; init: RequestInit }>;

    beforeEach(() => {
        seen = [];
        process.env.SUBSPACE_ADMIN_API_KEY = "admin-key";
        process.env.SUBSPACE_API_KEY = "reader-key";
        process.env.SUBSPACE_API_BASE_URL = "https://subspace.test/";
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        for (const [k, v] of [["SUBSPACE_ADMIN_API_KEY", saved.admin], ["SUBSPACE_API_KEY", saved.key], ["SUBSPACE_API_BASE_URL", saved.base]] as const) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });
    const stub = (res: () => Response | Promise<Response>) => {
        globalThis.fetch = (async (url: string, init: RequestInit) => (seen.push({ url, init }), res())) as typeof fetch;
    };

    it("is unavailable without the admin key and does not call out; the reader key is not a substitute", async () => {
        delete process.env.SUBSPACE_ADMIN_API_KEY;
        stub(() => new Response("{}"));
        assert.equal(hasModerationKey(), false);
        const r = await postModeration({ action: "close_listing" });
        assert.deepEqual(r, { ok: false, status: 0, code: "unavailable", message: "Admin moderation isn't configured on this server." });
        assert.equal(seen.length, 0);
    });

    it("sends the admin key (never the reader key) to the moderation path, and unwraps the envelope", async () => {
        stub(() => Response.json({ data: { log_id: 9 }, meta: {} }, { status: 201 }));
        const r = await postModeration<{ log_id: number }>({ action: "close_listing", actor: "a" });
        assert.deepEqual(r, { ok: true, status: 201, data: { log_id: 9 } });
        const headers = seen[0].init.headers as Record<string, string>;
        assert.equal(seen[0].url, "https://subspace.test/api/v1/admin/moderation");
        assert.equal(headers["x-api-key"], "admin-key");
        assert.ok(!Object.values(headers).includes("reader-key"));
        assert.equal(seen[0].init.method, "POST");
        assert.deepEqual(JSON.parse(seen[0].init.body as string), { action: "close_listing", actor: "a" });
    });

    it("reads the log with GET and a bounded limit in the query", async () => {
        stub(() => Response.json({ data: [], meta: {} }));
        await getModerationLog(50);
        assert.equal(seen[0].url, "https://subspace.test/api/v1/admin/moderation?limit=50");
        assert.equal(seen[0].init.method, "GET");
        assert.equal(seen[0].init.body, undefined);
    });

    it("carries Subspace's error code and message through, and survives a non-JSON body", async () => {
        stub(() => Response.json({ error: { message: "now 40", code: "preview_stale" } }, { status: 409 }));
        assert.deepEqual(await postModeration({ action: "reject_domain" }), { ok: false, status: 409, code: "preview_stale", message: "now 40" });
        stub(() => new Response("<html>bad gateway</html>", { status: 502 }));
        assert.deepEqual(await postModeration({ action: "reject_domain" }), { ok: false, status: 502, code: "http_502", message: "Subspace answered 502." });
    });

    it("says a timeout may still be running, and a dead network is its own code", async () => {
        stub(() => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })));
        const t = await postModeration({ action: "reject_domain" });
        assert.equal(!t.ok && t.code, "timeout");
        assert.match(!t.ok ? t.message : "", /may still be running/);
        stub(() => Promise.reject(new Error("ECONNREFUSED 10.0.0.5")));
        const n = await postModeration({ action: "close_listing" });
        assert.equal(!n.ok && n.code, "network_error");
        assert.ok(!(!n.ok && n.message.includes("10.0.0.5")), "the network error text is not echoed to the admin UI");
    });

    it("gives a domain write a longer wait than a preview", () => {
        assert.ok(REJECT_DOMAIN_TIMEOUT_MS >= 60_000);
    });
});

/* ------------------------------- class guards ------------------------------- */

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = path.join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

describe("the moderation key stays in one server module", () => {
    const files = walk(path.join(process.cwd(), "src"));
    const rel = (f: string) => path.relative(process.cwd(), f).split(path.sep).join("/");

    it("SUBSPACE_ADMIN_API_KEY is named only by src/lib/jobs/subspace-moderation.ts", () => {
        const users = files.filter((f) => readFileSync(f, "utf8").includes("SUBSPACE_ADMIN_API_KEY")).map(rel);
        assert.deepEqual(users, ["src/lib/jobs/subspace-moderation.ts"]);
    });

    it("no client component imports the Subspace moderation client or the server action core", () => {
        const offenders = files
            .filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")))
            .filter((f) => /lib\/jobs\/subspace-moderation|lib\/admin\/moderation-core/.test(readFileSync(f, "utf8")))
            .map(rel);
        assert.deepEqual(offenders, []);
    });

    it("the subspace-moderation client never reads the reader key", () => {
        const src = readFileSync(path.join(process.cwd(), "src/lib/jobs/subspace-moderation.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
        assert.ok(!/process\.env\.SUBSPACE_API_KEY/.test(src));
    });
});
