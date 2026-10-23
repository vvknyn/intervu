import type { Metadata } from "next";
import { ResumeStatesMockLoader } from "@/components/mock/ResumeStatesMockLoader";

export const metadata: Metadata = {
    title: "Resume states mock",
    robots: { index: false, follow: false },
};

/** Design-conformance proof for /resume's none/parsing/parsed states. */
export default function ResumeStatesMockPage() {
    return <ResumeStatesMockLoader />;
}
