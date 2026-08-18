import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Job Application Tracker",
  description: "Track your job applications, interviews, and offers in one private workspace.",
  robots: { index: false, follow: false },
};

export default function YoursLayout({ children }: { children: React.ReactNode }) {
  return children;
}
