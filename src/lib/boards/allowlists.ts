import elite from "../../../data/boards/elite-domains.json";
import { BOARD_META, type BoardId } from "./types";

const LISTS: Record<BoardId, string[]> = {
  elite: (elite as string[]).map((d) => d.trim().toLowerCase()).filter(Boolean),
};

export function isBoardId(v: string): v is BoardId {
  return Object.prototype.hasOwnProperty.call(BOARD_META, v);
}

export function getBoardDomains(boardId: BoardId): string[] {
  return LISTS[boardId] ?? [];
}
