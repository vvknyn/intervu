import { ArrowSquareOut, FileText, ListChecks, ShieldCheck, Target, type Icon } from "@phosphor-icons/react";
import { BrandMark, HEADER_MARK_SRC } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import {
    CHROME_EXTENSION_LEAD,
    CHROME_EXTENSION_NAME,
    CHROME_EXTENSION_POINTS,
    CHROME_EXTENSION_STORE_URL,
    type ExtensionPointId,
} from "@/lib/brand/extension-store";
import { cn } from "@/lib/utils";

const POINT_ICON: Record<ExtensionPointId, Icon> = {
    fit: Target,
    posting: ShieldCheck,
    resume: FileText,
    apply: ListChecks,
};

/**
 * The Velai Chrome extension, as a tile in the packs hub's own style (cream paper, navy ink): what it does on a job
 * page in four short lines, and one way in, the Chrome Web Store. A page cannot tell whether the extension is
 * installed (it has no content script on velai.app), so the action is always "Add to Chrome", never "Open".
 */
export function ExtensionTile({ className }: { className?: string }) {
    return (
        <section
            aria-label={CHROME_EXTENSION_NAME}
            data-testid="extension-tile"
            className={cn(
                "surface-paper flex flex-col gap-4 rounded-panel border border-border bg-surface-postcard p-4 text-surface-postcard-foreground md:flex-row md:items-center md:justify-between md:gap-6",
                className,
            )}
        >
            <div className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-panel border border-border bg-background">
                    <BrandMark src={HEADER_MARK_SRC} className="h-7 w-7" pixelSize={28} />
                </span>
                <div className="space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                        <h3 className="text-base font-semibold leading-snug text-balance">{CHROME_EXTENSION_NAME}</h3>
                        <p className="text-xs text-muted-foreground">{CHROME_EXTENSION_LEAD}</p>
                    </div>
                    <ul className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4 sm:gap-x-5" data-testid="extension-tile-points">
                        {CHROME_EXTENSION_POINTS.map((point) => {
                            const PointIcon = POINT_ICON[point.id];
                            return (
                                <li key={point.id} className="flex items-center gap-1.5" data-testid={`extension-tile-point-${point.id}`}>
                                    <PointIcon size={16} aria-hidden className="shrink-0 text-brand" />
                                    {point.text}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
            <Button asChild className="w-full shrink-0 md:w-auto">
                <a
                    href={CHROME_EXTENSION_STORE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="extension-tile-link"
                    aria-label="Add to Chrome, opens the Chrome Web Store"
                >
                    Add to Chrome
                    <ArrowSquareOut size={16} aria-hidden />
                </a>
            </Button>
        </section>
    );
}
