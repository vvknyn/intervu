import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { saveJobFromExtension, SNAPSHOT_DESCRIPTION_MAX, type SaveFromExtensionDeps } from "../../src/lib/pursuits/save-from-extension";
import { buildJobSnapshot, type JobSnapshot, type PursuitStage } from "../../src/lib/pursuits/types";
import type { PublicJob } from "../../src/lib/jobs/types";

const JOB = {
    id: "job-1",
    title: "Registered Nurse - ICU",
    company: "Cedarbrook Health",
    location: "Toronto, ON, Canada",
    description: "Join our ICU.",
    apply_url: "https://careers.cedarbrook.example/jobs/rn-icu",
} as PublicJob;

/** Stub deps that record what the save writes. */
function stub(over: Partial<SaveFromExtensionDeps> = {}) {
    const calls = { upsert: [] as { job: JobSnapshot & { job_id: string }; stage: PursuitStage }[], create: [] as unknown[], findTracked: [] as string[] };
    const deps: SaveFromExtensionDeps = {
        jobById: async (id) => (id === JOB.id ? JOB : null),
        upsert: async (job, stage) => {
            calls.upsert.push({ job, stage });
            return { data: { id: "p1", status: stage } };
        },
        findTracked: async (url) => {
            calls.findTracked.push(url);
            return null;
        },
        create: async (row) => {
            calls.create.push(row);
            return { data: { id: "p2" } };
        },
        ...over,
    };
    return { deps, calls };
}

describe("extension Save", () => {
    it("saves a posting Velai has as Saved, with the snapshot the MCP save_job writes", async () => {
        const { deps, calls } = stub();
        const out = await saveJobFromExtension(deps, { company: "Cedarbrook Health", title: "RN ICU", applyUrl: "https://careers.cedarbrook.example/jobs/rn-icu", jobId: "job-1" });
        assert.deepEqual(out, { data: { id: "p1", status: "interested" } });
        assert.equal(calls.upsert.length, 1);
        assert.equal(calls.upsert[0].stage, "interested", "Saved, never Applied");
        assert.deepEqual(calls.upsert[0].job, { job_id: "job-1", ...buildJobSnapshot(JOB) });
        assert.equal(calls.create.length, 0);
    });

    it("reports a role further along as it is: a save never moves a role back", async () => {
        const { deps } = stub({ upsert: async () => ({ data: { id: "p1", status: "interviewing" } }) });
        const out = await saveJobFromExtension(deps, { company: "Cedarbrook Health", title: "RN ICU", applyUrl: "", jobId: "job-1" });
        assert.deepEqual(out, { data: { id: "p1", status: "interviewing" } });
    });

    it("falls back to the page's own words when Velai's copy is gone", async () => {
        const { deps, calls } = stub({ jobById: async () => null });
        await saveJobFromExtension(deps, { company: "Cedarbrook Health", title: "RN ICU", applyUrl: "https://x.example/rn", jobId: "gone" });
        assert.deepEqual(calls.upsert[0].job, {
            job_id: "gone",
            title: "RN ICU",
            company: "Cedarbrook Health",
            location: null,
            description: null,
            apply_url: "https://x.example/rn",
        });
    });

    it("keeps a snapshot description within what the tracker accepts", async () => {
        const long = { ...JOB, description: "x".repeat(SNAPSHOT_DESCRIPTION_MAX + 500) } as PublicJob;
        const { deps, calls } = stub({ jobById: async () => long });
        await saveJobFromExtension(deps, { company: "Cedarbrook Health", title: "RN ICU", applyUrl: "", jobId: "job-1" });
        assert.equal(calls.upsert[0].job.description?.length, SNAPSHOT_DESCRIPTION_MAX);
    });

    it("surfaces what the tracker refuses instead of claiming a save", async () => {
        const { deps } = stub({ upsert: async () => ({ error: "could not save that right now" }) });
        const out = await saveJobFromExtension(deps, { company: "Cedarbrook Health", title: "RN ICU", applyUrl: "", jobId: "job-1" });
        assert.deepEqual(out, { error: "could not save that right now" });
    });

    it("saves a posting Velai doesn't have as a new Saved row", async () => {
        const { deps, calls } = stub();
        const out = await saveJobFromExtension(deps, { company: "Harbourline Health", title: "RN ICU", applyUrl: "https://jobs.lever.co/harbourline/7781" });
        assert.deepEqual(out, { data: { id: "p2", status: "interested" } });
        assert.deepEqual(calls.create, [
            { company_name: "Harbourline Health", position: "RN ICU", job_url: "https://jobs.lever.co/harbourline/7781", status: "interested" },
        ]);
        assert.equal(calls.upsert.length, 0);
    });

    it("finds the row a second save of the same posting made, and says what stage it is at", async () => {
        const { deps, calls } = stub({ findTracked: async () => ({ id: "p9", status: "applied" }) });
        const out = await saveJobFromExtension(deps, { company: "Harbourline Health", title: "RN ICU", applyUrl: "https://jobs.lever.co/harbourline/7781" });
        assert.deepEqual(out, { data: { id: "p9", status: "applied" } });
        assert.equal(calls.create.length, 0, "no second row");
    });

    it("refuses when nobody is signed in rather than saving to nobody", async () => {
        const { deps, calls } = stub({
            findTracked: async () => {
                throw new Error("User not authenticated");
            },
        });
        const out = await saveJobFromExtension(deps, { company: "Harbourline Health", title: "RN ICU", applyUrl: "https://jobs.lever.co/harbourline/7781" });
        assert.deepEqual(out, { error: "User not authenticated" });
        assert.equal(calls.create.length, 0);
    });

    it("saves a posting with no page address as a new row without a link", async () => {
        const { deps, calls } = stub();
        await saveJobFromExtension(deps, { company: "Harbourline Health", title: "RN ICU" });
        assert.deepEqual(calls.create, [{ company_name: "Harbourline Health", position: "RN ICU", status: "interested" }]);
        assert.equal(calls.findTracked.length, 0);
    });
});
