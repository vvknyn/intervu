import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { postingUrlKey } from "../../src/lib/pursuits/same-posting";

describe("postingUrlKey", () => {
    it("treats the same posting URL as one posting, whatever tags, fragment, www or slash it carries", () => {
        const key = postingUrlKey("https://boards.greenhouse.io/acme/jobs/4821");
        for (const url of [
            "https://boards.greenhouse.io/acme/jobs/4821/",
            "https://BOARDS.greenhouse.io/acme/jobs/4821#apply",
            "https://boards.greenhouse.io/acme/jobs/4821?utm_source=linkedin&utm_medium=post",
            "http://www.boards.greenhouse.io/acme/jobs/4821",
        ]) {
            assert.equal(postingUrlKey(url), key, url);
        }
    });

    it("keeps postings apart when only the query names the job", () => {
        assert.notEqual(postingUrlKey("https://ca.indeed.com/viewjob?jk=111"), postingUrlKey("https://ca.indeed.com/viewjob?jk=222"));
        assert.equal(postingUrlKey("https://ca.indeed.com/viewjob?jk=111&from=serp"), postingUrlKey("https://ca.indeed.com/viewjob?from=serp&jk=111"));
        assert.notEqual(postingUrlKey("https://jobs.lever.co/acme/1"), postingUrlKey("https://jobs.lever.co/acme/2"));
    });

    it("has no key for a missing or non-web URL", () => {
        assert.equal(postingUrlKey(""), null);
        assert.equal(postingUrlKey(undefined), null);
        assert.equal(postingUrlKey("not a url"), null);
        assert.equal(postingUrlKey("chrome://extensions"), null);
    });
});
