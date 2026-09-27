import { JOBS_ONBOARDING_FIRST_PAINT_SCRIPT } from "@/lib/jobs/onboarding-first-paint";
import { ConceptALandingStatic } from "@/components/onboarding/ConceptALandingStatic";

export default function JobsLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <script dangerouslySetInnerHTML={{ __html: JOBS_ONBOARDING_FIRST_PAINT_SCRIPT }} />
            <link rel="preload" href="/velai-logo.png" as="image" fetchPriority="high" />
            <ConceptALandingStatic />
            {children}
        </>
    );
}
