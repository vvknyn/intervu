import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LOCKED_RESUME_NOTE } from "../../src/lib/resume/locked-copy";
import { resumeNeededError } from "../../src/lib/agent/tools";
import { collectDailyPicks } from "../../src/lib/daily-picks/collect";

process.env.NEXT_PUBLIC_SITE_URL = "https://velai.app";

describe("a saved résumé behind the paid month is never reported as missing", () => {
    it("tells the connected AI a résumé is saved and links the pricing page, for any tool", () => {
        for (const tool of ["for_you", "daily_picks", "tailor_resume"]) {
            const text = resumeNeededError({ source: "locked" }, tool, "ranks against");
            assert.ok(text.includes(LOCKED_RESUME_NOTE));
            assert.ok(text.endsWith("https://velai.app/pricing"));
            assert.doesNotMatch(text, /no résumé on file/);
        }
        assert.match(resumeNeededError({ source: "none" }, "for_you", "x"), /no résumé on file/);
    });

    it("the daily run skips a locked account with its own reason, not as none", async () => {
        const deps = { getBaseResume: async () => ({ source: "locked" as const }) } as never;
        assert.deepEqual(await collectDailyPicks("u", deps, { nowMs: 0, sent: {} as never }), { kind: "no-resume", reason: "locked" });
    });
});
