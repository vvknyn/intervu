/**
 * Guest save gate — a save (a job "Go after" or a saved search) needs an
 * account. The one rule lives here so every save surface asks the same
 * question: a guest's attempt, first or later, opens the sign-in gate and
 * writes nothing locally.
 */

export type SaveAttemptOutcome = "save" | "gate";

export function decideSaveAttempt(signedIn: boolean): SaveAttemptOutcome {
    return signedIn ? "save" : "gate";
}
