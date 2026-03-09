"use client";

import { RecipeCard } from "./RecipeCard";
import { getVisibleRecipes, type Recipe, type RecipeContext } from "./recipes-config";

interface RecipeGridProps {
    context: RecipeContext;
    onSelectRecipe: (recipe: Recipe) => void;
}

export function RecipeGrid({ context, onSelectRecipe }: RecipeGridProps) {
    const recipes = getVisibleRecipes(context);

    if (recipes.length === 0) return null;

    return (
        <div data-tour="recipe-grid" className="w-full animate-in fade-in">
            <h3 className="text-sm font-medium text-muted-foreground mb-3">
                What would you like to do?
            </h3>
            <div className="flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory custom-scrollbar">
                {recipes.map((recipe) => (
                    <RecipeCard
                        key={recipe.id}
                        recipe={recipe}
                        onSelect={onSelectRecipe}
                    />
                ))}
            </div>
        </div>
    );
}
