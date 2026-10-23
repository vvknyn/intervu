import type { Metadata } from "next";
import { robotsMetadataFor } from "@/lib/seo/indexability";

export const metadata: Metadata = {
  ...robotsMetadataFor("/stories"),
};

export default function StoriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
