import Link from "next/link";
import { BrandLockup } from "@/components/brand/BrandMark";
import { RouteStatusLayout, RouteStatusPanel } from "@/components/layout/route-status-chrome";
import { Button } from "@/components/ui/button";

/**
 * Branded 404. Renders inside the root layout/app shell, so it inherits the
 * design tokens from globals.css.
 */
export default function NotFound() {
    return (
        <RouteStatusLayout>
            <RouteStatusPanel className="text-center">
                <BrandLockup className="mx-auto w-fit" />
                <p className="mt-4 text-xs text-muted-foreground">404</p>
                <h1 className="mt-1 text-title-sm font-semibold text-foreground">Page not found</h1>
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
