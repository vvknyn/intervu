import Image from "next/image";
import { BRAND_MARK_BRACKETS, BRAND_MARK_VIEWBOX, BrandMark } from "@/components/brand/BrandMark";

function Wordmark() {
    return (
        <span className="font-display text-[28px] leading-none font-bold uppercase tracking-tight">
            velai
        </span>
    );
}

function LockupRow({ children }: { children: React.ReactNode }) {
    return <span className="flex items-center gap-2 text-brand">{children}</span>;
}

/** Brackets only, no live dot — a no-signal variant of the canonical mark. */
function FilledWeightStandInMark() {
    return (
        <svg viewBox={BRAND_MARK_VIEWBOX} aria-hidden className="h-7 w-7">
            {BRAND_MARK_BRACKETS.map((d) => (
                <path key={d} d={d} fill="currentColor" />
            ))}
        </svg>
    );
}

function LiveSignalMark() {
    return (
        <span className="relative inline-flex h-7 w-7 shrink-0">
            <BrandMark className="h-7 w-7 text-current" />
            <span
                className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-live"
                aria-hidden
            />
        </span>
    );
}

function Option({
    n,
    title,
    children,
}: {
    n: number;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <section className="border border-border bg-card p-5">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {n}. {title}
            </h2>
            <div className="mt-4 border-t border-dashed border-border pt-4">{children}</div>
        </section>
    );
}

export function LockupMock() {
    return (
        <main className="mx-auto flex max-w-[820px] flex-col gap-6 p-8">
            <header>
                <h1 className="font-display text-[22px] font-semibold tracking-tight">
                    Header lockup — four directions
                </h1>
                <p className="mt-1 text-[13px] text-muted-foreground">
                    Compare-only fixture at header scale. Not linked from anywhere and not indexed.
                </p>
            </header>

            <Option n={1} title="App-icon lockup">
                <LockupRow>
                    <Image
                        src="/velai-logo.png"
                        width={28}
                        height={28}
                        alt=""
                        className="h-7 w-7 rounded-md"
                    />
                    <Wordmark />
                </LockupRow>
            </Option>

            <Option n={2} title="Filled monogram — filled-weight stand-in">
                <LockupRow>
                    <FilledWeightStandInMark />
                    <Wordmark />
                </LockupRow>
            </Option>

            <Option n={3} title="Live-signal dot">
                <LockupRow>
                    <LiveSignalMark />
                    <Wordmark />
                </LockupRow>
            </Option>

            <Option n={4} title="Wordmark only">
                <LockupRow>
                    <Wordmark />
                </LockupRow>
            </Option>
        </main>
    );
}
