"use client";

/**
 * What the role page and the tracker's sheet do with the résumé a role kept
 * when it was marked Applied (`AppliedResume`): download it and remove it,
 * for the account's roles and a guest's alike.
 */

import { fetchAppliedResumeAction, removeAppliedResumeAction } from "@/actions/applications";
import { getSignedInUser } from "@/lib/firebase/client-auth";
import { toast } from "@/lib/toast";
import { downloadResumeVersion } from "./download-resume";
import { removeGuestAppliedResume } from "./guest-store";
import { APPLIED_RESUME_LABEL } from "./resume-on-apply";
import type { Pursuit } from "./types";
import { invalidatePursuitsCache } from "./use-pursuits";

/** Same renderer as a filed version. A guest's copy carries its text; the
 *  account's tracker list leaves the text out, so it's read first. */
export async function downloadAppliedResume(pursuit: Pick<Pursuit, "id" | "company_name" | "position" | "applied_resume">): Promise<void> {
    const copy = pursuit.applied_resume;
    if (!copy) return;
    let content = copy.content;
    if (!content) {
        const res = await fetchAppliedResumeAction(pursuit.id);
        content = res.data?.content;
        if (!content) {
            toast.error("We couldn't load that résumé. Try again.");
            return;
        }
    }
    await downloadResumeVersion({ content, label: APPLIED_RESUME_LABEL, saved_at: copy.saved_at }, pursuit);
}

/** Takes the copy off the role; the résumé itself stays. */
export async function removeAppliedResumeFromRole(id: string): Promise<boolean> {
    if (getSignedInUser()) {
        const res = await removeAppliedResumeAction(id);
        if (res.error) {
            toast.error(`Could not remove: ${res.error}`);
            return false;
        }
        invalidatePursuitsCache();
    } else if (!removeGuestAppliedResume(id)) {
        toast.error("Could not find this pursuit.");
        return false;
    }
    toast.success("Résumé removed from this role");
    return true;
}
