/**
 * Filling a job application form from the person's Velai résumé, on their
 * click on the card. One rule for any site: each field is recognised by what
 * the form itself says about it (its label, name, id, placeholder or
 * autocomplete token), never by a site-specific selector.
 *
 * What it fills: name (full, or first and last), email, phone, city or
 * location, LinkedIn, GitHub and website, from the résumé's own contact
 * lines, and the résumé upload, with the PDF tailored to the job. What it
 * leaves alone: anything already filled in, drop-downs, checkboxes and radio
 * buttons (work authorisation, demographics), free-text questions, and
 * fields it doesn't recognise. It never submits the form: the person checks
 * it and presses the site's own button.
 *
 * `fieldKind`, `contactValues` and `isConfirmation` are pure; the rest reads
 * and writes the page and runs in the card's content script.
 */
import type { ResumeProfile } from "@/types/resume";

export type FieldKind = "firstName" | "lastName" | "fullName" | "email" | "phone" | "city" | "location" | "linkedin" | "github" | "website" | "resume";

/** What a form says about one of its fields. */
export interface FieldHint {
    /** The input's type, lowercased ("text", "email", "tel", "url", "file"). */
    type: string;
    autocomplete: string;
    name: string;
    id: string;
    /** Its label: a <label>, aria-label or aria-labelledby text. */
    label: string;
    placeholder: string;
}

/** Text fields worth recognising; anything else (dates, numbers, passwords) is left alone. */
const TEXT_TYPES = new Set(["", "text", "email", "tel", "url", "search"]);

/** Words that make a name, email or phone field someone else's (a referrer's, a manager's) or another kind of name. */
const NOT_THE_PERSON = /\b(company|employer|organi[sz]ation|school|university|college|institution|reference|referee|referr\w*|manager|supervisor|recruiter|emergency|spouse|parent|guardian|middle|preferred|nick ?name|maiden|previous|former|other names?|user ?name|password|pronouns?)\b/;

/** Pure: "firstName", "first_name", "urls[LinkedIn]" → "first name", "urls linkedin". */
function words(text: string): string {
    return text
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .replace(/[_\-[\].:*()/]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/** A label without the marks forms add: "Full name *", "Email (required)". */
function bareLabel(label: string): string {
    return words(label.replace(/\(\s*(required|optional)\s*\)|[*✱•]/gi, ""));
}

const BY_AUTOCOMPLETE: Record<string, FieldKind> = {
    "given-name": "firstName",
    "family-name": "lastName",
    name: "fullName",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    "address-level2": "city",
    url: "website",
};

/** Pure: which résumé detail a form field asks for, or null when it asks for something else. */
export function fieldKind(hint: FieldHint): FieldKind | null {
    const type = hint.type.toLowerCase();
    const all = words([hint.label, hint.name, hint.id, hint.placeholder].join(" "));
    if (type === "file") {
        const resume = /\b(r[eé]sum[eé]s?|cv|curriculum vitae)\b/.test(all);
        return resume && !/\b(cover|letter|transcripts?|writing|sample|additional|other|supporting)\b/.test(all) ? "resume" : null;
    }
    if (!TEXT_TYPES.has(type)) return null;
    // A token such as "section-x shipping given-name": the last word is the field.
    const token = hint.autocomplete.toLowerCase().trim().split(/\s+/).pop() ?? "";
    const label = bareLabel(hint.label);
    if (/\b(referr\w*|reference|referee|manager|supervisor|recruiter|emergency)\b/.test(all)) return null;
    if (BY_AUTOCOMPLETE[token]) return BY_AUTOCOMPLETE[token];
    if (/\blinked ?in\b/.test(all)) return "linkedin";
    if (/\bgit ?hub\b/.test(all)) return "github";
    if (type === "email" || /\be ?mail\b/.test(all)) return NOT_THE_PERSON.test(all) ? null : "email";
    if (/\b(website|web site|portfolio|personal (site|url|page|link)|blog)\b/.test(all)) return "website";
    if (type === "tel" || /\b(phone|mobile|cell|telephone)\b/.test(all)) {
        return /\b(ext|extension|country code|type)\b/.test(all) || NOT_THE_PERSON.test(all) ? null : "phone";
    }
    if (/\b(first|given|fore) ?name\b|\bfname\b/.test(all)) return NOT_THE_PERSON.test(all.replace(/\b(first|given|fore) ?name\b/, "")) ? null : "firstName";
    if (/\b(last|family|sur) ?name\b|\bsurname\b|\blname\b/.test(all)) return NOT_THE_PERSON.test(all.replace(/\b(last|family|sur) ?name\b/, "")) ? null : "lastName";
    const nameOnly = /^(your |full |legal |full legal |candidate |applicant )?name$/;
    if (nameOnly.test(label) || (!label && (nameOnly.test(words(hint.name)) || /\bsystemfield name$/.test(words(hint.name))))) return "fullName";
    if (/\b(relocat\w*|prefer\w*|willing|desired|work location|office|open to)\b/.test(all)) return null;
    if (/\bcity\b/.test(all)) return "city";
    if (/^(current )?location$|\bwhere are you (based|located)\b|\bcurrent location\b/.test(label || words(hint.name))) return "location";
    return null;
}

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "la", "le", "dos", "das", "bin", "bint", "al", "el", "ter", "ten"]);

/** "JORDAN LEE" → "Jordan Lee"; a name already in mixed case stays as written. */
function nameCase(name: string): string {
    if (name !== name.toUpperCase()) return name;
    return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => `${sep}${ch.toUpperCase()}`);
}

function withScheme(url: string): string {
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
}

/**
 * Pure: what each kind of field gets, from the résumé's contact lines. The
 * last word of the name is the last name, with any particle before it ("van",
 * "de"); a detail the résumé doesn't have is left out.
 */
export function contactValues(profile: Pick<ResumeProfile, "name" | "email" | "phone" | "location" | "linkedin" | "website">): Partial<Record<FieldKind, string>> {
    const out: Partial<Record<FieldKind, string>> = {};
    const name = nameCase((profile.name ?? "").replace(/\s+/g, " ").trim());
    if (name) {
        out.fullName = name;
        const parts = name.split(" ");
        if (parts.length > 1) {
            let cut = parts.length - 1;
            while (cut > 1 && PARTICLES.has(parts[cut - 1].toLowerCase())) cut--;
            out.firstName = parts.slice(0, cut).join(" ");
            out.lastName = parts.slice(cut).join(" ");
        }
    }
    if (profile.email?.trim()) out.email = profile.email.trim();
    if (profile.phone?.trim()) out.phone = profile.phone.trim();
    const location = profile.location?.trim();
    if (location) {
        out.location = location;
        out.city = location.split(",")[0].trim();
    }
    if (profile.linkedin?.trim()) out.linkedin = withScheme(profile.linkedin);
    const website = profile.website?.trim();
    if (website) {
        out.website = withScheme(website);
        if (/github\.com/i.test(website)) out.github = out.website;
    }
    return out;
}

/** What sites say once an application went through. */
const CONFIRMATION =
    /\b(thank(s| you) for (applying|your application|submitting)|application (was |has been )?(submitted|received|sent|complete)|we('ve| have) received your application|your application (is|was|has been) (submitted|received|in)|successfully (applied|submitted))\b/i;

/** Pure: whether a page's text says the application was sent. */
export function isConfirmation(text: string): boolean {
    return CONFIRMATION.test(text);
}

// ── In the page ────────────────────────────────────────────────────────────

export interface FormField {
    el: HTMLInputElement;
    kind: FieldKind;
}

function visible(el: Element): boolean {
    return (el as HTMLElement).offsetParent !== null || (el as HTMLElement).getClientRects().length > 0;
}

function textOf(ids: string): string {
    return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
}

function labelOf(input: HTMLInputElement): string {
    const labels = Array.from(input.labels ?? []).map((l) => l.textContent ?? "");
    const aria = [input.getAttribute("aria-label") ?? "", textOf(input.getAttribute("aria-labelledby") ?? "")];
    let text = [...labels, ...aria].join(" ").replace(/\s+/g, " ").trim();
    // A file input is often a bare control inside a "Resume/CV" box: use the widest box around it that is still short.
    if (!text && input.type === "file") {
        let node: HTMLElement | null = input.parentElement;
        for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
            const own = (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim();
            if (own.length > 120) break;
            if (own) text = own;
        }
    }
    return text;
}

function hintFor(input: HTMLInputElement): FieldHint {
    return {
        type: (input.getAttribute("type") ?? "").toLowerCase(),
        autocomplete: input.getAttribute("autocomplete") ?? "",
        name: input.getAttribute("name") ?? "",
        id: input.id,
        label: labelOf(input),
        placeholder: input.getAttribute("placeholder") ?? "",
    };
}

/** A field that opens a list to pick from (a location picker): typing alone leaves it half set, so it's the person's. */
function isPicker(input: HTMLInputElement): boolean {
    const auto = (input.getAttribute("aria-autocomplete") ?? "").toLowerCase();
    return input.getAttribute("role") === "combobox" || auto === "list" || auto === "both";
}

/**
 * The application form's fields Velai can fill, or null when the page has no
 * application form: one needs an email field and a name field or a résumé
 * upload, and no password field (that's a sign-in or account form).
 */
export function findApplicationForm(doc: Document = document): FormField[] | null {
    const inputs = Array.from(doc.querySelectorAll("input"));
    if (inputs.some((input) => input.type === "password" && visible(input))) return null;
    const fields: FormField[] = [];
    const files: { input: HTMLInputElement; hint: FieldHint }[] = [];
    for (const input of inputs) {
        if (input.disabled || input.readOnly) continue;
        const hint = hintFor(input);
        if (hint.type === "file") files.push({ input, hint });
        else if (!visible(input) || isPicker(input)) continue;
        const kind = fieldKind(hint);
        if (kind) fields.push({ el: input, kind });
    }
    // The form's only upload, when nothing says it's for something else, is the résumé.
    if (files.length === 1 && !fields.some((f) => f.kind === "resume")) {
        const [{ input, hint }] = files;
        if (!/\b(cover|letter|transcripts?|writing|sample|photo|picture|image)\b/.test(words([hint.label, hint.name, hint.id].join(" ")))) fields.push({ el: input, kind: "resume" });
    }
    const has = (...kinds: FieldKind[]) => fields.some((f) => kinds.includes(f.kind));
    if (!has("email") || !has("fullName", "firstName", "lastName", "resume")) return null;
    return fields;
}

/** Sets a field's value so the page's own scripts see it, as if typed. */
function setValue(input: HTMLInputElement, value: string): void {
    input.focus({ preventScroll: true });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new FocusEvent("blur"));
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    input.blur();
}

export interface ResumeFile {
    bytes: Uint8Array<ArrayBuffer>;
    filename: string;
}

/**
 * Fills the fields that are still empty and that the résumé has a value for,
 * attaches the résumé to the first empty résumé upload, and returns the kinds
 * it filled. Never presses a button.
 */
export function fillForm(fields: FormField[], values: Partial<Record<FieldKind, string>>, resume: ResumeFile | null): FieldKind[] {
    const filled: FieldKind[] = [];
    let attached = false;
    for (const { el, kind } of fields) {
        if (kind === "resume") {
            if (attached || !resume || (el.files && el.files.length)) continue;
            const transfer = new DataTransfer();
            transfer.items.add(new File([resume.bytes], resume.filename, { type: "application/pdf" }));
            el.files = transfer.files;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            attached = true;
            filled.push(kind);
            continue;
        }
        const value = values[kind];
        if (!value || el.value.trim()) continue;
        setValue(el, value);
        if (!filled.includes(kind)) filled.push(kind);
    }
    return filled;
}

const KIND_WORDS: Record<FieldKind, string> = {
    fullName: "name",
    firstName: "name",
    lastName: "name",
    email: "email",
    phone: "phone",
    city: "city",
    location: "location",
    linkedin: "LinkedIn",
    github: "GitHub",
    website: "website",
    resume: "résumé PDF",
};

/** The order filledList names them in, whatever order the form asks. */
const KIND_ORDER: FieldKind[] = ["fullName", "firstName", "lastName", "email", "phone", "city", "location", "linkedin", "github", "website", "resume"];

/** Pure: "name, email, phone and résumé PDF" for the kinds filled. */
export function filledList(kinds: FieldKind[]): string {
    const sorted = [...kinds].sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
    const named = [...new Set(sorted.map((k) => KIND_WORDS[k]))];
    return named.length > 1 ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}` : (named[0] ?? "");
}
