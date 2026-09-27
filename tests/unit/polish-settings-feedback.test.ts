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

describe("Phase 2 batch — settings feedback + account deletion", () => {
    it("SettingsLoading exposes a labeled status region", () => {
        const src = readFileSync(LOADING, "utf8");
        assert.match(src, /aria-labelledby=\{SETTINGS_LOADING_LABEL_ID\}/);
        assert.match(src, /Loading account…/);
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

    it("delete confirm uses destructive token and keeps errors in the dialog", () => {
        const src = readFileSync(SETTINGS, "utf8");
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
