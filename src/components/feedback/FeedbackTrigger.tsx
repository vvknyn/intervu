"use client";

import { usePathname } from "next/navigation";
import { ChatTeardropText } from "@phosphor-icons/react";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { shouldHideSiteChrome } from "@/components/layout/should-hide-site-chrome";

export function FeedbackTrigger() {
    const pathname = usePathname();

    if (shouldHideSiteChrome(pathname)) return null;

    return (
        <div
            data-testid="floating-feedback-trigger"
            className="fixed right-4 z-40 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] lg:right-6 lg:bottom-6"
        >
            <FeedbackModal>
                <button
                    type="button"
                    aria-label="Send feedback"
                    className="inline-flex items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
                >
                    <ChatTeardropText size={16} weight="bold" />
                    <span>Feedback</span>
                </button>
            </FeedbackModal>
        </div>
    );
}
