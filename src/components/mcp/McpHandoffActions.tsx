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

    return (
        <div className="flex flex-col items-end gap-2">
            {chooserOpen && !savedClient ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                    {(Object.keys(CLIENT_LABEL) as McpHandoffClient[]).map((client) => (
                        <Button key={client} variant="outline" size="sm" onClick={() => pickClient(client)}>
                            {CLIENT_LABEL[client]}
                        </Button>
                    ))}
                </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-2">
                {savedClient ? (
                    <button
                        type="button"
                        onClick={handleSwitch}
                        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                    >
                        Switch AI
                    </button>
                ) : null}
                <Button variant="outline" size="sm" onClick={handlePrimary}>
                    Open in your AI →
                </Button>
            </div>
            {/* Single source for the pairing-state line — exactly one of
                {"Switch AI", "Not paired yet?"} may render, both keyed off
                the SAME `savedClient` read above (previously this line lived
                unconditionally in McpHandoffNote, so it showed even when
                "Switch AI" was also on screen, claiming paired AND
                not-paired at once). */}
            {!savedClient && (
                <p className="text-xs text-muted-foreground">
                    Not paired yet?{" "}
                    <Link href="/connect" className="font-medium text-foreground underline underline-offset-4 hover:text-foreground">
                        Connect once →
                    </Link>
                </p>
            )}
        </div>
    );
}
