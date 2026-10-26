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

const WARN_FROM = END - 7 * DAY;

test("nothing before end-7d; warn inside the window, once per end", () => {
    assert.equal(retentionAction(st({ now: WARN_FROM - 1 })), "none");
    assert.equal(retentionAction(st({ now: WARN_FROM })), "warn");
    assert.equal(retentionAction(st({ now: END - 1, warnedFor: END })), "none");
    assert.equal(retentionAction(st({ now: END - 1, hasEmail: false })), "none", "no address, nothing to send");
});

test("a later purchase moves end and re-arms the warning", () => {
    const newEnd = END + 60 * DAY;
    assert.equal(retentionAction(st({ end: newEnd, now: newEnd - DAY, warnedFor: END })), "warn");
});

test("at or after end: delete, warned or not, with or without an address", () => {
    assert.equal(retentionAction(st({ now: END, warnedFor: END })), "delete");
    assert.equal(retentionAction(st({ now: END })), "delete", "never warned");
    assert.equal(retentionAction(st({ now: END + 30 * DAY, warnedFor: END - 1, hasEmail: false })), "delete");
});

test("the rule is not shaped by one end date", () => {
    const other = END + 1234 * DAY + 17;
    assert.equal(retentionAction(st({ end: other, now: other - 7 * DAY - 1 })), "none");
    assert.equal(retentionAction(st({ end: other, now: other - 7 * DAY })), "warn");
    assert.equal(retentionAction(st({ end: other, now: other })), "delete");
});

test("an end of 0 is an anomaly, never acted on", () => {
    assert.equal(retentionAction(st({ end: 0, now: 10 ** 13 })), "anomaly");
});

test("warning carries only the dates and the pricing link", () => {
    const { subject, text } = buildRetentionWarning(Date.UTC(2026, 0, 1), "https://velai.app");
    assert.equal(subject, "Your saved résumé will be deleted on January 1, 2026");
    assert.match(text, /ends on January 1, 2026\. A résumé saved on Velai is deleted within an hour after your paid time ends\./);
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

function rig(seed: Record<string, Record<string, unknown>>, over: { email?: string | null; sent?: boolean; recompute?: RetentionDeps["recompute"]; mirror?: ReturnType<typeof memoryFirestore>; emailFor?: RetentionDeps["emailFor"] } = {}) {
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
        recompute: over.recompute ?? (async () => 0),
    };
    return { primary, deps, sentTo };
}
const profile = (extra: Record<string, unknown> = {}) => ({ access_until: END, resume_data: { x: 1 }, name: "keep", ...extra });
const run = (r: ReturnType<typeof rig>, now: number, apply = true) => runResumeRetention({ apply, now, deps: r.deps });

test("a warning stamps only after a successful send; a failed send leaves no stamp and is counted", async () => {
    const bad = rig({ "profiles/u": profile() }, { sent: false });
    const c = await run(bad, END - DAY);
    assert.equal(c.send_failed, 1);
    assert.equal(c.warned, 0);
    assert.equal(bad.primary.docs.get("profiles/u")?.retention_warned_for, undefined);
    const good = rig({ "profiles/u": profile() });
    assert.equal((await run(good, END - DAY)).warned, 1);
    assert.equal(good.primary.docs.get("profiles/u")?.retention_warned_for, END);
    assert.equal(good.primary.docs.get("profiles/u")?.retention_warned_at, END - DAY);
});

test("before end-7d: not even scanned; inside the window: warned once, not again for the same end", async () => {
    const r = rig({ "profiles/u": profile() });
    assert.equal((await run(r, WARN_FROM - 1)).scanned, 0);
    assert.equal((await run(r, WARN_FROM)).warned, 1);
    assert.equal((await run(r, END - 1)).warned, 0);
    assert.equal(r.sentTo.length, 1);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data, "warning never deletes");
});

test("a dry run sends and writes nothing, and never recomputes", async () => {
    let recomputed = 0;
    const r = rig({ "profiles/u": profile() }, { recompute: async () => (recomputed++, 0) });
    assert.equal((await run(r, END - DAY, false)).warned, 1);
    assert.equal((await run(r, END, false)).deleted, 1);
    assert.equal(r.sentTo.length, 0);
    assert.equal(r.primary.writes.length, 0);
    assert.equal(recomputed, 0);
});

test("at end, warned: deletes only the résumé subset", async () => {
    const r = rig({
        "profiles/u": profile({ retention_warned_for: END, retention_warned_at: END - 3 * DAY }),
        "tailored_resumes/t1": { user_id: "u", job: "j" },
        "saved_jobs/s1": { user_id: "u", title: "keep" },
    });
    const c = await run(r, END);
    assert.equal(c.deleted, 1);
    const p = r.primary.docs.get("profiles/u")!;
    assert.equal(p.resume_data, undefined);
    assert.equal(p.name, "keep");
    assert.equal(p.access_until, END);
    assert.equal(r.primary.docs.has("tailored_resumes/t1"), false);
    assert.equal(r.primary.docs.has("saved_jobs/s1"), true);
});

test("at end, never warned or the send failed: still deleted, no email sent", async () => {
    const never = rig({ "profiles/u": profile() });
    assert.equal((await run(never, END + 5 * DAY)).deleted, 1);
    assert.equal(never.sentTo.length, 0);
    assert.equal(never.primary.docs.get("profiles/u")?.resume_data, undefined);
    const failed = rig({ "profiles/u": profile() }, { sent: false });
    assert.equal((await run(failed, END - DAY)).send_failed, 1);
    assert.equal((await run(failed, END)).deleted, 1);
    assert.equal(failed.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("a second account at a different end follows the same rule", async () => {
    const END2 = END + 40 * DAY;
    const r = rig({ "profiles/a": profile(), "profiles/b": profile({ access_until: END2 }) });
    await run(r, END);
    assert.equal(r.primary.docs.get("profiles/a")?.resume_data, undefined);
    assert.ok(r.primary.docs.get("profiles/b")?.resume_data, "b is not near its end");
    await run(r, END2 - DAY);
    assert.equal(r.primary.docs.get("profiles/b")?.retention_warned_for, END2);
    await run(r, END2);
    assert.equal(r.primary.docs.get("profiles/b")?.resume_data, undefined);
});

test("at end, but Stripe already holds a renewal: recompute moves access_until, nothing is deleted", async () => {
    const r = rig({ "profiles/u": profile() }, {});
    r.deps.recompute = async (uid) => {
        await r.primary.db.doc(`profiles/${uid}`).update({ access_until: END + 30 * DAY });
        return END + 30 * DAY;
    };
    const c = await run(r, END);
    assert.equal(c.deleted, 0);
    assert.equal(c.errors, 0);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
});

test("recompute throws: nothing deleted, counted as an error", async () => {
    const r = rig({ "profiles/u": profile() }, { recompute: async () => { throw new Error("stripe down"); } });
    const c = await run(r, END);
    assert.equal(c.errors, 1);
    assert.equal(c.deleted, 0);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
});

test("copies-only (base résumé already gone) are still found and deleted; the mirror store is cleaned too", async () => {
    const mirror = memoryFirestore({ "profiles/u": { resume_data: { m: 1 } } });
    const r = rig(
        { "profiles/u": profile({ resume_data: undefined }), "tailored_resumes/t1": { user_id: "u" } },
        { mirror },
    );
    const c = await run(r, END);
    assert.equal(c.deleted, 1);
    assert.equal(r.primary.docs.has("tailored_resumes/t1"), false);
    assert.equal(mirror.docs.get("profiles/u")?.resume_data, undefined);
});

test("an account that never had access gets a first-seen stamp (its end), then is deleted on the next run", async () => {
    const r = rig({ "profiles/u": { resume_data: { x: 1 } } });
    const c1 = await run(r, END);
    assert.equal(c1.no_access_period, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.retention_first_seen_at, END);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
    assert.equal((await run(r, END + 3_600_000)).deleted, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("an account with no résumé data anywhere is not scanned; a paid account is untouched", async () => {
    const r = rig({ "profiles/none": { access_until: END }, "profiles/paid": profile({ access_until: END + 500 * DAY }) });
    const c = await run(r, END);
    assert.equal(c.scanned, 0);
    assert.equal(r.sentTo.length, 0);
});

test("no address in the warn window is counted and nothing is sent; at end it is deleted regardless", async () => {
    const r = rig({ "profiles/u": profile() }, { email: null });
    const w = await run(r, END - DAY);
    assert.equal(w.no_email, 1);
    assert.equal(w.warned, 0);
    assert.equal((await run(r, END)).deleted, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("batches deletes in groups of at most 500", async () => {
    const seed: Record<string, Record<string, unknown>> = { "profiles/u": profile() };
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
    assert.equal((await run(r, END)).deleted, 1);
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

test("(a) a lookup error at end does not hold up the deletion (the address is only for the warning)", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ user: outage }) });
    const c = await run(r, END);
    assert.equal(c.errors, 0);
    assert.equal(c.deleted, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.resume_data, undefined);
});

test("(b) a lookup error in the warn window leaves no warn stamp", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ byExternalId: outage }) });
    const c = await run(r, END - DAY);
    assert.equal(c.errors, 1);
    assert.equal(r.primary.docs.get("profiles/u")?.retention_warned_for, undefined);
});

test("(c) WorkOS not-found in the warn window is positively no address: counted, not an error", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ byExternalId: notFound, user: notFound }) });
    const c = await run(r, END - DAY);
    assert.equal(c.no_email, 1);
    assert.equal(c.errors, 0);
    assert.equal(r.sentTo.length, 0);
});

test("(d) a minted address cannot receive mail: counts as no address, not send_failed forever", async () => {
    const r = rig({ "profiles/u": profile() }, { emailFor: workos({ user: async () => ({ email: "someone@intervu.cc" }) }) });
    const c = await run(r, END - DAY);
    assert.equal(c.no_email, 1);
    assert.equal(c.send_failed, 0);
    assert.equal(r.sentTo.length, 0);
});

test("(e) access_until moved to the future after the snapshot: no delete", async () => {
    const r = rig({ "profiles/u": profile() });
    // A purchase lands between the run's snapshot and the delete (here: during the recompute).
    r.deps.recompute = async () => {
        await r.primary.db.doc("profiles/u").update({ access_until: END + 400 * DAY });
        return END + 400 * DAY;
    };
    const c = await run(r, END);
    assert.equal(c.deleted, 0);
    assert.ok(r.primary.docs.get("profiles/u")?.resume_data);
});
