import type { Metadata } from "next";
import { Suspense } from "react";
import { ContactForm } from "@/components/contact/ContactForm";
import { WaitState } from "@/components/ui/wait-state";
import { canonicalMetadata } from "@/lib/seo/page-metadata";
import { PUBLIC_SUPPORT_EMAIL } from "@/lib/legal/public-contact";

const TITLE = "Contact";
const DESCRIPTION = "Reach the velai team — questions, feedback, or a listing to correct.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/contact", TITLE, DESCRIPTION),
};

export default function ContactPage() {
  return (
    <div data-testid="contact-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-title-lg font-semibold text-foreground">Contact</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We read everything that comes through here, and we reply from {PUBLIC_SUPPORT_EMAIL} (Subspace, our job data partner).
        </p>
      </header>

      <Suspense fallback={<WaitState label="Loading contact form" fill className="bg-background" />}>
        <ContactForm />
      </Suspense>

      {/* Status line (docs-mockup.html Comp J / .status): same green-square +
          mono shape as the landing hero's sourcing line (see page.tsx). */}
      <div className="mt-8 flex items-center gap-2.5 text-xs text-muted-foreground">
        <span aria-hidden className="inline-block h-[9px] w-[9px] bg-brand" />
        the velai team · job data by Subspace
      </div>
    </div>
  );
}
