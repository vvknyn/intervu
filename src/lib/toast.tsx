"use client";

/**
 * Single chokepoint for non-blocking user feedback, replacing the ~27 native
 * `alert()` / `confirm()` calls scattered across the app. Native dialogs block
 * the JS event loop, look unbranded, and can't be styled or auto-dismissed.
 *
 * Usage:
 *   import { toast, confirmToast } from "@/lib/toast";
 *   toast.error("Could not save");                 // inline, auto-dismiss
 *   toast.success("Saved");
 *   if (await confirmToast({ title: "Delete?", confirmLabel: "Delete", destructive: true })) { ... }
 *
 * Mount <Toaster /> exactly once near the app root (see app/layout.tsx). It
 * renders both the toast stack and the confirm dialog.
 */

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, WarningCircle, Info, X } from "@phosphor-icons/react";

type ToastVariant = "success" | "error" | "info";

/** One button on a toast, such as "Try again". Pressing it also dismisses the toast. */
export interface ToastAction {
    label: string;
    onClick: () => void;
}

interface ToastItem {
    id: number;
    message: string;
    variant: ToastVariant;
    duration: number;
    action?: ToastAction;
}

export interface ConfirmOptions {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    /** Renders the confirm button in destructive (red) styling. */
    destructive?: boolean;
}

interface ConfirmState extends ConfirmOptions {
    id: number;
    resolve: (ok: boolean) => void;
}

// --- Module-level store (so any component or non-React caller can fire) ---

let toastItems: ToastItem[] = [];
let confirmState: ConfirmState | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
    for (const l of listeners) l();
}

function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function pushToast(message: string, variant: ToastVariant, duration: number, action?: ToastAction): number {
    const id = ++seq;
    toastItems = [...toastItems, { id, message, variant, duration, action }];
    emit();
    if (duration > 0 && typeof window !== "undefined") {
        window.setTimeout(() => dismissToast(id), duration);
    }
    return id;
}

function dismissToast(id: number) {
    toastItems = toastItems.filter((t) => t.id !== id);
    emit();
}

/** Fire a non-blocking toast. */
export const toast = {
    success: (message: string, duration = 3500) => pushToast(message, "success", duration),
    error: (message: string, duration = 5000, action?: ToastAction) => pushToast(message, "error", duration, action),
    info: (message: string, duration = 3500) => pushToast(message, "info", duration),
};

/**
 * Styled, promise-based replacement for window.confirm(). Resolves true if the
 * user confirms, false otherwise (cancel / dismiss). If a confirm is already
 * open, the new request resolves false immediately rather than stacking.
 */
export function confirmToast(opts: ConfirmOptions): Promise<boolean> {
    if (typeof window === "undefined") return Promise.resolve(false);
    if (confirmState) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
        confirmState = { ...opts, id: ++seq, resolve };
        emit();
    });
}

function resolveConfirm(ok: boolean) {
    const c = confirmState;
    confirmState = null;
    emit();
    c?.resolve(ok);
}

// --- Rendering ---

const VARIANT_META: Record<ToastVariant, { icon: React.ReactNode; cls: string }> = {
    success: {
        icon: <CheckCircle weight="fill" className="text-live shrink-0" />,
        cls: "border-live",
    },
    error: {
        icon: <WarningCircle weight="fill" className="text-danger-text shrink-0" />,
        cls: "border-danger-text",
    },
    info: {
        icon: <Info weight="fill" className="text-brand shrink-0" />,
        cls: "border-brand",
    },
};

const EMPTY_TOASTS: ToastItem[] = [];

/**
 * Mount once near the app root. Renders the toast stack (bottom-right) and the
 * confirm dialog. Uses useSyncExternalStore so it stays in sync with the
 * module-level store regardless of which component fired the toast.
 */
export function Toaster() {
    const items = React.useSyncExternalStore(
        subscribe,
        () => toastItems,
        () => EMPTY_TOASTS,
    );
    const confirm = React.useSyncExternalStore(
        subscribe,
        () => confirmState,
        () => null,
    );

    return (
        <>
            <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--mobile-tabbar-h,0px)+env(safe-area-inset-bottom,0px)+1rem)] z-[var(--z-toast)] flex flex-col items-end gap-2 lg:inset-x-auto lg:bottom-4 lg:right-4">
                {items.map((t) => {
                    const meta = VARIANT_META[t.variant];
                    const isError = t.variant === "error";
                    return (
                        <div
                            key={t.id}
                            role={isError ? "alert" : "status"}
                            aria-live={isError ? "assertive" : "polite"}
                            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-none border bg-background px-4 py-3 text-sm enter-reveal ${meta.cls}`}
                        >
                            {meta.icon}
                            <span className="flex-1 leading-snug text-foreground">{t.message}</span>
                            {t.action && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        dismissToast(t.id);
                                        t.action?.onClick();
                                    }}
                                    className="designed-focus shrink-0 rounded-ctl font-medium text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground focus-visible:border-foreground"
                                >
                                    {t.action.label}
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => dismissToast(t.id)}
                                className="designed-focus shrink-0 rounded-ctl text-muted-foreground transition-colors hover:text-foreground focus-visible:border-foreground"
                                aria-label="Dismiss"
                            >
                                <X weight="bold" />
                            </button>
                        </div>
                    );
                })}
            </div>

            <Dialog
                open={!!confirm}
                onOpenChange={(open) => {
                    if (!open) resolveConfirm(false);
                }}
            >
                {confirm && (
                    <DialogContent showCloseButton={false}>
                        <DialogHeader>
                            <DialogTitle>{confirm.title}</DialogTitle>
                            {confirm.description && (
                                <DialogDescription>{confirm.description}</DialogDescription>
                            )}
                        </DialogHeader>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => resolveConfirm(false)}>
                                {confirm.cancelLabel || "Cancel"}
                            </Button>
                            <Button
                                variant={confirm.destructive ? "destructive" : "default"}
                                onClick={() => resolveConfirm(true)}
                            >
                                {confirm.confirmLabel || "Confirm"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                )}
            </Dialog>
        </>
    );
}
