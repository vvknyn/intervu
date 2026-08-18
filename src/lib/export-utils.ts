import { StarStory } from "@/types";

/**
 * Hand the browser a file to save. The object URL is revoked immediately after
 * the synthetic click — the download is already queued by then, and leaving it
 * alive pins the blob in memory for the life of the document.
 */
export function downloadBlob(content: BlobPart, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function exportStoriesToText(stories: StarStory[]) {
    if (!stories || stories.length === 0) return;

    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `my-star-stories-${timestamp}.txt`;

    let content = `STAR STORIES EXPORT\nGenerated on ${new Date().toLocaleDateString()}\n\n`;
    content += `Total Stories: ${stories.length}\n`;
    content += "=================================================================\n\n";

    stories.forEach((story, index) => {
        content += `STORY #${index + 1}: ${story.title || "Untitled"}\n`;
        content += `Importance: ${story.importance ? story.importance.toUpperCase() : "NOT SET"}\n`;
        content += "-----------------------------------------------------------------\n";

        if (story.type === 'blob' || (!story.situation && story.content)) {
            content += `[Draft Content]\n${story.content || "No content"}\n`;
        } else {
            content += `SITUATION:\n${story.situation || "N/A"}\n\n`;
            content += `TASK:\n${story.task || "N/A"}\n\n`;
            content += `ACTION:\n${story.action || "N/A"}\n\n`;
            content += `RESULT:\n${story.result || "N/A"}\n`;
        }

        content += "\n=================================================================\n\n";
    });

    downloadBlob(content, filename, "text/plain");
}
