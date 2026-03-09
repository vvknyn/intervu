"use client";

import { cn } from "@/lib/utils";
import { Clock, ArrowRight } from "@phosphor-icons/react";
import type { Recipe } from "./recipes-config";

interface RecipeCardProps {
    recipe: Recipe;
    onSelect: (recipe: Recipe) => void;
}

export function RecipeCard({ recipe, onSelect }: RecipeCardProps) {
    const Icon = recipe.icon;

    return (
        <button
            data-tour={`recipe-${recipe.id}`}
            onClick={() => onSelect(recipe)}
            className={cn(
                "group text-left p-4 rounded-xl border border-border/40 bg-card",
                "hover:shadow-md hover:border-border/60 transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "min-w-[160px] flex-1 snap-start shrink-0"
            )}
        >
            <div className="flex items-start justify-between mb-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", recipe.iconBg)}>
                    <Icon size={22} weight="duotone" className={recipe.iconColor} />
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={12} />
                    <span>~{recipe.estimatedMinutes}min</span>
                </div>
            </div>
            <h3 className="font-semibold text-sm mb-1 group-hover:text-brand transition-colors">
                {recipe.title}
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed mb-2">
                {recipe.subtitle}
            </p>
            <div className="flex items-center justify-between">
                {recipe.stepCount && (
                    <span className="text-[10px] text-muted-foreground/70">
                        {recipe.stepCount} steps
                    </span>
                )}
                <ArrowRight
                    size={14}
                    className="text-muted-foreground/40 group-hover:text-brand group-hover:translate-x-0.5 transition-all ml-auto"
                />
            </div>
        </button>
    );
}
