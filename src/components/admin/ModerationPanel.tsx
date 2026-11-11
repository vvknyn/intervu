"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WaitState } from "@/components/ui/wait-state";
import { settleAction } from "@/lib/load-result";
import {
    listModerationLogAction,
    previewDomainAction,
    previewListingAction,
    rejectDomainAction,
    removeListingAction,
    undoModerationAction,
    type ModerationActionResult,
} from "@/actions/admin-moderation";
import {
    DOMAIN_REASON_OPTIONS,
    LISTING_REASON_OPTIONS,
    NOTE_MAX,
    parseListingRef,
    type DomainPreview,
    type DomainReason,
    type ListingPreview,
    type ListingReason,
    type ModerationLogRow,
} from "@/lib/admin/moderation";

/**
 * /admin → Remove listings and domains. Everything here is soft: a listing is
 * closed and hidden, a domain's board is rejected and its listings closed, and
 * each row in Recent actions has an Undo. The server action behind every button
 * re-checks that the caller is an admin; this panel is only reachable behind
 * /admin's own gate.
 */

/** Closing a big domain can take Subspace a while (the server waits up to two minutes); the default 30s ceiling would report a failure while it is still working. */
const REJECT_DOMAIN_CEILING_MS = 130_000;

type Outcome<T> = { ok: true; data: T } | { ok: false; message: string };

/** Turns what settleAction returned (the action's own result, or its `{ error }`) into one shape for the UI. */
function outcome<T>(res: ModerationActionResult<T> | { error: string }): Outcome<T> {
    if ("error" in res) return { ok: false, message: String(res.error) };
    switch (res.kind) {
        case "ok":
            return { ok: true, data: res.data };
        case "forbidden":
            return { ok: false, message: "Your account isn't an admin." };
        case "unavailable":
            return { ok: false, message: "Admin moderation isn't configured on this server." };
        case "error":
            return { ok: false, message: res.message };
    }
}

const ACTION_LABEL: Record<ModerationLogRow["action"], string> = {
    close_listing: "Removed listing",
    restore_listing: "Restored listing",
    reject_domain: "Blocked domain",
    restore_domain: "Restored domain",
};

function Notice({ tone, children, testId }: { tone: "ok" | "error"; children: React.ReactNode; testId?: string }) {
    return (
        <p data-testid={testId} className={tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {children}
        </p>
    );
}

function ReasonSelect<V extends string>({
    id,
    value,
    onChange,
    options,
}: {
    id: string;
    value: V;
    onChange: (v: V) => void;
    options: ReadonlyArray<{ value: V; label: string }>;
}) {
    return (
        <Select value={value} onValueChange={(v) => onChange(v as V)}>
            <SelectTrigger id={id} size="sm" className="sm:max-w-xs">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function RemoveListingCard({ onChanged }: { onChanged: () => void }) {
    const [ref, setRef] = useState("");
    const [preview, setPreview] = useState<ListingPreview | null>(null);
    const [reason, setReason] = useState<ListingReason>("not_a_job");
    const [note, setNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

    const lookUp = async () => {
        setBusy(true);
        setMsg(null);
        setPreview(null);
        const r = outcome(await settleAction(previewListingAction(ref)));
        if (r.ok) setPreview(r.data);
        else setMsg({ tone: "error", text: r.message });
        setBusy(false);
    };

    const remove = async () => {
        if (!preview) return;
        setBusy(true);
        const r = outcome(await settleAction(removeListingAction({ jobId: preview.listing.id, reason, note })));
        if (r.ok) {
            setMsg({ tone: "ok", text: r.data.already_removed ? "It was already removed." : "Removed. It leaves search within a few minutes." });
            setPreview(null);
            setRef("");
            setNote("");
            onChanged();
        } else {
            setMsg({ tone: "error", text: r.message });
        }
        setBusy(false);
    };

    return (
        <Card className="gap-4 p-4 sm:p-6" data-testid="admin-remove-listing-card">
            <h3 className="text-sm font-semibold">Remove a listing</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    aria-label="Job link or id"
                    placeholder="Paste a Velai job link or its id"
                    value={ref}
                    onChange={(e) => {
                        setRef(e.target.value);
                        setPreview(null);
                    }}
                />
                <Button type="button" variant="outline" onClick={lookUp} disabled={busy || !parseListingRef(ref)}>
                    Look up
                </Button>
            </div>
            {preview && (
                <div className="space-y-3" data-testid="admin-listing-preview">
                    <div className="rounded-ctl border border-border p-3 text-sm">
                        <p className="font-medium">{preview.listing.title ?? "(untitled)"}</p>
                        <p className="text-muted-foreground">
                            {[preview.listing.company, preview.listing.company_domain, preview.listing.vacancy_status].filter(Boolean).join(" · ")}
                        </p>
                        {preview.already_removed && <p className="mt-1 text-muted-foreground">Already removed by an admin.</p>}
                    </div>
                    <ReasonSelect id="admin-listing-reason" value={reason} onChange={setReason} options={LISTING_REASON_OPTIONS} />
                    <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} placeholder="Note (optional)" rows={2} />
                    <Button type="button" onClick={remove} disabled={busy || preview.already_removed}>
                        Remove listing
                    </Button>
                </div>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </Card>
    );
}

function BlockDomainCard({ onChanged }: { onChanged: () => void }) {
    const [domain, setDomain] = useState("");
    const [reason, setReason] = useState<DomainReason>("classifieds_or_marketplace");
    const [note, setNote] = useState("");
    const [preview, setPreview] = useState<DomainPreview | null>(null);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

    const look = async () => {
        setBusy(true);
        setMsg(null);
        setPreview(null);
        const r = outcome(await settleAction(previewDomainAction({ domain, reason })));
        if (r.ok) setPreview(r.data);
        else setMsg({ tone: "error", text: r.message });
        setBusy(false);
    };

    const apply = async () => {
        if (!preview) return;
        setBusy(true);
        const r = outcome(await settleAction(rejectDomainAction({ domain: preview.domain, reason, note, expectOpenListings: preview.open_listings }), REJECT_DOMAIN_CEILING_MS));
        if (r.ok) {
            setMsg({
                tone: "ok",
                text: `Blocked ${r.data.domain}. Closed ${r.data.closed}, ${r.data.remaining_open_listings} still open. They leave search within a few minutes.`,
            });
            setPreview(null);
            setDomain("");
            setNote("");
            onChanged();
        } else {
            setMsg({ tone: "error", text: r.message });
        }
        setBusy(false);
    };

    return (
        <Card className="gap-4 p-4 sm:p-6" data-testid="admin-block-domain-card">
            <h3 className="text-sm font-semibold">Mark a domain as not an employer</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                    aria-label="Domain"
                    placeholder="example.com"
                    value={domain}
                    onChange={(e) => {
                        setDomain(e.target.value);
                        setPreview(null);
                    }}
                />
                <ReasonSelect
                    id="admin-domain-reason"
                    value={reason}
                    onChange={(v) => {
                        setReason(v);
                        setPreview(null);
                    }}
                    options={DOMAIN_REASON_OPTIONS}
                />
                <Button type="button" variant="outline" onClick={look} disabled={busy || !domain.trim()}>
                    Preview
                </Button>
            </div>
            {preview && (
                <div className="space-y-3" data-testid="admin-domain-preview">
                    <div className="rounded-ctl border border-border p-3 text-sm">
                        <p className="font-medium">{preview.domain}</p>
                        <p className="text-muted-foreground">
                            {preview.board.exists
                                ? `Board ${preview.board.status}${preview.board.company_name ? ` as "${preview.board.company_name}"` : ""}`
                                : "No board yet; one will be created as rejected"}
                            {" · "}
                            {preview.open_listings.toLocaleString()} open listing{preview.open_listings === 1 ? "" : "s"}
                        </p>
                        {preview.sample.length > 0 && (
                            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                                {preview.sample.map((s) => (
                                    <li key={s.id}>{s.title ?? "(untitled)"}</li>
                                ))}
                            </ul>
                        )}
                        {preview.already_rejected && <p className="mt-2 text-muted-foreground">Already rejected. Applying again closes anything still open.</p>}
                    </div>
                    <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} placeholder="Note (optional)" rows={2} />
                    <Button type="button" variant="destructive" onClick={apply} disabled={busy}>
                        {`Close ${preview.open_listings.toLocaleString()} listing${preview.open_listings === 1 ? "" : "s"} and block ${preview.domain}`}
                    </Button>
                </div>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </Card>
    );
}

type Tone = "ok" | "error";

function RecentActionsCard({
    rows,
    loading,
    error,
    onUndo,
}: {
    rows: ModerationLogRow[];
    loading: boolean;
    error: string | null;
    onUndo: (row: ModerationLogRow) => Promise<{ tone: Tone; text: string } | null>;
}) {
    const [pending, setPending] = useState<number | null>(null);
    const [msg, setMsg] = useState<{ tone: Tone; text: string } | null>(null);

    const undo = async (row: ModerationLogRow) => {
        setPending(row.id);
        setMsg(null);
        setMsg(await onUndo(row));
        setPending(null);
    };

    return (
        <Card className="gap-4 p-4 sm:p-6" data-testid="admin-recent-actions">
            <h3 className="text-sm font-semibold">Recent actions</h3>
            {loading ? (
                <WaitState label="Loading actions" fill className="min-h-0 py-6 text-xs text-muted-foreground" />
            ) : error ? (
                <Notice tone="error">{error}</Notice>
            ) : rows.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Nothing removed yet.</p>
            ) : (
                <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                    {rows.map((row) => {
                        const undoable = (row.action === "close_listing" || row.action === "reject_domain") && !row.undone_at;
                        return (
                            <li key={row.id} className="flex items-start justify-between gap-3 rounded-ctl border border-border p-3 text-sm">
                                <div className="min-w-0">
                                    <p className="font-medium">
                                        {ACTION_LABEL[row.action]}
                                        {row.undone_at ? " (undone)" : ""}
                                    </p>
                                    <p className="truncate text-muted-foreground" title={row.target}>
                                        {row.target}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {new Date(row.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                        {" · "}
                                        {row.reason.replace(/_/g, " ")}
                                        {row.affected > 0 ? ` · ${row.affected.toLocaleString()} closed` : ""}
                                        {row.note ? ` · ${row.note}` : ""}
                                    </p>
                                </div>
                                {undoable && (
                                    <Button type="button" variant="outline" size="sm" disabled={pending === row.id} onClick={() => void undo(row)} data-testid="admin-undo">
                                        Undo
                                    </Button>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        </Card>
    );
}

export function ModerationPanel() {
    const [rows, setRows] = useState<ModerationLogRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Bumped to ask for another read of the log (after a removal, a block or an undo).
    const [reads, setReads] = useState(0);
    const reload = useCallback(() => setReads((n) => n + 1), []);

    // State is set only in the read's callback, never synchronously in the effect.
    useEffect(() => {
        let current = true;
        void settleAction(listModerationLogAction()).then((res) => {
            if (!current) return;
            const r = outcome(res);
            if (r.ok) {
                setRows(r.data);
                setError(null);
            } else {
                setError(r.message);
            }
            setLoading(false);
        });
        return () => {
            current = false;
        };
    }, [reads]);

    const undo = async (row: ModerationLogRow): Promise<{ tone: Tone; text: string } | null> => {
        if (row.action !== "close_listing" && row.action !== "reject_domain") return null;
        const r = outcome(await settleAction(undoModerationAction({ logId: row.id, kind: row.action })));
        reload();
        if (!r.ok) return { tone: "error", text: r.message };
        return {
            tone: "ok",
            text:
                row.action === "close_listing"
                    ? "Restored. It returns to search within a few minutes."
                    : "Restored. The board is back in the scan queue and its listings return as they are scanned.",
        };
    };

    return (
        <div className="space-y-6" data-testid="admin-moderation">
            <RemoveListingCard onChanged={reload} />
            <BlockDomainCard onChanged={reload} />
            <RecentActionsCard rows={rows} loading={loading} error={error} onUndo={undo} />
        </div>
    );
}
