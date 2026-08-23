"use server";

import Groq from "groq-sdk";
import { getServerUser } from "@/lib/auth/session";
import { AUTH_REQUIRED } from "@/lib/llm/credit-gate";
import { getUserLLMConfig } from "@/actions/profile";

/** Hard cap on uploaded audio size (~25MB) — Groq's whisper API limit, and a
 *  DoS/cost guard against arbitrarily large uploads on the shared key. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(formData: FormData) {
    try {
        // Transcription runs on the shared (app-funded) Groq key, so it requires
        // an account — never spend it for anonymous traffic.
        const user = await getServerUser();
        if (!user) {
            return { error: `${AUTH_REQUIRED}: Sign in to use voice transcription.` };
        }

        const file = formData.get("file") as File;
        if (!file) {
            throw new Error("No file uploaded");
        }

        if (file.size > MAX_AUDIO_BYTES) {
            return { error: "Audio file too large. Please keep recordings under 25MB." };
        }

        // Prefer the user's own Groq key (BYOK) so they're not spending the shared
        // key; fall back to the app-funded GROQ_API_KEY (login already enforced above).
        const userCfg = await getUserLLMConfig();
        const apiKey =
            userCfg?.provider === "groq" && userCfg.apiKey
                ? userCfg.apiKey
                : process.env.GROQ_API_KEY;
        if (!apiKey) {
            throw new Error("Server configuration error: GROQ_API_KEY missing");
        }

        const groq = new Groq({
            apiKey: apiKey,
        });

        const transcription = await groq.audio.transcriptions.create({
            file: file,
            model: "whisper-large-v3-turbo", // or whisper-large-v3 for higher accuracy
            response_format: "json",
            language: "en",
            temperature: 0.0,
        });

        return { text: transcription.text };
    } catch (error: any) {
        console.error("Transcription error:", error);
        return { error: error.message || "Failed to transcribe audio" };
    }
}
