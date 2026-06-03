import { clearSessionCookie } from "@/lib/firebase/auth-session";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    await clearSessionCookie();
    revalidatePath("/", "layout");
    return NextResponse.redirect(new URL("/", req.url), { status: 302 });
}
