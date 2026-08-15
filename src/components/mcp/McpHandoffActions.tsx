"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
    buildHandoffUrl,
    clearHandoffClient,
    getSavedHandoffClient,
    saveHandoffClient,
    type JobHandoffInput,
    type McpHandoffClient,
} from "@/lib/mcp/job-handoff";

const CLIENT_LABEL: Record<McpHandoffClient, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
};

function openHandoff(client: McpHandoffClient, job: JobHandoffInput) {
    window.open(buildHandoffUrl(client, job), "_blank", "noopener,noreferrer");
}

export function McpHandoffActions({ job }: { job: JobHandoffInput }) {
    const [savedClient, setSavedClient] = useState<McpHandoffClient | null>(null);
    const [chooserOpen, setChooserOpen] = useState(false);

    useEffect(() => {
        setSavedClient(getSavedHandoffClient());
    }, []);

    const pickClient = (client: McpHandoffClient) => {
        saveHandoffClient(client);
        setSavedClient(client);
        setChooserOpen(false);
        openHandoff(client, job);
    };

    const handlePrimary = () => {
        if (savedClient) {
            openHandoff(savedClient, job);
            return;
        }
        setChooserOpen(true);
    };

    const handleSwitch = () => {
        clearHandoffClient();
        setSavedClient(null);
        setChooserOpen(true);
    };

    // Exactly one pairing affordance renders at a time, keyed off savedClient
    // (+ chooserOpen) as mutually exclusive branches on the same state — never
    // independent flags that could both be true. pickClient always clears
    // chooserOpen when it sets savedClient, and handleSwitch always clears
    // savedClient when it opens the chooser, so "chooser open" and "paired"
    // can't coexist.
    if (chooserOpen && !savedClient) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(CLIENT_LABEL) as McpHandoffClient[]).map((client) => (
                    <button
                        key={client}
                        onClick={() => pickClient(client)}
                        className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-800 transition-colors"
                    >
                        {CLIENT_LABEL[client]}
                    </button>
                ))}
                <p className="text-xs text-emerald-900 dark:text-emerald-300">
                    First time?{" "}
                    <Link href="/connect" className="font-bold underline underline-offset-4 hover:text-emerald-950 dark:hover:text-white">
                        Connect once →
                    </Link>
                </p>
            </div>
        );
    }

    if (savedClient) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <button
                    onClick={handlePrimary}
                    className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-800 transition-colors"
                >
                    Open in {CLIENT_LABEL[savedClient]} →
                </button>
                <button
                    type="button"
                    onClick={handleSwitch}
                    className="text-xs font-medium text-emerald-900 underline underline-offset-4 hover:text-emerald-950 dark:text-emerald-300"
                >
                    Switch AI
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                onClick={handlePrimary}
                className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-800 transition-colors"
            >
                Open in your AI →
            </button>
        </div>
    );
}
