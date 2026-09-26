import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS = join(__dirname, "../../src/components/settings/SettingsContainer.tsx");
const LOCAL_AI = join(__dirname, "../../src/components/settings/LocalAiSettingsSection.tsx");

describe("settings copy", () => {
    it("résumé tab label uses accent spelling", () => {
        const src = readFileSync(SETTINGS, "utf8");
        assert.match(src, /<TabsTrigger value="resume">Résumé<\/TabsTrigger>/);
        assert.doesNotMatch(src, /<TabsTrigger value="resume">Resume<\/TabsTrigger>/);
    });

    it("preferences card headings use sentence case aligned with résumé on-device banner", () => {
        const settings = readFileSync(SETTINGS, "utf8");
        const localAi = readFileSync(LOCAL_AI, "utf8");
        assert.match(settings, /On-device AI &amp; privacy/);
        assert.doesNotMatch(settings, /On-Device AI &amp; Privacy/);
        assert.match(localAi, /On-device AI inference/);
        assert.doesNotMatch(localAi, />On-Device AI inference</);
    });
});
