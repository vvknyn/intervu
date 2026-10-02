"use client";

import { useEffect, useSyncExternalStore } from "react";
import { fetchAgentPreferencesAction, type AgentPreferences } from "@/actions/agent-preferences";

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

interface Read {
    uid: string;
    prefs: AgentPreferences | null;
}

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
    if (current?.uid === uid || loading === uid) return;
    loading = uid;
    let prefs: AgentPreferences | null = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const res = await fetchAgentPreferencesAction().catch(() => null);
        if (res?.data) {
            prefs = res.data;
            break;
        }
        if (attempt < ATTEMPTS - 1) await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    // A newer account (or a Settings save) took over while this read was out.
    if (loading === uid) publish({ uid, prefs });
}

/** What Settings just saved, so the next fit label uses it without a reload. */
export function rememberAgentPreferences(uid: string, prefs: AgentPreferences) {
    publish({ uid, prefs });
}

export function useAgentPreferences(uid: string | null): { prefs: AgentPreferences | null; settled: boolean } {
    const read = useSyncExternalStore(subscribe, () => current, () => null);
    useEffect(() => {
        if (uid) void load(uid);
    }, [uid]);
    if (!uid) return { prefs: null, settled: true };
    return read?.uid === uid ? { prefs: read.prefs, settled: true } : { prefs: null, settled: false };
}
