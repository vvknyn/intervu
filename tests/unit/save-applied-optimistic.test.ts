import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    buildOptimisticPursuit,
    isOptimisticConfirmedByServer,
    isOptimisticPursuitId,
    pruneConfirmedOptimisticPursuits,
} from "../../src/lib/pursuits/optimistic-pursuit";
import type { Pursuit } from "../../src/lib/pursuits/types";

const PAGE = join(__dirname, "../../src/app/jobs/JobsContent.tsx");

describe("optimistic save / applied ordering", () => {
    it("builds optimistic pursuit before server id exists", () => {
        const p = buildOptimisticPursuit({
            id: "job-1",
            title: "Engineer",
            company: "Acme",
            apply_url: "https://example.com/apply",
        } as import("@/lib/jobs/types").PublicJob);
        assert.ok(isOptimisticPursuitId(p.id));
        assert.equal(p.status, "interested");
    });

    it("keeps overlay until server map confirms stage", () => {
        const optimistic = buildOptimisticPursuit(
            { id: "j1", title: "T", company: "C", apply_url: "u" } as import("@/lib/jobs/types").PublicJob,
        );
        const overlay = new Map([["j1", optimistic]]);
        assert.equal(isOptimisticConfirmedByServer(optimistic, undefined), false);
        const server: Pursuit = { ...optimistic, id: "real-id", user_id: "u1", status: "interested" };
        assert.equal(isOptimisticConfirmedByServer(optimistic, server), true);
        const pruned = pruneConfirmedOptimisticPursuits(overlay, new Map([["j1", server]]));
        assert.equal(pruned.size, 0);
    });

    it("signed-in save defers success toast/haptic until after server OK", () => {
        const src = readFileSync(PAGE, "utf8");
        const saveBlock = src.match(/const handleGoAfter = \(job: PublicJob\) => \{[\s\S]*?^\    \};/m)?.[0] ?? "";
        assert.ok(saveBlock.length > 0);
        const signedInBlock =
            saveBlock.match(/if \(saveInFlightRef\.current\.has\(job\.id\)\)[\s\S]*$/m)?.[0] ?? "";
        assert.ok(signedInBlock.length > 0, "signed-in save path must exist after guest branch");
        assert.match(signedInBlock, /triggerSavePulse\(job\.id\)/);
        assert.match(signedInBlock, /goAfterJobAction\(job\)/);
        assert.match(signedInBlock, /toast\.success\(GUEST_SAVE_TOAST\)/);
        const toastIdx = signedInBlock.indexOf("toast.success(GUEST_SAVE_TOAST)");
        const actionIdx = signedInBlock.indexOf("goAfterJobAction(job)");
        assert.ok(toastIdx > actionIdx, "success toast must follow server action");
        assert.doesNotMatch(
            signedInBlock.slice(0, actionIdx),
            /hapticTap\("success"\)/,
            "no success haptic before server call for signed-in",
        );
    });

    it("applied toast only after successful mark action", () => {
        const src = readFileSync(PAGE, "utf8");
        const block = src.match(/const doMarkApplied = async \(job: ApplyReturnJob\) => \{[\s\S]*?^\    \};/m)?.[0] ?? "";
        assert.match(block, /Applied — nice work/);
        const toastIdx = block.indexOf('toast.success("Applied — nice work")');
        const actionIdx = block.indexOf("markJobAppliedAction");
        assert.ok(toastIdx > actionIdx);
        assert.doesNotMatch(
            block.slice(0, actionIdx),
            /toast\.success\("Applied — nice work"\)/,
        );
    });

    it("does not delete optimistic overlay immediately on invalidate alone", () => {
        const src = readFileSync(PAGE, "utf8");
        assert.match(src, /pruneConfirmedOptimisticPursuits/);
        assert.doesNotMatch(
            src.match(/invalidatePursuitsCache\(\);[\s\S]{0,120}setOptimisticPursuits[\s\S]{0,80}next\.delete/)?.[0] ?? "",
            /next\.delete/,
        );
    });

    it("apply-return contract file remains frozen", () => {
        const applyReturn = readFileSync(
            join(__dirname, "../../src/lib/jobs/apply-return.ts"),
            "utf8",
        );
        assert.match(applyReturn, /APPLY_RETURN_THRESHOLD_MS = 10_000/);
    });
});
