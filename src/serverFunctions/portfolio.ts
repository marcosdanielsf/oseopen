import { createServerFn } from "@tanstack/react-start";
import { PortfolioService } from "@/server/features/portfolio/services/PortfolioService";
import { requireAuthenticatedContext } from "@/serverFunctions/middleware";
import { portfolioSearchInputSchema } from "@/types/schemas/portfolio";

/**
 * Every project in the organization side by side. Org-scoped (not
 * project-scoped) on purpose: this is the one screen that answers "how is the
 * whole portfolio doing" without switching projects one at a time.
 */
export const getPortfolioOverview = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .handler(({ context }) =>
    PortfolioService.getOverview({ organizationId: context.organizationId }),
  );

/** Live Search Console totals per project. Split from the overview so the table
 *  paints from stored data first and the GSC fan-out fills in after. */
export const getPortfolioSearchTotals = createServerFn({ method: "POST" })
  .middleware(requireAuthenticatedContext)
  .validator(portfolioSearchInputSchema)
  .handler(({ data, context }) =>
    PortfolioService.getSearchTotals({
      organizationId: context.organizationId,
      dateRange: data.dateRange,
    }),
  );
