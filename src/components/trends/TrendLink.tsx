import type { ComponentProps } from "react";
import Link from "next/link";

/** A /trends link into the /jobs search: those URLs are robots-blocked, so crawlers are told not to follow them. */
export function TrendLink(props: ComponentProps<typeof Link>) {
  return <Link rel="nofollow" {...props} />;
}
