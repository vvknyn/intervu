/**
 * The PostHog instance, once `PostHogProvider` has loaded and initialized it.
 *
 * Nothing a page loads up front imports posthog-js: `captureEvent`
 * (events.ts) and the other client callers read the instance from here, and
 * `PostHogProvider`, which `DeferredPostHogProvider` loads after the page,
 * registers it right after `posthog.init`. A static `import posthog from
 * "posthog-js"` in events.ts used to put the whole library (~240 KB of JS,
 * ~77 KB gzipped) in every page's first-load bundle, parsed ahead of
 * hydration, although nothing could be sent before init anyway.
 *
 * Type-only import below: it never pulls posthog-js into a bundle.
 */
import type { PostHog } from "posthog-js";

export type PostHogClient = Pick<PostHog, "capture" | "__loaded">;

let client: PostHogClient | null = null;

export function setPostHogClient(next: PostHogClient | null): void {
  client = next;
}

export function getPostHogClient(): PostHogClient | null {
  return client;
}

/** PostHog is initialized and takes events. */
export function isPostHogLoaded(): boolean {
  return client?.__loaded === true;
}
