"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { RESUME_UPLOAD_PROMISE, RESUME_UPLOAD_SIGNIN_LINE } from "@/lib/jobs/resume-cta-copy";

/**
 * The /jobs at-rest front door's résumé-upload band (requirement 2). Full-
 * bleed brand-filled block, replacing `ColdVisitorOrientation` at rest (see
 * `showColdOrientation`'s doc comment in page.tsx). Visibility is
 * `showsFrontDoorBand` (lib/jobs/front-door-state.ts) — the same rule for
 * signed-out AND signed-in visitors without a résumé on file, so both this
 * band and page.tsx's other résumé-entry surfaces (`needsResumeEntry`) can't
 * disagree about who needs the invite.
 *
 * Copy: `RESUME_UPLOAD_PROMISE` and `RESUME_UPLOAD_SIGNIN_LINE` are shared
 * with /resume's signed-out empty state (`resume-cta-copy.ts`) — see that
 * file's doc comment for why this makes NO on-device/privacy/AI claim (the
 * default upload path is server-side).
 *
 * Requirement 5 (one filled action per screen at rest): "Upload resume" is
 * the only filled/solid button here — white fill, brand text. "Sign in" is
 * a hairline outline button (white border/text on the brand fill).
 */
export function FrontDoorResumeBand({
    onUploadClick,
    onSignInClick,
}: {
    onUploadClick: () => void;
    onSignInClick: () => void;
}) {
    return (
        <section
            aria-label="Add your resume"
            className="mt-6 w-full bg-brand px-4 py-8 text-brand-foreground sm:px-8"
        >
            <div className="mx-auto grid max-w-[960px] gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
                <div>
                    <h2 className="text-xl font-semibold text-brand-foreground sm:text-2xl">
                        Add your resume. Rank results by fit.
                    </h2>
                    <p className="mt-1 text-sm text-brand-foreground/90">{RESUME_UPLOAD_PROMISE}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={onUploadClick}
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-none bg-brand-foreground px-5 text-xs font-semibold text-brand transition-colors hover:bg-brand-foreground/90"
                    >
                        <UploadSimple size={16} weight="bold" aria-hidden />
                        Upload resume
                    </button>
                    <button
                        type="button"
                        onClick={onSignInClick}
                        className="inline-flex h-11 items-center justify-center rounded-none border border-brand-foreground px-5 text-xs font-semibold text-brand-foreground transition-colors hover:bg-brand-foreground/10"
                    >
                        Sign in
                    </button>
                </div>
                <p className="text-xs text-brand-foreground/75 sm:col-span-2">{RESUME_UPLOAD_SIGNIN_LINE}</p>
            </div>
        </section>
    );
}
