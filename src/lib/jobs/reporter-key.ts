import { createHmac } from "node:crypto";
import { UNKNOWN_CLIENT_IP } from "@/lib/shield/client-ip";

/**
 * The flags endpoint dedupes and caps by a caller-supplied `reporter_key`
 * (unique (job_url, reporter_key); 20 flags / 24h per key). The browser never
 * supplies it: a signed-in reporter is their uid, an anonymous one is an
 * HMAC of the client IP — stable per visitor, not reversible, and
 * server-derived so it can't be rotated by editing the request. `null` when
 * there is neither a user nor a usable IP, so the caller refuses instead of
 * pooling every unidentifiable visitor under one key.
 */
export function resolveReporterKey(uid: string | null, ip: string, secret: string): string | null {
  if (uid) return uid;
  if (ip === UNKNOWN_CLIENT_IP) return null;
  return `anon:${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32)}`;
}
