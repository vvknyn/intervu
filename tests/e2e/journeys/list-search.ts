import type { Request, Route } from "@playwright/test";

/**
 * The jobs list's own searches: POST /api/jobs/search with the search params
 * as one JSON object, answered with the result as JSON (src/lib/jobs/search-client.ts).
 * They left the Server Action queue on 2026-10-01, so a stub that only looks
 * for a `next-action` header no longer sees them.
 */
export const isListSearch = (req: Request) => req.method() === "POST" && new URL(req.url()).pathname === "/api/jobs/search";

/** Answers a list search with `value` in place of the real answer, in the browser only: the search still runs. */
export async function answerListSearch(route: Route, value: unknown) {
  const response = await route.fetch();
  return route.fulfill({ response, contentType: "application/json", body: JSON.stringify(value) });
}
