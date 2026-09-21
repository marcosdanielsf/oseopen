import { z } from "zod";
import { SEARCH_PERFORMANCE_RANGES } from "@/types/schemas/search-performance";

/** The portfolio reuses the Search Performance ranges so a row's numbers match
 *  what the project page shows for the same window. */
export const portfolioSearchInputSchema = z.object({
  dateRange: z.enum(SEARCH_PERFORMANCE_RANGES).default("last_28_days"),
});

export type PortfolioSearchInput = z.infer<typeof portfolioSearchInputSchema>;
