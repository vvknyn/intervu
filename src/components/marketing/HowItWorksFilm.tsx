"use client";

// design-lint-allow-file: self-contained dark film plate -- its own
// black/near-black palette, not this app's token set; exempt from the
// repo-wide banned-utility gate (tests/unit/design-language.test.ts).

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    HOW_IT_WORKS_FILMS,
    type HowItWorksFilmId,
} from "@/lib/marketing/how-it-works";

interface HowItWorksFilmProps {
    film: HowItWorksFilmId | null;
    onOpenChange: (open: boolean) => void;
}

export function HowItWorksFilm({ film, onOpenChange }: HowItWorksFilmProps) {
    const active = film ? HOW_IT_WORKS_FILMS[film] : null;

    return (
        <Dialog open={film !== null} onOpenChange={onOpenChange}>
            <DialogContent
                className="max-w-[min(920px,calc(100vw-2rem))] gap-0 overflow-hidden rounded-none border border-foreground bg-[#12151a] p-0 text-[#ececec] sm:max-w-[min(920px,calc(100vw-2rem))]"
                showCloseButton
            >
                {active ? (
                    <>
                        <DialogHeader className="space-y-1 border-b border-[#2a2f36] px-5 py-4 text-left">
                            <DialogTitle className="text-base text-[#ececec]">
                                How it works · {active.title}
                            </DialogTitle>
                            <DialogDescription className="text-xs text-[#8b919a]">
                                {active.subtitle} · silent · no audio needed
                            </DialogDescription>
                        </DialogHeader>
                        <div className="bg-black p-0">
                            <video
                                key={active.src}
                                src={active.src}
                                poster={active.poster}
                                className="aspect-video w-full"
                                autoPlay
                                loop
                                muted
                                playsInline
                                controls
                            />
                        </div>
                    </>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
