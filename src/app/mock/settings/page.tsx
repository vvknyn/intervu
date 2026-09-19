"use client";

/**
 * Fixture entry point for /settings.
 *
 * SettingsContainer's own `if (isLoading || !user) return <SettingsLoading />`
 * gate means the real /settings route can never render its tab content
 * signed out, and there is no signed-in session to screenshot here either.
 * Rather than re-implement the tab shell as fixture markup, this pre-seeds
 * `window.__INTERVU_E2E_AUTH__` — the exact hook client-auth.ts's
 * `getCurrentUser`/`onAuthChange` already check for Playwright's e2e suite,
 * disabled whenever NODE_ENV is "production" — so those calls resolve a
 * fixture user instead of asking the server for a session that doesn't
 * exist. The tree below is the unmodified production SettingsContainer:
 * every panel, tab and row is the shipped component, not a re-drawn copy.
 */
if (typeof window !== "undefined") {
    window.__INTERVU_E2E_AUTH__ = {
        uid: "fixture-settings-user",
        email: "fixture.settings@example.com",
        displayName: "Fixture User",
    };
}

import { SettingsContainer } from "@/components/settings/SettingsContainer";

export default function SettingsMockPage() {
    return <SettingsContainer />;
}
