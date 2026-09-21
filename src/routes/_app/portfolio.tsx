import { createFileRoute } from "@tanstack/react-router";
import { PortfolioPage } from "@/client/features/portfolio/PortfolioPage";

export const Route = createFileRoute("/_app/portfolio")({
  component: PortfolioPage,
});
