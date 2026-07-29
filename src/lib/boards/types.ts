export type BoardId = "elite";
export const BOARD_META: Record<BoardId, { label: string; description: string }> = {
  elite: {
    label: "Elite startups",
    description: "Curated high-signal startups — editorial allowlist, not fundraising rank.",
  },
};
