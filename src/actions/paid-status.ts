"use server";

import { getServerUser } from "@/lib/auth/server-user";
import { hasPaidAccess } from "@/lib/billing/access";

/**
 * Whether this session's account has paid time now, so the browser can keep a
 * résumé on the device instead of sending text the server would refuse anyway.
 * A guest is unpaid; a failed read is `{error}`, which the client treats as
 * unpaid. Every server gate stays; this only spares the send.
 */
export async function fetchPaidStatusAction(): Promise<{ paid?: boolean; error?: string }> {
    const user = await getServerUser();
    if (!user) return { paid: false };
    try {
        return { paid: await hasPaidAccess(user.uid) };
    } catch {
        return { error: "Couldn't check paid time" };
    }
}
