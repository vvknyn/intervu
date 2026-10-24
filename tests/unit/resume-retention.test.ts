import assert from "node:assert/strict";
import { test } from "node:test";

import { MIGRATION_MANIFEST } from "@/lib/db/firestore-migration-manifest";
import { bearerMatches } from "@/lib/retention/bearer";
import {
    RESUME_SUBSET,
    buildRetentionWarning,
    resumeOps,
    retentionAction,
    retentionEmailForUid,
    runResumeRetention,
    type RetentionDeps,
} from "@/lib/retention/resume-retention";
import { memoryFirestore } from "./memory-firestore";

process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";
const DAY = 86_400_000;
const END = 1_800_000_000_000;
const st = (over: Partial<Parameters<typeof retentionAction>[0]> = {}) => ({ end: END, now: END, warnedFor: undefined, warnedAt: undefined, hasEmail: true, ...over });

test("nothing before 83 days; warn at exactly 83 days, once per end", () => {
    assert.equal(retentionAction(st({ now: END + 83 * DAY - 1 })), "none");
    assert.equal(retentionAction(st({ now: END - DAY })), "none");
    assert.equal(retentionAction(st({ now: END + 83 * DAY })), "warn");
    assert.equal(retentionAction(st({ now: END + 89 * DAY, warnedFor: END, warnedAt: END + 83 * DAY })), "none");
});

test("a later purchase moves end and re-arms the warning", () => {
    const newEnd = END + 60 * DAY;
    assert.equal(retentionAction(st({ end: newEnd, now: newEnd + 83 * DAY, warnedFor: END, warnedAt: END + 83 * DAY })), "warn");
});

test("F4: never deletes without a warning for this end, nor within 7 days of it", () => {
    const at90 = END + 90 * DAY;
    assert.equal(retentionAction(st({ now: at90 - 1, warnedFor: END, warnedAt: END + 83 * DAY })), "none");
    assert.equal(retentionAction(st({ now: at90 })), "warn", "never warned: warn first");
    assert.equal(retentionAction(st({ now: at90, warnedFor: END - 1, warnedAt: END })), "warn", "warned for an older end");
    assert.equal(retentionAction(st({ now: at90 + DAY, warnedFor: END, warnedAt: at90 })), "none", "warned under 7 days ago");
    assert.equal(retentionAction(st({ now: at90 + 7 * DAY, warnedFor: END, warnedAt: at90 })), "delete");
    assert.equal(retentionAction(st({ now: at90, warnedFor: END, warnedAt: END + 83 * DAY })), "delete");
});

test("an account with no address is deleted on the 90-day mark and never warned", () => {
    assert.equal(retentionAction(st({ now: END + 85 * DAY, hasEmail: false })), "none");
    assert.equal(retentionAction(st({ now: END + 90 * DAY, hasEmail: false })), "delete");
});

test("end == 0 is an anomaly, never a deletion", () => {
    assert.equal(retentionAction(st({ end: 0, now: 10 ** 13 })), "anomaly");
});

test("warning carries only the dates and the pricing link", () => {
    const { subject, text } = buildRetentionWarning(Date.UTC(2026, 0, 1), "https://velai.app");
    assert.equal(subject, "Your saved résumé will be deleted on April 1, 2026");
    assert.match(text, /ended on January 1, 2026/);
    assert.match(text, /https:\/\/velai\.app\/pricing$/);
});

test("every RESUME_SUBSET table is in the user-data manifest", () => {
    const tables = new Set(MIGRATION_MANIFEST.map((c) => c.table));
    for (const t of Object.keys(RESUME_SUBSET)) assert.ok(tables.has(t), t);
});

test("resumeOps removes only résumé fields and derived docs, keeping the rest", () => {
    const doc = (path: string, data: Record<string, unknown>) => ({ path, data }) as never;
    const ops = resumeOps({
        applications: [doc("applications/a1", { resume_versions: [{}], status: "applied" }), doc("applications/a2", { status: "saved" })],
        tailored_resumes: [doc("tailored_resumes/t1", {})],
        email_digest_state: [doc("email_digest_state/u", { dailyPicks: { sentIds: ["x"], enabled: true } })],
        saved_jobs: [doc("saved_jobs/s1", { title: "x" })],
        profiles: [doc("profiles/u", { resume_data: {}, access_until: 5 })],
    });
    assert.deepEqual(ops, [
        { path: "tailored_resumes/t1", fields: null },
        { path: "applications/a1", fields: ["resume_versions"] },
        { path: "email_digest_state/u", fields: ["dailyPicks.sentIds"] },
        { path: "profiles/u", fields: ["resume_data"] },
    ]);
});

test("bearerMatches compares the secret exactly", () => {
    assert.equal(bearerMatches("Bearer s3cret", "s3cret"), true);
    assert.equal(bearerMatches("Bearer s3cre", "s3cret"), false);
    assert.equal(bearerMatches("Bearer s3cret!", "s3cret"), false);
    assert.equal(bearerMatches("s3cret", "s3cret"), false);
    assert.equal(bearerMatches(null, "s3cret"), false);
    assert.equal(bearerMatches("Bearer ", ""), false);
});

function rig(seed: Record<string, Record<string, unknown>>, over: { email?: string | null; sent?: boolean; mirror?: ReturnType<typeof memoryFirestore>; emailFor?: RetentionDeps["emailFor"] } = {}) {
    const primary = memoryFirestore(seed);
    const sentTo: string[] = [];
    const deps: RetentionDeps = {
        db: primary.db,
        withMirror: async (_uid, use) => {
            if (!over.mirror) return "not-applicable";
            await use(over.mirror.db);
            return "ok" as never;
        },
        emailFor: over.emailFor ?? (async () => (over.email === undefined ? "a@example.com" : over.email)),
        send: async (to) => (sentTo.push(to), { sent: over.sent ?? true }),
    };
    return { primary, deps, sentTo };
}
const profile = (extra: Record<string, unknown> = {}) => ({ access_until: END, resume_data: { x: 1 }, name: "keep", ...extra });
const run = (r: ReturnType<typeof rig>, now: number, apply = true) => runResumeRetention({ apply, now, deps: r.deps });

test("F4: a warning stamps only after a successful send; a failed send leaves no stamp and is counted", async () => {
    const bad = rig({ "profiles/u": profile() }, { sent: false });
    const c = await run(bad, END + 84 * DAY);
    assert.equal(c.send_failed, 1);
    assert.equal(c.warned, 0);
    assert.equal(bad.primary.docs.get("profiles/u")?.retention_warned_for, undefined);
    const good = rig({ "profiles/u": profile() });
    assert.equal((await run(good, END + 84 * DAY)).warned, 1);
    assert.equal(good.primary.docs.get("profiles/u")?.retention_warned_for, END);
    assert.equal(good.primary.docs.get("profiles/u")?.retention_warned_at, END + 84 * DAY);
});

test("a dry run sends and writes nothing", async () => {
    const r = rig({ "profiles/u": profile() });
    const c = await run(r, END + 84 * DAY, false);
    assert.equal(c.warned, 1);
    assert.equal(r.sentTo.length, 0);
    assert.equal(r.primary.writes.length, 0);
});

test("never-warned past 90 days warns first and keeps the résumé; after the gap it deletes only the résumé subset", async () => {
    const r = rig({
        "profiles/u": profile(),
        "tailored_resumes/t1": { user_id: "u", job: "j" },
        "saved_jobs/s1": { user_id: "u", title: "keep" },
    });
    await run(r, END + 91 * DAY);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data, "warned, not deleted");
    const c = await run(r, END + 99 * DAY);
    assert.equal(c.deleted, 1);
    const p = r.primary.docs.get("profiles/u")!;
    assert.equal(p.resume_data, undefined);
    assert.equal(p.name, "keep");
    assert.equal(p.access_until, END);
    assert.equal(r.primary.docs.has("tailored_resumes/t1"), false);
    assert.equal(r.primary.docs.has("saved_jobs/s1"), true);
});

test("F3: copies-only (base résumé already gone) are still found and deleted; the mirror store is cleaned too", async () => {
    const mirror = memoryFirestore({ "profiles/u": { resume_data: { m: 1 } } });
    const r = rig(
        { "profiles/u": profile({ resume_data: undefined, retention_warned_for: END, retention_warned_at: END + 83 * DAY }), "tailored_resumes/t1": { user_id: "u" } },
        { mirror },
    );
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.deleted, 1);
    assert.equal(r.primary.docs.has("tailored_resumes/t1"), false);
    assert.equal(mirror.docs.get("profiles/u")?.resume_data, undefined);
});

test("F5: an account that never had access gets a first-seen stamp, then the clock runs from it", async () => {
    const r = rig({ "profiles/u": { resume_data: { x: 1 } } });
    const c1 = await run(r, END);
    assert.equal(c1.no_access_period, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.retention_first_seen_at, END);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
    await run(r, END + 84 * DAY);
    assert.equal(r.primary.docs.get("profiles/u")?.retention_warned_for, END);
});

test("an account with no résumé data anywhere is not scanned; a paid account is untouched", async () => {
    const r = rig({ "profiles/none": { access_until: END }, "profiles/paid": profile({ access_until: END + 500 * DAY }) });
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.scanned, 0);
    assert.equal(r.sentTo.length, 0);
});

test("no address: deleted on the mark and counted", async () => {
    const r = rig({ "profiles/u": profile() }, { email: null });
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.deleted, 1);
    assert.equal(c.no_email, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("batches deletes in groups of at most 500", async () => {
    const seed: Record<string, Record<string, unknown>> = { "profiles/u": profile({ retention_warned_for: END, retention_warned_at: END }) };
    for (let i = 0; i < 1200; i++) seed[`tailored_resumes/t${i}`] = { user_id: "u" };
    const r = rig(seed);
    r.primary.db.batch = ((orig) => () => {
        const b = orig();
        const commit = b.commit.bind(b);
        let n = 0;
        const wrap = (k: "update" | "delete") => { const f = (b as any)[k].bind(b); (b as any)[k] = (...a: unknown[]) => (n++, f(...a)); };
        wrap("update"); wrap("delete");
        b.commit = async () => { assert.ok(n <= 500, `batch of ${n}`); return commit(); };
        return b;
    })(r.primary.db.batch.bind(r.primary.db)) as never;
    assert.equal((await run(r, END + 91 * DAY)).deleted, 1);
    assert.equal([...r.primary.docs.keys()].filter((k) => k.startsWith("tailored_resumes/")).length, 0);
});

/** The real retention lookup over a fake WorkOS: `getUserByExternalId` / `getUser` behave as given. */
const workos = (lookup: { byExternalId?: () => Promise<{ id: string }>; user?: () => Promise<{ email?: string | null }> }) =>
    (uid: string) =>
        retentionEmailForUid(uid, {
            getUserByExternalId: lookup.byExternalId ?? (async () => ({ id: "w" })),
            getUser: lookup.user ?? (async () => ({ email: "a@example.com" })),
        } as never);
const outage = () => Promise.reject(Object.assign(new Error("boom"), { name: "GenericServerException", status: 500 }));
const notFound = () => Promise.reject(Object.assign(new Error("nf"), { name: "NotFoundException", status: 404 }));

test("(a) a lookup error past 90 days with no warning: no delete, no send, counted as an error", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ user: outage }) });
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.errors, 1);
    assert.equal(c.deleted, 0);
    assert.equal(r.sentTo.length, 0);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
});

test("(b) a lookup error in the warn window leaves no warn stamp", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ byExternalId: outage }) });
    const c = await run(r, END + 84 * DAY);
    assert.equal(c.errors, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.retention_warned_for, undefined);
});

test("(c) WorkOS not-found for the account is positively no address: deleted on the mark", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ byExternalId: notFound, user: notFound }) });
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.deleted, 1);
    assert.equal(c.no_email, 1);
    assert.equal(c.errors, 0);
    assert.equal(r.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("(d) a minted address cannot receive mail: counts as no address, deleted instead of send_failed forever", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ user: async () => ({ email: "someone@intervu.cc" }) }) });
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.deleted, 1);
    assert.equal(c.send_failed, 0);
    assert.equal(r.sentTo.length, 0);
});

test("(e) access_until moved to the future after the snapshot: no delete", async () => {
    const r = rig({ "profiles/u": profile({ retention_warned_for: END, retention_warned_at: END + 83 * DAY }) });
    // The purchase lands while the run is between its snapshot and the delete (the address lookup).
    r.deps.emailFor = async () => {
        await r.primary.db.doc("profiles/u").update({ access_until: END + 400 * DAY });
        return "a@example.com";
    };
    const c = await run(r, END + 91 * DAY);
    assert.equal(c.deleted, 0);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
});
