import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import type {
  PortfolioProjectRow,
  PortfolioSearchRow,
} from "@/server/features/portfolio/services/PortfolioService";

/**
 * Presentation pieces of the portfolio table. Kept out of PortfolioPage so the
 * page file stays about data flow, the same split the Search Performance page
 * uses.
 */

const SEARCH_STATUS_LABELS: Record<PortfolioSearchRow["status"], string> = {
  ok: "",
  not_connected: "Search Console not connected",
  rate_limited: "Rate limited, retry shortly",
  error: "Unavailable",
};

export type Delta = { text: string; improved: boolean } | null;

export function percentDelta(current: number, previous: number): Delta {
  if (previous <= 0) return null;
  const change = (current - previous) / previous;
  return {
    text: `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`,
    improved: change >= 0,
  };
}

/** Position falls as rankings improve, so the delta is inverted. */
export function positionDelta(current: number, previous: number): Delta {
  if (previous <= 0 || current <= 0) return null;
  const change = previous - current;
  return {
    text: `${change >= 0 ? "+" : ""}${change.toFixed(1)}`,
    improved: change >= 0,
  };
}

export function DeltaTag({ delta }: { delta: Delta }) {
  if (!delta) return null;
  return (
    <span
      className={`ml-1 text-xs ${delta.improved ? "text-success" : "text-error"}`}
    >
      {delta.text}
    </span>
  );
}

export function TotalCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: Delta;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-base-300 bg-base-100 p-4">
      <div className="text-xs uppercase tracking-wider text-base-content/50">
        {label}
      </div>
      <div className="mt-1 flex items-baseline">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {delta ? <DeltaTag delta={delta} /> : null}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-base-content/50">{hint}</div>
      ) : null}
    </div>
  );
}

/** Pages hit by the critical issue types in the project's latest audit. */
export function criticalPages(project: PortfolioProjectRow): number {
  if (!project.audit) return 0;
  return project.audit.topIssues
    .filter((issue) => issue.severity === "critical")
    .reduce((sum, issue) => sum + issue.count, 0);
}

export function SearchCells({
  row,
  loading,
}: {
  row: PortfolioSearchRow | undefined;
  loading: boolean;
}) {
  if (loading && !row) {
    return (
      <>
        {[0, 1, 2, 3].map((cell) => (
          <td key={cell} className="text-right">
            <span className="inline-block h-3 w-10 animate-pulse rounded bg-base-300" />
          </td>
        ))}
      </>
    );
  }

  if (!row || row.status !== "ok" || !row.current || !row.previous) {
    const label = SEARCH_STATUS_LABELS[row?.status ?? "not_connected"];
    return (
      <td colSpan={4} className="text-right text-xs text-base-content/40">
        {label}
      </td>
    );
  }

  const { current, previous } = row;
  return (
    <>
      <td className="text-right tabular-nums">
        {formatCount(current.clicks)}
        <DeltaTag delta={percentDelta(current.clicks, previous.clicks)} />
      </td>
      <td className="text-right tabular-nums">
        {formatCount(current.impressions)}
        <DeltaTag
          delta={percentDelta(current.impressions, previous.impressions)}
        />
      </td>
      <td className="text-right tabular-nums">{formatCtr(current.ctr)}</td>
      <td className="text-right tabular-nums">
        {formatPosition(current.position)}
        <DeltaTag delta={positionDelta(current.position, previous.position)} />
      </td>
    </>
  );
}
