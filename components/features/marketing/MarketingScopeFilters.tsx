"use client";

import {
  BriefcaseBusiness,
  Layers3,
  Megaphone,
  RotateCcw,
  Target,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface MarketingScopeFilterOption {
  value: string;
  label: string;
}

export interface MarketingScopeFiltersProps {
  accountId: string | null;
  onAccountChange: (value: string | null) => void;
  accounts: MarketingScopeFilterOption[];
  campaignId: string | null;
  onCampaignChange: (value: string | null) => void;
  campaigns: MarketingScopeFilterOption[];
  adSetId: string | null;
  onAdSetChange: (value: string | null) => void;
  adSets: MarketingScopeFilterOption[];
  objective: string | null;
  onObjectiveChange: (value: string | null) => void;
  objectives: MarketingScopeFilterOption[];
  onClear: () => void;
  isLoading?: boolean;
  variant?: "default" | "macro" | "panel";
  className?: string;
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
}: ScopeSelectProps) {
  const isMacro = variant === "macro";
  const isPanel = variant === "panel";

  return (
    <Select
      value={value ?? "all"}
      onValueChange={(nextValue) =>
        onChange(nextValue === "all" ? null : nextValue)
      }
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 min-w-0 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[11px] font-light text-[var(--app-text-primary)] shadow-none focus:ring-1 focus:ring-primary/30 data-[placeholder]:text-[var(--app-text-tertiary)]",
          isMacro &&
            "h-10 rounded-[10px] !bg-[rgba(255,255,255,0.08)] px-3 !text-[#f8fafc] transition-colors hover:!bg-[rgba(255,255,255,0.13)] focus:ring-white/25 data-[placeholder]:!text-[#cbd5e1] [&>svg]:!text-[#94a3b8]",
          isPanel && "w-full",
          className,
        )}
      >
        <span className="!flex min-w-0 flex-1 items-center gap-2">
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]",
              isMacro && "!text-[#94a3b8]",
            )}
            aria-hidden="true"
          />
          <SelectValue placeholder={allLabel} />
        </span>
      </SelectTrigger>
      <SelectContent
        className={cn(
          "rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-lg",
          isMacro && "rounded-[10px] !bg-[#172946] !text-[#f8fafc] shadow-xl",
        )}
      >
        <SelectItem
          value="all"
          className={cn(
            "text-[11px] font-light",
            isMacro &&
              "!text-[#f8fafc] focus:!bg-[rgba(255,255,255,0.1)] focus:!text-[#f8fafc]",
          )}
        >
          {allLabel}
        </SelectItem>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className={cn(
              "text-[11px] font-light",
              isMacro &&
                "!text-[#f8fafc] focus:!bg-[rgba(255,255,255,0.1)] focus:!text-[#f8fafc]",
            )}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MarketingScopeFilters({
  accountId,
  onAccountChange,
  accounts,
  campaignId,
  onCampaignChange,
  campaigns,
  adSetId,
  onAdSetChange,
  adSets,
  objective,
  onObjectiveChange,
  objectives,
  onClear,
  isLoading = false,
  variant = "default",
  className,
}: MarketingScopeFiltersProps) {
  const hasActiveScope = Boolean(
    accountId || campaignId || adSetId || objective,
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
      <ScopeSelect
        ariaLabel="Filtrar por conta de anúncios"
        value={accountId}
        onChange={onAccountChange}
        options={accounts}
        allLabel="Todas as contas"
        icon={BriefcaseBusiness}
        disabled={isLoading && accounts.length === 0}
        variant={variant}
        className={cn("w-[190px]", isMacro && "xl:flex-1", isPanel && "w-full")}
      />
      <ScopeSelect
        ariaLabel="Filtrar por campanha"
        value={campaignId}
        onChange={onCampaignChange}
        options={campaigns}
        allLabel="Todas as campanhas"
        icon={Megaphone}
        disabled={isLoading && campaigns.length === 0}
        variant={variant}
        className={cn("w-[230px]", isMacro && "xl:flex-1", isPanel && "w-full")}
      />
      <ScopeSelect
        ariaLabel="Filtrar por conjunto de anúncios"
        value={adSetId}
        onChange={onAdSetChange}
        options={adSets}
        allLabel="Todos os conjuntos"
        icon={Layers3}
        disabled={isLoading && adSets.length === 0}
        variant={variant}
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
        className={cn("w-[190px]", isMacro && "xl:flex-1", isPanel && "w-full")}
      />

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
