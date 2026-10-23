import type { Metadata } from "next";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
    title: "Résumé",
    description: "Your base resume and any versions you've tailored for a specific role.",
    ...robotsMetadataFor("/resume"),
};

export default function ResumeLayout({ children }: { children: React.ReactNode }) {
    return children;
}
