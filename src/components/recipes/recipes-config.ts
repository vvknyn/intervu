"use client";

import { Plugs, Briefcase, FileText, MagnifyingGlass, BookOpen, Article } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { RECIPE_SUBTITLES } from "@/lib/copy";

export type RecipeType = "dialog" | "navigate" | "action";

export interface Recipe {
    id: string;
    title: string;
    subtitle: string;
    icon: Icon;
    iconColor: string;
    iconBg: string;
    type: RecipeType;
    priority: number;
    estimatedMinutes: number;
    stepCount?: number;
    navigateTo?: string;
    showWhen: (ctx: RecipeContext) => boolean;
}

export interface RecipeContext {
    hasResume: boolean;
    hasApiKeys: boolean;
    storyCount: number;
}

export const RECIPES: Recipe[] = [
    {
        id: "setup",
        title: "Set Up Intervu",
        subtitle: RECIPE_SUBTITLES["setup"],
        icon: Plugs,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "dialog",
        priority: 0,
        estimatedMinutes: 3,
        stepCount: 3,
        showWhen: (ctx) => !ctx.hasApiKeys,
    },
    {
        id: "track-application",
        title: "Track New Application",
        subtitle: RECIPE_SUBTITLES["track-application"],
        icon: Briefcase,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "navigate",
        priority: 1,
        estimatedMinutes: 5,
        navigateTo: "/applications?view=new",
        showWhen: (ctx) => ctx.hasResume,
    },
    {
        id: "tailor-resume",
        title: "Tailor Resume for a Job",
        subtitle: RECIPE_SUBTITLES["tailor-resume"],
        icon: FileText,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "navigate",
        priority: 2,
        estimatedMinutes: 5,
        navigateTo: "/resume-builder?openTailoring=true",
        showWhen: (ctx) => ctx.hasResume,
    },
    {
        id: "prepare-interview",
        title: "Prepare for an Interview",
        subtitle: RECIPE_SUBTITLES["prepare-interview"],
        icon: MagnifyingGlass,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "action",
        priority: 3,
        estimatedMinutes: 2,
        showWhen: () => true,
    },
    {
        id: "add-sources",
        title: "Add Sources & Knowledge",
        subtitle: RECIPE_SUBTITLES["add-sources"],
        icon: Article,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "dialog",
        priority: 4,
        estimatedMinutes: 3,
        showWhen: () => true,
    },
    {
        id: "build-stories",
        title: "Build Your Story Bank",
        subtitle: RECIPE_SUBTITLES["build-stories"],
        icon: BookOpen,
        iconColor: "text-brand",
        iconBg: "bg-brand/10",
        type: "dialog",
        priority: 5,
        estimatedMinutes: 5,
        showWhen: () => true,
    },
];

export function getVisibleRecipes(context: RecipeContext): Recipe[] {
    return RECIPES.filter((r) => r.showWhen(context)).sort(
        (a, b) => a.priority - b.priority
    );
}
