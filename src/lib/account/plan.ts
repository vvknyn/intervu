// PARSE_GATE_EXEMPT: fetchPlanAction returns the plan's status and end date, never résumé text.
import { useEffect, useState } from "react";
import { fetchPlanAction } from "@/actions/plan";
import type { PlanSummary } from "@/lib/billing/plan";

const PLAN_TTL_MS = 30_000;

export type PlanResult = { plan?: PlanSummary; error?: string };

/** A short-lived memo of one plan read, shared by the Settings card and the notice. A rejected read is `{error}`. */
export function createPlanCache(
    fetcher: () => Promise<PlanResult>,
    now: () => number = Date.now,
): () => Promise<PlanResult> {
    let held: { at: number; result: Promise<PlanResult> } | null = null;
    return () => {
        if (held && now() - held.at < PLAN_TTL_MS) return held.result;
        const result = fetcher().catch((): PlanResult => ({ error: "Couldn't load your plan" }));
        held = { at: now(), result };
        return result;
    };
}

export const readPlan = createPlanCache(fetchPlanAction);

/** null while loading. */
export function usePlan(): PlanResult | null {
    const [result, setResult] = useState<PlanResult | null>(null);
    useEffect(() => {
        let live = true;
        void readPlan().then((r) => live && setResult(r));
        return () => {
            live = false;
        };
    }, []);
    return result;
}
