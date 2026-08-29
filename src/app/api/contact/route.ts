/**
 * POST /api/contact — the contact form's submission endpoint. Deploy-stable
 * (unlike the server action it replaced), so a visitor whose tab predates a
 * deploy still lands here instead of hitting a build-specific action-ID
 * mismatch. All decision logic lives in `submitContact` (src/lib/contact/submit.ts);
 * this handler is just the JSON boundary.
 */
import { NextResponse } from "next/server";
import { submitContact, type ContactSubmitInput } from "@/lib/contact/submit";

export async function POST(request: Request): Promise<NextResponse> {
  let body: Partial<ContactSubmitInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const result = await submitContact({
    name: body.name,
    email: body.email ?? "",
    message: body.message ?? "",
    honeypot: body.honeypot ?? "",
    turnstileToken: body.turnstileToken,
    path: body.path ?? "",
    kind: body.kind,
    context: body.context,
  });

  return NextResponse.json(result, { status: 200 });
}
