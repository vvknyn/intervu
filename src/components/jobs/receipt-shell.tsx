/**
 * Shared "receipt" chrome — bordered box, header row with a mono uppercase
 * label plus a status pill, body below. Same visual grammar as
 * `JobDetailDocument.tsx`'s `Receipt` (the ghost-check box on a live
 * posting), extracted here so a posting-check surface that ISN'T rendering
 * the full ghost signal list — e.g. the pursuit dossier's live-posting
 * check, which only ever has a loading/gone/unknown state to report — gets
 * the same box instead of three one-off plain-text blocks.
 */

import { cn } from "@/lib/utils";

export function ReceiptShell({
    label,
    status,
    statusClassName,
    children,
}: {
    label: string;
    status: string;
    statusClassName: string;
    children: React.ReactNode;
}) {
    return (
        <div className="border border-border bg-card">
            <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <span className="mono-data text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
                <span className={cn("inline-flex items-center px-2 py-0.5 text-xs font-bold uppercase tracking-wider", statusClassName)}>
                    {status}
                </span>
            </div>
            <div className="px-4 py-4 text-sm">{children}</div>
        </div>
    );
}
