import JobsRouteGate from "@/app/jobs/JobsRouteGate";

/** Server entry — the client mega-bundle mounts straight away; /jobs is board-first. */
export default function JobsPage() {
    return <JobsRouteGate />;
}
