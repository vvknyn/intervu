"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { settleAction } from "@/lib/load-result";
import { listFollowAlertsAction } from "@/actions/follows";
import { readFollowAlertCursor, writeFollowAlertCursor } from "@/lib/follows/alert-cursor";
import { jobPostedMs, type FollowAlertGroup } from "@/lib/follows/alerts";
import { useFollows } from "@/lib/follows/use-follows";
import type { PublicJob } from "@/lib/jobs/types";

export type FollowAlertRow = {
    job: PublicJob;
    displayName: string;
};

/** Newest posting first, one row per job, each labelled with the company it belongs to. */
export function flattenAlertRows(groups: FollowAlertGroup[]): FollowAlertRow[] {
    const rows: FollowAlertRow[] = [];
    for (const group of groups) {
        for (const job of group.jobs) rows.push({ job, displayName: group.displayName });
    }
    return rows.sort((a, b) => (jobPostedMs(b.job) ?? 0) - (jobPostedMs(a.job) ?? 0));
}

/** "2 new roles at companies you follow", or the company's name when there is only one. */
export function followAlertsTitle(rows: FollowAlertRow[], companyCount: number): string {
    if (rows.length === 1) return `1 new role at ${rows[0]?.displayName ?? "a company you follow"}`;
    return `${rows.length} new roles at ${companyCount === 1 ? rows[0]?.displayName ?? "companies you follow" : "companies you follow"}`;
}

/**
 * New roles at the companies a signed-in account follows since it last looked.
 * The account menu reads it for its row and the dot on the avatar; the dialog the
 * row opens lists the roles. `acknowledge` moves the "since" cursor to now.
 */
export function useFollowAlerts() {
    const { follows, isSignedIn } = useFollows();
    const [groups, setGroups] = useState<FollowAlertGroup[]>([]);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            if (follows.length === 0) {
                if (!cancelled) setGroups([]);
                return;
            }
            const res = await settleAction(listFollowAlertsAction(readFollowAlertCursor(), follows));
            if (cancelled) return;
            if (res.data) setGroups(res.data);
        })();
        return () => {
            cancelled = true;
        };
    }, [follows]);

    const rows = useMemo(() => (isSignedIn ? flattenAlertRows(groups) : []), [groups, isSignedIn]);

    const acknowledge = useCallback(() => {
        writeFollowAlertCursor(new Date().toISOString());
        setGroups([]);
    }, []);

    return { rows, companyCount: groups.length, title: followAlertsTitle(rows, groups.length), acknowledge };
}
