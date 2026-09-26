import type { Metadata } from "next";
import { OnboardingMock } from "@/components/mock/OnboardingMock";

export const metadata: Metadata = {
    title: "Onboarding & Profile Mock — Velai",
    robots: { index: false, follow: false },
};

export default function OnboardingMockPage() {
    return <OnboardingMock />;
}
