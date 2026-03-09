import { Newspaper } from "@phosphor-icons/react";
import { CompanyReconData } from "@/types";
import MarkdownIt from "markdown-it";
import { useMemo } from "react";

const md = new MarkdownIt();

interface CompanyReconProps {
    data: CompanyReconData;
}

export function CompanyRecon({ data }: CompanyReconProps) {
    const renderedDesc = useMemo(() => md.render(data.description || ""), [data.description]);

    const subtitle = (
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mt-1">
            <span className="bg-muted/50 px-2 py-0.5 rounded-md">{data.ticker || "Private"}</span>
            {data.industry && (
                <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{data.industry}</span>
                </>
            )}
            {data.vibe && (
                <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-brand-muted">{data.vibe}</span>
                </>
            )}
        </div>
    );

    return (
        <div className="w-full pt-4 mt-4 border-t border-border/50 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex flex-col gap-1 mb-4">
                <h3 className="text-lg font-bold tracking-tight">{data.name}</h3>
                {subtitle}
            </div>

            <div
                className="text-xs text-muted-foreground mb-4 leading-relaxed line-clamp-4"
                dangerouslySetInnerHTML={{ __html: renderedDesc }}
            />

            <div className="flex gap-3 mb-4">
                <a
                    href={`https://news.google.com/search?q=${data.name}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-medium text-muted-foreground hover:text-brand transition-colors flex items-center gap-1 uppercase tracking-wider"
                >
                    News
                </a>
                <span className="text-border text-[10px]">|</span>
                <a
                    href={`https://www.google.com/search?q=${data.name}+stock`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-medium text-muted-foreground hover:text-brand transition-colors flex items-center gap-1 uppercase tracking-wider"
                >
                    Stock
                </a>
            </div>
        </div>
    );
}
