import type { Metadata } from "next";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
  title: "Job Application Tracker",
  description: "Track your job applications, interviews, and offers in one private workspace.",
  ...robotsMetadataFor("/yours"),
};

export default function YoursLayout({ children }: { children: React.ReactNode }) {
  return children;
}
