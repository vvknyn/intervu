import type { Instrumentation } from "next";
import { logServer, requestErrorRecord } from "@/lib/observability/posthog-logs";

/**
 * The one server-side error chokepoint: Next calls this for every uncaught
 * error in a route handler, server action, server component or proxy. New
 * routes and actions are covered by construction — nothing to register per
 * call site. (An error a handler catches and turns into a 5xx response itself
 * never reaches here.)
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const { body, attrs } = requestErrorRecord(error, request, context);
  logServer("error", body, attrs);
};
