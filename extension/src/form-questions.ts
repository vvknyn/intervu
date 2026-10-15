/**
 * The free-text questions on an application form ("Why do you want to work
 * here?", "Describe your experience with X"), found the same way on any site:
 * a visible, empty text area (or a one-line box whose label reads as a
 * question) that isn't one of the contact fields form-fill.ts fills. The card
 * lists them and drafts an answer to one only when the person taps its
 * button; each carries the verdict of question.ts, which questions Velai
 * leaves to the person (work authorisation, pay, demographics...) and why.
 *
 * Runs in the card's content script. It reads labels; it never writes to the
 * page (inserting a draft is the card's, on the person's tap).
 */
import { classifyQuestion, looksLikeQuestion, questionText, type QuestionVerdict } from "@/lib/screening/question";
import { fieldKind, hintFor, isPicker, labelOf, visible } from "./form-fill";

export interface FormQuestion {
    el: HTMLTextAreaElement | HTMLInputElement;
    /** The question as the form words it, without its marks ("*", "(required)"). */
    text: string;
    verdict: QuestionVerdict;
}

/** The most questions the card lists. */
export const QUESTIONS_MAX = 8;
/** A text area's label has to say at least this much to be a question (not "Address"). */
const TEXTAREA_LABEL_MIN_CHARS = 15;
/** Input types that hold a typed answer. */
const ONE_LINE_TYPES = new Set(["", "text"]);

/** The nearest text before a control that holds no control of its own: the question on forms that don't use <label for>. */
function nearbyLabel(el: Element): string {
    let node: Element | null = el;
    for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
        const before: Element | null = node.previousElementSibling;
        if (!before || before.querySelector("input, textarea, select, button")) continue;
        const text = ((before as HTMLElement).innerText || before.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 300) return text;
    }
    return "";
}

function questionOf(el: HTMLTextAreaElement | HTMLInputElement): string {
    const label = questionText(labelOf(el));
    if (label) return label;
    const placeholder = questionText(el.getAttribute("placeholder") ?? "");
    if (looksLikeQuestion(placeholder)) return placeholder;
    return el instanceof HTMLTextAreaElement ? questionText(nearbyLabel(el)) : "";
}

/** The questions on the page that are still empty, in page order. */
export function findQuestions(doc: Document = document): FormQuestion[] {
    const found: FormQuestion[] = [];
    for (const el of Array.from(doc.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea, input"))) {
        if (found.length === QUESTIONS_MAX) break;
        if (el.disabled || el.readOnly || el.value.trim() || !visible(el) || isPicker(el)) continue;
        const text = questionOf(el);
        if (el instanceof HTMLInputElement) {
            if (!ONE_LINE_TYPES.has((el.getAttribute("type") ?? "").toLowerCase())) continue;
            // A plain field of the form (name, email, LinkedIn...) is the fill button's, not a question.
            if (fieldKind(hintFor(el)) || !looksLikeQuestion(text)) continue;
        }
        const verdict = classifyQuestion(text);
        // A short text-area label ("Address") is no question; "Cover letter" is listed, to say it is the person's.
        const coverLetter = !verdict.draft && /cover letter/.test(verdict.reason);
        if (el instanceof HTMLTextAreaElement && text.length < TEXTAREA_LABEL_MIN_CHARS && !looksLikeQuestion(text) && !coverLetter) continue;
        found.push({ el, text, verdict });
    }
    return found;
}
