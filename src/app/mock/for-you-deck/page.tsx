import type { Metadata } from "next";
import { ForYouDeckMockLoader } from "@/components/mock/ForYouDeckMockLoader";

export const metadata: Metadata = {
    title: "For-you deck mock — Velai",
    robots: { index: false, follow: false },
};

/** Dev-only deck fixture — gated by `src/app/mock/layout.tsx`. */
export default function ForYouDeckMockPage() {
    return <ForYouDeckMockLoader />;
}
