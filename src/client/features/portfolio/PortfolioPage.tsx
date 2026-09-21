import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import {
  formatCount,
  formatCtr,
  formatPosition,
} from "@/client/features/search-performance/SearchPerformanceColumns";
import {
  criticalPages,
  percentDelta,
  SearchCells,
  TotalCard,
} from "@/client/features/portfolio/PortfolioParts";
import { CreateProjectModal } from "@/client/features/projects/CreateProjectModal";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  getPortfolioOverview,
  getPortfolioSearchTotals,
} from "@/serverFunctions/portfolio";
import type { PortfolioSearchRow } from "@/server/features/portfolio/services/PortfolioService";
import {
  SEARCH_PERFORMANCE_RANGES,
  type SearchPerformanceDateRange,
} from "@/types/schemas/search-performance";

const RANGE_LABELS: Record<SearchPerformanceDateRange, string> = {
  last_7_days: "7 days",
  last_28_days: "28 days",
  last_3_months: "3 months",
};

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

  // A property connected to two projects makes both rows show identical
  // numbers, which reads as a bug until the row says why.
  const sharedProperties = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of overviewQuery.data?.projects ?? []) {
      if (!project.gsc.siteUrl) continue;
      counts.set(
        project.gsc.siteUrl,
        (counts.get(project.gsc.siteUrl) ?? 0) + 1,
      );
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([siteUrl]) => siteUrl),
    );
  }, [overviewQuery.data]);
  const totals = overviewQuery.data?.totals;
  const searchTotals = searchQuery.data?.totals ?? null;

  // Both Search Console cards are deduplicated by property, so both say so.
  const dedupHint = totals
    ? `${totals.gscConnected}/${totals.projects} connected` +
      (sharedProperties.size > 0
        ? ", shared properties counted once"
        : " to Search Console")
    : undefined;

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
            hint={dedupHint}
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
            hint={dedupHint}
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
            hint={totals ? `across ${totals.projects} projects` : undefined}
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
                    {project.gsc.siteUrl ? (
                      <div className="text-xs text-base-content/40">
                        {project.gsc.siteUrl}
                        {sharedProperties.has(project.gsc.siteUrl) ? (
                          <span
                            className="ml-1 text-warning"
                            title="Another project is connected to this same property, so both rows show the same numbers."
                          >
                            shared
                          </span>
                        ) : null}
                      </div>
                    ) : null}
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
            {projects.length > 0 ? (
              // The carteira totals sit under the columns they sum, which is
              // also where the property dedup is visible: these clicks and
              // impressions are lower than the column adds up to whenever two
              // projects share one property.
              <tfoot>
                <tr className="border-t border-base-300 font-medium">
                  <td>
                    Total
                    {sharedProperties.size > 0 ? (
                      <div className="text-xs font-normal text-base-content/50">
                        shared properties counted once
                      </div>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">
                    {searchTotals
                      ? formatCount(searchTotals.current.clicks)
                      : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {searchTotals
                      ? formatCount(searchTotals.current.impressions)
                      : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {searchTotals ? formatCtr(searchTotals.current.ctr) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {searchTotals
                      ? formatPosition(searchTotals.current.position)
                      : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {totals ? formatCount(totals.top10) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {totals ? formatCount(totals.trackedKeywords) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {totals ? formatCount(totals.criticalIssuePages) : "—"}
                  </td>
                  <td className="text-right tabular-nums">
                    {totals?.referringDomains != null
                      ? formatCount(totals.referringDomains)
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {creating ? (
        <CreateProjectModal onClose={() => setCreating(false)} />
      ) : null}
    </div>
  );
}
