"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NoteAutosave } from "@/lib/pursuits/note-autosave";
import { TRACKER_FIELD_CLASS } from "@/components/tracker/field-class";

/**
 * The tracker note: autosaves while you type, flushes on unmount (sheet
 * close, leaving the page) and on `beforeunload`, with a quiet
 * "saving…"/"saved" line. Shared by the detail sheet and the full pursuit
 * page so a note typed on either surface is kept the same way (notes used to
 * be lost on close, spec B1). Seeded from `initialNote` once; the caller
 * remounts it (a `key`) to load a different pursuit's note.
 */
export function PursuitNoteField({
    initialNote,
    onSave,
    rows = 2,
}: {
    initialNote: string;
    /** Receives the trimmed note. */
    onSave: (note: string) => Promise<void>;
    rows?: number;
}) {
    const id = useId();
    const [note, setNote] = useState(initialNote);
    const [indicator, setIndicator] = useState<"saving" | "saved" | null>(null);

    // `onSave` is a fresh closure every render of the parent — keep the
    // latest in a ref so the autosave engine (built once) never calls a
    // stale one. Refs are written in an effect and in the change handler,
    // never during render.
    const onSaveRef = useRef(onSave);
    useEffect(() => {
        onSaveRef.current = onSave;
    }, [onSave]);
    const noteRef = useRef(initialNote);

    // Built on the first keystroke (an event, not render); a note that is
    // never touched never saves.
    const autosaveRef = useRef<NoteAutosave | null>(null);
    const autosave = () =>
        (autosaveRef.current ??= new NoteAutosave((value) => {
            setIndicator("saving");
            void onSaveRef.current(value.trim()).then(
                () => setIndicator("saved"),
                () => setIndicator(null),
            );
        }));

    useEffect(() => {
        const flush = () => autosaveRef.current?.flush(noteRef.current);
        window.addEventListener("beforeunload", flush);
        return () => {
            window.removeEventListener("beforeunload", flush);
            flush();
        };
    }, []);

    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <Label htmlFor={id} className="block whitespace-nowrap text-xs text-muted-foreground">
                    Note
                </Label>
                {indicator && (
                    <span data-testid="pursuit-note-status" className="text-xs text-muted-foreground" aria-live="polite">
                        {indicator === "saving" ? "saving…" : "saved"}
                    </span>
                )}
            </div>
            <Textarea
                id={id}
                value={note}
                onChange={(e) => {
                    setNote(e.target.value);
                    noteRef.current = e.target.value;
                    autosave().edit(e.target.value);
                }}
                rows={rows}
                className={TRACKER_FIELD_CLASS}
            />
        </div>
    );
}
