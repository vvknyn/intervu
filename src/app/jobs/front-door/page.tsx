import type { Metadata } from "next";
import { connection } from "next/server";
import JobsRouteGate from "@/app/jobs/JobsRouteGate";
import { buildJobsMetadata } from "@/lib/seo/jobs-metadata";

export const metadata: Metadata = buildJobsMetadata();

/**
 * /jobs's signed-out front door rendered on the server. Reached only through
 * the middleware's rewrite of a signed-out visitor's bare `/jobs` (the
 * address bar keeps that URL; see server-front-door.ts for who gets it), so
 * the masthead, search box and résumé band are in the HTML instead of
 * waiting for the page's code and a session check. Rendered per request:
 * the list reads the address while it renders, which a prerendered page
 * would hand to the browser instead.
 */
export default async function JobsFrontDoorPage() {
    await connection();
    return <JobsRouteGate signedOut />;
}
