import MarketingScreen, {
  buildMarketingTabHrefs,
  normalizeMarketingTab,
  type MarketingSearchParams,
} from "@/components/features/marketing";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

interface MarketingPageProps {
  searchParams: Promise<MarketingSearchParams>;
}

export default async function MarketingPage({
  searchParams,
}: MarketingPageProps) {
  const params = await searchParams;

  return (
    <PermissionBoundary title="Marketing" module="campaigns" permission="dashboard_campaigns_view">
      <MarketingScreen
        activeTab={normalizeMarketingTab(params.tab)}
        tabHrefs={buildMarketingTabHrefs(params)}
      />
    </PermissionBoundary>
  );
}
