"use server";

import { BANNER_QUOTES, pickRandom } from "@/lib/copy";

// Returns a random quirky quote string.
// Kept as a server action in case we re-introduce an external API later.
export async function fetchQuote(): Promise<string> {
    return pickRandom(BANNER_QUOTES);
}
