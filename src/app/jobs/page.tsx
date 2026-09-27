import JobsRouteGate from "@/app/jobs/JobsRouteGate";

/** Server entry — Concept A Step 1 is SSR in layout; client mega-bundle loads on demand. */
export default function JobsPage() {
    return <JobsRouteGate />;
}
