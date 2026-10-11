import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS = join(__dirname, "../../src/components/settings/SettingsContainer.tsx");

describe("settings copy", () => {
    it("résumé tab label uses accent spelling", () => {
        const src = readFileSync(SETTINGS, "utf8");
        assert.match(src, /<TabsTrigger value="resume">Résumé<\/TabsTrigger>/);
        assert.doesNotMatch(src, /<TabsTrigger value="resume">Resume<\/TabsTrigger>/);
    });

    it("has no on-device AI card: the on-device models are gone (2026-10-11)", () => {
        const settings = readFileSync(SETTINGS, "utf8");
        assert.doesNotMatch(settings, /On-device AI|LocalAiSettingsSection/i);
    });
});
