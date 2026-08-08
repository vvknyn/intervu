import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo/constants";

/**
 * /manifest.webmanifest — served automatically by Next's file convention.
 * Icons are the 192/512 PNGs scripts/generate-favicons.mjs derives from the
 * brand mark (src/app/icon.svg) alongside favicon.ico and apple-touch-icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#12151a",
    theme_color: "#12151a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
