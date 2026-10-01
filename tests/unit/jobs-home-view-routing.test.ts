import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_SRC = readFileSync(join(__dirname, "../../src/app/jobs/JobsContent.tsx"), "utf8");
const FOR_YOU_HOME_SRC = readFileSync(
    join(__dirname, "../../src/components/jobs/for-you/ForYouHome.tsx"),
    "utf8",
);

describe("jobs homeView routing — For you cannot fall through to Search SERP", () => {
    it("page.tsx mounts ForYouHome behind showForYouHome", () => {
        assert.match(PAGE_SRC, /showForYouHome\s*=\s*resolvedHomeView\s*===\s*"for-you"/);
        assert.match(PAGE_SRC, /showForYouHome\s*\?\s*\([\s\S]*<ForYouHome/);
    });

    it("page.tsx mounts ForYouHomePending behind showJobsHomePending", () => {
        assert.match(PAGE_SRC, /showJobsHomePending\s*=\s*resolvedHomeView\s*===\s*"pending"/);
        assert.match(PAGE_SRC, /showJobsHomePending\s*\?\s*\([\s\S]*<ForYouHomePending/);
    });

    it("Search results tree (JobCard list / detail-pane) is gated on showSearchHome", () => {
        const searchBranchStart = PAGE_SRC.indexOf(") : (");
        assert.ok(searchBranchStart > 0, "expected the Search branch after For-you / pending");
        const searchBranch = PAGE_SRC.slice(searchBranchStart);
        assert.match(searchBranch, /searchIntent/);
        assert.match(searchBranch, /JobCard/);
        assert.match(searchBranch, /detail-pane/);
        assert.doesNotMatch(
            PAGE_SRC.slice(0, searchBranchStart),
            /for-you-result-line/,
            "Search result line must not appear in the For-you branch",
        );
        assert.doesNotMatch(
            PAGE_SRC.slice(0, searchBranchStart),
            /<JobCard/,
            "JobCard list must not mount in the For-you branch",
        );
    });

    it("ForYouHome is the stacked role cards — no coach strip or preference chips", () => {
        assert.match(FOR_YOU_HOME_SRC, /<RoleStack/);
        assert.match(FOR_YOU_HOME_SRC, /<StackedRoleCard/);
        assert.doesNotMatch(FOR_YOU_HOME_SRC, /Why this fits/);
        assert.doesNotMatch(FOR_YOU_HOME_SRC, /Getting around/);
        assert.doesNotMatch(FOR_YOU_HOME_SRC, /for-you-result-line/);
        assert.doesNotMatch(FOR_YOU_HOME_SRC, /for-you-preferences/);
    });
});
