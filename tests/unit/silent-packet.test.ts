import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    SILENT_PACKET_FIT_THRESHOLD,
    createSilentPacketPrewarm,
    getOrRunSilentPacketPrewarm,
    hasMeaningfulDiff,
    isSilentPacketDraftReady,
    resetSilentPacketPrewarmInflightForTests,
    resumeFingerprint,
    shouldPrewarmSilentPacket,
    shouldShowReviewPacket,
    shouldSilentPrewarmRun,
    silentPacketCacheKey,
    startPacketDownloadAndApply,
} from "../../src/lib/local-ai/silent-packet";
import { MATCH_CHIP_BRAND_THRESHOLD } from "../../src/lib/match/score";
import { heuristicTailorResume, type TailorDraft } from "../../src/lib/local-ai/tailor-resume";
import type { ResumeData } from "../../src/types/resume";

function fakeScheduler() {
    let captured: (() => void) | null = null;
    return {
        scheduler: {
            schedule(fn: () => void) {
                captured = fn;
                return {};
            },
            cancel() {
                captured = null;
            },
        },
        fire() {
            const fn = captured;
            captured = null;
            fn?.();
        },
        pending: () => captured !== null,
    };
}

function sampleResume(overrides: Partial<{ bullet: string }> = {}): ResumeData {
    return {
        profile: {
            name: "Jane Doe",
            profession: "Product Manager",
            yearsOfExperience: 6,
            location: "Toronto",
            email: "jane@example.com",
            phone: "",
        },
        experience: [
            {
                id: "exp-1",
                company: "Acme Corp",
                role: "Senior Product Manager",
                dates: "2021 - Present",
                description: overrides.bullet ?? "Led product planning for B2B SaaS platform",
            },
        ],
        competencies: [{ category: "Skills", skills: ["Product planning", "Roadmap"] }],
        education: [],
        generatedSummary: "Product manager with 6 years driving product planning.",
    };
}

function noopDraftFromHeuristic(): TailorDraft {
    const draft = heuristicTailorResume(sampleResume(), {
        title: "Product Manager",
        company: "Acme Corp",
        tags: ["roadmap"],
        description: "Own the product roadmap.",
    });
    return {
        ...draft,
        summaryAfter: draft.summaryBefore,
        bullets: draft.bullets.map((b) => ({ ...b, after: b.before })),
    };
}

beforeEach(() => {
    resetSilentPacketPrewarmInflightForTests();
});

describe("silent packet gate", () => {
    it("exports threshold aligned with match chip brand threshold", () => {
        assert.equal(SILENT_PACKET_FIT_THRESHOLD, MATCH_CHIP_BRAND_THRESHOLD);
        assert.equal(SILENT_PACKET_FIT_THRESHOLD, 75);
    });

    it("prewarms only when local AI is on, résumé is usable, and fit >= 75", () => {
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: true, fitTotal: 75 }),
            true,
        );
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: true, fitTotal: 90 }),
            true,
        );
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: true, fitTotal: 74 }),
            false,
        );
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: true, fitTotal: null }),
            false,
        );
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: false, resumeUsable: true, fitTotal: 80 }),
            false,
        );
        assert.equal(
            shouldPrewarmSilentPacket({ localAiEnabled: true, resumeUsable: false, fitTotal: 80 }),
            false,
        );
    });

    it("shouldSilentPrewarmRun requires consent in addition to fit gate", () => {
        assert.equal(
            shouldSilentPrewarmRun({
                consent: true,
                localAiEnabled: true,
                resumeUsable: true,
                fitTotal: 80,
            }),
            true,
        );
        assert.equal(
            shouldSilentPrewarmRun({
                consent: false,
                localAiEnabled: true,
                resumeUsable: true,
                fitTotal: 80,
            }),
            false,
        );
    });
});

describe("silent packet fingerprint and cache key", () => {
    it("is stable for the same résumé identity fields", () => {
        const resume = sampleResume();
        const a = resumeFingerprint(resume);
        const b = resumeFingerprint(sampleResume());
        assert.equal(a, b);
        assert.ok(a.length > 0);
    });

    it("changes when an experience bullet changes", () => {
        const before = resumeFingerprint(sampleResume());
        const after = resumeFingerprint(sampleResume({ bullet: "Owned roadmap and stakeholder alignment" }));
        assert.notEqual(before, after);
    });

    it("builds cache keys from job id and fingerprint", () => {
        const fp = resumeFingerprint(sampleResume());
        assert.equal(silentPacketCacheKey("job-abc", fp), `job-abc:${fp}`);
    });
});

describe("hasMeaningfulDiff", () => {
    it("returns false for identical summary and bullets", () => {
        const draft = noopDraftFromHeuristic();
        assert.equal(hasMeaningfulDiff(draft), false);
    });

    it("returns true when summary changes", () => {
        const draft = noopDraftFromHeuristic();
        draft.summaryAfter = `${draft.summaryBefore} Extra clause.`;
        assert.equal(hasMeaningfulDiff(draft), true);
    });

    it("returns true when one bullet changes", () => {
        const draft = noopDraftFromHeuristic();
        if (draft.bullets.length === 0) {
            draft.bullets.push({
                experienceId: "exp-1",
                company: "Acme",
                role: "PM",
                before: "Before text",
                after: "After text",
            });
        } else {
            draft.bullets[0] = { ...draft.bullets[0], after: "Rewritten bullet." };
        }
        assert.equal(hasMeaningfulDiff(draft), true);
    });

    it("returns false for empty or null drafts", () => {
        assert.equal(hasMeaningfulDiff(null), false);
        assert.equal(hasMeaningfulDiff(undefined), false);
    });
});

describe("silent packet draft readiness", () => {
    it("accepts heuristic drafts with a meaningful diff", () => {
        const draft = heuristicTailorResume(sampleResume(), {
            title: "Product Manager",
            company: "Acme Corp",
            tags: ["roadmap"],
            description: "Own the product roadmap.",
        });
        assert.equal(isSilentPacketDraftReady(draft), true);
    });

    it("rejects heuristic no-op drafts with identical before/after", () => {
        const draft = noopDraftFromHeuristic();
        assert.equal(isSilentPacketDraftReady(draft), false);
    });

    it("rejects empty drafts", () => {
        assert.equal(isSilentPacketDraftReady(null), false);
    });

    it("accepts a bullet-only change even when summary after is empty", () => {
        const draft = noopDraftFromHeuristic();
        draft.summaryAfter = "";
        draft.bullets = [
            {
                experienceId: "exp-1",
                company: "Acme",
                role: "PM",
                before: "Led planning",
                after: "Led product planning for a regulated portfolio",
            },
        ];
        assert.equal(isSilentPacketDraftReady(draft), true);
    });
});

describe("shouldShowReviewPacket", () => {
    it("shows while warming even without a draft", () => {
        assert.equal(shouldShowReviewPacket({ status: "warming", draft: null }), true);
    });

    it("shows when ready with meaningful diff", () => {
        const draft = heuristicTailorResume(sampleResume(), {
            title: "Product Manager",
            tags: ["roadmap"],
            description: "Own the roadmap.",
        });
        assert.equal(shouldShowReviewPacket({ status: "ready", draft }), true);
    });

    it("hides when ready without meaningful diff", () => {
        const draft = noopDraftFromHeuristic();
        assert.equal(shouldShowReviewPacket({ status: "ready", draft }), false);
    });
});

describe("silent packet prewarm scheduler", () => {
    it("does not run before debounce when cancelled", () => {
        const runs: number[] = [];
        const { scheduler, fire } = fakeScheduler();
        const prewarm = createSilentPacketPrewarm(() => runs.push(1), 1200, scheduler);

        prewarm.schedule();
        prewarm.cancel();
        fire();

        assert.deepEqual(runs, []);
    });

    it("runs after debounce when not cancelled", () => {
        const runs: number[] = [];
        const { scheduler, fire } = fakeScheduler();
        const prewarm = createSilentPacketPrewarm(() => runs.push(1), 1200, scheduler);

        prewarm.schedule();
        fire();

        assert.deepEqual(runs, [1]);
    });

    it("ignores in-flight results after cancel", async () => {
        const { scheduler, fire } = fakeScheduler();
        let applied = false;
        const prewarm = createSilentPacketPrewarm(() => {
            const runGeneration = prewarm.captureRunGeneration();
            prewarm.cancel();
            assert.equal(prewarm.shouldApplyRun(runGeneration), false);
            applied = prewarm.shouldApplyRun(runGeneration);
        }, 1200, scheduler);

        prewarm.schedule();
        fire();

        assert.equal(applied, false);
    });
});

describe("startPacketDownloadAndApply", () => {
    it("opens apply URL first, then download, then accept", () => {
        const order: string[] = [];
        const result = startPacketDownloadAndApply({
            applyUrl: "https://example.com/apply",
            openWindow: (url, target, features) => {
                order.push("open");
                assert.equal(url, "https://example.com/apply");
                assert.equal(target, "_blank");
                assert.equal(features, "noopener,noreferrer");
            },
            downloadPdf: () => order.push("download"),
            acceptQuietly: () => order.push("accept"),
        });
        assert.deepEqual(order, ["open", "download", "accept"]);
        assert.equal(result.openedApply, true);
    });

    it("skips open when no apply URL but still download and accept", () => {
        const order: string[] = [];
        const result = startPacketDownloadAndApply({
            applyUrl: null,
            openWindow: () => order.push("open"),
            downloadPdf: () => order.push("download"),
            acceptQuietly: () => order.push("accept"),
        });
        assert.deepEqual(order, ["download", "accept"]);
        assert.equal(result.openedApply, false);
    });

    it("trims whitespace-only apply URLs", () => {
        const order: string[] = [];
        const result = startPacketDownloadAndApply({
            applyUrl: "  ",
            openWindow: () => order.push("open"),
            downloadPdf: () => order.push("download"),
            acceptQuietly: () => order.push("accept"),
        });
        assert.deepEqual(order, ["download", "accept"]);
        assert.equal(result.openedApply, false);
    });
});

describe("silent packet in-flight dedupe", () => {
    it("shares one promise per cache key", async () => {
        let calls = 0;
        const p1 = getOrRunSilentPacketPrewarm("job:fp", async () => {
            calls++;
            return heuristicTailorResume(sampleResume(), { title: "PM", tags: ["roadmap"] });
        });
        const p2 = getOrRunSilentPacketPrewarm("job:fp", async () => {
            calls++;
            return heuristicTailorResume(sampleResume(), { title: "PM", tags: ["roadmap"] });
        });

        await Promise.all([p1, p2]);
        assert.equal(calls, 1);
    });
});
