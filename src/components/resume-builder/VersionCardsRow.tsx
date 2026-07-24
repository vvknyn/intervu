"use client";

import { useState } from "react";
import Link from "next/link";
import { TailoredResumeVersion } from "@/types/resume";
import { formatRelativeAge } from "@/lib/jobs/freshness";

interface VersionCardsRowProps {
    versions: TailoredResumeVersion[];
    /** undefined = base resume is the active view. */
    activeVersionId?: string;
}

const CARD_BASE =
    "flex-1 min-w-[180px] rounded-xl border bg-card px-[18px] py-3.5 transition-colors";
const CARD_ACTIVE = "border-[1.5px] border-foreground";
const CARD_INACTIVE = "border-border hover:border-border-strong";

/**
 * The hub's version-switcher row: the base resume + one card per real
 * tailored version + a dashed "+ New version" entry into /resume-tailor.
 * No ATS score, no match % — TailoredResumeVersion carries no such fields
 * (PORTAL-REDESIGN-SPEC.md, Page: Resume).
 */
export function VersionCardsRow({ versions, activeVersionId }: VersionCardsRowProps) {
    // Sampled once per mount, not per render — see src/app/page.tsx's `nowMs`
    // for why a bare `Date.now()` here would trip `react-hooks/purity`.
    const [now] = useState(() => Date.now());

    return (
        <div className="mb-[18px] flex flex-wrap gap-3">
            <Link
                href="/resume-builder"
                data-testid="resume-version-base"
                className={`${CARD_BASE} ${!activeVersionId ? CARD_ACTIVE : CARD_INACTIVE}`}
            >
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">Base resume</span>
                    <span className="shrink-0 rounded bg-chip px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-text-2">
                        default
                    </span>
                </div>
            </Link>

            {versions.map((v) => (
                <Link
                    key={v.id}
                    href={`/resume-builder?versionId=${v.id}`}
                    data-testid="resume-version-card"
                    className={`${CARD_BASE} ${activeVersionId === v.id ? CARD_ACTIVE : CARD_INACTIVE}`}
                >
                    <div className="truncate text-sm font-semibold">{v.versionName}</div>
                    {v.createdAt && (
                        <div className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                            created {formatRelativeAge(v.createdAt, now)}
                        </div>
                    )}
                </Link>
            ))}

            <Link
                href="/resume-tailor"
                data-testid="resume-new-version"
                className="flex min-w-[150px] flex-none items-center justify-center rounded-xl border-[1.5px] border-dashed border-border-strong px-5 py-3.5 text-[13px] font-medium text-faint transition-colors hover:border-foreground hover:text-foreground"
            >
                + New version
            </Link>
        </div>
    );
}
