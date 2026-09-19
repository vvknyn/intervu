import { cn } from "@/lib/utils";

/**
 * First letters of the first two words of `name`; the first two letters of
 * `name` when it's a single word; else the first two characters of the
 * email's local part; else "". Exported so the decision is unit-testable
 * without mounting the component.
 */
export function getAvatarInitials(name?: string, email?: string): string {
    const words = name?.trim().split(/\s+/).filter(Boolean) ?? [];
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    const local = email?.trim().split("@")[0];
    return local ? local.slice(0, 2).toUpperCase() : "";
}

export interface UserAvatarProps {
    name?: string;
    email?: string;
    pictureUrl?: string;
    size?: number;
    className?: string;
}

/**
 * Identity trigger for the signed-in header menu — a profile photo when we
 * have one, else initials. Deliberately not Klein: identity is not an
 * action or a selection state (rulebook, docs/design/rulebook-2026-09), so
 * it sits on the neutral layer token (`bg-muted`) with a hairline border
 * (`border-border`) like any other inert surface.
 */
export function UserAvatar({ name, email, pictureUrl, size = 32, className }: UserAvatarProps) {
    return (
        <span
            // The identity mark uses the pill role (fully round at any size),
            // same token every avatar/chip/status-dot in the system uses —
            // not a one-off circle exception.
            className={cn(
                "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-pill border border-border bg-muted text-sm leading-5 font-semibold text-foreground",
                className,
            )}
            style={{ width: size, height: size }}
        >
            {pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pictureUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
                getAvatarInitials(name, email)
            )}
        </span>
    );
}
