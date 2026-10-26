import { useEffect, useState } from "react";
import { getCompanyHiringRecordAction } from "@/actions/jobs";
import type { HiringRecordView } from "@/lib/companies/hiring-record";

/** The employer's opened/closed sentence and weekly bars for a job page; null until resolved, and when the box has no record. */
export function useCompanyHiringRecord(domain: string | null | undefined, enabled = true): HiringRecordView | null {
    const [record, setRecord] = useState<HiringRecordView | null>(null);
    useEffect(() => {
        let cancelled = false;
        setRecord(null);
        if (!enabled || !domain) return;
        getCompanyHiringRecordAction(domain)
            .then((view) => {
                if (!cancelled) setRecord(view);
            })
            .catch(() => {
                // Presentation only — a failed read shows no line.
            });
        return () => {
            cancelled = true;
        };
    }, [domain, enabled]);
    return record;
}
