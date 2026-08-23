import { revalidatePath } from "next/cache";
import { relativeRedirect } from "@/lib/http/relative-redirect";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
    const supabase = await createClient();
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    // 302, not the helper's 307 default — lets the browser downgrade the
    // replay to GET instead of resubmitting POST /.
    return relativeRedirect("/", 302);
}
