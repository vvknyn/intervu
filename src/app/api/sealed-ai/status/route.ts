import { NextResponse } from "next/server";
import { sealedAiAccess } from "@/lib/sealed-ai/access";
import { sealedAiKey, sealedAiModel } from "@/lib/sealed-ai/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/sealed-ai/status — whether résumé rewriting and reading can use
 * sealed AI (Tinfoil) for THIS visitor, and which model. Off when the box has no
 * `TINFOIL_API_KEY`, and off for anyone who is not signed in with a paid month
 * (the pass-through refuses them): the browser then keeps the rules draft and quick read.
 */
export async function GET(): Promise<NextResponse> {
    const enabled = sealedAiKey() !== null && (await sealedAiAccess()) === "ok";
    return NextResponse.json({ enabled, model: sealedAiModel() }, { headers: { "Cache-Control": "no-store, private" } });
}
