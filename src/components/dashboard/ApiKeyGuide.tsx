import { ExternalLink } from "lucide-react";

export function ApiKeyGuide() {
    return (
        <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-medium mb-2">How to get your key</h4>
            <div className="space-y-1">
                <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-foreground hover:bg-muted/50">
                        Groq — fastest, free
                        <span className="ml-2 shrink-0 transition-transform duration-200 group-open:rotate-180">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </span>
                    </summary>
                    <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground space-y-1.5 animate-in slide-in-from-top-1">
                        <p>1. Go to <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" className="text-brand underline inline-flex items-center gap-1">Groq Console <ExternalLink size={10} /></a>.</p>
                        <p>2. Log in or sign up.</p>
                        <p>3. Click &quot;Create Key&quot;.</p>
                        <p>4. Copy the key starting with <code>gsk_</code> and paste it above.</p>
                    </div>
                </details>

                <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-foreground hover:bg-muted/50">
                        Google Gemini — free, large context
                        <span className="ml-2 shrink-0 transition-transform duration-200 group-open:rotate-180">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </span>
                    </summary>
                    <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground space-y-1.5 animate-in slide-in-from-top-1">
                        <p>1. Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-brand underline inline-flex items-center gap-1">Google AI Studio <ExternalLink size={10} /></a>.</p>
                        <p>2. Click &quot;Create Key&quot;.</p>
                        <p>3. Select a project (or create one).</p>
                        <p>4. Copy the key and paste it above.</p>
                    </div>
                </details>

                <details className="group">
                    <summary className="flex cursor-pointer items-center justify-between rounded-lg px-2 py-2 text-xs font-medium text-foreground hover:bg-muted/50">
                        OpenAI — most capable, pay-as-you-go
                        <span className="ml-2 shrink-0 transition-transform duration-200 group-open:rotate-180">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </span>
                    </summary>
                    <div className="px-2 pb-2 pt-1 text-xs text-muted-foreground space-y-1.5 animate-in slide-in-from-top-1">
                        <p>0. Make sure you have an OpenAI developer account (separate from ChatGPT).</p>
                        <p>1. Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-brand underline inline-flex items-center gap-1">OpenAI Platform <ExternalLink size={10} /></a>.</p>
                        <p>2. Log in and click &quot;Create new secret key&quot;.</p>
                        <p>3. Name your key and create it.</p>
                        <p>4. Copy the key starting with <code>sk-</code> and paste it above.</p>
                    </div>
                </details>
            </div>
        </div>
    );
}
