"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
    House,
    MagnifyingGlass,
    Sparkle,
    Books,
    FileText,
    Kanban,
    Gear,
    SignIn,
    ChatCircleDots,
    CaretLeft,
    CaretDown,
    Sun,
    Moon,
} from "@phosphor-icons/react";
import { type User as FirebaseUser } from "firebase/auth";
import { useEffect, useState } from "react";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { AuthPopover } from "@/components/auth/auth-popover";

interface AppShellProps {
    children: React.ReactNode;
    user?: FirebaseUser | null;
}

const NAV_ITEMS = [
    { id: "home", label: "Home", href: "/", icon: House },
    { id: "jobs", label: "Find jobs", href: "/jobs", icon: MagnifyingGlass },
    { id: "prepare", label: "Interview prep", href: "/", icon: Sparkle },
    { id: "library", label: "Library", href: "/library", icon: Books },
    { id: "resume", label: "Resumes", href: "/resume-builder", icon: FileText },
    { id: "applications", label: "Applications", href: "/applications", icon: Kanban },
];

/** The brand mark — the V of inter·vu, cut as a rising checkmark. Carries the accent. */
function VMark({ size = 30 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="intervu" className="shrink-0">
            <path
                d="M9 13 L19 28 L31 7"
                fill="none"
                stroke="rgb(var(--brand))"
                strokeWidth={4.4}
                strokeLinecap="square"
                strokeLinejoin="miter"
            />
        </svg>
    );
}

function initialsOf(user: FirebaseUser): string {
    const src = (user.displayName || user.email || "?").trim();
    const parts = src.split(/\s+/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return src.slice(0, 2).toUpperCase();
}

export function AppShell({ children, user }: AppShellProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [prepareHref, setPrepareHref] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [dark, setDark] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Hydrate persisted UI state on the client (avoids SSR mismatch).
    useEffect(() => {
        setMounted(true);
        try {
            setCollapsed(localStorage.getItem("iv-collapsed") === "1");
        } catch {
            /* ignore */
        }
        setDark(document.documentElement.classList.contains("dark"));
    }, []);

    // Keep "Interview prep" pointing at the active search, like before.
    useEffect(() => {
        if ((pathname === "/" || pathname === "/dashboard") && searchParams?.get("searched")) {
            setPrepareHref(`/?${searchParams.toString()}`);
        }
    }, [pathname, searchParams]);

    const toggleCollapsed = () =>
        setCollapsed((c) => {
            const next = !c;
            try {
                localStorage.setItem("iv-collapsed", next ? "1" : "0");
            } catch {
                /* ignore */
            }
            return next;
        });

    const toggleDark = () =>
        setDark((d) => {
            const next = !d;
            const root = document.documentElement;
            if (next) root.classList.add("dark");
            else root.classList.remove("dark");
            try {
                localStorage.setItem("intervu-dark", next ? "1" : "0");
            } catch {
                /* ignore */
            }
            return next;
        });

    const getActiveItem = () => {
        if (pathname === "/" || pathname === "/dashboard") {
            return searchParams?.get("searched") ? "prepare" : "home";
        }
        if (pathname.startsWith("/jobs")) return "jobs";
        if (pathname.startsWith("/library")) return "library";
        if (pathname.startsWith("/resume-builder") || pathname.startsWith("/resume-tailor")) return "resume";
        if (pathname.startsWith("/applications")) return "applications";
        if (pathname.startsWith("/settings") || pathname.startsWith("/account")) return "settings";
        return null;
    };
    const activeItem = getActiveItem();

    const hideNav = pathname.startsWith("/login") || pathname.startsWith("/auth");
    if (hideNav) {
        return <>{children}</>;
    }

    const isCollapsed = mounted && collapsed;
    const navItems = NAV_ITEMS.filter((item) => item.id !== "prepare" || prepareHref);

    const itemBase =
        "group relative flex items-center gap-[11px] rounded-[9px] px-2.5 py-2.5 text-[14.5px] font-medium transition-colors w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-background";
    const itemIdle = "text-muted-foreground hover:bg-muted hover:text-foreground";
    const itemActive = "bg-brand/10 text-brand font-semibold";

    // Shared base for the mobile bottom-tab items (keyboard focus + even spacing).
    const mobileItemBase =
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

    return (
        <div
            className="min-h-screen bg-background flex flex-col"
            style={{ "--sbw": isCollapsed ? "76px" : "var(--sb-w)" } as React.CSSProperties}
        >
            <main className="flex-1 pb-[4.5rem] lg:pb-0 lg:pl-[var(--sbw)] transition-[padding] duration-200 ease-out">
                {children}
            </main>

            {/* Desktop sidebar */}
            <nav
                className="hidden lg:flex fixed left-0 top-0 bottom-0 w-[var(--sbw)] bg-card border-r border-border flex-col px-[14px] pt-[18px] pb-[14px] z-50 overflow-hidden transition-[width] duration-200 ease-out"
                data-tour="nav-menu"
            >
                {/* Brand lockup */}
                <div className={cn("flex items-center gap-2 mb-[18px] px-2 pt-1.5 pb-1", isCollapsed && "justify-center px-0")}>
                    <button
                        onClick={toggleCollapsed}
                        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                        className="flex items-center rounded-lg hover:opacity-80 transition-opacity"
                    >
                        <VMark size={30} />
                    </button>
                    {!isCollapsed && (
                        <>
                            <div className="text-[18px] font-bold tracking-[-0.4px] leading-none">
                                inter<b className="text-brand font-bold">vu</b>
                            </div>
                            <span className="text-[8.5px] font-extrabold tracking-[0.18em] uppercase text-muted-foreground/80 self-start mt-1">
                                beta
                            </span>
                            <button
                                onClick={toggleCollapsed}
                                title="Collapse sidebar"
                                className="ml-auto grid place-items-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                            >
                                <CaretLeft size={18} />
                            </button>
                        </>
                    )}
                </div>

                {/* Primary nav — scrolls independently so the footer (login/avatar)
                    can never overlap the nav links on a short viewport. */}
                <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto custom-scrollbar">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActive = activeItem === item.id;
                        const href = item.id === "prepare" && prepareHref ? prepareHref : item.href;
                        return (
                            <Link
                                key={item.id}
                                href={href}
                                title={item.label}
                                className={cn(itemBase, isActive ? itemActive : itemIdle, isCollapsed && "justify-center px-0")}
                            >
                                <Icon size={19} weight={isActive ? "fill" : "regular"} className="shrink-0" />
                                {!isCollapsed && <span className="flex-1 truncate">{item.label}</span>}
                            </Link>
                        );
                    })}
                </div>

                {/* Foot */}
                <div className="mt-auto pt-3">
                    <hr className="h-px bg-border border-0 mb-2" />

                    {/* Dark mode toggle */}
                    <button
                        onClick={toggleDark}
                        title={dark ? "Switch to light mode" : "Switch to dark mode"}
                        className={cn(itemBase, itemIdle, isCollapsed && "justify-center px-0")}
                    >
                        {dark ? <Sun size={19} className="shrink-0" /> : <Moon size={19} className="shrink-0" />}
                        {!isCollapsed && <span className="flex-1 truncate">{dark ? "Light mode" : "Dark mode"}</span>}
                    </button>

                    {/* Settings */}
                    <Link
                        href="/settings"
                        title="Settings"
                        className={cn(itemBase, activeItem === "settings" ? itemActive : itemIdle, isCollapsed && "justify-center px-0")}
                    >
                        <Gear size={19} weight={activeItem === "settings" ? "fill" : "regular"} className="shrink-0" />
                        {!isCollapsed && <span className="flex-1 truncate">Settings</span>}
                    </Link>

                    {/* Feedback */}
                    <FeedbackModal>
                        <button title="Send feedback" className={cn(itemBase, itemIdle, isCollapsed && "justify-center px-0")}>
                            <ChatCircleDots size={19} className="shrink-0" />
                            {!isCollapsed && <span className="flex-1 truncate">Feedback</span>}
                        </button>
                    </FeedbackModal>

                    <hr className="h-px bg-border border-0 my-2" />

                    {/* User / login */}
                    {user ? (
                        <Link
                            href="/settings"
                            title={user.displayName || user.email || "Account"}
                            className={cn(
                                "flex items-center gap-2.5 p-2 rounded-[9px] hover:bg-muted transition-colors",
                                isCollapsed && "justify-center"
                            )}
                        >
                            <div
                                className="w-[34px] h-[34px] rounded-full grid place-items-center font-bold text-sm shrink-0 text-brand-foreground"
                                style={{
                                    background:
                                        "linear-gradient(135deg, rgb(var(--brand) / 0.85), rgb(var(--brand)))",
                                }}
                            >
                                {initialsOf(user)}
                            </div>
                            {!isCollapsed && (
                                <>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13.5px] font-semibold truncate leading-tight">
                                            {user.displayName || user.email?.split("@")[0]}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate leading-tight">{user.email}</div>
                                    </div>
                                    <CaretDown size={16} className="text-muted-foreground shrink-0" />
                                </>
                            )}
                        </Link>
                    ) : (
                        <button
                            onClick={() => setAuthPopoverOpen(true)}
                            title="Log in"
                            className={cn(itemBase, itemIdle, isCollapsed && "justify-center px-0")}
                        >
                            <SignIn size={19} className="shrink-0" />
                            {!isCollapsed && <span className="flex-1 truncate">Log in</span>}
                        </button>
                    )}
                </div>
            </nav>

            {/* Mobile bottom tab bar */}
            <nav
                className="lg:hidden fixed bottom-0 left-0 right-0 h-[4.5rem] bg-card/95 backdrop-blur-xl border-t border-border flex items-center justify-around px-2 z-50 shadow-[0_-4px_16px_rgb(16_18_27/0.06)]"
                style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
                {NAV_ITEMS.filter((item) => item.id !== "prepare").map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem === item.id || (item.id === "home" && activeItem === "prepare");
                    return (
                        <Link
                            key={item.id}
                            href={item.href}
                            className={cn(
                                // flex-1 + min-w-0 lets the 6 tabs share the bar evenly so the
                                // icon, label and active-dot never collide on a narrow phone.
                                mobileItemBase,
                                isActive ? "text-brand" : "text-muted-foreground"
                            )}
                        >
                            <Icon size={22} weight={isActive ? "fill" : "regular"} className="shrink-0" />
                            <span className="max-w-full truncate text-[10px] font-medium leading-none">{item.label}</span>
                            <div className={cn("h-1 w-1 rounded-full bg-brand", isActive ? "opacity-100" : "opacity-0")} />
                        </Link>
                    );
                })}
                {/* User area */}
                {user ? (
                    <Link
                        href="/settings"
                        className={cn(
                            mobileItemBase,
                            activeItem === "settings" ? "text-brand" : "text-muted-foreground"
                        )}
                    >
                        <div
                            className={cn(
                                "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase",
                                activeItem === "settings" ? "bg-brand/20 text-brand" : "bg-brand/10 text-brand"
                            )}
                        >
                            {(user.displayName || user.email || "?")[0]}
                        </div>
                        <span className="max-w-full truncate text-[10px] font-medium leading-none">
                            {user.displayName || user.email?.split("@")[0]}
                        </span>
                        <div className={cn("h-1 w-1 rounded-full bg-brand", activeItem === "settings" ? "opacity-100" : "opacity-0")} />
                    </Link>
                ) : (
                    <button
                        onClick={() => setAuthPopoverOpen(true)}
                        className={cn(mobileItemBase, "text-muted-foreground")}
                    >
                        <SignIn size={22} weight="regular" className="shrink-0" />
                        <span className="max-w-full truncate text-[10px] font-medium leading-none">Login</span>
                        <div className="h-1 w-1 rounded-full opacity-0" />
                    </button>
                )}
            </nav>

            {/* Auth dialog for logged-out users */}
            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
        </div>
    );
}
