"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { goAfterJobAction } from "@/actions/application";
import { JobDetail } from "@/components/jobs/JobDetail";
import { getCurrentUser } from "@/lib/firebase/client-auth";
import { resolveApplyGateDecision } from "@/lib/jobs/pending-actions";
import type { PublicJob } from "@/lib/jobs/types";
import { toast } from "@/lib/toast";

/**
 * Client-side wiring for `JobDetail` on the standalone `/jobs/[slug]` page.
 * The route itself is a server component and can't hand `JobDetail`
 * function props (Apply/Save handlers) across the RSC boundary, so this
 * thin wrapper supplies them. It renders no body UI of its own — everything
 * still comes from `JobDetail` (writing-lean-code: do not fork a second
 * detail component).
 *
 * `signedIn` is forced `true` here regardless of the visitor's real auth
 * state. On the board (`/jobs`), `JobDetail`'s `!signedIn` branch hides the
 * ghost-verdict module, exposure badges, and company-intel rail behind a
 * truncated preview + sign-in CTA (G4 guest gate) — correct there, where the
 * visitor is already inside the product. This route's entire purpose is the
 * opposite (spec §6): the verdict/exposure content is what a crawler or a
 * shared link is supposed to see, and Googlebot never carries a session. So
 * this page always shows the full body and gates only the real mutations
 * (apply / save) on the actual signed-in state below, through the same pure
 * `resolveApplyGateDecision` the board itself uses — one gate decision, not
 * a second one reimplemented here.
 */
export function PublicJobDetail({ job }: { job: PublicJob }) {
    // Single clock read for this component's lifetime — JobDetail derives
    // relative ages from it during render, where a fresh Date.now() would be
    // the impure-render call react-hooks/purity flags.
    const [nowMs] = useState(() => Date.now());
    const [goingAfter, setGoingAfter] = useState(false);
    const pathname = usePathname();
    const router = useRouter();

    const requireAuth = () => {
        router.push(`/login?next=${encodeURIComponent(pathname)}`);
    };

    return (
        <JobDetail
            job={job}
            now={nowMs}
            signedIn
            pursuit={undefined}
            goingAfter={goingAfter}
            onOpenPosting={() => {
                if (resolveApplyGateDecision(Boolean(getCurrentUser())) === "gate") {
                    requireAuth();
                    return;
                }
                if (job.apply_url) window.open(job.apply_url, "_blank", "noopener,noreferrer");
            }}
            onGoAfter={() => {
                if (resolveApplyGateDecision(Boolean(getCurrentUser())) === "gate") {
                    requireAuth();
                    return;
                }
                void (async () => {
                    setGoingAfter(true);
                    try {
                        const res = await goAfterJobAction(job);
                        if (res.error) {
                            toast.error(`Could not save: ${res.error}`);
                            return;
                        }
                        toast.success("Saved — find it in your Tracker");
                    } catch (e) {
                        toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
                    } finally {
                        setGoingAfter(false);
                    }
                })();
            }}
        />
    );
}
