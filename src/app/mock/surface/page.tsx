import type { Metadata } from "next";
import { SurfaceMock } from "@/components/mock/SurfaceMock";

export const metadata: Metadata = {
    title: "Surface mock — Intervu",
    robots: { index: false, follow: false },
};

/** Page-width and page-ground options for /jobs, at true scale, for picking one of each. */
export default function SurfaceMockPage() {
    return <SurfaceMock />;
}
