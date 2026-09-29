import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SETTINGS = join(ROOT, "src/components/settings/SettingsContainer.tsx");
const LOADING = join(ROOT, "src/components/settings/SettingsLoading.tsx");
const AGENT_ACCESS = join(ROOT, "src/components/settings/AgentAccessSection.tsx");
const AGENT_PREFS = join(ROOT, "src/components/settings/AgentPreferencesSection.tsx");
const INLINE = join(ROOT, "src/components/settings/SettingsInlineError.tsx");
const TOAST = join(ROOT, "src/lib/toast.tsx");
const EMAIL_PREFS = join(ROOT, "src/components/settings/EmailPreferencesSection.tsx");
const RESUME_SECTION = join(ROOT, "src/components/settings/YourResumeSection.tsx");

const SETTINGS_PROSE_FILES = [
    SETTINGS,
    LOADING,
    AGENT_ACCESS,
    AGENT_PREFS,
    EMAIL_PREFS,
    RESUME_SECTION,
    INLINE,
    join(ROOT, "src/components/settings/SettingsSectionLoading.tsx"),
];

describe("Phase 2 batch — settings feedback + account deletion", () => {
    it("SettingsLoading exposes a labeled status region", () => {
        const src = readFileSync(LOADING, "utf8");
        // The labeled role="status" region comes from the one wait primitive.
        assert.match(src, /<WaitState\s+label="Loading account"/);
    });

    it("SettingsInlineError is the shared alert surface", () => {
        const src = readFileSync(INLINE, "utf8");
        assert.match(src, /role="alert"/);
        assert.match(src, /aria-live="assertive"/);
    });

    it("agent load failures do not toast — inline only", () => {
        const access = readFileSync(AGENT_ACCESS, "utf8");
        const prefs = readFileSync(AGENT_PREFS, "utf8");
        assert.doesNotMatch(access, /toast\.error\("Couldn't load your connected agents/);
        const loadPrefs = prefs.slice(prefs.indexOf("const loadPreferences"), prefs.indexOf("const addCustomRow"));
        assert.doesNotMatch(loadPrefs, /toast\.error/);
        assert.match(access, /SettingsInlineError/);
        assert.match(prefs, /SettingsInlineError/);
    });

    it("settings prose uses title-case Velai, not lowercase velai", () => {
        for (const file of SETTINGS_PROSE_FILES) {
            const src = readFileSync(file, "utf8");
            const hits = src
                .split("\n")
                .filter(
                    (line) =>
                        /\bvelai\b/.test(line) &&
                        !line.includes("velai.app") &&
                        !line.includes("velai.onboarding") &&
                        !line.includes("@velai"),
                );
            assert.equal(hits.length, 0, `lowercase velai in ${file}: ${hits.join(" | ")}`);
        }
        assert.match(readFileSync(EMAIL_PREFS, "utf8"), /Which emails Velai sends you/);
    });

    it("delete trigger and confirm use destructive styling", () => {
        const src = readFileSync(SETTINGS, "utf8");
        assert.match(src, /border-danger-text/);
        assert.match(src, /variant="destructive"/);
        assert.match(src, /deleteError/);
        assert.match(src, /onCloseAutoFocus/);
        assert.match(src, /deleteTriggerRef/);
        const deleteHandler = src.slice(src.indexOf("handleDeleteAccount"), src.indexOf("useEffect(() => {", src.indexOf("handleDeleteAccount")));
        assert.doesNotMatch(deleteHandler, /setMessage\(\{ type: "error"/);
    });

    it("toaster clears mobile tab bar safe area", () => {
        const src = readFileSync(TOAST, "utf8");
        assert.match(src, /mobile-tabbar-h/);
        assert.match(src, /safe-area-inset-bottom/);
    });
});
