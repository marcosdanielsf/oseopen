import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import { CreateProjectModal } from "@/client/features/projects/CreateProjectModal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getPortfolioOverview,
  getPortfolioSearchTotals,
} from "@/serverFunctions/portfolio";
import type {
  PortfolioProjectRow,
  PortfolioSearchRow,
} from "@/server/features/portfolio/services/PortfolioService";
import {
  SEARCH_PERFORMANCE_RANGES,
  type SearchPerformanceDateRange,
} from "@/types/schemas/search-performance";

const RANGE_LABELS: Record<SearchPerformanceDateRange, string> = {
  last_7_days: "7 days",
  last_28_days: "28 days",
  last_3_months: "3 months",
};

const SEARCH_STATUS_LABELS: Record<PortfolioSearchRow["status"], string> = {
  ok: "",
  not_connected: "Search Console not connected",
  rate_limited: "Rate limited, retry shortly",
  error: "Unavailable",
};

type Delta = { text: string; improved: boolean } | null;

function percentDelta(current: number, previous: number): Delta {
  if (previous <= 0) return null;
  const change = (current - previous) / previous;
  return {
    text: `${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%`,
    improved: change >= 0,
  };
}

/** Position falls as rankings improve, so the delta is inverted. */
function positionDelta(current: number, previous: number): Delta {
  if (previous <= 0 || current <= 0) return null;
  const change = previous - current;
  return {
    text: `${change >= 0 ? "+" : ""}${change.toFixed(1)}`,
    improved: change >= 0,
  };
}

function DeltaTag({ delta }: { delta: Delta }) {
  if (!delta) return null;
  return (
    <span
      className={`ml-1 text-xs ${delta.improved ? "text-success" : "text-error"}`}
    >
      {delta.text}
    </span>
  );
}

function TotalCard({
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
function criticalPages(project: PortfolioProjectRow): number {
  if (!project.audit) return 0;
  return project.audit.topIssues
    .filter((issue) => issue.severity === "critical")
    .reduce((sum, issue) => sum + issue.count, 0);
}

function SearchCells({
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

export function PortfolioPage() {
  const [range, setRange] =
    useState<SearchPerformanceDateRange>("last_28_days");
  const [creating, setCreating] = useState(false);

  const overviewQuery = useQuery({
    queryKey: ["portfolio", "overview"],
    queryFn: () => getPortfolioOverview(),
  });

  // Separate query: the stored-data table paints immediately and the GSC
  // fan-out (one call pair per connected project) fills in behind it.
  const searchQuery = useQuery({
    queryKey: ["portfolio", "search", range],
    queryFn: () => getPortfolioSearchTotals({ data: { dateRange: range } }),
    enabled: (overviewQuery.data?.projects.length ?? 0) > 0,
  });

  const searchByProject = useMemo(() => {
    const map = new Map<string, PortfolioSearchRow>();
    for (const row of searchQuery.data?.projects ?? []) {
      map.set(row.projectId, row);
    }
    return map;
  }, [searchQuery.data]);

  const projects = overviewQuery.data?.projects ?? [];
  const totals = overviewQuery.data?.totals;
  const searchTotals = searchQuery.data?.totals ?? null;

  return (
    <div className="h-full overflow-auto bg-base-100 px-4 py-8 pb-24 md:px-6 md:py-10 md:pb-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Portfolio</h1>
            <p className="mt-1 text-sm text-base-content/60">
              Every project side by side. Search Console numbers cover the
              selected window; the rest comes from the latest stored run.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div role="tablist" className="tabs tabs-box tabs-sm">
              {SEARCH_PERFORMANCE_RANGES.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="tab"
                  aria-selected={option === range}
                  className={`tab ${option === range ? "tab-active" : ""}`}
                  onClick={() => setRange(option)}
                >
                  {RANGE_LABELS[option]}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              New project
            </button>
          </div>
        </div>

        {overviewQuery.isError ? (
          <div className="alert alert-error">
            <AlertTriangle className="size-5" />
            <span>{getStandardErrorMessage(overviewQuery.error)}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TotalCard
            label="Clicks"
            value={
              searchTotals ? formatCount(searchTotals.current.clicks) : "—"
            }
            delta={
              searchTotals
                ? percentDelta(
                    searchTotals.current.clicks,
                    searchTotals.previous.clicks,
                  )
                : null
            }
            hint={
              totals
                ? `${totals.gscConnected}/${totals.projects} connected to Search Console`
                : undefined
            }
          />
          <TotalCard
            label="Impressions"
            value={
              searchTotals ? formatCount(searchTotals.current.impressions) : "—"
            }
            delta={
              searchTotals
                ? percentDelta(
                    searchTotals.current.impressions,
                    searchTotals.previous.impressions,
                  )
                : null
            }
          />
          <TotalCard
            label="Keywords in top 10"
            value={totals ? formatCount(totals.top10) : "—"}
            hint={
              totals
                ? `${formatCount(totals.trackedKeywords)} tracked`
                : undefined
            }
          />
          <TotalCard
            label="Critical audit pages"
            value={totals ? formatCount(totals.criticalIssuePages) : "—"}
            hint={
              totals?.referringDomains != null
                ? `${formatCount(totals.referringDomains)} referring domains`
                : undefined
            }
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Project</th>
                <th className="text-right">Clicks</th>
                <th className="text-right">Impressions</th>
                <th className="text-right">CTR</th>
                <th className="text-right">Position</th>
                <th className="text-right">Top 10</th>
                <th className="text-right">Tracked</th>
                <th className="text-right">Critical</th>
                <th className="text-right">Ref. domains</th>
              </tr>
            </thead>
            <tbody>
              {overviewQuery.isLoading ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center">
                    <Loader2 className="inline size-5 animate-spin text-base-content/40" />
                  </td>
                </tr>
              ) : null}

              {!overviewQuery.isLoading && projects.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="py-10 text-center text-sm text-base-content/50"
                  >
                    No projects yet.
                  </td>
                </tr>
              ) : null}

              {projects.map((project) => (
                <tr key={project.id} className="hover">
                  <td>
                    <Link
                      to="/p/$projectId"
                      params={{ projectId: project.id }}
                      className="font-medium hover:underline"
                    >
                      {project.name}
                    </Link>
                    <div className="text-xs text-base-content/50">
                      {project.error
                        ? project.error
                        : (project.domain ?? "No domain set")}
                    </div>
                  </td>
                  <SearchCells
                    row={searchByProject.get(project.id)}
                    loading={searchQuery.isLoading || searchQuery.isFetching}
                  />
                  <td className="text-right tabular-nums">
                    {project.rank ? formatCount(project.rank.top10) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {project.rank
                      ? formatCount(project.rank.trackedKeywords)
                      : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {project.audit ? formatCount(criticalPages(project)) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {project.backlinks?.referringDomains != null
                      ? formatCount(project.backlinks.referringDomains)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {creating ? (
        <CreateProjectModal onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}
