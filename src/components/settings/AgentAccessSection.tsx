"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast, confirmToast } from "@/lib/toast";
import { AGENT, claudeCodeConnectCommand, chatAppConnectInstruction } from "@/lib/agent/config";
import type { User } from "@/lib/firebase/client-auth";
import {
    listAgentCredentialsAction,
    createManualTokenAction,
    revokeAgentCredentialAction,
    type AgentCredentialSummary,
} from "@/actions/agent-access";
import { Copy, Check, Trash, CircleNotch, WarningCircle } from "@phosphor-icons/react";

function formatDate(ts: number | null): string {
    if (ts == null) return "Never used";
    return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** Manual tokens carry no client name (there's no OAuth client to name them
 *  after); everything else came from an OAuth exchange, so its clientName is
 *  the one meaningful "who is this" a user can recognize. */
function displayName(c: AgentCredentialSummary): string {
    if (c.kind === "manual") return "Personal access token";
    return c.clientName ?? "Unknown client";
}

function kindLabel(c: AgentCredentialSummary): string {
    return c.kind === "manual" ? "Manual token" : "OAuth connection";
}

function CopyButton({ value, label }: { value: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 shrink-0"
            onClick={async () => {
                await navigator.clipboard.writeText(value);
                setCopied(true);
                toast.success("Copied");
                setTimeout(() => setCopied(false), 2000);
            }}
        >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {label}
        </Button>
    );
}

interface AgentAccessSectionProps {
    user: User | null;
    onLoginClick: () => void;
}

/**
 * Settings section: lets a user see and manage the AI agents (Claude Code,
 * Claude.ai custom connectors, etc.) connected to their intervu account, mint
 * a manual token by hand, and revoke access. Mirrors ConnectionCard.tsx's
 * card styling and SettingsContainer's section/divider conventions.
 */
export function AgentAccessSection({ user, onLoginClick }: AgentAccessSectionProps) {
    const [credentials, setCredentials] = useState<AgentCredentialSummary[] | null>(null);
    const [generating, setGenerating] = useState(false);
    const [newSecret, setNewSecret] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);

    const loadCredentials = useCallback(async () => {
        // Right after a fresh sign-in, the client's `user` can flip truthy a
        // beat before the server session cookie finishes syncing (see
        // syncSessionCookie in client-auth.ts) — this component only ever
        // calls the action once it already believes the user is logged in,
        // so an "Unauthorized" here always means that cookie race, never a
        // real permission denial. Retry briefly instead of flashing a false
        // error for a login that's still completing.
        for (let attempt = 0; attempt < 4; attempt++) {
            const res = await listAgentCredentialsAction();
            if (!res.error) {
                setCredentials(res.data ?? []);
                return;
            }
            if (attempt < 3) await new Promise((r) => setTimeout(r, 400));
        }
        toast.error("Couldn't load your connected agents. Try refreshing the page.");
        setCredentials([]);
    }, []);

    useEffect(() => {
        if (!user) {
            setCredentials(null);
            return;
        }
        loadCredentials();
    }, [user, loadCredentials]);

    const handleGenerate = async () => {
        setGenerating(true);
        try {
            const res = await createManualTokenAction();
            if (res.error || !res.secret) {
                toast.error(res.error || "Couldn't create a token. Try again.");
                return;
            }
            setNewSecret(res.secret);
            await loadCredentials();
        } finally {
            setGenerating(false);
        }
    };

    const handleRevoke = async (credential: AgentCredentialSummary) => {
        const ok = await confirmToast({
            title: `Disconnect ${displayName(credential)}?`,
            description: "It won't be able to reach your intervu account anymore. You can always connect it again later.",
            confirmLabel: "Disconnect",
            destructive: true,
        });
        if (!ok) return;

        setRevokingId(credential.id);
        try {
            const res = await revokeAgentCredentialAction(credential.id);
            if (res.error) {
                toast.error(res.error);
                return;
            }
            setCredentials((prev) => (prev ?? []).filter((c) => c.id !== credential.id));
            toast.success("Disconnected");
        } finally {
            setRevokingId(null);
        }
    };

    if (!user) {
        return (
            <section className="pt-6 border-t border-border">
                <h2 className="text-lg font-semibold mb-1">Connected agents</h2>
                <p className="text-sm text-muted-foreground">
                    <button onClick={onLoginClick} className="underline text-brand hover:text-brand/80">
                        login
                    </button>{" "}
                    to connect Claude or another AI agent to your intervu account.
                </p>
            </section>
        );
    }

    const mcpUrl = `${AGENT.issuer()}/api/mcp`;
    const chatAppInstruction = chatAppConnectInstruction();

    return (
        <section className="pt-6 border-t border-border">
            <h2 className="text-lg font-semibold mb-1">Connected agents</h2>
            <p className="text-sm text-muted-foreground mb-4">
                Let Claude or another AI agent search jobs and update your tracker on your behalf. It can never see your
                resume, stories, or anything else in your account.
            </p>

            <div className="space-y-2 mb-6">
                {credentials === null && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <CircleNotch size={16} className="animate-spin" />
                        Loading...
                    </div>
                )}

                {credentials !== null && credentials.length === 0 && (
                    <p className="text-sm text-muted-foreground">No agents connected yet.</p>
                )}

                {credentials?.map((c) => (
                    <div
                        key={c.id}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                    >
                        <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{displayName(c)}</p>
                            <p className="text-xs text-muted-foreground">
                                {kindLabel(c)} · connected {formatDate(c.createdAt)} · last used {formatDate(c.lastUsedAt)}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2.5 shrink-0 text-muted-foreground hover:text-destructive"
                            disabled={revokingId === c.id}
                            onClick={() => handleRevoke(c)}
                        >
                            {revokingId === c.id ? <CircleNotch size={13} className="animate-spin" /> : <Trash size={13} />}
                            Revoke
                        </Button>
                    </div>
                ))}
            </div>

            <div className="mb-6">
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
                    {generating ? <CircleNotch size={14} className="animate-spin" /> : null}
                    {generating ? "Generating..." : "Generate manual token"}
                </Button>

                {newSecret && (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                        <p className="text-xs font-medium flex items-center gap-1.5 text-amber-600 dark:text-amber-500">
                            <WarningCircle size={14} weight="fill" />
                            Copy this now — we can&apos;t show it to you again.
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-1.5 text-xs font-mono">
                                {newSecret}
                            </code>
                            <CopyButton value={newSecret} label="Copy" />
                        </div>
                        <button
                            onClick={() => setNewSecret(null)}
                            className="text-xs text-muted-foreground underline hover:text-foreground"
                        >
                            Done, I saved it
                        </button>
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-border p-4 space-y-3 text-sm">
                <p className="font-medium">Connect an agent</p>
                <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-md bg-muted px-2.5 py-1.5 text-xs font-mono">
                        {mcpUrl}
                    </code>
                    <CopyButton value={mcpUrl} label="Copy URL" />
                </div>
                <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                    <li>
                        <span className="text-foreground font-medium">Claude Code:</span>{" "}
                        <code className="font-mono">{claudeCodeConnectCommand(mcpUrl)}</code>
                    </li>
                    <li>
                        <span className="text-foreground font-medium">Chat apps with custom connectors:</span>{" "}
                        {chatAppInstruction.primary} {chatAppInstruction.alternate}
                    </li>
                </ul>
                <a href="/agents" className="inline-block text-xs text-brand underline hover:text-brand/80">
                    Full setup instructions →
                </a>
            </div>
        </section>
    );
}
