/**
 * Pure OS sniff from a User-Agent string. Used by /connect to decide what
 * the OpenClaw tab shows — the local agent's install command on a Mac, or a
 * plain-language "not today" band everywhere else (see connect-client.tsx).
 * Never used to gate anything security-sensitive: UA strings are trivially
 * spoofable, so the worst case of a wrong guess is showing the wrong copy,
 * not a broken permission boundary.
 *
 * Known accepted quirk: iPadOS's default desktop-mode Safari sends the same
 * UA as real macOS ("Macintosh; Intel Mac OS X …", no "iPad" token at all),
 * so a modern iPad reads as "mac" here. Accepted — the OpenClaw path is
 * Mac-only regardless, and misrouting an iPad into the Mac copy is a smaller
 * wrong than misrouting a real Mac laptop into the "not today" band.
 */
export type DetectedPlatform = "mac" | "windows" | "linux" | "other";

const MOBILE_TOKEN = /iphone|ipod|ipad|android/i;
const WINDOWS_TOKEN = /windows/i;
const MAC_TOKEN = /mac os x|macintosh/i;
const LINUX_TOKEN = /linux/i;

export function detectPlatform(ua: string): DetectedPlatform {
  if (!ua) return "other";
  // Checked first: iPhone UAs contain "like Mac OS X", and Android UAs
  // contain "Linux" — both would otherwise be misread by the checks below.
  if (MOBILE_TOKEN.test(ua)) return "other";
  if (WINDOWS_TOKEN.test(ua)) return "windows";
  if (MAC_TOKEN.test(ua)) return "mac";
  if (LINUX_TOKEN.test(ua)) return "linux";
  return "other";
}
