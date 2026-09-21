import { DashboardService } from "@/server/features/dashboard/services/DashboardService";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import {
  GscNotConnectedError,
  GscService,
  isExpectedGrantFailure,
} from "@/server/features/gsc/services/GscService";
import { resolveDateRange } from "@/server/features/gsc/searchAnalytics";
import { GscApiError } from "@/server/lib/gscClient";
import {
  DAILY_ROW_LIMIT,
  previousPeriod,
  sumSearchTotals,
} from "@/server/features/gsc/searchPerformanceReport";
import { ProjectService } from "@/server/features/projects/services/ProjectService";
import type { SearchPerformanceDateRange } from "@/types/schemas/search-performance";

type DashboardOverview = Awaited<
  ReturnType<typeof DashboardService.getOverview>
>;
type SearchTotals = ReturnType<typeof sumSearchTotals>;

// Every row is an independent fan-out; cap the parallelism so an org with
// dozens of projects doesn't open dozens of D1/GSC calls at once.
const PROJECT_CONCURRENCY = 6;
// Totals come from the daily breakdown: buildSearchAnalyticsRequest rewrites an
// empty `dimensions` to ["query"], which would total only the top query.

export type PortfolioProjectRow = {
  id: string;
  name: string;
  domain: string | null;
  gsc: { connected: boolean; siteUrl: string | null };
  rank: DashboardOverview["rank"];
  audit: DashboardOverview["audit"];
  backlinks: DashboardOverview["backlinks"];
  /** Set when this project's summary failed; the other rows still render. */
  error: string | null;
};

export type PortfolioTotals = {
  projects: number;
  gscConnected: number;
  trackedKeywords: number;
  top10: number;
  improved: number;
  declined: number;
  /** Pages hit by the critical issue types each project's latest audit lists. */
  criticalIssuePages: number;
  /** Null when no project has a backlink snapshot yet. */
  referringDomains: number | null;
};

export type PortfolioOverview = {
  projects: PortfolioProjectRow[];
  totals: PortfolioTotals;
};

export type PortfolioSearchRow = {
  projectId: string;
  status: "ok" | "not_connected" | "rate_limited" | "error";
  siteUrl: string | null;
  current: SearchTotals | null;
  previous: SearchTotals | null;
};

type AnsweredSearchRow = PortfolioSearchRow & {
  current: SearchTotals;
  previous: SearchTotals;
};

export type PortfolioSearch = {
  startDate: string;
  endDate: string;
  projects: PortfolioSearchRow[];
  /** Summed across the projects that answered; null when none did. */
  totals: { current: SearchTotals; previous: SearchTotals } | null;
};

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  // Indexed writes keep the results in input order even though the workers
  // finish out of order.
  const results: R[] = [];
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function emptyTotals(): SearchTotals {
  return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
}

function addTotals(a: SearchTotals, b: SearchTotals): SearchTotals {
  const clicks = a.clicks + b.clicks;
  const impressions = a.impressions + b.impressions;
  // Re-weight position by impressions so the portfolio average isn't an
  // average of averages.
  const weighted = a.position * a.impressions + b.position * b.impressions;
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weighted / impressions : 0,
  };
}

function summarize(rows: PortfolioProjectRow[]): PortfolioTotals {
  const totals: PortfolioTotals = {
    projects: rows.length,
    gscConnected: 0,
    trackedKeywords: 0,
    top10: 0,
    improved: 0,
    declined: 0,
    criticalIssuePages: 0,
    referringDomains: null,
  };

  for (const row of rows) {
    if (row.gsc.connected) totals.gscConnected += 1;
    if (row.rank) {
      totals.trackedKeywords += row.rank.trackedKeywords;
      totals.top10 += row.rank.top10;
      totals.improved += row.rank.improved;
      totals.declined += row.rank.declined;
    }
    if (row.audit) {
      for (const issue of row.audit.topIssues) {
        if (issue.severity === "critical") {
          totals.criticalIssuePages += issue.count;
        }
      }
    }
    if (row.backlinks?.referringDomains != null) {
      totals.referringDomains =
        (totals.referringDomains ?? 0) + row.backlinks.referringDomains;
    }
  }

  return totals;
}

/**
 * Every project in the organization on one screen. Reads only first-party
 * stored data (rank runs, audits, backlink snapshots), so it stays cheap and
 * never spends credits; live Search Console numbers come from getSearchTotals.
 * A project that throws is reported in its own row instead of failing the page.
 */
async function getOverview(input: {
  organizationId: string;
}): Promise<PortfolioOverview> {
  const projects = await ProjectService.listProjects(input.organizationId);

  const rows = await mapWithConcurrency(
    projects,
    PROJECT_CONCURRENCY,
    async (project): Promise<PortfolioProjectRow> => {
      const base = {
        id: project.id,
        name: project.name,
        domain: project.domain,
      };
      try {
        const [overview, connection] = await Promise.all([
          DashboardService.getOverview({
            projectId: project.id,
            domain: project.domain,
          }),
          GscConnectionRepository.getByProjectId(project.id),
        ]);
        return {
          ...base,
          gsc: {
            connected: connection !== null,
            siteUrl: connection?.siteUrl ?? null,
          },
          rank: overview.rank,
          audit: overview.audit,
          backlinks: overview.backlinks,
          error: null,
        };
      } catch (error) {
        // The detail belongs in the log, not on the client: this string is
        // rendered verbatim in the project's row.
        console.error("Portfolio summary failed", {
          projectId: project.id,
          error,
        });
        return {
          ...base,
          gsc: { connected: false, siteUrl: null },
          rank: null,
          audit: null,
          backlinks: null,
          error: "Summary unavailable",
        };
      }
    },
  );

  return { projects: rows, totals: summarize(rows) };
}

/** A 429 is the fan-out's own doing (one call pair per connected project, no
 *  cache in GscService), so the row says "retry" instead of "failed". */
function searchRowStatus(error: unknown): PortfolioSearchRow["status"] {
  if (error instanceof GscNotConnectedError || isExpectedGrantFailure(error)) {
    return "not_connected";
  }
  if (error instanceof GscApiError && error.status === 429) {
    return "rate_limited";
  }
  return "error";
}

/**
 * Clicks/impressions/CTR/position per project for the same window, plus the
 * previous period for deltas. One GSC call pair per connected project; a
 * disconnected or dead grant degrades that row to "not_connected" instead of
 * failing the batch.
 */
async function getSearchTotals(input: {
  organizationId: string;
  dateRange: SearchPerformanceDateRange;
}): Promise<PortfolioSearch> {
  const projects = await ProjectService.listProjects(input.organizationId);
  const { startDate, endDate } = resolveDateRange({
    dateRange: input.dateRange,
  });
  const prev = previousPeriod(startDate, endDate);

  const rows = await mapWithConcurrency(
    projects,
    PROJECT_CONCURRENCY,
    async (project): Promise<PortfolioSearchRow> => {
      try {
        const [current, previous] = await Promise.all([
          GscService.getPerformance({
            projectId: project.id,
            startDate,
            endDate,
            dimensions: ["date"],
            rowLimit: DAILY_ROW_LIMIT,
          }),
          GscService.getPerformance({
            projectId: project.id,
            startDate: prev.startDate,
            endDate: prev.endDate,
            dimensions: ["date"],
            rowLimit: DAILY_ROW_LIMIT,
          }),
        ]);
        return {
          projectId: project.id,
          status: "ok",
          siteUrl: current.siteUrl,
          current: sumSearchTotals(current.rows),
          previous: sumSearchTotals(previous.rows),
        };
      } catch (error) {
        return {
          projectId: project.id,
          status: searchRowStatus(error),
          siteUrl: null,
          current: null,
          previous: null,
        };
      }
    },
  );

  // Two projects can point at the SAME Search Console property (the unique
  // index is per project, not per property). Summing both would double-count
  // the carteira, so the totals take each property once.
  const seenProperties = new Set<string>();
  const answered = rows
    .filter(
      (row): row is AnsweredSearchRow =>
        row.current !== null && row.previous !== null,
    )
    .filter((row) => {
      const key = row.siteUrl ?? row.projectId;
      if (seenProperties.has(key)) return false;
      seenProperties.add(key);
      return true;
    });
  const totals = answered.length
    ? answered.reduce(
        (acc, row) => ({
          current: addTotals(acc.current, row.current),
          previous: addTotals(acc.previous, row.previous),
        }),
        { current: emptyTotals(), previous: emptyTotals() },
      )
    : null;

  return { startDate, endDate, projects: rows, totals };
}

export const PortfolioService = {
  getOverview,
  getSearchTotals,
};
