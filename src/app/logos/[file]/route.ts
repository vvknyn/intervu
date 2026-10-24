import { proxyLogo } from "@/lib/companies/logo-proxy";

/** GET /logos/<domain>.png — first-party company logo (see lib/companies/logo-proxy.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  return proxyLogo((await params).file);
}
