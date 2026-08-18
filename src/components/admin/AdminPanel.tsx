"use client";

import { useState, useEffect } from "react";
import { getAppConfig, updateAppConfig } from "@/actions/admin";
import { fetchAllFeedback, FeedbackItem } from "@/actions/feedback";
import { PageLayout } from "@/components/layout/PageLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { CircleNotch, Check, Bug, ChatCircle, DotsThree, ArrowLeft } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { MetricsDashboard } from "@/components/admin/MetricsDashboard";
import Link from "next/link";

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Bug; color: string }> = {
    bug: { label: "Bug", icon: Bug, color: "text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950/30" },
    feedback: { label: "Feedback", icon: ChatCircle, color: "text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30" },
    other: { label: "Other", icon: DotsThree, color: "text-muted-foreground bg-muted" },
};

export function AdminPanel() {
    const [showDonation, setShowDonation] = useState(false);
    const [donationUrl, setDonationUrl] = useState("");
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
    const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
    const [feedbackLoading, setFeedbackLoading] = useState(true);
    const [feedbackFilter, setFeedbackFilter] = useState<"all" | "bug" | "feedback" | "other">("all");

    useEffect(() => {
        const loadConfig = async () => {
            setIsLoading(true);
            const { data } = await getAppConfig();
            if (data) {
                setShowDonation(data.show_donation);
                setDonationUrl(data.donation_url || "");
            }
            setIsLoading(false);
        };
        loadConfig();
    }, []);

    useEffect(() => {
        const loadFeedback = async () => {
            setFeedbackLoading(true);
            const { data } = await fetchAllFeedback();
            if (data) setFeedback(data);
            setFeedbackLoading(false);
        };
        loadFeedback();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setMessage(null);
        const result = await updateAppConfig({
            show_donation: showDonation,
            donation_url: donationUrl,
        });
        if (result.error) {
            setMessage({ type: "error", text: result.error });
        } else {
            setMessage({ type: "success", text: "Settings saved." });
            setTimeout(() => setMessage(null), 3000);
        }
        setIsSaving(false);
    };

    const filteredFeedback = feedbackFilter === "all"
        ? feedback
        : feedback.filter((f) => f.type === feedbackFilter);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    };

    return (
        <PageLayout
            header={
                <PageHeader
                    title="Admin"
                    actions={
                        <Link href="/">
                            <Button variant="outline" size="sm" className="gap-2">
                                <ArrowLeft size={14} />
                                Back
                            </Button>
                        </Link>
                    }
                />
            }
        >
            <div className="space-y-6">
            <MetricsDashboard />

            {isLoading ? (
                <div className="py-16 flex flex-col items-center justify-center text-muted-foreground gap-3">
                    <div className="w-5 h-5 border border-border border-t-foreground rounded-full animate-spin" />
                    <p className="text-sm">Loading config...</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {message && (
                        <div className={`p-3 rounded-lg text-sm ${message.type === "success" ? "bg-muted text-foreground" : "bg-destructive/5 text-destructive"}`}>
                            {message.text}
                        </div>
                    )}

                    {/* Donation Settings */}
                    <Card className="gap-4 p-4 sm:p-6">
                        <h3 className="text-sm font-semibold mb-4">Donation Settings</h3>

                        <div className="space-y-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={showDonation}
                                    onClick={() => setShowDonation(!showDonation)}
                                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${showDonation ? "bg-green-600" : "bg-muted-foreground/30"}`}
                                >
                                    <span
                                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform shadow-sm ${showDonation ? "translate-x-[18px]" : "translate-x-[3px]"}`}
                                    />
                                </button>
                                <span className="text-sm">Show donation button</span>
                            </label>

                            <div className="space-y-1.5">
                                <label htmlFor="donation-url" className="text-xs text-muted-foreground">
                                    Donation URL (Ko-fi, Buy Me a Coffee, etc.)
                                </label>
                                <Input
                                    id="donation-url"
                                    type="url"
                                    placeholder="https://ko-fi.com/yourname"
                                    value={donationUrl}
                                    onChange={(e) => setDonationUrl(e.target.value)}
                                />
                            </div>
                        </div>
                    </Card>

                    <Button onClick={handleSave} disabled={isSaving} className="gap-2">
                        {isSaving ? (
                            <CircleNotch size={16} className="animate-spin" />
                        ) : (
                            <Check size={16} weight="bold" />
                        )}
                        {isSaving ? "Saving..." : "Save changes"}
                    </Button>

                    {/* Feedback Section */}
                    <Card className="gap-4 p-4 sm:p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold">
                                User Feedback
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    ({feedback.length} total)
                                </span>
                            </h3>
                            <div className="flex gap-1">
                                {(["all", "bug", "feedback", "other"] as const).map((filter) => (
                                    <button
                                        key={filter}
                                        onClick={() => setFeedbackFilter(filter)}
                                        className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                                            feedbackFilter === filter
                                                ? "bg-brand/10 text-brand"
                                                : "text-muted-foreground hover:bg-muted"
                                        }`}
                                    >
                                        {filter === "all" ? "All" : TYPE_CONFIG[filter].label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {feedbackLoading ? (
                            <div className="py-8 flex flex-col items-center justify-center text-muted-foreground gap-2">
                                <div className="w-4 h-4 border border-border border-t-foreground rounded-full animate-spin" />
                                <p className="text-xs">Loading feedback...</p>
                            </div>
                        ) : filteredFeedback.length === 0 ? (
                            <div className="py-8 text-center text-muted-foreground text-sm">
                                {feedbackFilter === "all" ? "No feedback yet." : `No ${feedbackFilter} reports.`}
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[600px] overflow-y-auto">
                                {filteredFeedback.map((item) => {
                                    const config = TYPE_CONFIG[item.type] || TYPE_CONFIG.other;
                                    const Icon = config.icon;
                                    return (
                                        <div key={item.id} className="border border-border rounded-lg p-3 space-y-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${config.color}`}>
                                                    <Icon size={12} weight="bold" />
                                                    {config.label}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {formatDate(item.created_at)}
                                                </span>
                                            </div>
                                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{item.message}</p>
                                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                                                {item.path && <span>Page: {item.path}</span>}
                                                <span className="truncate max-w-[200px]" title={item.user_id}>
                                                    User: {item.user_id.slice(0, 8)}...
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            )}
            </div>
        </PageLayout>
    );
}
