import { CompanyCadenceStrip } from "@/components/company/CompanyCadenceStrip";
import type { HiringRecordView } from "@/lib/companies/hiring-record";

/** The employer's weekly opened bars on a job page: the /co strip itself, nothing when the record has no weeks. */
export function HiringRecordChart({ record }: { record: HiringRecordView | null }) {
    if (!record?.cadence) return null;
    return (
        <div data-testid="job-detail-hiring-chart" className="mt-4 basis-full">
            <CompanyCadenceStrip cadence={record.cadence} />
        </div>
    );
}
