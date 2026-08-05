/** Locked logo #2 — closer-set peek (asleep / awake). */
export function BrandMark({ className = "h-7 w-7" }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden
            className={className}
        >
            <path
                d="M12 40c7-14 14-20 20-20s13 6 20 20"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
            />
            <path
                d="M24 34.5c1.4 1.9 3.2 1.9 4.6 0"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
            />
            <circle cx="38.5" cy="34" r="2.8" fill="#7cb87a" />
        </svg>
    );
}
