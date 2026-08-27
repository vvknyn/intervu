import { redirect } from "next/navigation";

// One door, one guard: /settings is the sole auth gate (see
// isAuthGatedProductPath in lib/auth/product-routes.ts) — this route carries
// no gate of its own, just a redirect to the real destination.
export default function AccountPage() {
    redirect("/settings?tab=account");
}
