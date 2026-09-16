"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/lib/toast";
import { AGENT } from "@/lib/agent/config";
import { EXPERIENCE_LEVELS, EMPLOYMENT_TYPES, POSTED_WITHIN_DAYS_OPTIONS, type ExperienceLevel, type EmploymentType, type PostedWithinDays } from "@/lib/agent/facets";
import { facetValueLabel } from "@/components/jobs/FilterPanel";
import type { User } from "@/lib/firebase/client-auth";
import {
    fetchAgentPreferencesAction,
    saveAgentPreferencesAction,
    type AgentPreferences,
    type AgentPreferencesPatch,
} from "@/actions/agent-preferences";
import { CircleNotch, Trash } from "@phosphor-icons/react";

/** Sentinel Select value for "no preference" — Radix's `Select.Item` can't
 *  take an empty-string value, and `experienceLevel`/`employmentType`/
 *  `postedWithinDays` are all optional fields with no natural "unset" value
 *  of their own. */
const ANY = "__any__";

interface CustomRow {
    id: number;
    key: string;
    value: string;
}

/**
 * Diffs the current custom-answer rows against the keys that were present
 * at load time into the wire's add/update/delete map (see
 * `AgentPreferencesPatch.answers.custom`'s doc comment for the `null`
 * delete-signal this feeds): every currently-present, non-blank-labeled row
 * sends its current value (even if unchanged); any key that was loaded but
 * no longer has a row sends `null`; a blank-labeled row is skipped
 * entirely — it was never a real key, so it's neither saved nor deleted.
 * Pure and I/O-free so it's testable without mocking the fetch/save actions.
 */
export function computeCustomAnswersPatch(
    rows: CustomRow[],
    loadedKeys: ReadonlySet<string>,
): Record<string, string | null> {
    const patch: Record<string, string | null> = {};
    const currentKeys = new Set<string>();
    for (const row of rows) {
        const key = row.key.trim();
        if (!key) continue;
        currentKeys.add(key);
        patch[key] = row.value;
    }
    for (const loadedKey of loadedKeys) {
        if (!currentKeys.has(loadedKey)) patch[loadedKey] = null;
    }
    return patch;
}

interface AgentPreferencesSectionProps {
    user: User | null;
    onLoginClick: () => void;
    embedded?: boolean;
}

/**
 * Settings section: the human-facing mirror of the SAME `agent_preferences`
 * document the `get_preferences`/`set_preferences` MCP tools read and write
 * (`lib/agent/preferences.ts`) — intervu is the single source of truth for
 * an agent's knowledge of its user, and this card views/edits that state
 * directly rather than keeping a separate copy. Mirrors AgentAccessSection's
 * section shape, load-retry pattern, and styling conventions.
 */
export function AgentPreferencesSection({ user, onLoginClick, embedded }: AgentPreferencesSectionProps) {
    const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
    const [configured, setConfigured] = useState(false);
    const [saving, setSaving] = useState(false);

    const [query, setQuery] = useState("");
    const [location, setLocation] = useState("");
    const [remoteOnly, setRemoteOnly] = useState(false);
    const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | undefined>(undefined);
    const [employmentType, setEmploymentType] = useState<EmploymentType | undefined>(undefined);
    const [salaryMin, setSalaryMin] = useState("");
    const [postedWithinDays, setPostedWithinDays] = useState<PostedWithinDays | undefined>(undefined);

    const [workAuthorization, setWorkAuthorization] = useState("");
    const [relocation, setRelocation] = useState("");
    const [noticePeriod, setNoticePeriod] = useState("");
    const [startDate, setStartDate] = useState("");
    const [salaryExpectation, setSalaryExpectation] = useState("");

    const [customRows, setCustomRows] = useState<CustomRow[]>([]);
    const [loadedCustomKeys, setLoadedCustomKeys] = useState<ReadonlySet<string>>(new Set());
    const nextRowId = useRef(0);

    /** Seeds every piece of local state from a fetched/saved
     *  `AgentPreferences` in one place, so the initial load and the
     *  post-save baseline refresh can never seed inconsistently. */
    const seedFrom = useCallback((prefs: AgentPreferences) => {
        setConfigured(prefs.configured);
        setQuery(prefs.search.query ?? "");
        setLocation(prefs.search.location ?? "");
        setRemoteOnly(prefs.search.remoteOnly ?? false);
        setExperienceLevel(prefs.search.experienceLevel as ExperienceLevel | undefined);
        setEmploymentType(prefs.search.employmentType as EmploymentType | undefined);
        setSalaryMin(prefs.search.salaryMin !== undefined ? String(prefs.search.salaryMin) : "");
        setPostedWithinDays(prefs.search.postedWithinDays as PostedWithinDays | undefined);
        setWorkAuthorization(prefs.answers.workAuthorization ?? "");
        setRelocation(prefs.answers.relocation ?? "");
        setNoticePeriod(prefs.answers.noticePeriod ?? "");
        setStartDate(prefs.answers.startDate ?? "");
        setSalaryExpectation(prefs.answers.salaryExpectation ?? "");
        const rows = Object.entries(prefs.answers.custom).map(([key, value], idx) => ({ id: idx, key, value }));
        nextRowId.current = rows.length;
        setCustomRows(rows);
        setLoadedCustomKeys(new Set(Object.keys(prefs.answers.custom)));
    }, []);

    // Same retry-on-cookie-race pattern as AgentAccessSection.loadCredentials:
    // right after a fresh sign-in the client `user` can flip truthy a beat
    // before the server session cookie finishes syncing, so an
    // "Unauthorized" here almost always means that race, not a real denial.
    const loadPreferences = useCallback(async () => {
        setStatus("loading");
        for (let attempt = 0; attempt < 4; attempt++) {
            const res = await fetchAgentPreferencesAction();
            if (!res.error && res.data) {
                seedFrom(res.data);
                setStatus("ready");
                return;
            }
            if (attempt < 3) await new Promise((r) => setTimeout(r, 400));
        }
        // Deliberately does NOT fall through to an empty/editable form here:
        // this card's Save always writes the whole search+answers state, so
        // rendering it from unseeded local state would risk overwriting a
        // real saved section with blanks. Stay in "error" with a manual
        // retry instead.
        toast.error("Couldn't load your agent's answers. Try refreshing the page.");
        setStatus("error");
    }, [seedFrom]);

    useEffect(() => {
        if (!user) return;
        loadPreferences();
    }, [user, loadPreferences]);

    const addCustomRow = () => {
        setCustomRows((rows) => [...rows, { id: nextRowId.current++, key: "", value: "" }]);
    };
    const updateCustomRow = (id: number, patch: Partial<Pick<CustomRow, "key" | "value">>) => {
        setCustomRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    };
    const removeCustomRow = (id: number) => {
        setCustomRows((rows) => rows.filter((r) => r.id !== id));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const patch: AgentPreferencesPatch = {
                search: {
                    query,
                    location,
                    remoteOnly,
                    // Optional enum/number fields are included only when set:
                    // an explicit `undefined` value (rather than an absent
                    // key) would both defeat mergeAgentPreferences' "absent
                    // patch field leaves the existing value alone" behavior
                    // AND crash the Admin SDK write (it rejects literal
                    // `undefined` field values) — the same reason
                    // `custom`'s delete signal had to be `null`, not
                    // `undefined`.
                    ...(experienceLevel ? { experienceLevel } : {}),
                    ...(employmentType ? { employmentType } : {}),
                    ...(salaryMin.trim() ? { salaryMin: Number(salaryMin) } : {}),
                    ...(postedWithinDays !== undefined ? { postedWithinDays } : {}),
                },
                answers: {
                    workAuthorization,
                    relocation,
                    noticePeriod,
                    startDate,
                    salaryExpectation,
                    custom: computeCustomAnswersPatch(customRows, loadedCustomKeys),
                },
            };
            const res = await saveAgentPreferencesAction(patch);
            if (res.error || !res.data) {
                toast.error(res.error || "Couldn't save your agent's answers. Try again.");
                return;
            }
            seedFrom(res.data);
            toast.success("Saved");
        } finally {
            setSaving(false);
        }
    };

    if (!user) {
        return (
            <section className={embedded ? undefined : "pt-6 border-t border-border"}>
                <h2 className={embedded ? "text-sm font-semibold mb-1" : "text-base font-semibold mb-1"}>
                    {embedded ? "Job search" : "Your agent's answers"}
                </h2>
                <p className="text-sm text-muted-foreground">
                    <button onClick={onLoginClick} className="underline text-brand hover:text-brand">
                        login
                    </button>{" "}
                    to see and edit what your AI fills into applications for you.
                </p>
            </section>
        );
    }

    return (
        <section className={embedded ? undefined : "pt-6 border-t border-border"}>
            {!embedded && (
                <>
                    <h2 className="text-base font-semibold mb-1">Your agent&apos;s answers</h2>
                    <p className="text-sm text-muted-foreground mb-4">
                        What your AI fills into applications for you. It learns these when you first talk to it — or set
                        them here.
                    </p>
                </>
            )}

            {status === "loading" && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <CircleNotch size={16} className="animate-spin" />
                    Loading...
                </div>
            )}

            {status === "error" && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Couldn&apos;t load your agent&apos;s answers.</p>
                    <Button variant="outline" size="sm" onClick={loadPreferences}>
                        Try again
                    </Button>
                </div>
            )}

            {status === "ready" && (
                <div className="space-y-6">
                    {!configured && (
                        <p className="text-xs text-muted-foreground">
                            Your agent fills these in when you first talk to it — or set them here now.
                        </p>
                    )}

                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-semibold">Job search</p>
                            {embedded && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Defaults for the board filters and overnight search. Same language as Jobs.
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Roles</Label>
                                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. backend engineer" />
                            </div>
                            <div className="space-y-2">
                                <Label>Location</Label>
                                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Remote, New York" />
                            </div>
                            <div className="space-y-2">
                                <Label>Experience level</Label>
                                <Select
                                    value={experienceLevel ?? ANY}
                                    onValueChange={(v) => setExperienceLevel(v === ANY ? undefined : (v as ExperienceLevel))}
                                >
                                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-popover">
                                        <SelectItem value={ANY}>Any</SelectItem>
                                        {EXPERIENCE_LEVELS.map((lvl) => (
                                            <SelectItem key={lvl} value={lvl}>{facetValueLabel("experience_level", lvl)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Employment type</Label>
                                <Select
                                    value={employmentType ?? ANY}
                                    onValueChange={(v) => setEmploymentType(v === ANY ? undefined : (v as EmploymentType))}
                                >
                                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-popover">
                                        <SelectItem value={ANY}>Any</SelectItem>
                                        {EMPLOYMENT_TYPES.map((t) => (
                                            <SelectItem key={t} value={t}>{facetValueLabel("employment_type", t)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Minimum salary</Label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={salaryMin}
                                    onChange={(e) => setSalaryMin(e.target.value)}
                                    placeholder="e.g. 120000"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Posted within</Label>
                                <Select
                                    value={postedWithinDays !== undefined ? String(postedWithinDays) : ANY}
                                    onValueChange={(v) => setPostedWithinDays(v === ANY ? undefined : (Number(v) as PostedWithinDays))}
                                >
                                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                                    <SelectContent className="bg-popover">
                                        <SelectItem value={ANY}>Any time</SelectItem>
                                        {POSTED_WITHIN_DAYS_OPTIONS.map((d) => (
                                            <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                            <p className="text-sm">Remote only</p>
                            <button
                                type="button"
                                onClick={() => setRemoteOnly((v) => !v)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-none border border-border transition-colors ${remoteOnly ? "bg-brand text-brand-foreground" : "bg-muted"}`}
                                role="switch"
                                aria-checked={remoteOnly}
                            >
                                <span className={`inline-block h-4 w-4 rounded-none border border-border bg-card transition-transform ${remoteOnly ? "translate-x-[23px]" : "translate-x-[3px]"}`} />
                            </button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <p className="text-sm font-semibold">Standing answers</p>
                            {embedded && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    What forms ask every time. Keep short — your agent fills these in.
                                </p>
                            )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Work authorization</Label>
                                <Input
                                    value={workAuthorization}
                                    onChange={(e) => setWorkAuthorization(e.target.value)}
                                    maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                    placeholder="e.g. US citizen"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Relocation</Label>
                                <Input
                                    value={relocation}
                                    onChange={(e) => setRelocation(e.target.value)}
                                    maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                    placeholder="e.g. open to relocating"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Notice period</Label>
                                <Input
                                    value={noticePeriod}
                                    onChange={(e) => setNoticePeriod(e.target.value)}
                                    maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                    placeholder="e.g. 2 weeks"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Start date</Label>
                                <Input
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                    placeholder="e.g. Immediately available"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Salary expectation</Label>
                                <Input
                                    value={salaryExpectation}
                                    onChange={(e) => setSalaryExpectation(e.target.value)}
                                    maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                    placeholder="e.g. $150k+"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        <Label>Other answers</Label>
                        <p className="text-xs text-muted-foreground">
                            Anything else your agent should always know when it fills out an application.
                        </p>
                        <div className="space-y-3">
                            {customRows.map((row) => (
                                <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                    <Input
                                        value={row.key}
                                        onChange={(e) => updateCustomRow(row.id, { key: e.target.value })}
                                        placeholder="Question (e.g. How did you hear about us?)"
                                        maxLength={200}
                                        spellCheck={false}
                                        className="min-w-0 w-full sm:flex-1"
                                    />
                                    <div className="flex min-w-0 w-full items-center gap-2 sm:flex-1">
                                        <Input
                                            value={row.value}
                                            onChange={(e) => updateCustomRow(row.id, { value: e.target.value })}
                                            placeholder="Answer"
                                            maxLength={AGENT.PREFERENCES_STRING_MAX_CHARS}
                                            className="min-w-0 w-full flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0 text-muted-foreground hover:text-danger-text"
                                            onClick={() => removeCustomRow(row.id)}
                                            aria-label="Remove"
                                        >
                                            <Trash />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="w-full rounded-none sm:w-auto"
                            onClick={addCustomRow}
                            disabled={customRows.length >= AGENT.PREFERENCES_CUSTOM_ANSWERS_MAX}
                        >
                            Add answer
                        </Button>
                    </div>

                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
                        <Button onClick={handleSave} disabled={saving} className="w-full rounded-none sm:w-auto">
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}
