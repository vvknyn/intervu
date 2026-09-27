import { ConceptALandingFace } from "@/components/onboarding/ConceptALandingFace";

/** Server-rendered Concept A shell — LCP hero paints from HTML before /jobs JS hydrates. */
export function ConceptALandingStatic() {
    return <ConceptALandingFace id="concept-a-ssr" interactive={false} />;
}
