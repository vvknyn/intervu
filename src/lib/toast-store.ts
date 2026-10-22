/** Module-level toast/confirm store: no React, so any caller (and the idle loader) can use it. */

export type ToastVariant = "success" | "error" | "info";

/** One button on a toast, such as "Try again". Pressing it also dismisses the toast. */
export interface ToastAction {
    label: string;
    onClick: () => void;
}

export interface ToastItem {
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

export interface ConfirmState extends ConfirmOptions {
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

export function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function pushToast(message: string, variant: ToastVariant, duration: number, action?: ToastAction): number {
    const id = ++seq;
    toastItems = [...toastItems, { id, message, variant, duration, action }];
    emit();
    return id;
}

const timed = new Set<number>();

/**
 * Starts a toast's dismiss countdown, once. The Toaster calls this when the
 * item is first on screen: a toast pushed before the Toaster has mounted
 * (it loads after idle) must not run its clock unseen.
 */
export function startToastTimer(id: number) {
    const t = toastItems.find((i) => i.id === id);
    if (!t || timed.has(id)) return;
    timed.add(id);
    if (t.duration > 0) window.setTimeout(() => dismissToast(id), t.duration);
}

export function hasPendingToasts(): boolean {
    return toastItems.length > 0;
}

export function getToastItems(): ToastItem[] {
    return toastItems;
}

export function getConfirmState(): ConfirmState | null {
    return confirmState;
}

export function dismissToast(id: number) {
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

export function resolveConfirm(ok: boolean) {
    const c = confirmState;
    confirmState = null;
    emit();
    c?.resolve(ok);
}

