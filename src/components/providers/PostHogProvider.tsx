"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect, useState } from "react";

// intervu reuses subspace's PostHog project/key — no separate project, no
// dashboard step. In-project demarcation is the `product` super property
// below (+ PostHog's automatic $host), not a different key. This deploy
// carries subspace's existing env values; until NEXT_PUBLIC_POSTHOG_KEY is
// set, this provider no-ops completely (no init call, no network, renders
// children unwrapped) — same guard as if it had its own key.
const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

// Stamped on every event via posthog.register() right after init — this,
// plus the automatic $host, is how intervu's events are told apart from
// subspace's inside the one shared PostHog project.
const POSTHOG_PRODUCT = "intervu";

// intervu has no cookie-consent banner (deliberate — see privacy policy).
// Persistence is always 'memory': cookieless, per-tab, gone on refresh.
// person_profiles 'identified_only' keeps guests unprofiled regardless.
// If a consent banner ever ships, port subspace's consent-aware upgrade
// path (PostHogProvider.tsx in interview-os) — the localStorage-backed
// 'cookie-consent-accepted' read + cookie-consent-accepted/declined
// listeners that flip persistence to 'localStorage+cookie' — instead of
// re-deriving it here.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!POSTHOG_KEY || typeof window === "undefined") return;
    if (initialized) return;

    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      autocapture: true,
      persistence: "memory",
    });
    posthog.register({ product: POSTHOG_PRODUCT });

    setInitialized(true);
  }, [initialized]);

  if (!POSTHOG_KEY) {
    return <>{children}</>;
  }

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
