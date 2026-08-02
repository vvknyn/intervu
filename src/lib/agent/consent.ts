/**
 * Consent-request validation for the OAuth authorize page + its server
 * actions. One ladder, used by both: the page runs it to decide whether to
 * render the consent card or an error card, and the Allow/Deny server
 * actions re-run it to re-validate attacker-controllable form params before
 * ever calling `redirect()` — a page-render pass is not a security check.
 */
import type { AgentStore } from "./store";
import { getClient, type OAuthClient } from "./oauth";

export interface ConsentParams {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    response_type: string;
    state?: string;
}

export type ConsentParamsInput = Partial<Record<keyof ConsentParams, string>>;

export type ConsentValidation =
    | { ok: true; params: ConsentParams; client: OAuthClient }
    | { ok: false; error: string };

/** Pure shape/value checks — no store access, so no mocks needed to test it. */
export function validateConsentShape(
    raw: ConsentParamsInput
): { ok: true; params: ConsentParams } | { ok: false; error: string } {
    const { client_id, redirect_uri, code_challenge, code_challenge_method, response_type, state } = raw;
    if (!client_id) return { ok: false, error: "missing client_id" };
    if (!redirect_uri) return { ok: false, error: "missing redirect_uri" };
    if (!code_challenge) return { ok: false, error: "missing code_challenge" };
    if (response_type !== "code") return { ok: false, error: "response_type must be 'code'" };
    if (code_challenge_method !== "S256") return { ok: false, error: "code_challenge_method must be 'S256'" };
    return { ok: true, params: { client_id, redirect_uri, code_challenge, code_challenge_method, response_type, state } };
}

/** Full validation: shape, then that the client exists and redirect_uri is one of ITS registered URIs. */
export async function validateConsentRequest(
    store: AgentStore,
    raw: ConsentParamsInput
): Promise<ConsentValidation> {
    const shape = validateConsentShape(raw);
    if (!shape.ok) return shape;

    const client = await getClient(store, shape.params.client_id);
    if (!client) return { ok: false, error: "unknown client_id" };
    if (!client.redirectUris.includes(shape.params.redirect_uri)) {
        return { ok: false, error: "redirect_uri is not registered for this client" };
    }
    return { ok: true, params: shape.params, client };
}
