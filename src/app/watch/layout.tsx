import type { Metadata } from "next";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
  title: "Live Application Session",
  description: "Watch your live job application session.",
  ...robotsMetadataFor("/watch"),
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
