import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/constants";

/**
 * /manifest.webmanifest — served automatically by Next's file convention.
 * Icons: 192/512 from scripts/generate-favicons.mjs (derived from
 * public/velai-logo.png = locked product mark) plus the sized pack under
 * /icons/velai-icon-*.png for denser PWA / home-screen coverage.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#0B0D12",
    theme_color: "#0B0D12",
    icons: [
      { src: "/icons/velai-icon-16.png", sizes: "16x16", type: "image/png" },
      { src: "/icons/velai-icon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/icons/velai-icon-64.png", sizes: "64x64", type: "image/png" },
      { src: "/icons/velai-icon-128.png", sizes: "128x128", type: "image/png" },
      { src: "/icons/velai-icon-152.png", sizes: "152x152", type: "image/png" },
      { src: "/icons/velai-icon-180.png", sizes: "180x180", type: "image/png" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/velai-icon-256.png", sizes: "256x256", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/velai-icon-1024.png", sizes: "1024x1024", type: "image/png" },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
