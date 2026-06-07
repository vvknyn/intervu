
import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
    console.error("GEMINI_API_KEY is not set. Export it before running this script.");
    process.exit(1);
}

async function listModels() {
    console.log("Listing Gemini Models...");
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`);
        const data = await response.json();

        if (data.models) {
            console.log("Available Models (All):");
            data.models.forEach((m: any) => {
                console.log(`- ${m.name}`);
            });
        } else {
            console.error("No models found or error:", data);
        }
    } catch (e: any) {
        console.error("❌ Failed to list models:", e.message);
    }
}

listModels();
