import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walkTsxFiles } = require("../../scripts/design/banned-classes.cjs") as {
    walkTsxFiles: (dir: string) => string[];
};

/**
 * A client component that calls a server action bare is one 502 away from a
 * control pending forever (Oct 25: saved-search ✕ spinner, "Loading your
 * résumé"): Next rejects on the client when the response is not a valid
 * action response, so checking `res.error` is not enough. Route the call
 * through `settleAction` (lib/load-result.ts) — it turns a throw or a hang
 * into the `{ error }` the action already returns.
 *
 * The class is "a call to anything imported from `@/actions/*` that is not
 * the argument of settleAction/settleEnvelope", whatever the spelling:
 * `await fooAction(`, `fooAction(...).then(`, `Promise.all([fooAction(`.
 * A reference passed on (`createServerListCache(listFooAction)`) is not a
 * call here; the cache settles it. A module's own wrapper around a plain
 * fetch (JobsContent's `searchJobsAction` over /api/jobs/search, already
 * under withSettleGuard) is not imported from `@/actions`, so it is not one.
 *
 * RATCHET: the sites below still call bare (most sit inside their own
 * try/catch or `.catch`, so they are handled but get no wait ceiling). The
 * counts may only go DOWN; a new bare call fails. Lower a count when you
 * convert a site, and delete the entry at 0.
 */
const IMPORT_FROM_ACTIONS = /import\s+(?!type\b)\{([^}]*)\}\s*from\s*["']@\/actions\/[^"']+["']/g;

function withoutComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** Local names of the values this module imports from `@/actions/*`. */
export function importedActionNames(src: string): string[] {
    const names: string[] = [];
    for (const m of src.matchAll(IMPORT_FROM_ACTIONS)) {
        for (const part of m[1].split(",")) {
            const t = part.trim();
            if (t && !t.startsWith("type ")) names.push(t.split(/\s+as\s+/).pop()!.trim());
        }
    }
    return names;
}

/** Calls to an imported action that are not the argument of settleAction/settleEnvelope. */
export function unsettledActionCalls(source: string): number {
    const src = withoutComments(source);
    const names = importedActionNames(src);
    if (!names.length) return 0;
    const alt = names.join("|");
    const calls = (src.match(new RegExp(`\\b(?:${alt})\\s*\\(`, "g")) ?? []).length;
    const settled = (src.match(new RegExp(`\\bsettle(?:Action|Envelope)\\(\\s*(?:${alt})\\s*\\(`, "g")) ?? []).length;
    return calls - settled;
}

const REMAINING: Record<string, number> = {
    "src/app/jobs/JobsContent.tsx": 9,
    "src/app/stories/page.tsx": 4,
    "src/app/yours/[id]/page.tsx": 2,
    "src/app/yours/page.tsx": 3,
    "src/components/admin/AdminPanel.tsx": 3,
    "src/components/admin/MetricsDashboard.tsx": 1,
    "src/components/admin/SearchDemand.tsx": 1,
    "src/components/auth/login-form.tsx": 2,
    "src/components/auth/verify-code-step.tsx": 2,
    "src/components/companies/FollowButton.tsx": 7,
    "src/components/company/CompanyRoleSearch.tsx": 2,
    "src/components/daily-picks/DailyPicksSwitch.tsx": 2,
    "src/components/jobs/BoardVisitBanner.tsx": 1,
    "src/components/jobs/JobDetail.tsx": 2,
    "src/components/jobs/JobDetailDocument.tsx": 1,
    "src/components/jobs/PublicJobDetail.tsx": 4,
    "src/components/jobs/SavedSearchesPanel.tsx": 1,
    "src/components/jobs/front-door/FrontDoorReturnCard.tsx": 1,
    "src/components/jobs/front-door/FrontDoorWeekCount.tsx": 1,
    "src/components/marketing/OpenclawWaitlistForm.tsx": 1,
    "src/components/modals/FavoritesModal.tsx": 3,
    "src/components/modals/FeedbackModal.tsx": 1,
    "src/components/onboarding/SetupSteps.tsx": 4,
    "src/components/resume-builder/ResumeEditor.tsx": 1,
    "src/components/settings/EmailPreferencesSection.tsx": 2,
    "src/components/settings/LanguagesSetting.tsx": 1,
    "src/components/settings/SettingsContainer.tsx": 1,
    "src/components/settings/SourcesManager.tsx": 9,
    "src/components/settings/YourResumeSection.tsx": 1,
    "src/hooks/use-adopt-guest-resume.ts": 2,
    "src/hooks/use-agent-preferences.ts": 2,
    "src/hooks/use-onboarding.ts": 2,
    "src/lib/follows/use-company-email-verified.ts": 1,
    "src/lib/follows/use-follows.ts": 1,
    "src/lib/pursuits/applied-resume-client.ts": 2,
    "src/lib/pursuits/use-pursuits.ts": 4,
    "src/lib/resume/use-resume-presence.ts": 1,
    "src/lib/views/use-viewed.ts": 1,
};

function bareCallCounts(): Record<string, number> {
    const root = path.resolve(__dirname, "../..");
    const counts: Record<string, number> = {};
    for (const file of walkTsxFiles(path.join(root, "src"))) {
        const src = readFileSync(file, "utf8");
        if (!/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src)) continue;
        const n = unsettledActionCalls(src);
        if (n) counts[path.relative(root, file)] = n;
    }
    return counts;
}

test("no client module calls a server action bare beyond the ratcheted remainder", () => {
    const actual = bareCallCounts();
    const over = Object.entries(actual).filter(([f, n]) => n > (REMAINING[f] ?? 0)).map(([f, n]) => `${f}: ${n} > ${REMAINING[f] ?? 0}`);
    assert.deepEqual(over, [], "route the call through settleAction (lib/load-result.ts), or convert instead of adding");
    const stale = Object.entries(REMAINING).filter(([f, n]) => (actual[f] ?? 0) < n).map(([f]) => f);
    assert.deepEqual(stale, [], "lower the ratchet count for converted sites (delete the entry at 0)");
});

const IMPORTS = 'import { fooAction, type BarResult, bazAction as baz } from "@/actions/foo";\n';

test("detector: sees every spelling of a bare call, ignores settled ones, references and local wrappers", () => {
    const n = (body: string) => unsettledActionCalls(IMPORTS + body);
    assert.equal(n("const r = await fooAction(1);"), 1, "await");
    assert.equal(n("fooAction(1).then((r) => use(r));"), 1, ".then chain (missed by the old `await xAction(` matcher)");
    assert.equal(n("const [a, b] = await Promise.all([fooAction(1), baz(2)]);"), 2, "Promise.all (missed by the old matcher)");
    assert.equal(n("const r = await settleAction(fooAction(1));"), 0, "settled");
    assert.equal(n("const r = await settleAction(\n  fooAction(1),\n);"), 0, "settled across lines");
    assert.equal(n("const r = await settleEnvelope(fooAction(1));"), 0, "settled envelope");
    assert.equal(n("const a = await settleAction(fooAction(1)); const b = await baz(2);"), 1, "mixed");
    assert.equal(n("const cache = createServerListCache(fooAction);"), 0, "a reference is not a call");
    assert.equal(n("// await fooAction(1)\n/* fooAction(2) */"), 0, "comments");
    assert.equal(unsettledActionCalls("const searchJobsAction = (p) => fetch(p);\nawait searchJobsAction(1);"), 0, "a local wrapper is not imported from @/actions");
});
