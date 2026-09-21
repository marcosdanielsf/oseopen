import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getOverview: vi.fn(),
  getConnectionByProjectId: vi.fn(),
  getPerformance: vi.fn(),
}));

class FakeGscNotConnectedError extends Error {}
class FakeGscApiError extends Error {
  constructor(readonly status: number) {
    super(`gsc ${status}`);
  }
}

vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: { listProjects: mocks.listProjects },
}));

vi.mock("@/server/features/dashboard/services/DashboardService", () => ({
  DashboardService: { getOverview: mocks.getOverview },
}));

vi.mock("@/server/features/gsc/repositories/GscConnectionRepository", () => ({
  GscConnectionRepository: { getByProjectId: mocks.getConnectionByProjectId },
}));

vi.mock("@/server/features/gsc/services/GscService", () => ({
  GscService: { getPerformance: mocks.getPerformance },
  GscNotConnectedError: FakeGscNotConnectedError,
  isExpectedGrantFailure: () => false,
}));

vi.mock("@/server/lib/gscClient", () => ({
  GscApiError: FakeGscApiError,
}));

const projectA = { id: "project_a", name: "Acme", domain: "acme.com" };
const projectB = { id: "project_b", name: "Globex", domain: "globex.com" };

function overview(top10: number, criticalPages: number) {
  return {
    rank: {
      trackedKeywords: 10,
      improved: 2,
      declined: 1,
      top10,
      lastCheckedAt: "2026-09-20",
    },
    audit: {
      status: "completed" as const,
      pagesCrawled: 100,
      startedAt: "2026-09-20",
      topIssues: [
        {
          issueType: "missing_title",
          severity: "critical" as const,
          count: criticalPages,
        },
        { issueType: "slow_page", severity: "warning" as const, count: 99 },
      ],
      totalIssueTypes: 2,
    },
    backlinks: null,
  };
}

async function loadService() {
  const { PortfolioService } = await import("./PortfolioService");
  return PortfolioService;
}

describe("PortfolioService.getOverview", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("returns one row per project and sums the org totals", async () => {
    mocks.listProjects.mockResolvedValue([projectA, projectB]);
    mocks.getOverview
      .mockResolvedValueOnce(overview(3, 5))
      .mockResolvedValueOnce(overview(4, 2));
    mocks.getConnectionByProjectId
      .mockResolvedValueOnce({ siteUrl: "sc-domain:acme.com" })
      .mockResolvedValueOnce(null);

    const result = await (
      await loadService()
    ).getOverview({
      organizationId: "org_1",
    });

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].gsc).toEqual({
      connected: true,
      siteUrl: "sc-domain:acme.com",
    });
    expect(result.projects[1].gsc.connected).toBe(false);
    expect(result.totals.projects).toBe(2);
    expect(result.totals.gscConnected).toBe(1);
    expect(result.totals.top10).toBe(7);
    expect(result.totals.trackedKeywords).toBe(20);
    // Only critical severities count toward the audit total.
    expect(result.totals.criticalIssuePages).toBe(7);
  });

  it("keeps the input order when there are more projects than workers", async () => {
    // PROJECT_CONCURRENCY is 6; ten projects exercise the pool's reuse.
    const many = Array.from({ length: 10 }, (_, index) => ({
      id: `project_${index}`,
      name: `Project ${index}`,
      domain: `p${index}.com`,
    }));
    mocks.listProjects.mockResolvedValue(many);
    mocks.getConnectionByProjectId.mockResolvedValue(null);
    mocks.getOverview.mockImplementation(
      async ({ projectId }: { projectId: string }) => {
        const index = Number(projectId.replace("project_", ""));
        // Later projects resolve first, so the order can only come from the
        // indexed writes, not from completion order.
        await new Promise((resolve) => setTimeout(resolve, (10 - index) % 5));
        return overview(index, 0);
      },
    );

    const result = await (
      await loadService()
    ).getOverview({ organizationId: "org_1" });

    expect(result.projects.map((row) => row.id)).toEqual(
      many.map((project) => project.id),
    );
    expect(result.totals.top10).toBe(45);
  });

  it("keeps the other rows when one project's summary throws", async () => {
    mocks.listProjects.mockResolvedValue([projectA, projectB]);
    mocks.getOverview
      .mockRejectedValueOnce(new Error("d1 timeout"))
      .mockResolvedValueOnce(overview(4, 0));
    mocks.getConnectionByProjectId.mockResolvedValue(null);

    const result = await (
      await loadService()
    ).getOverview({
      organizationId: "org_1",
    });

    // The driver message stays in the log; the row carries a generic label.
    expect(result.projects[0].error).toBe("Summary unavailable");
    expect(result.projects[0].rank).toBeNull();
    expect(result.projects[1].error).toBeNull();
    expect(result.totals.top10).toBe(4);
  });
});

describe("PortfolioService.getSearchTotals", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("sums connected projects and marks disconnected ones", async () => {
    mocks.listProjects.mockResolvedValue([projectA, projectB]);
    mocks.getPerformance.mockImplementation(
      async ({ projectId }: { projectId: string }) => {
        if (projectId === projectB.id) {
          throw new FakeGscNotConnectedError("not connected");
        }
        return {
          siteUrl: "sc-domain:acme.com",
          connectedBy: null,
          request: {},
          rows: [{ clicks: 10, impressions: 100, ctr: 0.1, position: 5 }],
        };
      },
    );

    const result = await (
      await loadService()
    ).getSearchTotals({
      organizationId: "org_1",
      dateRange: "last_28_days",
    });

    const acme = result.projects.find((row) => row.projectId === projectA.id);
    const globex = result.projects.find((row) => row.projectId === projectB.id);
    expect(acme?.status).toBe("ok");
    expect(acme?.current?.clicks).toBe(10);
    expect(globex?.status).toBe("not_connected");
    expect(globex?.current).toBeNull();
    expect(result.totals?.current.clicks).toBe(10);
    expect(result.totals?.current.position).toBe(5);
  });

  it("marks a rate-limited project as retryable instead of failed", async () => {
    mocks.listProjects.mockResolvedValue([projectA]);
    mocks.getPerformance.mockRejectedValue(new FakeGscApiError(429));

    const result = await (
      await loadService()
    ).getSearchTotals({
      organizationId: "org_1",
      dateRange: "last_28_days",
    });

    expect(result.projects[0].status).toBe("rate_limited");
  });

  it("counts a property shared by two projects only once in the totals", async () => {
    mocks.listProjects.mockResolvedValue([projectA, projectB]);
    // Both projects connected to the same Search Console property.
    mocks.getPerformance.mockResolvedValue({
      siteUrl: "sc-domain:acme.com",
      connectedBy: null,
      request: {},
      rows: [{ clicks: 24, impressions: 371, ctr: 0.065, position: 9.6 }],
    });

    const result = await (
      await loadService()
    ).getSearchTotals({
      organizationId: "org_1",
      dateRange: "last_28_days",
    });

    // Each row still reports its own numbers...
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0].current?.clicks).toBe(24);
    expect(result.projects[1].current?.clicks).toBe(24);
    // ...but the carteira total is not 48.
    expect(result.totals?.current.clicks).toBe(24);
    expect(result.totals?.current.impressions).toBe(371);
  });

  it("reports no totals when no project answers", async () => {
    mocks.listProjects.mockResolvedValue([projectA]);
    mocks.getPerformance.mockRejectedValue(
      new FakeGscNotConnectedError("not connected"),
    );

    const result = await (
      await loadService()
    ).getSearchTotals({
      organizationId: "org_1",
      dateRange: "last_7_days",
    });

    expect(result.totals).toBeNull();
    expect(result.projects[0].status).toBe("not_connected");
  });
});
