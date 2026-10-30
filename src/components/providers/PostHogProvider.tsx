"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useRef } from "react";
import { onAuthChange } from "@/lib/firebase/client-auth";
import {
  POSTHOG_PRODUCT,
  posthogApiHost,
  POSTHOG_OPTIONS,
} from "@/lib/posthog-options";
import { captureEvent, flushHeldEvents } from "@/lib/analytics/events";
import { setPostHogClient } from "@/lib/analytics/posthog-client";
import { consumeSignupSignalFromDocumentCookie } from "@/lib/auth/authkit-signup-signal";
import { clearGateAttempt, gateAttemptEventFields, readGateAttempt } from "@/lib/auth/gate-attempt";

// Velai shares one PostHog project with Subspace; the `product` super property
// (see POSTHOG_PRODUCT) is what tells their events apart, and the project's
// remote settings reach Velai too, which is why POSTHOG_OPTIONS pins every
// capture lane off.
// Until NEXT_PUBLIC_POSTHOG_KEY is set, this provider no-ops completely (no
// init call, no network, renders children unwrapped).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// Read, not defaulted. The default lives in posthogApiHost() and is the
// same-origin proxy; this var only exists to override it deliberately. It used
// to default to "https://us.i.posthog.com" here, which meant a dropped env var
// silently reinstated the ad-blocked host and lost analytics with no signal.
const POSTHOG_HOST_OVERRIDE = process.env.NEXT_PUBLIC_POSTHOG_HOST;

// intervu has no cookie-consent banner (deliberate — see privacy policy), so
// persistence is always 'sessionStorage' (cookieless; see posthog-options.ts). If a consent banner ever ships, port
// subspace's consent-aware upgrade path (PostHogProvider.tsx in interview-os)
// — the localStorage-backed 'cookie-consent-accepted' read + the
// cookie-consent-accepted/declined listeners that flip persistence to
// 'localStorage+cookie' — instead of re-deriving it here.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // A ref, not state: nothing in render depends on this, and a ref survives
  // StrictMode's dev remount so init() still runs exactly once.
  const started = useRef(false);

  useEffect(() => {
    if (!POSTHOG_KEY || typeof window === "undefined") return;

    if (!started.current) {
      started.current = true;
      void (async () => {
        // The replay recorder comes with the app, not from PostHog's CDN:
        // POSTHOG_OPTIONS blocks every lazily-fetched PostHog bundle
        // (disable_external_dependency_loading), and posthog-js skips its own
        // download when the recorder is already on the page. It must be there
        // BEFORE init: the project's replay setting arrives with init's first
        // config request, and a recorder that is late is never retried.
        // A chunk that fails to load costs the recordings, not the events.
        await import("posthog-js/dist/posthog-recorder").catch(() => undefined);
        posthog.init(POSTHOG_KEY, {
          api_host: posthogApiHost(window.location.origin, POSTHOG_HOST_OVERRIDE),
          ...POSTHOG_OPTIONS,
        });
        posthog.register({ product: POSTHOG_PRODUCT });
        // events.ts and the other callers reach PostHog only through this.
        setPostHogClient(posthog);
        // What the page fired as it mounted, before this loaded (events.ts `captureRoute`).
        flushHeldEvents();
      })();
    }

    // Analytics never learn who is signed in: there is no identify() or
    // reset(). The uid is read here only to notice the moment a visitor
    // becomes signed in, so the one-time signup event fires once.
    let signedInUid: string | null = null;
    return onAuthChange((user) => {
      const uid = user?.uid ?? null;
      if (uid && uid !== signedInUid) {
        const method = consumeSignupSignalFromDocumentCookie();
        const attempt = readGateAttempt(window.sessionStorage);
        if (method) {
          captureEvent("signup_completed", { method, ...gateAttemptEventFields(attempt) }); // signup-once: cookie exists only after the callback won claimSignupEvent
        }
        // Login and signup both end the gate attempt. Clear after capture so a
        // later unrelated account entry cannot inherit fit/save/tailor/resume.
        if (method || attempt) clearGateAttempt(window.sessionStorage);
      }
      signedInUid = uid;
    });
  }, []);

  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
