import { DownloadSimple, MagnifyingGlass, WarningCircle, Eraser, ArrowsClockwise, ArrowRight, DotsThreeVertical } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KeyboardEvent } from "react";
import { User as SupabaseUser } from "@supabase/supabase-js";

import { ModelSwitcher } from "@/components/dashboard/ModelSwitcher";
import { PrepSettings, QuestionSettings } from "@/components/dashboard/PrepSettings";

interface HeaderProps {
  searchQuery?: string;
  setSearchQuery?: (value: string) => void;
  onAnalyze?: () => void;
  isAnalyzing?: boolean;
  onExportPDF?: () => void;
  isExportingPDF?: boolean;
  onReset?: () => void;
  error?: string | null;
  company?: string;
  position?: string;
  round?: string;
  user: SupabaseUser | null;
  showSearch?: boolean;
  title?: string;
  onOpenSidebar?: () => void;
  modelProvider?: 'groq' | 'gemini' | 'openai';
  modelId?: string;
  onModelChange?: (provider: 'groq' | 'gemini' | 'openai', modelId: string) => void;
  apiKeys?: { groq?: string; gemini?: string; openai?: string };
  onConfigureKey?: (provider: 'groq' | 'gemini' | 'openai') => void;
  onRemoveKey?: (provider: 'groq' | 'gemini' | 'openai') => void;
  onRegenerateAll?: () => void;
  isRegeneratingAll?: boolean;
  prepSettings?: QuestionSettings;
  onPrepSettingsChange?: (settings: QuestionSettings) => void;
  // Job Context
  jobUrl?: string;
  onJobUrlChange?: (url: string) => void;
  jobContext?: string;
  onJobContextChange?: (context: string) => void;
  isFetchingJob?: boolean;
  onFetchJobContext?: () => void;
  backButton?: React.ReactNode;
  hasPendingChanges?: boolean;
}

export function Header({
  searchQuery = "",
  setSearchQuery = () => { },
  onAnalyze = () => { },
  isAnalyzing = false,
  onExportPDF,
  isExportingPDF,
  onReset,
  error,
  user,
  showSearch = true,
  title,
  onOpenSidebar,
  modelProvider,
  modelId,
  onModelChange,
  apiKeys,
  onConfigureKey,
  onRemoveKey,
  onRegenerateAll,
  isRegeneratingAll = false,
  prepSettings,
  onPrepSettingsChange,
  jobUrl,
  onJobUrlChange,
  jobContext,
  onJobContextChange,
  isFetchingJob,
  onFetchJobContext,
  backButton,
  hasPendingChanges = false
}: HeaderProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      onAnalyze();
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl shadow-[var(--shadow-sm)]">
      <div className="px-4 h-16 flex items-center gap-2 sm:gap-4 overflow-hidden">
        {/* Mobile Menu Button */}
        {onOpenSidebar && (
          <Button variant="ghost" size="icon" className="lg:hidden -ml-2 text-muted-foreground" onClick={onOpenSidebar}>
            <div className="space-y-1.5">
              <div className="w-5 h-0.5 bg-current rounded-full"></div>
              <div className="w-5 h-0.5 bg-current rounded-full"></div>
              <div className="w-5 h-0.5 bg-current rounded-full"></div>
            </div>
          </Button>
        )}

        {/* Back Button */}
        {backButton && (
          <div className="mr-2">
            {backButton}
          </div>
        )}

        {title && !showSearch && (
          <div className="flex-1">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          </div>
        )}

        {/* Search Bar */}
        {showSearch && (
          <>
            <div className="flex-1 max-w-2xl">
              <div className="relative">
                {/* Left side: PrepSettings icon or magnifying glass fallback */}
                <div className="absolute left-2 inset-y-0 flex items-center">
                  {prepSettings && onPrepSettingsChange ? (
                    <div data-tour="prep-settings">
                      <PrepSettings
                        settings={prepSettings}
                        onChange={onPrepSettingsChange}
                        jobUrl={jobUrl || ""}
                        onJobUrlChange={onJobUrlChange || (() => { })}
                        jobContext={jobContext || ""}
                        onJobContextChange={onJobContextChange || (() => { })}
                        isFetchingJob={isFetchingJob || false}
                        onFetchJobContext={onFetchJobContext || (() => { })}
                      />
                    </div>
                  ) : (
                    <MagnifyingGlass
                      size={18}
                      className="ml-1 text-muted-foreground"
                      weight="regular"
                    />
                  )}
                </div>
                <Input
                  data-tour="search-input"
                  type="text"
                  className="h-10 pl-11 pr-12 text-sm bg-muted/30 focus-visible:bg-muted/50 transition-all duration-150 w-full"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery && setSearchQuery(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. Google PM final round"
                />
                {/* Right side: inline submit arrow */}
                <div className="absolute right-1.5 inset-y-0 flex items-center">
                  <button
                    data-tour="analyze-button"
                    onClick={onAnalyze}
                    disabled={isAnalyzing}
                    className={`group/btn relative flex items-center justify-center w-7 sm:w-auto sm:justify-start h-7 sm:px-2 rounded-md disabled:opacity-50 transition-all duration-300 ${hasPendingChanges && !isAnalyzing ? 'bg-amber-500 hover:bg-amber-600 text-white ring-2 ring-amber-400/50' : 'bg-brand text-brand-foreground hover:bg-brand/90'}`}
                  >
                    {hasPendingChanges && !isAnalyzing && (
                      <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      </span>
                    )}
                    {isAnalyzing ? (
                      <div className="w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin" />
                    ) : hasPendingChanges ? (
                      <ArrowsClockwise weight="bold" size={16} className="shrink-0" />
                    ) : (
                      <ArrowRight weight="bold" size={16} className="shrink-0" />
                    )}
                    <span className="hidden sm:grid grid-cols-[0fr] group-hover/btn:grid-cols-[1fr] transition-all duration-200">
                      <span className="overflow-hidden whitespace-nowrap text-xs font-medium pl-1.5">
                        {hasPendingChanges ? "Update" : "Analyze"}
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* Desktop actions — hidden on mobile */}
          {onReset && (
            <button
              onClick={onReset}
              className="group hidden md:inline-flex items-center h-9 px-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
              title="Start Over"
            >
              <Eraser size={18} weight="regular" className="shrink-0" />
              <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium pl-1.5">Clear</span>
              </span>
            </button>
          )}

          {onRegenerateAll && (
            <button
              onClick={onRegenerateAll}
              disabled={isRegeneratingAll}
              className="group hidden sm:inline-flex items-center h-9 px-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150 disabled:opacity-50"
              title="Regenerate All Content"
            >
              {isRegeneratingAll ? (
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0"></div>
              ) : (
                <ArrowsClockwise size={18} weight="bold" className="shrink-0" />
              )}
              <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium pl-1.5">Regenerate</span>
              </span>
            </button>
          )}

          {onExportPDF && (
            <button
              onClick={onExportPDF}
              disabled={isExportingPDF}
              className="group hidden sm:inline-flex items-center h-9 px-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150 disabled:opacity-50"
              title="Export PDF"
            >
              {isExportingPDF ? (
                <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0"></div>
              ) : (
                <DownloadSimple size={18} weight="regular" className="shrink-0" />
              )}
              <span className="grid grid-cols-[0fr] group-hover:grid-cols-[1fr] transition-all duration-200">
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium pl-1.5">PDF</span>
              </span>
            </button>
          )}

          {/* Model Switcher — desktop only */}
          {modelProvider && modelId && onModelChange && (
            <div data-tour="model-switcher" className="hidden sm:block">
              <ModelSwitcher
                provider={modelProvider}
                model={modelId}
                onModelChange={onModelChange}
                apiKeys={apiKeys}
                onConfigureKey={onConfigureKey}
                onRemoveKey={onRemoveKey}
              />
            </div>
          )}

          {/* Mobile overflow menu (⋮) — contains all hidden actions */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="sm:hidden flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                <DotsThreeVertical size={22} weight="bold" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto min-w-[10rem] p-1.5 sm:hidden">
              {/* Model Switcher — full width */}
              {modelProvider && modelId && onModelChange && (
                <div className="pb-1.5 mb-1.5 border-b border-border">
                  <ModelSwitcher
                    provider={modelProvider}
                    model={modelId}
                    onModelChange={onModelChange}
                    apiKeys={apiKeys}
                    onConfigureKey={onConfigureKey}
                    onRemoveKey={onRemoveKey}
                    className="w-full"
                  />
                </div>
              )}

              {onRegenerateAll && (
                <button
                  onClick={onRegenerateAll}
                  disabled={isRegeneratingAll}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {isRegeneratingAll ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <ArrowsClockwise size={18} weight="bold" className="shrink-0 text-muted-foreground" />
                  )}
                  Regenerate All
                </button>
              )}

              {onExportPDF && (
                <button
                  onClick={onExportPDF}
                  disabled={isExportingPDF}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md hover:bg-muted/50 transition-colors disabled:opacity-50"
                >
                  {isExportingPDF ? (
                    <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin shrink-0" />
                  ) : (
                    <DownloadSimple size={18} weight="regular" className="shrink-0 text-muted-foreground" />
                  )}
                  Export PDF
                </button>
              )}

              {onReset && (
                <button
                  onClick={onReset}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-md hover:bg-muted/50 transition-colors text-destructive"
                >
                  <Eraser size={18} weight="regular" className="shrink-0" />
                  Clear All
                </button>
              )}
            </PopoverContent>
          </Popover>

        </div>
      </div>

      {/* Error Banner - full width below header row */}
      {error && (
        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
            <WarningCircle size={14} weight="fill" className="shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}
    </header>
  );
}
