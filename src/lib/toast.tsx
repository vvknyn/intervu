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
import {
    subscribe, dismissToast, resolveConfirm, startToastTimer, getToastItems, getConfirmState,
    type ToastVariant, type ToastItem,
} from "./toast-store";
export { toast, confirmToast, type ToastAction, type ConfirmOptions } from "./toast-store";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, WarningCircle, Info, X } from "@phosphor-icons/react";

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
        getToastItems,
        () => EMPTY_TOASTS,
    );
    const confirm = React.useSyncExternalStore(
        subscribe,
        getConfirmState,
        () => null,
    );

    React.useEffect(() => {
        for (const t of items) startToastTimer(t.id);
    }, [items]);

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
                                    className="designed-focus shrink-0 rounded-ctl font-semibold text-foreground underline underline-offset-2 transition-colors hover:text-muted-foreground focus-visible:border-foreground"
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

            <AlertDialog
                open={!!confirm}
                onOpenChange={(open) => {
                    if (!open) resolveConfirm(false);
                }}
            >
                {confirm && (
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
                            {confirm.description && (
                                <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
                            )}
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{confirm.cancelLabel || "Cancel"}</AlertDialogCancel>
                            <AlertDialogAction
                                variant={confirm.destructive ? "destructive" : "default"}
                                onClick={() => resolveConfirm(true)}
                            >
                                {confirm.confirmLabel || "Confirm"}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                )}
            </AlertDialog>
        </>
    );
}
