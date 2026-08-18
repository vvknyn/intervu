import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Application Session",
  description: "Watch your live job application session.",
  robots: { index: false, follow: false },
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
