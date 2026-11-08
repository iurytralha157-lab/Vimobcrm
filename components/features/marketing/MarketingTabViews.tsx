import { MarketingAcquisitionTab } from "./MarketingAcquisitionTab";
import { MarketingCampaignsTab } from "./MarketingCampaignsTab";
import { MarketingMediaTab } from "./MarketingMediaTab";
import { MarketingOverviewTab } from "./MarketingOverviewTab";
import { MarketingSocialTab } from "./MarketingSocialTab";
import type { MarketingModel } from "./marketing-model";
import type { MarketingTab, MarketingTabHrefs } from "./marketing-tabs";

interface MarketingTabViewsProps {
  activeTab: MarketingTab;
  model: MarketingModel;
  tabHrefs: MarketingTabHrefs;
}

export function MarketingTabViews({ activeTab, model, tabHrefs }: MarketingTabViewsProps) {
  switch (activeTab) {
    case "paid":
      return <MarketingCampaignsTab model={model} tabHrefs={tabHrefs} />;
    case "media":
      return <MarketingMediaTab model={model} />;
    case "acquisition":
      return <MarketingAcquisitionTab model={model} />;
    case "social":
      return <MarketingSocialTab model={model} tabHrefs={tabHrefs} />;
    default:
      return <MarketingOverviewTab model={model} tabHrefs={tabHrefs} />;
  }
}
