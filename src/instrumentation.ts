import type { Instrumentation } from "next";
import { logServer, requestErrorLevel, requestErrorRecord } from "@/lib/observability/posthog-logs";

/**
 * Server start. A production server opens one phone search link itself once
 * it listens, so the first visitors after a deploy or a restart get a warm
 * search (lib/server-warm-up.ts). Not awaited: the server listens only after
 * this returns. Dev servers compile on demand and skip it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production") return;
  // Once per process, even if more than one bundle registers.
  const flags = globalThis as { __velaiWarmUpStarted?: boolean };
  if (flags.__velaiWarmUpStarted) return;
  flags.__velaiWarmUpStarted = true;
  const { warmUp } = await import("@/lib/server-warm-up");
  void warmUp({ port: process.env.PORT ?? "3000", hostname: process.env.HOSTNAME })
    .then(({ rows, pages }) => {
      if (!rows) logServer("warn", "warm-up search link had no rows", { "warm_up.pages": pages });
    })
    .catch(() => {});
}

/**
 * The one server-side error chokepoint: Next calls this for every uncaught
 * error in a route handler, server action, server component or proxy. New
 * routes and actions are covered by construction — nothing to register per
 * call site. (An error a handler catches and turns into a 5xx response itself
 * never reaches here.)
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const { body, attrs } = requestErrorRecord(error, request, context);
  logServer(requestErrorLevel(error), body, attrs);
};
