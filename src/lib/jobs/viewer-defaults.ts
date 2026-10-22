/**
 * What /jobs opens on for a signed-in viewer when the address says nothing: one rule, read by the server's
 * first-frame redirect (`server-entry.ts`) and by the client (`JobsContent`), so both land on the same list.
 *
 * A default fills only a param the address does not carry; an explicit value always wins (the URL is the only
 * state: a sort or work type the visitor picked is written into it and stays across searches). A visitor with
 * no résumé on file, or a guest, gets nothing.
 */
export interface ViewerDefaults {
    sort: "fit" | null;
    workType: "remote" | null;
}

export function viewerDefaults(
    url: { sort?: string | null; workType?: string | null },
    viewer: { resumeOnFile: boolean; remoteOnly: boolean },
): ViewerDefaults {
    return {
        sort: viewer.resumeOnFile && !url.sort ? "fit" : null,
        workType: viewer.remoteOnly && !url.workType ? "remote" : null,
    };
}
