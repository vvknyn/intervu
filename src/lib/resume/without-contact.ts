/**
 * Text without what identifies the person: their name, email, phone numbers
 * and links. Everything sent to the sealed AI server (a résumé read, a
 * screening answer's lines) goes through here first. A module of its own so
 * the Chrome extension takes it without bundling the résumé parser.
 */
export function withoutContactDetails(text: string, name?: string): string {
    let out = text
        .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "")
        .replace(/\b(https?:\/\/|www\.)\S+/gi, "")
        .replace(/\b[\w-]+\.(com|io|me|dev|net|org)\/\S+/gi, "")
        .replace(/\+\d[\d\s().-]{7,}\d/g, "")
        .replace(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "");
    const who = name?.trim();
    if (who && who.length >= 3) out = out.split(who).join("");
    return out;
}
