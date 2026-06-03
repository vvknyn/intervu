"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
    House,
    MagnifyingGlass,
    FileText,
    Briefcase,
    ChatCircleDots,
    Books,
    Gear,
    SignIn,
} from "@phosphor-icons/react";
import { type User as FirebaseUser } from "firebase/auth";
import { useEffect, useRef, useState } from "react";
import { FeedbackModal } from "@/components/modals/FeedbackModal";
import { AuthPopover } from "@/components/auth/auth-popover";

interface AppShellProps {
    children: React.ReactNode;
    user?: FirebaseUser | null;
}

const NAV_ITEMS = [
    {
        id: "home",
        label: "Home",
        href: "/",
        icon: House,
        description: "Dashboard & quick start"
    },
    {
        id: "prepare",
        label: "Prepare",
        href: "/",
        icon: MagnifyingGlass,
        description: "Interview prep & research"
    },
    {
        id: "library",
        label: "Library",
        href: "/library",
        icon: Books,
        description: "Stories & knowledge sources"
    },
    {
        id: "resume",
        label: "Resume",
        href: "/resume-builder",
        icon: FileText,
        description: "Build, tailor & manage"
    },
    {
        id: "applications",
        label: "Tracker",
        href: "/applications",
        icon: Briefcase,
        description: "Track your applications"
    }
];

export function AppShell({ children, user }: AppShellProps) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [authPopoverOpen, setAuthPopoverOpen] = useState(false);
    const [prepareHref, setPrepareHref] = useState<string | null>(null);

    // Populate prepareHref from current URL on mount + keep it up-to-date
    useEffect(() => {
        if ((pathname === "/" || pathname === "/dashboard") && searchParams?.get("searched")) {
            setPrepareHref(`/?${searchParams.toString()}`);
        }
    }, [pathname, searchParams]);

    const getActiveItem = () => {
        if (pathname === "/" || pathname === "/dashboard") {
            return searchParams?.get("searched") ? "prepare" : "home";
        }
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

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <main className="flex-1 pb-[4.5rem] lg:pb-0 lg:pl-20">
                {children}
            </main>

            {/* Desktop Side Rail */}
            <nav className="hidden lg:flex fixed left-0 top-0 bottom-0 w-20 bg-brand/[0.04] shadow-[var(--shadow-sm)] flex-col items-center py-6 gap-4 z-50" data-tour="nav-menu">
                {/* Logo + Beta */}
                <Link href={`/${searchParams?.toString() ? `?${searchParams.toString()}` : ''}`} className="mb-8 flex flex-col items-center gap-1.5 group">
                    <img
                        src="/intervu-logo.png"
                        alt="Intervu"
                        className="w-10 h-10 rounded-xl object-contain"
                    />
                    <span className="text-[7px] font-extrabold text-brand-muted tracking-[0.2em] uppercase select-none opacity-60 group-hover:opacity-100 transition-opacity">
                        BETA
                    </span>
                </Link>

                {/* Nav Items */}
                <div className="flex-1 flex flex-col items-center gap-1">
                    {NAV_ITEMS.filter(item => item.id !== "prepare" || prepareHref).map((item) => {
                        const Icon = item.icon;
                        const isActive = activeItem === item.id;
                        const href = item.id === "prepare" && prepareHref ? prepareHref : item.href;
                        return (
                            <Link
                                key={item.id}
                                href={href}
                                className={cn(
                                    "group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-150",
                                    isActive
                                        ? "bg-brand/10 text-brand"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                )}
                            >
                                {/* Active pill indicator */}
                                {isActive && (
                                    <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[7px] w-[3px] h-5 bg-brand rounded-full" />
                                )}

                                <Icon
                                    size={24}
                                    weight={isActive ? "fill" : "regular"}
                                />
                                <span className="text-[10px] mt-1 font-medium">
                                    {item.label}
                                </span>

                                {/* Tooltip */}
                                <div className="absolute left-full ml-3 px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50">
                                    <p className="text-xs font-medium">{item.label}</p>
                                    <p className="text-[10px] text-white/60 dark:text-neutral-500">{item.description}</p>
                                </div>
                            </Link>
                        );
                    })}
                </div>

                {/* Bottom Actions Group */}
                <div className="flex flex-col items-center gap-1">
                    {/* User area */}
                    {user ? (
                        <Link
                            href="/settings"
                            className={cn(
                                "group relative flex flex-col items-center justify-center w-14 py-2 rounded-xl transition-all duration-150",
                                activeItem === "settings"
                                    ? "bg-brand/10 text-brand"
                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            )}
                        >
                            {activeItem === "settings" && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[7px] w-[3px] h-5 bg-brand rounded-full" />
                            )}
                            <div className={cn(
                                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold uppercase",
                                activeItem === "settings"
                                    ? "bg-brand/20 text-brand"
                                    : "bg-brand/10 text-brand"
                            )}>
                                {(user.displayName || "?")[0]}
                            </div>
                            <span className="text-[10px] mt-1 font-medium truncate w-14 text-center">
                                {user.displayName || user.email?.split("@")[0]}
                            </span>

                            {/* Tooltip */}
                            <div className="absolute left-full ml-3 px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50">
                                <p className="text-xs font-medium">{user.displayName || user.email?.split("@")[0]}</p>
                                <p className="text-[10px] text-white/60 dark:text-neutral-500">Account & settings</p>
                            </div>
                        </Link>
                    ) : (
                        <>
                            <button
                                onClick={() => setAuthPopoverOpen(true)}
                                className="group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all duration-150"
                            >
                                <SignIn size={22} weight="regular" />
                                <span className="text-[10px] mt-0.5 font-medium">Log in</span>

                                {/* Tooltip */}
                                <div className="absolute left-full ml-3 px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50">
                                    <p className="text-xs font-medium">Log in</p>
                                    <p className="text-[10px] text-white/60 dark:text-neutral-500">Save & sync your data</p>
                                </div>
                            </button>

                            <Link
                                href="/settings"
                                className={cn(
                                    "group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl transition-all duration-150",
                                    activeItem === "settings"
                                        ? "bg-brand/10 text-brand"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                )}
                            >
                                <Gear size={22} weight={activeItem === "settings" ? "fill" : "regular"} />
                                <span className="text-[10px] mt-0.5 font-medium">Settings</span>

                                {/* Tooltip */}
                                <div className="absolute left-full ml-3 px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50">
                                    <p className="text-xs font-medium">Settings</p>
                                    <p className="text-[10px] text-white/60 dark:text-neutral-500">AI connections & preferences</p>
                                </div>
                            </Link>
                        </>
                    )}

                    {/* Feedback Button - Prominent for Beta */}
                    <FeedbackModal>
                        <button className="group relative flex flex-col items-center justify-center w-14 h-14 rounded-xl text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-all duration-150">
                            <ChatCircleDots size={22} weight="regular" />
                            <span className="text-[9px] mt-0.5 font-medium">Feedback</span>

                            {/* Tooltip */}
                            <div className="absolute left-full ml-3 px-3 py-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 whitespace-nowrap z-50">
                                <p className="text-xs font-medium">Send Feedback</p>
                                <p className="text-[10px] text-white/60 dark:text-neutral-500">Report bugs or share ideas</p>
                            </div>
                        </button>
                    </FeedbackModal>
                </div>
            </nav>

            {/* Mobile Bottom Tab Bar */}
            <nav className="lg:hidden fixed bottom-0 left-0 right-0 h-[4.5rem] bg-background/95 backdrop-blur-xl flex items-center justify-around px-2 z-50 shadow-[0_-4px_16px_rgb(0_0_0/0.06)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {NAV_ITEMS.filter(item => item.id !== "prepare").map((item) => {
                    const Icon = item.icon;
                    const isActive = activeItem === item.id || (item.id === "home" && activeItem === "prepare");
                    return (
                        <Link
                            key={item.id}
                            href={item.href}
                            className={cn(
                                "flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-all duration-150 min-w-[60px]",
                                isActive
                                    ? "text-brand"
                                    : "text-muted-foreground"
                            )}
                        >
                            <Icon
                                size={24}
                                weight={isActive ? "fill" : "regular"}
                            />
                            <span className={cn(
                                "text-[10px] mt-0.5 font-medium",
                                isActive && "text-brand"
                            )}>
                                {item.label}
                            </span>
                            {isActive && (
                                <div className="w-1 h-1 rounded-full bg-brand mt-0.5" />
                            )}
                        </Link>
                    );
                })}
                {/* User area */}
                {user ? (
                    <Link
                        href="/settings"
                        className={cn(
                            "flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-all duration-150 min-w-[60px]",
                            activeItem === "settings" ? "text-brand" : "text-muted-foreground"
                        )}
                    >
                        <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold uppercase",
                            activeItem === "settings" ? "bg-brand/20 text-brand" : "bg-brand/10 text-brand"
                        )}>
                            {(user.displayName || "?")[0]}
                        </div>
                        <span className={cn(
                            "text-[10px] mt-0.5 font-medium",
                            activeItem === "settings" && "text-brand"
                        )}>
                            {user.displayName || user.email?.split("@")[0]}
                        </span>
                        {activeItem === "settings" && (
                            <div className="w-1 h-1 rounded-full bg-brand mt-0.5" />
                        )}
                    </Link>
                ) : (
                    <button
                        onClick={() => setAuthPopoverOpen(true)}
                        className="flex flex-col items-center justify-center py-2 px-3 rounded-xl transition-all duration-150 min-w-[60px] text-muted-foreground"
                    >
                        <SignIn size={24} weight="regular" />
                        <span className="text-[10px] mt-0.5 font-medium">Login</span>
                    </button>
                )}
            </nav>

            {/* Auth dialog for logged-out users */}
            <AuthPopover open={authPopoverOpen} onOpenChange={setAuthPopoverOpen} showTrigger={false} />
        </div>
    );
}
