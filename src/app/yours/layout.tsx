import type { Metadata } from "next";
import { connection } from "next/server";
import { getServerUser } from "@/lib/auth/server-user";
import { LANDED_PLEDGE_URL_ENV, checkoutUrlWithBuyer } from "@/lib/billing/founding-offer";
import { PledgeProvider } from "@/lib/billing/pledge-context";

export const metadata: Metadata = {
  title: "Job Application Tracker",
  description: "Track your job applications, interviews, and offers in one private workspace.",
  robots: { index: false, follow: false },
};

/**
 * Server shell for the client tracker: resolves the pay-it-forward pledge
 * link (server-only env var, buyer reference attached for a signed-in
 * account) once per request and provides it to the pursuit detail sheet.
 * `connection()` keeps this per request rather than baked at build, so
 * setting the env var and restarting the container is enough (DEPLOY.md).
 */
export default async function YoursLayout({ children }: { children: React.ReactNode }) {
  await connection();
  const user = await getServerUser();
  const pledgeUrl = checkoutUrlWithBuyer(
    process.env[LANDED_PLEDGE_URL_ENV],
    user ? { uid: user.uid, email: user.email } : null,
  );
  return <PledgeProvider url={pledgeUrl}>{children}</PledgeProvider>;
}
