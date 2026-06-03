import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "firebase-session";

export async function middleware(request: NextRequest) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    // Protect /account routes — redirect to landing page if not authenticated
    if (
        !sessionCookie &&
        request.nextUrl.pathname.startsWith("/account")
    ) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
