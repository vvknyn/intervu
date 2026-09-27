import { JOBS_ONBOARDING_FIRST_PAINT_SCRIPT } from "@/lib/jobs/onboarding-first-paint";
import { ConceptALandingStatic } from "@/components/onboarding/ConceptALandingStatic";
import { JOBS_LANDING_CRITICAL_CSS } from "@/app/jobs/jobs-landing-critical.css";

export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <style dangerouslySetInnerHTML={{ __html: JOBS_LANDING_CRITICAL_CSS }} />
            <script dangerouslySetInnerHTML={{ __html: JOBS_ONBOARDING_FIRST_PAINT_SCRIPT }} />
            <link rel="preload" href="/velai-logo.png" as="image" fetchPriority="high" />
            <ConceptALandingStatic />
            {children}
        </>
    );
}
