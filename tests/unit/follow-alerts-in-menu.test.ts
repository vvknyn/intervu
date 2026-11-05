import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flattenAlertRows, followAlertsTitle } from "../../src/lib/follows/use-follow-alerts";
import type { FollowAlertGroup } from "../../src/lib/follows/alerts";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const job = (id: string, posted_ts: number) => ({ id, title: id, posted_ts }) as FollowAlertGroup["jobs"][number];

describe("new roles at followed companies live in the account menu, not a header bell", () => {
    it("jobs page no longer mounts the list banner", () => {
        const src = read("src/app/jobs/page.tsx");
        assert.doesNotMatch(src, /FollowAlertsCard/);
        assert.doesNotMatch(src, /follow-alerts-card/);
    });

    it("the header bar mounts no bell, and the old bell file is gone", () => {
        const src = read("src/components/layout/TopBar.tsx");
        assert.doesNotMatch(src, /FollowAlerts|Bell/);
        assert.throws(() => read("src/components/follows/FollowAlertsBell.tsx"));
    });

    it("the account menu owns the row, the dot on the avatar and the dialog", () => {
        const src = read("src/components/layout/AccountMenu.tsx");
        assert.match(src, /useFollowAlerts\(\)/);
        assert.match(src, /account-menu-follow-alerts/);
        assert.match(src, /topbar-avatar-dot/);
        assert.match(src, /<FollowAlertsDialog/);
        // The row and the dot appear only when there is something to read.
        assert.match(src, /newAtFollowed > 0/);
    });

    it("the dialog keeps the cursor ack, the roles and the manage-follows link (not the elite board)", () => {
        const dialog = read("src/components/follows/FollowAlertsDialog.tsx");
        assert.doesNotMatch(dialog, /board=elite/);
        assert.match(dialog, /MANAGE_FOLLOWS_HREF/);
        assert.match(dialog, /follow-alerts-cta/);
        assert.match(dialog, /follow-alert-row/);
        assert.match(dialog, /acknowledge/);
        const hook = read("src/lib/follows/use-follow-alerts.ts");
        assert.match(hook, /writeFollowAlertCursor/);
        assert.match(hook, /useFollows/);
    });

    it("rows are newest first and the title names the company when there is one", () => {
        const groups: FollowAlertGroup[] = [
            { domain: "acme.com", displayName: "Acme", jobs: [job("old", 1_000), job("new", 3_000)] },
            { domain: "beta.com", displayName: "Beta", jobs: [job("mid", 2_000)] },
        ];
        const rows = flattenAlertRows(groups);
        assert.deepEqual(rows.map((r) => r.job.id), ["new", "mid", "old"]);
        assert.equal(followAlertsTitle(rows, 2), "3 new roles at companies you follow");
        assert.equal(followAlertsTitle(rows.slice(0, 1), 1), "1 new role at Acme");
        assert.equal(followAlertsTitle(rows.filter((r) => r.displayName === "Acme"), 1), "2 new roles at Acme");
    });
});
