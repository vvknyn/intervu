import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { canonicalMetadata } from "@/lib/seo/page-metadata";

const TITLE = "Contact";
const DESCRIPTION = "Reach the intervu team — questions, feedback, or a listing to correct.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  ...canonicalMetadata("/contact", TITLE, DESCRIPTION),
};

export default function ContactPage() {
  return (
    <main data-testid="contact-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">Contact</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We read everything that comes through here, and we reply from hello@thesubspace.io (Subspace, our job data partner).
        </p>
      </header>

      <ContactForm />

      {/* Status line (docs-mockup.html Comp J / .status): same green-square +
          mono shape as the landing hero's sourcing line (see page.tsx). */}
      <div className="mt-8 flex items-center gap-2.5 text-[13px] tracking-[0.02em] text-muted-foreground">
        <span aria-hidden className="inline-block h-[9px] w-[9px] bg-brand" />
        the intervu team · job data by Subspace
      </div>
    </main>
  );
}
