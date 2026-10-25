import Link from "next/link";
import { Browser, EyeSlash, LockSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { SectionTitle } from "@/components/ui/heading";
import {
    PRIVACY_LINK_LABEL,
    PRIVACY_PROMISES,
    PRIVACY_RESUME_SECTION_ID,
    type PrivacyPromise,
} from "@/lib/legal/privacy-promises";

const ICONS: Record<PrivacyPromise["id"], typeof Browser> = {
    "read-in-browser": Browser,
    encrypted: LockSimple,
    "sealed-ai": ShieldCheck,
    "never-sold": EyeSlash,
};

/**
 * Velai's four résumé privacy promises (`PRIVACY_PROMISES`), each one tap
 * from the /privacy section that explains it. One component for the front
 * door's band and the summary atop /privacy, so the two can't say different
 * things. Server-safe: no hooks, SSR icons.
 */
export function PrivacyPromises({
    heading = "Your résumé stays private",
    showPolicyLink = true,
    className,
}: {
    heading?: string;
    /** The front door links to the policy; /privacy itself doesn't. */
    showPolicyLink?: boolean;
    className?: string;
}) {
    return (
        <section
            aria-labelledby="privacy-promises-title"
            data-testid="privacy-promises"
            className={cn("rounded-panel bg-surface px-4 py-5 sm:px-6", className)}
        >
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <SectionTitle id="privacy-promises-title">{heading}</SectionTitle>
                {showPolicyLink && (
                    <Link
                        href={`/privacy#${PRIVACY_RESUME_SECTION_ID}`}
                        className="text-sm font-semibold text-brand underline underline-offset-4 hover:text-brand"
                    >
                        {PRIVACY_LINK_LABEL}
                    </Link>
                )}
            </div>
            <ul className="mt-3 grid gap-5 sm:grid-cols-2">
                {PRIVACY_PROMISES.map((promise) => {
                    const Icon = ICONS[promise.id];
                    return (
                        <li key={promise.id} data-promise={promise.id}>
                            <Link href={promise.href} className="group flex gap-2.5">
                                <Icon size={20} weight="duotone" aria-hidden className="mt-0.5 shrink-0 text-live" />
                                <span>
                                    <span className="block text-sm font-semibold text-foreground group-hover:underline group-hover:underline-offset-4">
                                        {promise.title}
                                    </span>
                                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                                        {promise.detail}
                                    </span>
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
