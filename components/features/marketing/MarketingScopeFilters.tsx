"use client";

import {
  BriefcaseBusiness,
  Globe,
  Layers3,
  Megaphone,
  RotateCcw,
  Target,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchableFilterSelect } from "@/components/shared/SearchableFilterSelect";
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { cn } from "@/lib/utils";

export interface MarketingScopeFilterOption {
  value: string;
  label: string;
}

export interface MarketingScopeFiltersProps {
  accountId: string | null;
  onAccountChange: (value: string | null) => void;
  accounts: MarketingScopeFilterOption[];
  pageId: string | null;
  onPageChange: (value: string | null) => void;
  pages: MarketingScopeFilterOption[];
  campaignId: string | null;
  onCampaignChange: (value: string | null) => void;
  campaignIds?: string[];
  onCampaignsChange?: (values: string[]) => void;
  campaigns: MarketingScopeFilterOption[];
  adSetId: string | null;
  onAdSetChange: (value: string | null) => void;
  adSets: MarketingScopeFilterOption[];
  objective: string | null;
  onObjectiveChange: (value: string | null) => void;
  objectives: MarketingScopeFilterOption[];
  onClear: () => void;
  isLoading?: boolean;
  pageOnly?: boolean;
  variant?: "default" | "macro" | "panel";
  className?: string;
  layerScope?: string;
}

interface ScopeSelectProps {
  ariaLabel: string;
  value: string | null;
  onChange: (value: string | null) => void;
  options: MarketingScopeFilterOption[];
  allLabel: string;
  icon: LucideIcon;
  disabled?: boolean;
  variant?: "default" | "macro" | "panel";
  className?: string;
  layerScope?: string;
}

function ScopeSelect({
  ariaLabel,
  value,
  onChange,
  options,
  allLabel,
  icon: Icon,
  disabled,
  variant = "default",
  className,
  layerScope,
}: ScopeSelectProps) {
  const isMacro = variant === "macro";
  const isPanel = variant === "panel";

  return (
    <SearchableFilterSelect
      ariaLabel={ariaLabel}
      value={value}
      onChange={onChange}
      options={options}
      allLabel={allLabel}
      icon={<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      disabled={disabled}
      className={cn(
        "h-9 min-w-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light",
        isMacro && "h-10 rounded-[10px] !bg-[rgba(255,255,255,0.08)] !text-[#f8fafc]",
        isPanel && "w-full",
        className,
      )}
      popupClassName={isMacro ? "!bg-[#172946] !text-[#f8fafc]" : undefined}
      layerScope={layerScope}
    />
  );
}

export function MarketingScopeFilters({
  accountId,
  onAccountChange,
  accounts,
  pageId,
  onPageChange,
  pages,
  campaignId,
  onCampaignChange,
  campaignIds = [],
  onCampaignsChange,
  campaigns,
  adSetId,
  onAdSetChange,
  adSets,
  objective,
  onObjectiveChange,
  objectives,
  onClear,
  isLoading = false,
  pageOnly = false,
  variant = "default",
  className,
  layerScope,
}: MarketingScopeFiltersProps) {
  const hasActiveScope = Boolean(
    accountId || pageId || campaignId || campaignIds.length > 0 || adSetId || objective,
  );
  const isMacro = variant === "macro";
  const isPanel = variant === "panel";

  return (
    <section
      aria-label="Escopo do relatório de Marketing"
      className={cn(
        "flex min-w-0 items-center gap-2 overflow-x-auto rounded-[8px] bg-[var(--app-surface-solid)] p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        isMacro &&
          "rounded-[16px] rounded-b-[4px] bg-[#07142f] px-3 py-2.5 shadow-[0_16px_0_#07142f] lg:gap-2.5",
        isPanel &&
          "grid w-full grid-cols-1 gap-2 overflow-visible rounded-none bg-transparent p-0",
        className,
      )}
    >
      {!pageOnly ? (
        <ScopeSelect
          ariaLabel="Filtrar por conta de anúncios"
          value={accountId}
          onChange={onAccountChange}
          options={accounts}
          allLabel="Todas as contas"
          icon={BriefcaseBusiness}
          disabled={isLoading && accounts.length === 0}
          variant={variant}
          layerScope={layerScope}
          className={cn("w-[190px]", isMacro && "xl:flex-1", isPanel && "w-full")}
        />
      ) : null}
      <ScopeSelect
        ariaLabel="Filtrar por Página do Facebook"
        value={pageId}
        onChange={onPageChange}
        options={pages}
        allLabel="Todas as páginas"
        icon={Globe}
        disabled={isLoading && pages.length === 0}
        variant={variant}
        layerScope={layerScope}
        className={cn("w-[210px]", isMacro && "xl:flex-1", isPanel && "w-full")}
      />
      {!pageOnly ? (
        <>
          {onCampaignsChange ? <SearchableTagPicker
            tags={campaigns.map((option) => ({ id: option.value, name: option.label }))}
            selectedTagIds={campaignIds}
            onToggleTag={(id) => onCampaignsChange(campaignIds.includes(id) ? campaignIds.filter((selected) => selected !== id) : [...campaignIds, id])}
            onClearSelection={() => onCampaignsChange([])}
            placeholder="Todas as campanhas"
            triggerIcon={<Megaphone className="h-3.5 w-3.5" aria-hidden="true" />}
            showColorDot={false}
            showSelectedBadges={false}
            allowCreate={false}
            caseSensitiveIds
            showUnavailableId
            itemNameSingular="campanha"
            itemNamePlural="campanhas"
            loading={isLoading && campaigns.length === 0}
            layerScope={layerScope}
            triggerClassName={cn("w-[230px]", isMacro && "xl:flex-1", isPanel && "w-full")}
          /> : <ScopeSelect
            ariaLabel="Filtrar por campanha"
            value={campaignId}
            onChange={onCampaignChange}
            options={campaigns}
            allLabel="Todas as campanhas"
            icon={Megaphone}
            disabled={isLoading && campaigns.length === 0}
            variant={variant}
            layerScope={layerScope}
            className={cn("w-[230px]", isMacro && "xl:flex-1", isPanel && "w-full")}
          />}
          <ScopeSelect
            ariaLabel="Filtrar por conjunto de anúncios"
            value={adSetId}
            onChange={onAdSetChange}
            options={adSets}
            allLabel="Todos os conjuntos"
            icon={Layers3}
            disabled={campaignIds.length > 1 || (isLoading && adSets.length === 0)}
            variant={variant}
            layerScope={layerScope}
            className={cn("w-[230px]", isMacro && "xl:flex-1", isPanel && "w-full")}
          />
          <ScopeSelect
            ariaLabel="Filtrar por objetivo da campanha"
            value={objective}
            onChange={onObjectiveChange}
            options={objectives}
            allLabel="Todos os objetivos"
            icon={Target}
            disabled={isLoading && objectives.length === 0}
            variant={variant}
            layerScope={layerScope}
            className={cn("w-[190px]", isMacro && "xl:flex-1", isPanel && "w-full")}
          />
        </>
      ) : null}

      {hasActiveScope && !isPanel ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className={cn(
            "h-9 shrink-0 rounded-[6px] border-0 bg-transparent px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
            isMacro &&
              "h-10 rounded-[10px] bg-white/[0.08] text-white/75 hover:bg-white/[0.14] hover:text-white",
          )}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Limpar escopo
        </Button>
      ) : null}
    </section>
  );
}
