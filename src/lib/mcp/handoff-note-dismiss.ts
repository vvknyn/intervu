/** Browser memory for the assistant handoff bar. Not per job. */
export const MCP_HANDOFF_NOTE_DISMISS_KEY = "velai.mcp-handoff-note.dismissed";

export function readMcpHandoffNoteDismissed(storage: Pick<Storage, "getItem"> | null): boolean {
    if (!storage) return false;
    try {
        return storage.getItem(MCP_HANDOFF_NOTE_DISMISS_KEY) === "1";
    } catch {
        return false;
    }
}

export function writeMcpHandoffNoteDismissed(storage: Pick<Storage, "setItem">): void {
    storage.setItem(MCP_HANDOFF_NOTE_DISMISS_KEY, "1");
}
