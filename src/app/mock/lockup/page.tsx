import type { Metadata } from "next";
import { LockupMock } from "@/components/mock/LockupMock";

export const metadata: Metadata = {
    title: "Lockup mock",
    robots: { index: false, follow: false },
};

/** Four header lockup directions at true scale, for picking one. */
export default function LockupMockPage() {
    return <LockupMock />;
}
