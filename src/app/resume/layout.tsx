import type { Metadata } from "next";

export const metadata: Metadata = {
    title: "Resume",
    description: "Your base resume and any versions you've tailored for a specific role.",
    robots: { index: false, follow: false },
};

export default function ResumeLayout({ children }: { children: React.ReactNode }) {
    return children;
}
