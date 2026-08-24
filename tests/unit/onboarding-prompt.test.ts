import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    PROMPT_AFTER_INTERACTIONS,
    prefsDestination,
    prefsToFlush,
    readStash,
    shouldPromptOnboarding,
} from "@/lib/jobs/onboarding-prompt";
import { SALARY_PRESETS } from "@/components/jobs/FilterPanel";
import { DEFAULT_URL_STATE, parseJobsUrl, serializeJobsUrl } from "@/lib/jobs/url-state";

const ROOT = path.resolve(__dirname, "../..");

const browsing = {
    interactions: PROMPT_AFTER_INTERACTIONS,
    signedIn: false,
    dismissed: false,
    configured: false,
};

test("offers the wizard to a signed-out visitor once they've searched a few times", () => {
    assert.equal(shouldPromptOnboarding(browsing), true);
});

test("says nothing before the interaction threshold", () => {
    // The failure this prevents is the version everyone hates: a modal on
    // arrival, before the visitor has seen a single result.
    for (let i = 0; i < PROMPT_AFTER_INTERACTIONS; i++) {
        assert.equal(
            shouldPromptOnboarding({ ...browsing, interactions: i }),
            false,
            `prompted after only ${i} interaction(s)`,
        );
    }
});

test("never re-asks someone who closed it", () => {
    assert.equal(shouldPromptOnboarding({ ...browsing, dismissed: true }), false);
    // ...even with far more interactions — the counter must not out-vote a
    // dismissal, or "no" degrades into "not yet".
    assert.equal(
        shouldPromptOnboarding({ ...browsing, dismissed: true, interactions: 500 }),
        false,
    );
});

test("does not ask someone who already has preferences", () => {
    assert.equal(shouldPromptOnboarding({ ...browsing, configured: true }), false);
});

test("is scoped to signed-out visitors, per the owner's call", () => {
    assert.equal(shouldPromptOnboarding({ ...browsing, signedIn: true }), false);
});

test("destination is named, never assumed", () => {
    // saveAgentPreferencesAction writes to profiles/<uid>. Signed out there is
    // no uid, and the action returns {error:"Unauthorized"} rather than
    // throwing — which is precisely how the wizard used to say "we'll save it
    // to your account" and then silently not.
    assert.equal(prefsDestination(true), "account");
    assert.equal(prefsDestination(false), "browser");
});

test("signing in never overwrites preferences the account already has", () => {
    const stash = { query: "nurse", location: "Toronto", remoteOnly: false, salaryMin: 0 };
    // The case that matters: configured on another device, then a logged-out
    // session in THIS browser typed something else. Flushing would be data loss.
    assert.equal(prefsToFlush({ signedIn: true, stash, accountConfigured: true }), null);
    assert.deepEqual(prefsToFlush({ signedIn: true, stash, accountConfigured: false }), stash);
    assert.equal(prefsToFlush({ signedIn: false, stash, accountConfigured: false }), null);
    assert.equal(prefsToFlush({ signedIn: true, stash: null, accountConfigured: false }), null);
});

test("a malformed or query-less stash reads as absent, not as empty preferences", () => {
    assert.equal(readStash(null), null);
    assert.equal(readStash(""), null);
    assert.equal(readStash("not json"), null);
    assert.equal(readStash("null"), null);
    assert.equal(readStash('"a string"'), null);
    assert.equal(readStash("[1,2,3]"), null);
    assert.equal(readStash('{"location":"Toronto"}'), null, "no query — nothing to search");
    assert.equal(readStash('{"query":"   "}'), null, "whitespace query is not a query");
});

test("a good stash round-trips, coercing junk fields to safe values", () => {
    assert.deepEqual(
        readStash('{"query":"  nurse  ","location":" Toronto ","remoteOnly":"yes","salaryMin":-5}'),
        // remoteOnly is strict-true only (the string "yes" is not a yes), and a
        // negative salary floor would silently filter out every result.
        { query: "nurse", location: "Toronto", remoteOnly: false, salaryMin: 0 },
    );
    assert.deepEqual(readStash('{"query":"nurse","remoteOnly":true,"salaryMin":120000}'), {
        query: "nurse",
        location: "",
        remoteOnly: true,
        salaryMin: 120000,
    });
});

test("the wizard reports where it actually saved, instead of promising an account", () => {
    // Ratchet on the real defect: `persistAndComplete` awaited
    // saveAgentPreferencesAction and DISCARDED its result, so an Unauthorized
    // reply looked identical to a successful save.
    const src = readFileSync(path.join(ROOT, "src/components/jobs/SearchPrefsSetup.tsx"), "utf8");
    assert.match(
        src,
        /const\s+\w+\s*=\s*await saveAgentPreferencesAction/,
        "the save result must be captured, not discarded",
    );
    assert.match(
        src,
        /if\s*\(\s*\w+\.error\s*\)\s*destination = "browser"/,
        "an errored save must downgrade the reported destination, not be ignored",
    );
    // The copy half of the same lie. Pinning it to the CONDITIONAL rather than
    // to the absence of a phrase matters: the account promise is correct when
    // there IS an account, so a test that just banned the words would push the
    // next author into deleting true copy instead of branching it.
    assert.match(
        src,
        /signedIn\s*\n?\s*\?\s*"[^"]*your account/,
        "the account promise must be the signed-in branch of a conditional",
    );
});

test("every salary the wizard can produce survives a URL round-trip", () => {
    // The wizard used to take a free-typed number while the URL encodes salary
    // as one of four tiers, so "90000" filtered the results and then vanished
    // on reload — a floor you could see in the chips but not reproduce or
    // share. Asserting the ROUND-TRIP rather than "the wizard uses presets"
    // keeps the two in step from either side: adding an off-ladder preset
    // fails here just as loudly as reintroducing a free-form input would.
    for (const preset of SALARY_PRESETS) {
        const url = serializeJobsUrl({ ...DEFAULT_URL_STATE, salaryMin: preset.value });
        const back = parseJobsUrl(new URLSearchParams(url));
        assert.equal(
            back.salaryMin,
            preset.value,
            `salary preset ${preset.label} (${preset.value}) is not representable in the URL`,
        );
    }
});

test("the résumé step never opens an importer a signed-out visitor cannot finish", () => {
    // The wizard's "Add résumé" used to call setImportOpen(true) directly,
    // skipping the auth gate every other upload entry point goes through — so
    // signed out it opened a modal with nowhere to store the file. Both now
    // route to the one chokepoint.
    const src = readFileSync(path.join(ROOT, "src/app/jobs/page.tsx"), "utf8");
    assert.match(
        src,
        /const handleSearchPrefsAddResume = \(\) => beginResumeUpload\(\);/,
        "the wizard's résumé step must delegate to beginResumeUpload",
    );
    const start = src.indexOf("const beginResumeUpload = () => {");
    assert.ok(start >= 0, "beginResumeUpload is gone — this guard needs re-pointing");
    assert.match(
        src.slice(start, start + 600),
        /if \(!user\) \{[\s\S]*openAuth\("generic"\);[\s\S]*return;/,
        "the shared chokepoint must keep its signed-out auth gate",
    );
});
