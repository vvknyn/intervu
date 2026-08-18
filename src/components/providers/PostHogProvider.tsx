"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useRef } from "react";
import { onAuthChange } from "@/lib/firebase/client-auth";
import { POSTHOG_OPTIONS, POSTHOG_PRODUCT } from "@/lib/posthog-options";
import { identityAction } from "@/lib/posthog-identity";

// intervu reuses subspace's PostHog project/key — no separate project, no
// dashboard step. In-project demarcation is the `product` super property
// (see POSTHOG_PRODUCT) + PostHog's automatic $host, not a different key.
// Until NEXT_PUBLIC_POSTHOG_KEY is set, this provider no-ops completely (no
// init call, no network, renders children unwrapped).
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// intervu has no cookie-consent banner (deliberate — see privacy policy), so
// persistence is always 'memory'. If a consent banner ever ships, port
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
      posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, ...POSTHOG_OPTIONS });
      posthog.register({ product: POSTHOG_PRODUCT });
      started.current = true;
    }

    // Tie events to the account once someone is signed in.
    //
    // /privacy already promises this ("Events aren't tied to your identity
    // unless you're signed in"), but nothing ever called identify(), and with
    // person_profiles: 'identified_only' that meant the project held *zero*
    // person profiles — no signed-in behaviour could be attributed to an
    // account, and guest -> signup was unmeasurable.
    //
    // onAuthChange is the app's single auth chokepoint, so this is the one
    // place analytics identity is decided; no callsite knows about PostHog.
    let identified: string | null = null;
    return onAuthChange((user) => {
      const uid = user?.uid ?? null;
      const action = identityAction(identified, uid);
      if (action === "identify" && uid) posthog.identify(uid);
      if (action === "reset") posthog.reset();
      identified = uid;
    });
  }, []);

  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
