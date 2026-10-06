"use server";

import {
    getAgentPreferences,
    setAgentPreferences,
    type AgentPreferences,
    type AgentPreferencesPatch,
} from "@/lib/agent/preferences";
import { withPlaceCountries } from "@/lib/agent/place-countries";
import { getServerUser } from "@/lib/auth/server-user";

export type { AgentPreferences, AgentPreferencesPatch } from "@/lib/agent/preferences";

// No direct unit test for the two actions below: calling the real
// `getServerUser()` outside a Next.js request scope throws a framework
// error rather than cleanly exercising the "unauthenticated" branch — the
// same repo-wide boundary `agent-access.ts`'s actions sit behind (see
// `tests/unit/agent-access.test.ts`, which tests only its pure halves). The
// merge/shape logic these actions delegate to is already covered directly
// by `tests/unit/agent-preferences.test.ts`.

export async function fetchAgentPreferencesAction(): Promise<{ data?: AgentPreferences; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    return { data: withPlaceCountries(await getAgentPreferences(user.uid)) };
}

export async function saveAgentPreferencesAction(
    patch: AgentPreferencesPatch,
): Promise<{ data?: AgentPreferences; error?: string }> {
    const user = await getServerUser();
    if (!user) return { error: "Unauthorized" };
    return { data: withPlaceCountries(await setAgentPreferences(user.uid, patch)) };
}
