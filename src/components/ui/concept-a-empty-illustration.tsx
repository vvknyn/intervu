import { cn } from "@/lib/utils";

/** Inline postcard empty mark — decorative only (no external assets). */
export function ConceptAEmptyIllustration({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 80 56"
            width={80}
            height={56}
            className={cn("shrink-0 text-muted-foreground", className)}
            aria-hidden
            focusable="false"
        >
            <rect
                x="1"
                y="1"
                width="78"
                height="54"
                rx="6"
                fill="rgb(var(--surface))"
                stroke="rgb(var(--border))"
                strokeWidth="1"
            />
            <path
                fill="currentColor"
                opacity="0.55"
                d="M22 18H12v20h10v-4h-6V22h6zM58 18h10v20H58v-4h6V22h-6z"
            />
            <circle cx="40" cy="28" r="6" className="fill-live opacity-85" />
        </svg>
    );
}
