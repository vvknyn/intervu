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

/**
 * A picture is shown only when it is one of our own files (a site path such as
 * "/velai-logo.png"). A sign-in provider's photo address (Google, GitHub...)
 * would make the browser contact that company's image server on every page,
 * handing it the visitor's IP address, so any other address is ignored and the
 * initials show instead. This is the one place a picture address becomes an
 * <img>, so no caller can reintroduce a remote photo.
 */
export function localPictureSrc(url?: string): string | undefined {
    return url && /^\/(?![/\\])/.test(url) ? url : undefined;
}

export interface UserAvatarProps {
    name?: string;
    email?: string;
    pictureUrl?: string;
    size?: number;
    className?: string;
}

/**
 * Identity trigger for the signed-in header menu — a Velai-hosted picture when
 * there is one, else initials (provider photos are never loaded). Deliberately not Klein: identity is not an
 * action or a selection state (rulebook, docs/design/rulebook-2026-09), so
 * it sits on the neutral layer token (`bg-muted`) with a hairline border
 * (`border-border`) like any other inert surface.
 */
export function UserAvatar({ name, email, pictureUrl, size = 32, className }: UserAvatarProps) {
    const src = localPictureSrc(pictureUrl);
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
            {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
                getAvatarInitials(name, email)
            )}
        </span>
    );
}
