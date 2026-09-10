import {
  COMPARISON_HEADERS,
  COMPARISON_ROWS,
  type ComparisonBoard,
} from "@/lib/seo/board-comparison";

const TH =
  "px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground";
const TD = "border-t border-foreground/10 px-4 py-3 align-top";

export function BoardComparisonTable({ board }: { board: ComparisonBoard }) {
  return (
    <div className="overflow-x-auto">
      <table
        data-testid={`board-comparison-${board}`}
        className="w-full border-collapse border border-foreground/10 text-[13.5px]"
      >
        <thead>
          <tr>
            <th className={TH}></th>
            <th className={TH}>velai</th>
            <th className={TH}>{COMPARISON_HEADERS[board]}</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON_ROWS.map((row) => (
            <tr key={row.label}>
              <td className={TD}>{row.label}</td>
              <td className={TD}>{row.velai}</td>
              <td className={TD}>{row[board]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
