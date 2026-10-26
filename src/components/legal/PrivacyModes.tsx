import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionTitle } from "@/components/ui/heading";
import { PRIVACY_MODES, PRIVACY_SUMMARY, type PrivacyMode } from "@/lib/privacy-modes";

/** One mode's privacy points, as a checklist. Shared by /privacy and the /pricing cards. */
export function PrivacyModePoints({ mode, className }: { mode: PrivacyMode; className?: string }) {
    return (
        <ul className={cn("space-y-2 text-sm text-foreground", className)} data-mode-points={mode.id}>
            {mode.points.map((point) => (
                <li key={point} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span>{point}</span>
                </li>
            ))}
        </ul>
    );
}

/**
 * The two ways to use Velai, Local and Private cloud, opening /privacy. The
 * words live in `lib/privacy-modes.ts`. Server-safe: no hooks.
 */
export function PrivacyModes({ className }: { className?: string }) {
    return (
        <section
            aria-labelledby="privacy-modes-title"
            data-testid="privacy-modes"
            className={cn("rounded-panel bg-surface px-4 py-5 sm:px-6", className)}
        >
            <SectionTitle id="privacy-modes-title">Two ways to use Velai</SectionTitle>
            <p className="mt-2 text-sm text-muted-foreground">{PRIVACY_SUMMARY}</p>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
                {Object.values(PRIVACY_MODES).map((mode) => (
                    <div key={mode.id} data-mode={mode.id}>
                        <h3 className="text-sm font-semibold text-foreground">
                            {mode.name} <span className="font-normal text-muted-foreground">· {mode.price}</span>
                        </h3>
                        <PrivacyModePoints mode={mode} className="mt-3" />
                    </div>
                ))}
            </div>
        </section>
    );
}
