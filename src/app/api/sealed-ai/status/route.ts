import { NextResponse } from "next/server";
import { sealedAiKey, sealedAiModel } from "@/lib/sealed-ai/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/sealed-ai/status — whether résumé rewriting and reading can use
 * sealed AI (Tinfoil) on this server, and which model. Off when the box has no
 * `TINFOIL_API_KEY`: the browser then keeps the rules draft and quick read.
 */
export function GET(): NextResponse {
    return NextResponse.json(
        { enabled: sealedAiKey() !== null, model: sealedAiModel() },
        { headers: { "Cache-Control": "no-store" } },
    );
}
