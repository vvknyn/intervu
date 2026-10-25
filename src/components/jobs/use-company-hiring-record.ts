import { useEffect, useState } from "react";
import { getCompanyHiringRecordAction } from "@/actions/jobs";

/** The employer's opened/closed sentence for a job page; null until resolved, and when the box has no record. */
export function useCompanyHiringRecord(domain: string | null | undefined, enabled = true): string | null {
    const [record, setRecord] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        setRecord(null);
        if (!enabled || !domain) return;
        getCompanyHiringRecordAction(domain)
            .then((line) => {
                if (!cancelled) setRecord(line);
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
