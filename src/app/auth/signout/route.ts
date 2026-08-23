import { clearSessionCookie } from "@/lib/firebase/auth-session";
import { revalidatePath } from "next/cache";
import { relativeRedirect } from "@/lib/http/relative-redirect";

export async function POST() {
    await clearSessionCookie();
    revalidatePath("/", "layout");
    // 302, not the helper's 307 default — lets the browser downgrade the
    // replay to GET instead of resubmitting POST /.
    return relativeRedirect("/", 302);
}
