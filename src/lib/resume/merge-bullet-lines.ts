/**
 * Merge soft-wrapped résumé bullet lines into logical bullet items.
 *
 * PDF text extraction and plain-text paste often break one achievement across
 * multiple physical lines without repeating the bullet marker. Downstream
 * parsers must merge those continuations before splitting on newlines.
 */

/** Leading bullet marker: hyphen variants, asterisk, common Unicode bullets. */
export const BULLET_MARKER_RE = /^[\s]*[-*•−●◦▪]\s+/;

const SENTENCE_END_RE = /[.!?]["')\]]*$/;

const CONNECTOR_START_RE =
    /^(?:and|or|to|for|with|across|from|including|while|that|which|into|under|by|as|on|in|at|of|the|a|an)\b/i;

const EM_DASH_START_RE = /^[\u2014\u2013—-]/;
/** The line above stopped on a word that needs the next line ("standards and", "across a"). */
const DANGLING_END_RE = /\b(?:and|or|to|for|with|across|from|including|while|that|which|into|under|by|as|on|in|at|of|the|a|an|their|its)\s*$/i;

/** Typical résumé action-verb openings for a new bullet after sentence end. */
const ACTION_VERB_START_RE =
    /^(?:served|led|owned|coordinated|delivered|acted|translated|deployed|overhauled|architected|drove|built|managed|developed|created|implemented|designed|established|improved|increased|reduced|streamlined|facilitated|diagnosed|directed|rebuilt|shipped|accelerated|conceived|made|scoped|primary|key|medibank)\b/i;

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function stripBulletMarker(line: string): string {
    return collapseWhitespace(line.replace(BULLET_MARKER_RE, ""));
}

function startsWithLowercase(line: string): boolean {
    const trimmed = line.trimStart();
    return trimmed.length > 0 && /^[a-z]/.test(trimmed);
}

function startsWithConnectorOrDash(line: string): boolean {
    const trimmed = line.trimStart();
    return CONNECTOR_START_RE.test(trimmed) || EM_DASH_START_RE.test(trimmed);
}

function previousEndedWithSentence(text: string): boolean {
    return SENTENCE_END_RE.test(text.trim());
}

function looksLikeNewBulletAfterSentence(line: string): boolean {
    const trimmed = line.trimStart();
    if (!trimmed) return false;
    if (/^[A-Z]/.test(trimmed) && ACTION_VERB_START_RE.test(trimmed)) return true;
    if (/^[A-Z]/.test(trimmed) && !startsWithConnectorOrDash(trimmed)) return true;
    return false;
}

function isNewBulletLine(line: string, previousItem: string | null): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;

    if (BULLET_MARKER_RE.test(trimmed)) return true;

    if (!previousItem) return true;

    if (previousEndedWithSentence(previousItem) && looksLikeNewBulletAfterSentence(trimmed)) {
        return true;
    }

    return false;
}

/** Whether `line` continues the previous bullet (soft wrap), not a new item. */
export function shouldAppendAsBulletContinuation(line: string, previousItem: string): boolean {
    if (isNewBulletLine(line, previousItem)) return false;
    return isWrapContinuation(line, previousItem);
}

function isWrapContinuation(line: string, previousItem: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (BULLET_MARKER_RE.test(trimmed)) return false;

    if (startsWithLowercase(trimmed)) return true;
    if (startsWithConnectorOrDash(trimmed)) return true;
    // Two achievements often have no period ("Teach 26 students…" / "Raised EQAO…").
    // A wrap that still needs its last words ends on "and" or "a", so it stays one bullet.
    if (!previousEndedWithSentence(previousItem)) {
        if (DANGLING_END_RE.test(previousItem)) return true;
        return !looksLikeNewBulletAfterSentence(trimmed);
    }

    return false;
}

/**
 * Merge physical lines into logical bullet strings. Blank lines close the
 * current item; the next non-empty line starts fresh.
 */
export function mergeResumeBulletLines(lines: string[]): string[] {
    const items: string[] = [];
    let current: string | null = null;

    const finishCurrent = () => {
        if (current !== null) {
            const stripped = stripBulletMarker(current);
            if (stripped) items.push(stripped);
        }
        current = null;
    };

    for (const raw of lines) {
        if (!raw.trim()) {
            finishCurrent();
            continue;
        }

        if (current === null) {
            current = raw.trim();
            continue;
        }

        if (isNewBulletLine(raw, current)) {
            finishCurrent();
            current = raw.trim();
            continue;
        }

        if (isWrapContinuation(raw, current)) {
            current = `${current} ${raw.trim()}`;
            continue;
        }

        // Conservative fallback: treat as new bullet under same entry.
        finishCurrent();
        current = raw.trim();
    }

    finishCurrent();
    return items;
}

/**
 * Split a description field into logical bullets, merging soft wraps first.
 */
export function descriptionToBullets(description: string): string[] {
    if (!description.trim()) return [];
    const lines = description.replace(/\r\n/g, "\n").split("\n");
    return mergeResumeBulletLines(lines);
}
