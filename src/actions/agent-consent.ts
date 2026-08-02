"use server";

import { redirect } from "next/navigation";
import { firestoreStore } from "@/lib/agent/store";
import { createAuthCode } from "@/lib/agent/oauth";
import { validateConsentRequest, type ConsentParamsInput } from "@/lib/agent/consent";
import { getServerUser } from "@/lib/firebase/auth-session";

function readConsentParams(formData: FormData): ConsentParamsInput {
    const get = (key: string): string | undefined => {
        const value = formData.get(key);
        return typeof value === "string" && value.length > 0 ? value : undefined;
    };
    return {
        client_id: get("client_id"),
        redirect_uri: get("redirect_uri"),
        code_challenge: get("code_challenge"),
        code_challenge_method: get("code_challenge_method"),
        response_type: get("response_type"),
        state: get("state"),
    };
}

/** Send the user back to the client with an OAuth error — only ever called once redirect_uri is validated. */
function errorRedirect(redirectUri: string, state: string | undefined, error: string): never {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (state) url.searchParams.set("state", state);
    redirect(url.toString());
}

/**
 * Allow button. The rendered page already validated this request once, but
 * that was a render — these form fields are attacker-controllable, so every
 * check (client exists, redirect_uri registered to it, PKCE shape, login)
 * runs again here before anything is issued or any redirect happens.
 */
export async function approveConsentAction(formData: FormData): Promise<void> {
    const store = firestoreStore();
    const validation = await validateConsentRequest(store, readConsentParams(formData));
    if (!validation.ok) {
        // redirect_uri isn't provably registered to this client_id — there is
        // no validated URI to send the user to, so we don't redirect at all.
        throw new Error(`[agent-consent] approve rejected: ${validation.error}`);
    }

    const user = await getServerUser();
    if (!user) {
        errorRedirect(validation.params.redirect_uri, validation.params.state, "access_denied");
    }

    const code = await createAuthCode(store, {
        uid: user.uid,
        clientId: validation.client.id,
        redirectUri: validation.params.redirect_uri,
        codeChallenge: validation.params.code_challenge,
    });

    const url = new URL(validation.params.redirect_uri);
    url.searchParams.set("code", code);
    if (validation.params.state) url.searchParams.set("state", validation.params.state);
    redirect(url.toString());
}

/** Deny button — same re-validation, then bounce back with the standard RFC 6749 denial. */
export async function denyConsentAction(formData: FormData): Promise<void> {
    const store = firestoreStore();
    const validation = await validateConsentRequest(store, readConsentParams(formData));
    if (!validation.ok) {
        throw new Error(`[agent-consent] deny rejected: ${validation.error}`);
    }

    errorRedirect(validation.params.redirect_uri, validation.params.state, "access_denied");
}
