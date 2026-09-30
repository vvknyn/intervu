import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { landingNoticeFor, searchWithoutParam } from "../../src/lib/landing-notice";

const at = (surface: "jobs" | "settings", qs: string) => landingNoticeFor(surface, new URLSearchParams(qs));

describe("landing notice for emailed confirmation links", () => {
    it("says a search alert link worked or failed on /jobs", () => {
        assert.equal(at("jobs", "q=engineer&search_alert=1")?.tone, "success");
        assert.match(at("jobs", "q=engineer&search_alert=1")!.text, /Search alert confirmed/);
        assert.equal(at("jobs", "search_alert=0")?.tone, "error");
        assert.match(at("jobs", "search_alert=0")!.text, /expired or was already used/);
    });

    it("says a follow link worked or failed on /jobs", () => {
        assert.equal(at("jobs", "followed=0")?.tone, "error");
        assert.equal(at("jobs", "followed=1")?.tone, "success");
        assert.equal(at("settings", "followed=1"), null);
    });

    it("says an account email link worked or failed on /settings", () => {
        assert.equal(at("settings", "tab=account&email_confirmed=1")?.tone, "success");
        assert.equal(at("settings", "tab=account&email_confirmed=0")?.tone, "error");
        assert.equal(at("jobs", "email_confirmed=1"), null);
    });

    it("shows nothing without a flag or with a junk value", () => {
        assert.equal(at("jobs", ""), null);
        assert.equal(at("jobs", "search_alert=yes"), null);
    });

    it("strips only its own param from the URL", () => {
        assert.equal(searchWithoutParam("?q=engineer&search_alert=1", "search_alert"), "?q=engineer");
        assert.equal(searchWithoutParam("?followed=0", "followed"), "");
        assert.equal(searchWithoutParam("?tab=account&email_confirmed=1", "email_confirmed"), "?tab=account");
    });

    it("mounts on /jobs and /settings only, never on company pages (they read followed=1 themselves)", () => {
        assert.match(readFileSync("src/app/jobs/JobsContent.tsx", "utf8"), /<LandingNotice surface="jobs" \/>/);
        assert.match(readFileSync("src/components/settings/SettingsContainer.tsx", "utf8"), /<LandingNotice surface="settings" \/>/);
    });

    it("the account email verify route lands on the Account tab", () => {
        const src = readFileSync("src/app/api/account/email/verify/route.ts", "utf8");
        assert.match(src, /"\/settings\?tab=account&email_confirmed=0"/);
        assert.match(src, /"\/settings\?tab=account&email_confirmed=1"/);
    });
});
