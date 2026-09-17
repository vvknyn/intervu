"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";
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
 * the ONLY button here — white fill, brand text (Fable design pass,
 * 2026-09-17: the band's second, outline "Sign in" button was cut; signing
 * in is now the `AUTH_CTA_LABEL` word inside `RESUME_UPLOAD_SIGNIN_LINE`
 * below, rendered as a link — same split-on-embedded-label convention
 * `FrontDoorDetailPitch` uses for `FOOTER_PROVENANCE_LINE`).
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
                    <p className="mt-1 text-sm text-brand-foreground">{RESUME_UPLOAD_PROMISE}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={onUploadClick}
                        className="inline-flex h-11 items-center justify-center gap-1.5 rounded-none bg-brand-foreground px-5 text-xs font-semibold text-brand transition-colors hover:opacity-90"
                    >
                        <UploadSimple size={16} weight="bold" aria-hidden />
                        Upload resume
                    </button>
                </div>
                <p className="text-xs text-brand-foreground sm:col-span-2">
                    {RESUME_UPLOAD_SIGNIN_LINE.split(AUTH_CTA_LABEL).map((part, i, parts) => (
                        <span key={i}>
                            {i > 0 && (
                                <button
                                    type="button"
                                    onClick={onSignInClick}
                                    className="font-semibold underline underline-offset-2"
                                >
                                    {AUTH_CTA_LABEL}
                                </button>
                            )}
                            {part}
                        </span>
                    ))}
                </p>
            </div>
        </section>
    );
}
