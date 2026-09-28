import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  jobsBrowseSearchHref,
  jobsForYouHubHref,
} from "../../src/lib/jobs/prefetch-jobs-route";

const ROOT = join(__dirname, "..", "..");

describe("signed-out /packs and /apply redirects", () => {
  it("next.config.ts defines non-permanent redirects to jobs hub entry points", () => {
    const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");

    const blockPacks = config.match(
      /{\s*source:\s*"\/packs"[\s\S]*?permanent:\s*false\s*,?\s*}/,
    );
    const blockApply = config.match(
      /{\s*source:\s*"\/apply"[\s\S]*?permanent:\s*false\s*,?\s*}/,
    );
    assert.ok(blockPacks, "missing /packs redirect block with permanent: false");
    assert.ok(blockApply, "missing /apply redirect block with permanent: false");
    assert.doesNotMatch(blockPacks![0], /permanent:\s*true/);
    assert.doesNotMatch(blockApply![0], /permanent:\s*true/);

    assert.match(blockPacks![0], /destination:\s*jobsForYouHubHref\(\)/);
    assert.match(blockApply![0], /destination:\s*jobsBrowseSearchHref\(""\)/);

    assert.equal(jobsForYouHubHref(), "/jobs?view=for-you");
    assert.equal(jobsBrowseSearchHref(""), "/jobs?view=search");
  });
});
