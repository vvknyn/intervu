/**
 * POST /api/resume/pdf — HTML → Chromium/Skia text PDF for For-you / Customize
 * / apply downloads. Client builds zip HTML from ResumeData on-device, then
 * posts it here for print-to-pdf (same pipeline as Job Apply / Playwright gold).
 *
 * Soft-fails when the printed PDF has no extractable text (never pretends success).
 * The posted HTML is used to print the response bytes and is not written to storage.
 */
import { NextResponse } from "next/server";
import { htmlToChromePdf } from "@/lib/resume/chrome-print-pdf";
import { resumeDataToZipHtml } from "@/lib/resume/zip-html";
import type { ResumeData } from "@/types/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_HTML_CHARS = 1_500_000;

const RESUME_PDF_UNAVAILABLE_MESSAGE =
    "Could not generate a text PDF (Chromium print blocked or unavailable). Try again, or download will fall back to the text layout.";

export function buildResumePdfUnavailableBody(): { error: string } {
    return { error: RESUME_PDF_UNAVAILABLE_MESSAGE };
}

async function pdfHasExtractableText(bytes: Buffer): Promise<boolean> {
    try {
        const { extractText } = await import("unpdf");
        const { text } = await extractText(new Uint8Array(bytes));
        return text.join("").replace(/\s+/g, " ").trim().length >= 20;
    } catch {
        return false;
    }
}

export async function POST(request: Request): Promise<NextResponse> {
    let body: { html?: string; data?: ResumeData };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    let html: string | null = null;
    if (typeof body.html === "string" && body.html.includes("resume-page")) {
        html = body.html;
    } else if (body.data && typeof body.data === "object") {
        try {
            html = resumeDataToZipHtml(body.data);
        } catch (err) {
            return NextResponse.json(
                { error: err instanceof Error ? err.message : "Could not build résumé HTML." },
                { status: 400 },
            );
        }
    }

    if (!html) {
        return NextResponse.json(
            { error: "Provide resume-page HTML or ResumeData." },
            { status: 400 },
        );
    }
    if (html.length > MAX_HTML_CHARS) {
        return NextResponse.json({ error: "Résumé HTML too large." }, { status: 413 });
    }

    let pdf: Buffer;
    try {
        pdf = await htmlToChromePdf(html);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Chrome print-to-pdf failed.";
        console.error("[api/resume/pdf]", message);
        return NextResponse.json(buildResumePdfUnavailableBody(), { status: 503 });
    }

    if (!(await pdfHasExtractableText(pdf))) {
        return NextResponse.json(
            {
                error:
                    "Generated PDF has no extractable text. Please re-upload a text résumé or paste text instead — image-only PDFs cannot be used.",
            },
            { status: 422 },
        );
    }

    return new NextResponse(new Uint8Array(pdf), {
        status: 200,
        headers: {
            "Content-Type": "application/pdf",
            "Cache-Control": "no-store",
        },
    });
}
