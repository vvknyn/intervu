import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    applyWorkOsRedirectUriBridge,
    normalizeWorkOsRedirectUri,
    resolveWorkOsRedirectUriFromEnv,
} from "../../src/lib/auth/workos-redirect-uri-env";

describe("workos redirect uri env", () => {
    it("bridges legacy WORKOS_REDIRECT_URI into NEXT_PUBLIC_WORKOS_REDIRECT_URI", () => {
        const env: Record<string, string | undefined> = {
            WORKOS_REDIRECT_URI: "http://localhost:3002/callback",
        };
        applyWorkOsRedirectUriBridge(env as NodeJS.ProcessEnv);
        assert.equal(env.NEXT_PUBLIC_WORKOS_REDIRECT_URI, "http://localhost:3002/auth/callback");
    });

    it("fixes /callback → /auth/callback on the public var too", () => {
        assert.equal(
            normalizeWorkOsRedirectUri("http://127.0.0.1:3002/callback"),
            "http://127.0.0.1:3002/auth/callback",
        );
    });

    it("leaves a correct /auth/callback URI unchanged", () => {
        const uri = "http://127.0.0.1:3002/auth/callback";
        assert.equal(normalizeWorkOsRedirectUri(uri), uri);
        assert.equal(
            resolveWorkOsRedirectUriFromEnv({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: uri }),
            uri,
        );
    });

    it("prefers NEXT_PUBLIC over legacy when both are set", () => {
        assert.equal(
            resolveWorkOsRedirectUriFromEnv({
                NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://127.0.0.1:3002/auth/callback",
                WORKOS_REDIRECT_URI: "http://localhost:3002/callback",
            }),
            "http://127.0.0.1:3002/auth/callback",
        );
    });
});
