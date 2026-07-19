"use client";

import { useState, useEffect, useRef, KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Clock, MagnifyingGlass, Buildings, CaretRight } from "@phosphor-icons/react";
import { getSuggestions, SearchSuggestion } from "@/lib/search-suggestions";
import { cn } from "@/lib/utils";

interface SearchAutocompleteProps {
    value: string;
    onChange: (value: string) => void;
    onSearch: () => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string; // Class for the Input
    containerClassName?: string;
    autoFocus?: boolean;
    /**
     * Optional async suggestion source (e.g. title/company from a live search
     * index). When provided, it REPLACES the local `getSuggestions` + history
     * source entirely — default behavior (no prop) is unchanged, so existing/
     * future callers (prep pages) keep working without edits. Debounced
     * 150ms; a monotonic generation guard drops out-of-order responses so a
     * slow, stale request can't clobber a faster, newer one.
     */
    suggest?: (q: string) => Promise<SearchSuggestion[]>;
}

export function SearchAutocomplete({
    value,
    onChange,
    onSearch,
    placeholder,
    disabled,
    className,
    containerClassName,
    autoFocus,
    suggest
}: SearchAutocompleteProps) {
    const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    const [history, setHistory] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = localStorage.getItem("interview-os-recent-searches");
            if (saved) return JSON.parse(saved);
        } catch (e) { console.error(e); }
        return [];
    });
    const containerRef = useRef<HTMLDivElement>(null);
    // Always holds the latest `onSearch` prop. `handleSelect` (below) changes
    // `value` via `onChange` and then needs to call `onSearch` — but the
    // callback the parent passes in typically closes over its own `value`
    // state, so calling the closure captured at THIS render would search the
    // pre-selection text. Reading through a ref that's kept current every
    // render sidesteps that stale-closure race without changing the prop
    // contract (mirrors the "wait a tick for state to update" comment this
    // replaces — now correct instead of accidentally-right).
    const onSearchRef = useRef(onSearch);
    useEffect(() => {
        onSearchRef.current = onSearch;
    });
    // Monotonic generation guard for the async `suggest` path (same shape as
    // FitIntentGuard in app/jobs/page.tsx): only the response from the LAST
    // request issued gets to update state, so a slow, stale response can't
    // clobber a faster, newer one.
    const suggestGenRef = useRef(0);

    // Update suggestions
    useEffect(() => {
        if (!isOpen) return;

        if (suggest) {
            const q = value.trim();
            if (!q) {
                setSuggestions([]);
                return;
            }
            const generation = ++suggestGenRef.current;
            const timer = setTimeout(() => {
                suggest(q)
                    .then((results) => {
                        if (suggestGenRef.current === generation) setSuggestions(results);
                    })
                    .catch(() => {
                        if (suggestGenRef.current === generation) setSuggestions([]);
                    });
            }, 150);
            return () => clearTimeout(timer);
        }

        const timer = setTimeout(() => {
            if (value.trim() === "") {
                setSuggestions(history.slice(0, 5).map(h => ({ text: h, type: 'history' })));
            } else {
                setSuggestions(getSuggestions(value, history));
            }
        }, 0);
        return () => clearTimeout(timer);
    }, [value, history, isOpen, suggest]);

    // Click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        // Bubble up arrow keys only if dropdown is open and has items
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isOpen && suggestions.length > 0) {
            e.preventDefault();
            if (e.key === "ArrowDown") {
                setActiveIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : prev));
            } else {
                setActiveIndex(prev => (prev > 0 ? prev - 1 : -1));
            }
        } else if (e.key === "Enter") {
            if (isOpen && activeIndex >= 0 && suggestions[activeIndex]) {
                e.preventDefault();
                handleSelect(suggestions[activeIndex].text);
            } else {
                setIsOpen(false);
                onSearchRef.current();
            }
        } else if (e.key === "Escape") {
            setIsOpen(false);
        }
    };

    const handleSelect = (text: string) => {
        onChange(text);
        setIsOpen(false);

        // History bookkeeping is part of the local (non-`suggest`) source —
        // skip it when an external provider is wired in so a jobs-search pick
        // doesn't pollute the shared prep-search recents bucket.
        if (!suggest) {
            const newHistory = [text, ...history.filter(h => h !== text)].slice(0, 10);
            setHistory(newHistory);
            localStorage.setItem("interview-os-recent-searches", JSON.stringify(newHistory));
        }

        // Wait a tick so the parent's re-render (triggered by the `onChange`
        // above) lands before we search — `onSearchRef` always holds the
        // latest `onSearch` closure, so this reads the post-selection value.
        setTimeout(() => onSearchRef.current(), 0);
    };

    return (
        <div className={cn("relative group", containerClassName)} ref={containerRef}>
            <MagnifyingGlass
                size={20}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground z-30 pointer-events-none"
                weight="regular"
            />
            <Input
                type="text"
                placeholder={placeholder}
                className={cn("pl-12 pr-4 relative z-20 transition-all", className)}
                value={value}
                onChange={(e) => {
                    onChange(e.target.value);
                    setIsOpen(true);
                    setActiveIndex(-1);
                }}
                onFocus={() => setIsOpen(true)}
                onKeyDown={handleKeyDown}
                disabled={disabled}
                autoFocus={autoFocus}
            />

            {/* Dropdown */}
            {isOpen && suggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-xl z-[100] overflow-hidden animate-in fade-in slide-in-from-top-1">
                    <ul role="listbox" aria-label="Search suggestions" className="py-2 max-h-[300px] overflow-y-auto">
                        {suggestions.map((suggestion, index) => (
                            <li
                                key={index}
                                role="option"
                                aria-selected={index === activeIndex}
                                className={cn(
                                    "px-4 py-3 flex items-center gap-3 cursor-pointer transition-colors text-sm",
                                    index === activeIndex ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                )}
                                onClick={() => handleSelect(suggestion.text)}
                                onMouseEnter={() => setActiveIndex(index)}
                            >
                                {suggestion.type === 'history' ? (
                                    <Clock size={16} className="shrink-0 opacity-70" />
                                ) : suggestion.type === 'company' ? (
                                    <Buildings size={16} className="shrink-0 opacity-70" />
                                ) : (
                                    <MagnifyingGlass size={16} className="shrink-0 opacity-70" />
                                )}
                                <span className="flex-1 truncate">
                                    {suggestion.text}
                                </span>
                                {index === activeIndex && (
                                    <CaretRight size={14} className="opacity-50" />
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
