"use server";

import Groq from "groq-sdk";
import { resolveGroqTranscriptionKey } from "@/lib/llm/resolve-config";

/** Hard cap on uploaded audio size (~25MB) — Groq's whisper API limit, and a
 *  DoS/cost guard against arbitrarily large uploads on the shared key. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export async function transcribeAudio(formData: FormData) {
    try {
        const file = formData.get("file") as File;
        if (!file) {
            throw new Error("No file uploaded");
        }

        if (file.size > MAX_AUDIO_BYTES) {
            return { error: "Audio file too large. Please keep recordings under 25MB." };
        }

        const apiKey = await resolveGroqTranscriptionKey();

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
