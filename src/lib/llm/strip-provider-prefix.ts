/**
 * Strip a real bracketed provider prefix like "[Groq]" or "[OpenRouter]: ".
 *
 * Only matches a leading [...] — never a bare leading word. An earlier
 * version of this logic (bracket AND colon both optional) matched the first
 * bare word of ANY message, so "AI is temporarily out of credits on our
 * end." was mangled into "is temporarily out of credits on our end."
 *
 * Lives outside the generate-context server-actions file (whose exports
 * must all be async functions) so it stays a plain, directly unit-testable
 * pure function.
 */
export function stripProviderPrefix(msg: string): string {
    return msg.replace(/^\[[^\]]+\]\s*:?\s*/, '');
}
