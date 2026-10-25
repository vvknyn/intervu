import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

/**
 * A client component that awaits a server action bare is one 502 away from a
 * control pending forever (Oct 25: saved-search ✕ spinner, "Loading your
 * résumé"): Next rejects on the client when the response is not a valid
 * action response, so checking `res.error` is not enough. Route the call
 * through `settleAction` (lib/load-result.ts) — it turns a throw or a hang
 * into the `{ error }` the action already returns.
 *
 * RATCHET: the sites below still await bare (most sit inside their own
 * try/catch or `.catch`, so they are handled but get no wait ceiling). The
 * counts may only go DOWN; a new bare await fails. Lower a count when you
 * convert a site, and delete the entry at 0.
 */
const BARE_AWAIT = /\bawait\s+(?!settle)\w+Action\(/g;

const REMAINING: Record<string, number> = {
    "src/app/jobs/JobsContent.tsx": 4,
    "src/components/companies/FollowButton.tsx": 4,
    "src/components/company/CompanyRoleSearch.tsx": 1,
    "src/components/jobs/BoardVisitBanner.tsx": 1,
    "src/components/jobs/PublicJobDetail.tsx": 2,
    "src/components/jobs/front-door/FrontDoorReturnCard.tsx": 1,
    "src/components/onboarding/SetupSteps.tsx": 3,
    "src/hooks/use-agent-preferences.ts": 2,
    "src/hooks/use-onboarding.ts": 1,
    "src/lib/follows/use-company-email-verified.ts": 1,
    "src/lib/follows/use-follows.ts": 1,
    "src/lib/jobs/use-saved-searches.ts": 2,
    "src/lib/pursuits/applied-resume-client.ts": 2,
    "src/lib/pursuits/use-pursuits.ts": 1,
};

function bareAwaitCounts(): Record<string, number> {
    const root = path.resolve(__dirname, "../..");
    const counts: Record<string, number> = {};
    for (const file of walkTsxFiles(path.join(root, "src"))) {
        const src = readFileSync(file, "utf8");
        if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src)) continue;
        const n = (src.match(BARE_AWAIT) ?? []).length;
        if (n) counts[path.relative(root, file)] = n;
    }
    return counts;
}

test("no client module awaits a server action bare beyond the ratcheted remainder", () => {
    const actual = bareAwaitCounts();
    const over = Object.entries(actual).filter(([f, n]) => n > (REMAINING[f] ?? 0)).map(([f, n]) => `${f}: ${n} > ${REMAINING[f] ?? 0}`);
    assert.deepEqual(over, [], "route the call through settleAction (lib/load-result.ts), or convert instead of adding");
    const stale = Object.entries(REMAINING).filter(([f, n]) => (actual[f] ?? 0) < n).map(([f]) => f);
    assert.deepEqual(stale, [], "lower the ratchet count for converted sites (delete the entry at 0)");
});

test("detector: sees a bare await, ignores a settled one", () => {
    assert.equal("const r = await fooAction(1);".match(BARE_AWAIT)?.length, 1);
    assert.equal("const r = await settleAction(fooAction(1));".match(BARE_AWAIT), null);
});
