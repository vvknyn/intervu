import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEVICE_RESUME_KEY, parseSiteResume, resumeInUse, sameDeviceResume, SITE_RESUME_KEY, type DeviceResume } from "../../extension/src/device-resume";
import { resumeFromMe, type MeResponse } from "../../extension/src/report";
import { LOCAL_AI_RESUME_KEY } from "../../src/lib/local-ai/resume-storage";

const TEXT = readFileSync(path.join(__dirname, "../../extension/scripts/fixtures/resume.txt"), "utf8");
const data = resumeFromMe({ signedIn: true, resume: { data: null, text: TEXT, updatedAt: null } });
const device: DeviceResume = { data: data!, updatedAt: "2026-10-20T10:00:00.000Z" };
const accountMe: MeResponse = { signedIn: true, paid: true, resume: { data: null, text: TEXT, updatedAt: "2026-10-07T15:00:00Z" }, preferences: null };

describe("the résumé velai.app keeps in this browser", () => {
    it("reads velai.app's own key", () => {
        assert.equal(SITE_RESUME_KEY, LOCAL_AI_RESUME_KEY);
        assert.notEqual(DEVICE_RESUME_KEY, SITE_RESUME_KEY);
    });

    it("parses what velai.app stores, and nothing else", () => {
        assert.ok(data, "fixture résumé reads");
        const stored = JSON.stringify({ data, updatedAt: device.updatedAt, sourceLabel: "resume.pdf" });
        assert.deepEqual(parseSiteResume(stored), device, "the label is left behind");
        assert.equal(parseSiteResume(null), null);
        assert.equal(parseSiteResume(""), null);
        assert.equal(parseSiteResume("not json"), null);
        assert.equal(parseSiteResume(JSON.stringify({ data })), null, "no date");
        assert.equal(parseSiteResume(JSON.stringify({ updatedAt: device.updatedAt })), null, "no résumé");
        assert.equal(parseSiteResume(JSON.stringify({ data: "text", updatedAt: device.updatedAt })), null, "not structured");
    });

    it("tells a changed copy from the same one", () => {
        assert.equal(sameDeviceResume(device, { ...device }), true);
        // Chrome's storage gives the copy back with its keys sorted: still the same résumé.
        const sorted = (v: unknown): unknown =>
            Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sorted(x)])) : v;
        const fromStorage = { updatedAt: device.updatedAt, data: sorted(device.data) as DeviceResume["data"] };
        assert.notEqual(JSON.stringify(fromStorage.data), JSON.stringify(device.data), "the fixture's keys aren't already sorted");
        assert.equal(sameDeviceResume(fromStorage, device), true);
        assert.equal(sameDeviceResume(device, { ...device, updatedAt: "2026-10-21T10:00:00.000Z" }), false);
        assert.equal(sameDeviceResume(device, { ...device, data: { ...device.data, generatedSummary: "Changed." } }), false);
        assert.equal(sameDeviceResume(null, null), true);
        assert.equal(sameDeviceResume(device, null), false);
        assert.equal(sameDeviceResume(null, device), false);
    });
});

describe("the résumé in use", () => {
    it("is the account's when the account gives one (a paid month)", () => {
        const inUse = resumeInUse(accountMe, device);
        assert.equal(inUse?.from, "account");
        assert.equal(inUse?.updatedAt, "2026-10-07T15:00:00Z");
    });

    it("is this browser's without a paid month, signed out, or when velai.app didn't answer", () => {
        const unpaid: MeResponse = { signedIn: true, paid: false, resume: null, preferences: null };
        for (const me of [unpaid, { signedIn: false }, null] as (MeResponse | null)[]) {
            const inUse = resumeInUse(me, device);
            assert.equal(inUse?.from, "browser", JSON.stringify(me));
            assert.equal(inUse?.updatedAt, device.updatedAt);
            assert.ok(inUse?.resume.experience?.length, "the structured résumé");
        }
    });

    it("is none when neither has a usable résumé", () => {
        assert.equal(resumeInUse({ signedIn: false }, null), null);
        assert.equal(resumeInUse(null, null), null);
        assert.equal(resumeInUse({ signedIn: true, paid: true, resume: { data: null, text: null, updatedAt: null } }, null), null);
        assert.equal(resumeInUse({ signedIn: false }, { data: { profile: {} } as DeviceResume["data"], updatedAt: device.updatedAt }), null, "an empty résumé doesn't count");
    });
});
