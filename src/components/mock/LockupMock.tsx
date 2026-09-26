import Image from "next/image";
import { BrandMark, BrandLockup } from "@/components/brand/BrandMark";

function Wordmark() {
    return (
        <span className="text-2xl leading-none font-semibold">
            velai
        </span>
    );
}

function LockupRow({ children }: { children: React.ReactNode }) {
    return <span className="flex items-center gap-2 text-brand">{children}</span>;
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
            <h2 className="text-xs font-semibold text-muted-foreground">
                {n}. {title}
            </h2>
            <div className="mt-4 border-t border-dashed border-border pt-4">{children}</div>
        </section>
    );
}

/** Compare fixture: locked product mark is the only live direction. */
export function LockupMock() {
    return (
        <main className="mx-auto flex max-w-[820px] flex-col gap-6 p-8">
            <header>
                <h1 className="text-lg font-semibold">
                    Header lockup — locked product mark
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                    Soft paper card, navy brackets, one bigger green live dot. Not linked from anywhere and not indexed.
                </p>
            </header>

            <Option n={1} title="Locked app-icon lockup (product)">
                <LockupRow>
                    <Image
                        src="/velai-logo.png"
                        width={28}
                        height={28}
                        alt=""
                        className="h-7 w-7 object-contain"
                    />
                    <Wordmark />
                </LockupRow>
            </Option>

            <Option n={2} title="BrandMark component (same raster)">
                <LockupRow>
                    <BrandMark className="h-7 w-7" />
                    <Wordmark />
                </LockupRow>
            </Option>

            <Option n={3} title="BrandLockup (header chrome)">
                <BrandLockup />
            </Option>
        </main>
    );
}
