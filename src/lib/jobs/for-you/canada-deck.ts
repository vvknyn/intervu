import { isCanadaJobContext } from "@/lib/jobs/trust-corrections";
import type { PublicJob } from "@/lib/jobs/types";

/**
 * A breadcrumb segment that names Canada. `CAN` is the leak on raw ATS
 * strings (`CAN - ON - Toronto`) that never set `location_country`. `CA`
 * is intentionally absent: in a place string it is California.
 */
const CANADA_SEGMENT = /^(?:can|canada|canadian)$/i;

function segments(value: string | null | undefined): string[] {
    if (!value) return [];
    return value
        .split(/\s*,\s*|\s+-\s+|\s*\/\s*|\s*;\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
}

type CanadaDeckJob = Pick<
    PublicJob,
    "company" | "location" | "location_city" | "location_state" | "location_country"
>;

/**
 * Signed-in deck exclusion. Reuses `isCanadaJobContext` (country field and
 * company suffix) and also drops raw location breadcrumbs that say Canada
 * without a country field.
 */
export function isCanadaDeckJob(job: CanadaDeckJob): boolean {
    if (isCanadaJobContext(job)) return true;
    const country = Array.isArray(job.location_country)
        ? job.location_country.join(" ")
        : job.location_country;
    return [job.location, job.location_city, job.location_state, country].some((field) =>
        segments(field ?? undefined).some((part) => CANADA_SEGMENT.test(part)),
    );
}
