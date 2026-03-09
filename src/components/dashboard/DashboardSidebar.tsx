"use client";

import { useState, useEffect } from "react";
import { X, CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

interface SidebarSection {
    id: string;
    label: string;
    icon: any;
}

export interface SidebarGroup {
    id: string;
    label: string;
    children: SidebarSection[];
}

interface DashboardSidebarProps {
    groups: SidebarGroup[];
    activeSection: string;
    onSelectSection: (id: string) => void;
    bottomContent?: React.ReactNode;
    isOpen?: boolean;
    onClose?: () => void;
}

const SidebarContent = ({
    groups,
    activeSection,
    onSelectSection,
    bottomContent,
    onClose
}: {
    groups: SidebarGroup[];
    activeSection: string;
    onSelectSection: (id: string) => void;
    bottomContent?: React.ReactNode;
    onClose?: () => void;
}) => {
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
        const initial: Record<string, boolean> = {};
        groups.forEach(g => { initial[g.id] = true; });
        return initial;
    });

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
    };

    // Check if any child in a group is active
    const groupHasActiveChild = (group: SidebarGroup) =>
        group.children.some(c => c.id === activeSection);

    return (
        <div className="flex-1 flex flex-col w-full">
            <nav className="space-y-1">
                {groups.map((group) => {
                    const isExpanded = expandedGroups[group.id] ?? true;
                    const hasActive = groupHasActiveChild(group);
                    const Caret = isExpanded ? CaretDown : CaretRight;

                    return (
                        <div key={group.id}>
                            {/* Group Header */}
                            <button
                                onClick={() => toggleGroup(group.id)}
                                className={cn(
                                    "w-full flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded-md transition-colors",
                                    hasActive
                                        ? "text-brand"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <span>{group.label}</span>
                                <Caret size={12} weight="bold" className="opacity-50" />
                            </button>

                            {/* Children */}
                            {isExpanded && (
                                <div className="space-y-0.5 mt-0.5 mb-2">
                                    {group.children.map((section) => {
                                        const Icon = section.icon;
                                        const isActive = activeSection === section.id;
                                        return (
                                            <button
                                                key={section.id}
                                                onClick={() => {
                                                    onSelectSection(section.id);
                                                    if (onClose) onClose();
                                                }}
                                                className={cn(
                                                    "w-full flex items-center gap-2.5 pl-4 pr-3 py-2 text-sm font-medium rounded-lg transition-all duration-150",
                                                    isActive
                                                        ? "bg-brand/10 text-brand"
                                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                )}
                                            >
                                                <Icon size={16} weight={isActive ? "fill" : "regular"} />
                                                {section.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {bottomContent && (
                <div className="mt-6">
                    {bottomContent}
                </div>
            )}
        </div>
    );
};

export function DashboardSidebar({ groups, activeSection, onSelectSection, bottomContent, isOpen, onClose }: DashboardSidebarProps) {

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "auto";
        }
        return () => {
            document.body.style.overflow = "auto";
        };
    }, [isOpen]);

    return (
        <>
            {/* Desktop Sidebar */}
            <aside data-tour="dashboard-sidebar" className="w-80 hidden lg:flex flex-col sticky top-[4.5rem] self-start h-[calc(100vh-4.5rem)] pr-6 overflow-y-auto custom-scrollbar pt-2">
                <SidebarContent
                    groups={groups}
                    activeSection={activeSection}
                    onSelectSection={onSelectSection}
                    bottomContent={bottomContent}
                    onClose={onClose}
                />
            </aside>

            {/* Mobile Sidebar */}
            {isOpen && (
                <div className="fixed inset-0 z-[100] lg:hidden font-sans">
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                        onClick={onClose}
                    />
                    <div className="absolute left-0 top-0 bottom-0 w-[85%] max-w-sm bg-background shadow-2xl flex flex-col animate-in slide-in-from-left duration-300">
                        <div className="flex items-center justify-between p-4 shadow-[var(--shadow-sm)]">
                            <span className="font-semibold text-lg tracking-tight">Menu</span>
                            <button
                                onClick={onClose}
                                className="p-2 -mr-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
                            >
                                <X size={20} weight="bold" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-24">
                            <SidebarContent
                                groups={groups}
                                activeSection={activeSection}
                                onSelectSection={onSelectSection}
                                bottomContent={bottomContent}
                                onClose={onClose}
                            />
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
