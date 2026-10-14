/**
 * How a bge-small-en-v1.5 cosine (résumé passage vs posting) reads as a 0–1 fit: at or below
 * `SEMANTIC_COS_LO` nothing in common, at or above `SEMANTIC_COS_HI` the same work. Calibrated on
 * Vivek's PM résumé against live postings (2026-10-13). Isomorphic: no I/O.
 */
export const SEMANTIC_COS_LO = 0.55;
export const SEMANTIC_COS_HI = 0.85;
/** The share of the posting-level fit the meaning match carries when it is on hand. */
export const SEMANTIC_SHARE = 0.5;
