import { stageRank, type PursuitStage } from "@/lib/pursuits/types";

/**
 * The `applied_at` a pursuit write should set, or `undefined` to leave it as
 * it is. It is set once, by the write that moves a role into "applied" from
 * an earlier stage (or creates it there), so "applied this week", Today's
 * count and "applied 2d ago" count every application marked from a job page,
 * the "Did you apply?" prompt or an agent, not only ones changed on /yours.
 *
 * A role already at or past "applied" keeps its date, or its lack of one: a
 * repeat "Yes" is not a new application, and an interviewing role that never
 * had a date must not start counting as applied today.
 */
export function appliedAtForTransition(
    previous: { status: PursuitStage; applied_at?: string } | null,
    next: PursuitStage,
    nowIso: string,
): string | undefined {
    if (next !== "applied") return undefined;
    if (!previous) return nowIso;
    if (previous.applied_at) return undefined;
    return stageRank(previous.status) < stageRank("applied") ? nowIso : undefined;
}
