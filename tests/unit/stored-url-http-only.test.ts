import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { httpUrlOrNull, isHttpApplyUrl } from "../../src/lib/jobs/http-url";

const ROOT = join(__dirname, "../..");

describe("stored job/apply URLs render only as http(s)", () => {
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x", "mailto:a@b.c", "", "not a url"]) {
        it(`no link for ${JSON.stringify(bad)}`, () => {
            assert.equal(isHttpApplyUrl(bad), false);
            assert.equal(httpUrlOrNull(bad), null);
        });
    }
    for (const good of ["http://example.com/a", "https://boards.greenhouse.io/acme/jobs/1"]) {
        it(`link for ${good}`, () => assert.equal(httpUrlOrNull(good), good));
    }
    it("null and undefined give no link", () => {
        assert.equal(httpUrlOrNull(null), null);
        assert.equal(httpUrlOrNull(undefined), null);
    });
});

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) return sourceFiles(p);
        return /\.tsx?$/.test(name) ? [p] : [];
    });
}

describe("no unguarded navigation from a stored URL field", () => {
    const STORED = /(job_url|apply_url|applyUrl|jobUrl)/;
    const NAVIGATES = /(href=\{|window\.open\(|location(\.href)?\s*=[^=])/;
    it("every href/window.open/location built from a stored URL goes through the http guard", () => {
        const offenders: string[] = [];
        for (const file of [...sourceFiles(join(ROOT, "src/app")), ...sourceFiles(join(ROOT, "src/components"))]) {
            readFileSync(file, "utf8").split("\n").forEach((line, i) => {
                if (STORED.test(line) && NAVIGATES.test(line) && !/httpUrlOrNull|isHttpApplyUrl|openApplyUrl/.test(line)) {
                    offenders.push(`${file.replace(ROOT + "/", "")}:${i + 1}`);
                }
            });
        }
        assert.deepEqual(offenders, []);
    });
    it("the scan flags an unguarded site (negative control)", () => {
        const line = `<a href={pursuit.job_url} target="_blank">`;
        assert.ok(STORED.test(line) && NAVIGATES.test(line) && !/httpUrlOrNull|isHttpApplyUrl|openApplyUrl/.test(line));
    });
});
