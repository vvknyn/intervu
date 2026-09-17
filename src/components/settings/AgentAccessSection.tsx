"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AUTH_CTA_LABEL } from "@/lib/auth/auth-gate-copy";

function formatDate(ts: number | null): string {
    if (ts == null) return "Never used";
    return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/** `clientName` is the one "who is this" a user can recognize, whether it
 *  came from an OAuth exchange or the user's own label on a manual token
 *  (see `createManualTokenAction`) — shown when set, else a kind-based
 *  fallback for the (still common) unlabeled case. */
function displayName(c: AgentCredentialSummary): string {
    if (c.clientName) return c.clientName;
    return c.kind === "manual" ? "Personal access token" : "Unknown client";
}

function kindLabel(c: AgentCredentialSummary): string {
    return c.kind === "manual" ? "Manual token" : "OAuth connection";
}

const TOKEN_CREATE_ERROR = "Couldn't create a token. Try again.";

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
            {copied ? <Check /> : <Copy />}
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
 * a manual token by hand, and revoke access. Mirrors SettingsContainer's
 * section/divider conventions.
 */
export function AgentAccessSection({ user, onLoginClick }: AgentAccessSectionProps) {
    const [credentials, setCredentials] = useState<AgentCredentialSummary[] | null>(null);
    const [generating, setGenerating] = useState(false);
    const [newSecret, setNewSecret] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [label, setLabel] = useState("");

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
            const res = await createManualTokenAction(label);
            if (res.error || !res.secret) {
                toast.error(res.error || TOKEN_CREATE_ERROR);
                return;
            }
            setNewSecret(res.secret);
            setLabel("");
            await loadCredentials();
        } catch {
            toast.error(TOKEN_CREATE_ERROR);
        } finally {
            setGenerating(false);
        }
    };

    const handleRevoke = async (credential: AgentCredentialSummary) => {
        const ok = await confirmToast({
            title: `Disconnect ${displayName(credential)}?`,
            description:
                credential.kind === "oauth"
                    ? "This disconnects the app entirely, including its ability to silently refresh its own access — it won't be able to reach your velai account anymore. You can always connect it again later."
                    : "It won't be able to reach your velai account anymore. You can always connect it again later.",
            confirmLabel: "Disconnect",
            destructive: true,
        });
        if (!ok) return;

        setRevokingId(credential.id);
        try {
            const res = await revokeAgentCredentialAction(credential.id, credential.kind);
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
                <h2 className="text-base font-semibold mb-1">Connected agents</h2>
                <p className="text-sm text-muted-foreground">
                    <button onClick={onLoginClick} className="underline text-brand hover:text-brand">
                        {AUTH_CTA_LABEL}
                    </button>{" "}
                    to connect Claude or another AI agent to your velai account.
                </p>
            </section>
        );
    }

    const mcpUrl = `${AGENT.issuer()}/api/mcp`;
    const chatAppInstruction = chatAppConnectInstruction();

    return (
        <section className="pt-6 border-t border-border">
            <h2 className="text-base font-semibold mb-1">Connected agents</h2>
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
                        className="flex items-center justify-between gap-4 rounded-none border border-border p-3"
                    >
                        <div className="min-w-0">
                            <p className="text-sm truncate">{displayName(c)}</p>
                            <p className="text-xs text-muted-foreground">
                                {kindLabel(c)} · connected {formatDate(c.createdAt)} · last used {formatDate(c.lastUsedAt)}
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2.5 shrink-0 text-muted-foreground hover:text-danger-text"
                            disabled={revokingId === c.id}
                            onClick={() => handleRevoke(c)}
                        >
                            {revokingId === c.id ? <CircleNotch className="animate-spin" /> : <Trash />}
                            Revoke
                        </Button>
                    </div>
                ))}
            </div>

            <div className="mb-6">
                <div className="flex items-center gap-2">
                    <Input
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.nativeEvent.isComposing && !generating) void handleGenerate();
                        }}
                        placeholder="Label (optional)"
                        aria-label="Token label"
                        maxLength={AGENT.MAX_TOKEN_LABEL_LENGTH}
                        disabled={generating}
                        className="max-w-64"
                    />
                    <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating} className="shrink-0">
                        {generating ? <CircleNotch className="animate-spin" /> : null}
                        {generating ? "Generating..." : "Generate manual token"}
                    </Button>
                </div>

                {newSecret && (
                    <div className="mt-3 rounded-none border border-warn bg-muted p-3 space-y-2">
                        <p className="text-xs flex items-center gap-1.5 text-warn dark:text-warn">
                            <WarningCircle weight="fill" />
                            Copy this now — we can&apos;t show it to you again.
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 min-w-0 truncate rounded-none bg-muted px-2.5 py-1.5 text-xs">
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

            <div className="rounded-none border border-border p-4 space-y-3 text-sm">
                <p className="">Connect an agent</p>
                <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate rounded-none bg-muted px-2.5 py-1.5 text-xs">
                        {mcpUrl}
                    </code>
                    <CopyButton value={mcpUrl} label="Copy URL" />
                </div>
                <ul className="text-xs text-muted-foreground space-y-1.5 list-disc pl-4">
                    <li>
                        <span className="text-foreground">Claude Code:</span>{" "}
                        <code className="">{claudeCodeConnectCommand(mcpUrl)}</code>
                    </li>
                    <li>
                        <span className="text-foreground">Chat apps with custom connectors:</span>{" "}
                        {chatAppInstruction.primary} {chatAppInstruction.alternate}
                    </li>
                </ul>
                <a href="/connect" className="inline-block text-xs text-brand underline hover:text-brand">
                    Full setup instructions
                </a>
            </div>
        </section>
    );
}
