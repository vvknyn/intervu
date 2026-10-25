"use client";

import { UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { AUTH_CTA_LABEL, RESUME_UPLOAD_CTA } from "@/lib/auth/auth-gate-copy";
import {
    FRONT_DOOR_RESUME_CARD_SUBCOPY,
    FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN,
    RESUME_UPLOAD_SIGNIN_LINE,
} from "@/lib/jobs/resume-cta-copy";

/**
 * The /jobs at-rest front door's résumé-upload band (requirement 2). A
 * brand-filled panel on the page column, the one promo at rest. Visibility is
 * `frontDoorRegions().band` (lib/jobs/front-door-state.ts) — the same rule for
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
 * the ONLY button here — the Button primitive's `secondary` variant (brand text on a
 * faint brand tint; Fable design pass, 2026-09-17: the band's second, outline "Sign in" button was cut; signing
 * in is now the `AUTH_CTA_LABEL` word inside `RESUME_UPLOAD_SIGNIN_LINE`
 * below, rendered as a link — same split-on-embedded-label convention
 * the retired detail pitch used for `FOOTER_PROVENANCE_LINE`). A signed-in
 * account (the one /jobs used to put a full-page onboarding card in front of)
 * gets its own subcopy, since its upload is saved to the account rather than
 * kept in the browser, and no line asking it to sign in.
 */
export function FrontDoorResumeBand({
    signedIn,
    onUploadClick,
    onSignInClick,
}: {
    signedIn: boolean;
    onUploadClick: () => void;
    onSignInClick: () => void;
}) {
    return (
        <section
            aria-label="Add your resume"
            // rounded-panel: it sits inside the page gutter, not edge to edge,
            // so its square corners were the one unrounded panel on the page.
            className="@container mb-3 w-full rounded-panel bg-surface px-4 py-6 text-foreground sm:px-8"
        >
            <div className="mx-auto grid max-w-[960px] gap-3 @lg:grid-cols-[minmax(0,1fr)_auto] @lg:items-center @lg:gap-6">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">
                        See which live jobs fit you.
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {signedIn ? FRONT_DOOR_RESUME_CARD_SUBCOPY_SIGNED_IN : FRONT_DOOR_RESUME_CARD_SUBCOPY}
                    </p>
                </div>
                <Button type="button" variant="secondary" onClick={onUploadClick} className="justify-self-start">
                    <UploadSimple weight="bold" aria-hidden />
                    {RESUME_UPLOAD_CTA}
                </Button>
                {!signedIn && (
                    <p data-testid="front-door-band-signin" className="text-xs text-muted-foreground @lg:col-span-2">
                        {RESUME_UPLOAD_SIGNIN_LINE.split(AUTH_CTA_LABEL).map((part, i) => (
                            <span key={i}>
                                {i > 0 && (
                                    <button
                                        type="button"
                                        onClick={onSignInClick}
                                        className="font-semibold text-foreground underline underline-offset-2"
                                    >
                                        {AUTH_CTA_LABEL}
                                    </button>
                                )}
                                {part}
                            </span>
                        ))}
                    </p>
                )}
            </div>
        </section>
    );
}
