"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
    buildHandoffUrl,
    buildJobMcpHandoffPrompt,
    clearHandoffClient,
    getSavedHandoffClient,
    saveHandoffClient,
    type JobHandoffInput,
    type McpHandoffClient,
} from "@/lib/mcp/job-handoff";
import { toast } from "@/lib/toast";

const CLIENT_LABEL: Record<McpHandoffClient, string> = {
    claude: "Claude",
    chatgpt: "ChatGPT",
};

function openHandoff(client: McpHandoffClient, job: JobHandoffInput) {
    const prompt = buildJobMcpHandoffPrompt(job);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(prompt).catch(() => {});
        }
    } catch {}
    
    const url = buildHandoffUrl(client, job);
    window.open(url, "_blank", "noopener,noreferrer");
    toast.success(`Opening ${CLIENT_LABEL[client]} with job context`);
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

    if (chooserOpen && !savedClient) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(CLIENT_LABEL) as McpHandoffClient[]).map((client) => (
                    <button
                        key={client}
                        type="button"
                        onClick={() => pickClient(client)}
                        className="ctl-md inline-flex items-center justify-center rounded-none border border-border bg-background px-3 text-xs text-foreground hover:bg-muted transition-colors cursor-pointer"
                    >
                        {CLIENT_LABEL[client]}
                    </button>
                ))}
                <p className="text-xs text-muted-foreground">
                    First time?{" "}
                    <Link href="/connect" className="font-semibold text-foreground underline underline-offset-4 hover:opacity-80">
                        Connect once
                    </Link>
                </p>
            </div>
        );
    }

    if (savedClient) {
        return (
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={handlePrimary}
                    className="ctl-md inline-flex items-center justify-center rounded-none bg-brand px-3 text-xs font-semibold text-brand-foreground hover:bg-brand transition-colors cursor-pointer"
                >
                    Open in {CLIENT_LABEL[savedClient]}
                </button>
                <button
                    type="button"
                    onClick={handleSwitch}
                    className="text-xs text-foreground underline underline-offset-4 hover:opacity-80 cursor-pointer"
                >
                    Switch AI
                </button>
            </div>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            <button
                type="button"
                onClick={handlePrimary}
                className="ctl-md inline-flex items-center justify-center rounded-none bg-brand px-3.5 text-xs font-semibold text-brand-foreground hover:bg-brand transition-colors cursor-pointer"
            >
                Open in your AI
            </button>
        </div>
    );
}
