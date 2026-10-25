"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchAgentPreferencesAction, saveAgentPreferencesAction, type AgentPreferences } from "@/actions/agent-preferences";
import { normalizeLanguages } from "@/lib/match/posting-language";
import { agentPreferencesRead, type AgentPreferencesRead, type HeldPreferences } from "@/lib/agent-preferences-read";
import { settleAction } from "@/lib/load-result";

/**
 * The signed-in candidate's saved preferences, for `resolveCandidateSignals(resume, prefs)`.
 * Every surface that shows a fit label reads them through this hook, and they are read once per
 * account per visit and shared, so a saved location, level or remote-only choice counts the same
 * on a role's page as on Today, For you and the search list. Before this, the role's page scored
 * the résumé alone while the lists used the saved preferences.
 *
 * Saving in Settings updates the shared copy (`rememberAgentPreferences`). The place and query
 * /jobs saves as you search do not, as before: they apply from the next visit on, on every
 * surface at once, rather than re-ranking the lists mid-visit.
 */

/** `failed`: the read never answered, so `prefs` is unknown, not "none saved". Not kept, so the next mount reads again. */
type Read = HeldPreferences;

let current: Read | null = null;
let loading: string | null = null;
const listeners = new Set<() => void>();

function publish(read: Read) {
    current = read;
    loading = null;
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Right after sign-in the server cookie can trail the client by a beat ("Unauthorized"), as in Settings. */
const ATTEMPTS = 4;
const RETRY_MS = 400;

async function load(uid: string) {
    if ((current?.uid === uid && !current.failed) || loading === uid) return;
    loading = uid;
    let prefs: AgentPreferences | null = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const res = await settleAction(fetchAgentPreferencesAction());
        if (res.data) {
            prefs = res.data;
            break;
        }
        if (attempt < ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    // A newer account (or a Settings save) took over while this read was out.
    if (loading === uid) publish(prefs ? { uid, prefs } : { uid, prefs, failed: true });
}

/** Read the account's preferences again (a new résumé just rewrote what the old one filled). */
export function reloadAgentPreferences(uid: string): Promise<void> {
    if (current?.uid === uid) current = null;
    loading = null;
    return load(uid);
}

/** `reloadAgentPreferences` for whoever's preferences this visit holds; nothing when none were read yet. */
export function reloadSignedInAgentPreferences(): void {
    if (current?.uid) void reloadAgentPreferences(current.uid);
}

/** What Settings just saved, so the next fit label uses it without a reload. */
export function rememberAgentPreferences(uid: string, prefs: AgentPreferences) {
    publish({ uid, prefs });
}

/**
 * Saves the languages they read postings in (`[]` follows their résumé's language) as the account's saved preference,
 * shown at once and put back if the save fails. Resolves false when it could not be saved, so the caller says so
 * where the person looked.
 */
export async function saveLanguageChoice(uid: string, languages: string[]): Promise<boolean> {
    // Never save over preferences this visit has not read: the write would replace what is stored with a value it never held.
    if (agentPreferencesRead(current, uid).status !== "ready") return false;
    const next = normalizeLanguages(languages);
    const before = current?.uid === uid ? current.prefs : null;
    const base: AgentPreferences = before ?? { configured: true, search: {}, answers: { custom: {} } };
    publish({ uid, prefs: { ...base, configured: true, search: { ...base.search, languages: next } } });
    let saved: Awaited<ReturnType<typeof saveAgentPreferencesAction>> | null = null;
    try {
        saved = await saveAgentPreferencesAction({ search: { languages: next } });
    } catch {
        // A refused or dropped save is reported below, where they changed it.
    }
    if (!saved?.data) {
        publish({ uid, prefs: before });
        return false;
    }
    publish({ uid, prefs: saved.data });
    return true;
}

export function useAgentPreferences(uid: string | null): AgentPreferencesRead {
    const held = useSyncExternalStore(subscribe, () => current, () => null);
    useEffect(() => {
        if (uid) void load(uid);
    }, [uid]);
    return useMemo(() => agentPreferencesRead(held, uid), [held, uid]);
}
