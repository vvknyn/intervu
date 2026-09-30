"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { unfollowCompanyAction } from "@/actions/follows";
import { Button } from "@/components/ui/button";
import { InlineSpinner } from "@/components/ui/wait-state";
import { SettingsInlineError } from "@/components/settings/SettingsInlineError";
import { SettingsSectionLoading } from "@/components/settings/SettingsSectionLoading";
import { captureEvent } from "@/lib/analytics/events";
import { companyBoardPath } from "@/lib/companies/paths";
import { FOLLOWED_COMPANIES_ANCHOR } from "@/lib/follows/manage-path";
import { invalidateFollowsCache, useFollows } from "@/lib/follows/use-follows";
import { toast } from "@/lib/toast";

/**
 * Settings › Account: the one place a signed-in user can see every company
 * they follow and stop following one. Before this, a follow could only be
 * undone from that company's own page, so the bell's alerts had no way out
 * short of remembering which pages to revisit.
 */
export function FollowedCompaniesSection() {
    const { follows, loading, failed, retry, isSignedIn } = useFollows();
    const [removing, setRemoving] = useState<string | null>(null);
    // Rows unfollowed this visit disappear at once, before the follows cache
    // refetch lands, so a second click can't target a row that's already gone.
    const [removed, setRemoved] = useState<Set<string>>(() => new Set());
    const sectionRef = useRef<HTMLElement>(null);

    // The page renders this section only after auth resolves, which is after
    // the browser's own hash scroll has already run, so do it here.
    useEffect(() => {
        if (loading) return;
        if (window.location.hash !== `#${FOLLOWED_COMPANIES_ANCHOR}`) return;
        sectionRef.current?.scrollIntoView({ block: "start" });
    }, [loading]);

    if (!isSignedIn) return null;

    const rows = follows
        .filter((f) => !removed.has(f.domain))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const unfollow = async (domain: string, displayName: string) => {
        setRemoving(domain);
        try {
            const res = await unfollowCompanyAction(domain);
            if (res.error) {
                toast.error(`Couldn't unfollow ${displayName}. Try again.`);
                return;
            }
            captureEvent("company_unfollowed", { company_domain: domain });
            setRemoved((prev) => new Set(prev).add(domain));
            invalidateFollowsCache();
            toast.success(`Unfollowed ${displayName}`);
        } catch {
            toast.error(`Couldn't unfollow ${displayName}. Try again.`);
        } finally {
            setRemoving(null);
        }
    };

    return (
        <section ref={sectionRef} id={FOLLOWED_COMPANIES_ANCHOR} data-testid="followed-companies" className="scroll-mt-20">
            <h2 className="mb-1 text-base font-semibold leading-snug">Companies you follow</h2>
            <p className="mb-4 text-sm text-muted-foreground">
                New roles at these companies show under the bell and in your weekly digest.
            </p>

            {loading ? (
                <SettingsSectionLoading label="Loading companies you follow" />
            ) : failed && rows.length === 0 ? (
                <div className="space-y-3">
                    <SettingsInlineError>Couldn&apos;t load the companies you follow.</SettingsInlineError>
                    <Button variant="outline" size="sm" onClick={retry} data-testid="followed-companies-retry">
                        Try again
                    </Button>
                </div>
            ) : rows.length === 0 ? (
                <p data-testid="followed-companies-empty" className="text-sm text-foreground">
                    You don&apos;t follow any companies yet. Open a company from any job and choose Follow to hear
                    about its new roles.
                </p>
            ) : (
                <ul className="divide-y divide-border border-y border-border">
                    {rows.map((f) => (
                        <li
                            key={f.domain}
                            data-testid="followed-company-row"
                            className="flex items-center justify-between gap-3 py-3"
                        >
                            <div className="min-w-0">
                                <Link
                                    href={companyBoardPath(f.domain)}
                                    className="block truncate text-sm text-foreground underline-offset-2 hover:underline"
                                >
                                    {f.displayName}
                                </Link>
                                <p className="truncate text-xs text-muted-foreground">{f.domain}</p>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="shrink-0 px-2.5 text-muted-foreground hover:text-danger-text"
                                disabled={removing !== null}
                                aria-label={`Unfollow ${f.displayName}`}
                                data-testid="followed-company-unfollow"
                                onClick={() => void unfollow(f.domain, f.displayName)}
                            >
                                {removing === f.domain ? <InlineSpinner /> : null}
                                Unfollow
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
