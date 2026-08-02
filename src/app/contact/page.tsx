import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";

export const metadata: Metadata = {
  title: "Contact",
  description: "Reach the intervu team — questions, feedback, or a listing to correct.",
};

export default function ContactPage() {
  return (
    <main data-testid="contact-page" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-display font-extrabold text-foreground">Contact</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We read everything that comes through here, and we reply from hello@intervu.cc.
        </p>
      </header>

      <ContactForm />
    </main>
  );
}
