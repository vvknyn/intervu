import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandLockup } from "@/components/brand/BrandMark";
import { RouteStatusLayout, RouteStatusPanel } from "@/components/layout/route-status-chrome";
import { conceptAEmptyMaxClassName } from "@/components/ui/concept-a-empty-state";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/heading";

/**
 * Branded 404. Renders inside the root layout/app shell, so it inherits the
 * design tokens from globals.css.
 */
export default function NotFound() {
    return (
        <RouteStatusLayout>
            <RouteStatusPanel className={cn(conceptAEmptyMaxClassName, "enter-reveal text-center")}>
                <BrandLockup className="mx-auto w-fit" />
                <p className="mt-4 text-xs text-muted-foreground">404</p>
                <PageTitle className="mt-1">Page not found</PageTitle>
                <p className="mt-2 text-body-sm text-muted-foreground">
                    That page doesn&apos;t exist, or it moved. Let&apos;s get you back on track.
                </p>
                <Button asChild size="sm" className="mt-8">
                    <Link href="/jobs">Go to jobs</Link>
                </Button>
            </RouteStatusPanel>
        </RouteStatusLayout>
    );
}
