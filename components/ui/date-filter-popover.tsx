import { useState } from "react";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";
import { DatePreset, datePresetOptions, getDateRangeFromPreset } from "@/hooks/use-dashboard-filters";
import { FILTER_UI } from "@/config/filter-ui";
import { validateDateRangeLimit } from "@/lib/filters/date-range-limits";
import { DATE_FILTER_STYLE } from "@/components/shared/filters/date-filter-style";

interface DateFilterPopoverProps {
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset | null) => void;
  customDateRange?: { from: Date; to: Date } | null;
  onCustomDateRangeChange?: (range: { from: Date; to: Date } | null) => void;
  triggerClassName?: string;
  triggerDataTour?: string;
  align?: "start" | "center" | "end";
  defaultPreset?: DatePreset | null;
  showCalendar?: boolean;
  iconOnly?: boolean;
  dateLabel?: string;
  dateRangeMaxDays?: number;
  getPresetRange?: (preset: DatePreset) => { from: Date; to: Date };
  validateRange?: (range: { from: Date; to: Date } | null) => string | null;
  filterApplicationRevision?: number;
  layerScope?: string;
}

export function DateFilterPopover({
  datePreset,
  onDatePresetChange,
  customDateRange,
  onCustomDateRangeChange,
  triggerClassName,
  triggerDataTour,
  align = "start",
  defaultPreset = "last30days",
  showCalendar = true,
  iconOnly = false,
  dateLabel = "Período",
  dateRangeMaxDays,
  getPresetRange = getDateRangeFromPreset,
  validateRange,
  filterApplicationRevision,
  layerScope,
}: DateFilterPopoverProps) {
  const appliedRange = datePreset === "custom" ? customDateRange
    : datePreset ? getPresetRange(datePreset) : null;
  const validateResolvedRange = validateRange ?? ((range: { from: Date; to: Date } | null) =>
    dateRangeMaxDays === undefined ? null : validateDateRangeLimit(range, dateRangeMaxDays));
  const applicationKey = JSON.stringify([
    datePreset, appliedRange?.from.getTime(), appliedRange?.to.getTime(), filterApplicationRevision,
  ]);
  const [previousApplicationKey, setPreviousApplicationKey] = useState(applicationKey);
  const [openedApplicationKey, setOpenedApplicationKey] = useState<string | null>(null);
  const [tempDateRange, setTempDateRange] = useState<{ from?: Date; to?: Date }>({});
  const [attemptedRangeError, setAttemptedRangeError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  if (previousApplicationKey !== applicationKey) {
    setPreviousApplicationKey(applicationKey);
    setOpenedApplicationKey(null);
    setTempDateRange(appliedRange ? { from: appliedRange.from, to: appliedRange.to } : {});
    setAttemptedRangeError(null);
  }
  const calendarRange = normalizeCalendarRange(tempDateRange);
  const draftRange = tempDateRange.from && tempDateRange.to
    ? { from: startOfDay(tempDateRange.from), to: endOfDay(tempDateRange.to) }
    : null;
  // External applications close definitively, even if their values later return.
  // Equal date objects from an ordinary rerender keep the user's draft intact.
  const datePickerOpen = openedApplicationKey === applicationKey;
  const draftRangeError = validateResolvedRange(draftRange);
  const appliedRangeError = validateResolvedRange(appliedRange ?? null);
  const rangeError = attemptedRangeError ?? draftRangeError ?? appliedRangeError;

  // Quando o popover abre, reflete o preset ou range customizado no calendário
  const handleOpenChange = (open: boolean) => {
    if (open) {
      setAttemptedRangeError(null);
      if (datePreset && datePreset !== "custom") {
        const range = getPresetRange(datePreset);
        setTempDateRange({ from: range.from, to: range.to });
      } else if (customDateRange) {
        setTempDateRange({ from: customDateRange.from, to: customDateRange.to });
      } else {
        setTempDateRange({});
      }
    }
    setOpenedApplicationKey(open ? applicationKey : null);
  };

  const filteredPresets = datePresetOptions.filter((option) => {
    if (option.value === "custom") return false;
    return true;
  });

  const handleDatePresetChange = (preset: DatePreset) => {
    // Toggle off when re-clicking the same preset (allows clearing)
    if (datePreset === preset && !customDateRange) {
      onDatePresetChange(null);
      setTempDateRange({});
    } else {
      const range = getPresetRange(preset);
      const error = validateResolvedRange(range);
      if (error) { setAttemptedRangeError(error); return; }
      onDatePresetChange(preset);
      // Reflete o intervalo do atalho no calendário
      setTempDateRange({ from: range.from, to: range.to });
    }
    setAttemptedRangeError(null);
    onCustomDateRangeChange?.(null);
    setOpenedApplicationKey(null);
  };

  const handleClearDate = () => {
    setAttemptedRangeError(null);
    onDatePresetChange(null);
    onCustomDateRangeChange?.(null);
    setTempDateRange({});
    setOpenedApplicationKey(null);
  };

  const handleApplyCustomDate = () => {
    if (datePickerOpen && draftRange && !draftRangeError) {
      setAttemptedRangeError(null);
      onDatePresetChange("custom");
      onCustomDateRangeChange?.(draftRange);
      setOpenedApplicationKey(null);
      setTempDateRange({});
    }
  };

  const getDateLabel = () => {
    if (datePreset === "custom" && customDateRange) {
      return `${format(customDateRange.from, "dd/MM/yyyy", { locale: ptBR })} - ${format(customDateRange.to, "dd/MM/yyyy", { locale: ptBR })}`;
    }
    if (!datePreset) return "Período";
    const option = datePresetOptions.find((o) => o.value === datePreset);
    return option?.label || "Período";
  };

  const isActive = (datePreset !== null && datePreset !== defaultPreset) || !!customDateRange;

  return (
    <Popover open={datePickerOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-tour={triggerDataTour}
          data-filter-active={isActive}
          aria-label={`${dateLabel}: ${getDateLabel()}`}
          aria-invalid={Boolean(appliedRangeError)}
          aria-description={appliedRangeError ?? undefined}
          title={`${dateLabel}: ${getDateLabel()}`}
          className={cn(FILTER_UI.trigger, "max-w-[220px]", iconOnly && "w-8 px-0", isActive && "border-primary text-primary", triggerClassName)}
        >
          <CalendarIcon className={FILTER_UI.icon} aria-hidden="true" />
          {!iconOnly && <span className="truncate">{getDateLabel()}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        data-date-filter
        data-filter-layer={layerScope}
        data-filter-calendar={layerScope ? true : undefined}
        className={cn("w-auto p-0 border-border/40 shadow-xl", FILTER_UI.panelViewport, isMobile && "w-[min(340px,calc(100vw-24px))]")}
        align={align}
        collisionPadding={FILTER_UI.collisionPadding}
      >
        <style>{DATE_FILTER_STYLE}</style>
        {rangeError && <p role="alert" className="max-w-[520px] whitespace-normal px-3 pt-3 text-[11px] text-destructive">{rangeError}</p>}
        {isMobile ? (
          <div className="space-y-2.5 p-3">
            {/* Preset buttons in 2-column grid matching the design */}
            <div className="grid grid-cols-2 gap-1.5">
              {filteredPresets.map((option) => (
                <Button
                  key={option.value}
                  data-date-shortcut
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 rounded-[6px] border-0 text-xs font-medium shadow-none transition-colors",
                    datePreset === option.value && !customDateRange
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                  )}
                  onClick={() => handleDatePresetChange(option.value)}
                   aria-pressed={datePreset === option.value && !customDateRange}
                >
                  {option.label}
                </Button>
              ))}
            </div>

            {showCalendar && (
              <>
                {/* Divider with text */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-start">
                    <span className="bg-popover pr-2 text-xs text-muted-foreground">Ou selecione um período:</span>
                  </div>
                </div>

                {/* Calendar for custom range */}
                <Calendar
                  data-date-calendar
                  mode="range"
                  selected={calendarRange}
                  onSelect={(range) => {
                    setAttemptedRangeError(null);
                    setTempDateRange(normalizeCalendarRange(range));
                  }}
                  defaultMonth={calendarRange.from}
                  numberOfMonths={1}
                  locale={ptBR}
                  className="pointer-events-auto rounded-[6px] p-1"
                  styles={{ day_button: { fontSize: 12 } }}
                  classNames={{ month: "space-y-2" }}
                />

                <div data-date-actions className="grid grid-cols-2 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-date-action="clear-applied"
                    className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-xs font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]"
                    onClick={handleClearDate}
                  >
                    Limpar período
                  </Button>
                  <Button
                    size="sm"
                    data-date-action="apply"
                    className="h-9 rounded-[6px] text-xs font-light"
                    disabled={!draftRange || Boolean(draftRangeError)}
                    onClick={handleApplyCustomDate}
                  >
                    Aplicar
                  </Button>
                </div>
              </>
            )}
            {!showCalendar && (datePreset !== null || customDateRange) && <Button data-date-action="clear-applied" variant="ghost" size="sm" className="h-8 w-full text-xs font-light" onClick={handleClearDate}>Limpar período</Button>}
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap bg-background">
            {/* Botões Rápidos (Esquerda) */}
            <div data-date-shortcuts className="w-[180px] p-2 bg-muted/30 border-r border-border/40 space-y-1">
              <p className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Atalhos
              </p>
              {datePresetOptions
                .filter((o) => o.value !== "custom")
                .map((option) => (
                  <Button
                    key={option.value}
                    data-date-shortcut
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-xs h-8 font-medium hover:bg-primary/10 hover:text-primary transition-colors",
                      datePreset === option.value && !customDateRange
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                    onClick={() => handleDatePresetChange(option.value as DatePreset)}
                    aria-pressed={datePreset === option.value && !customDateRange}
                  >
                    {option.label}
                    {datePreset === option.value && !customDateRange && <Check className="ml-auto h-3 w-3" />}
                  </Button>
                ))}
            </div>

            {/* Seletor Personalizado (Direita) */}
            {showCalendar && <div className="min-w-0 p-3">
              <p className="px-1 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Personalizado
              </p>
              <Calendar
                data-date-calendar
                mode="range"
                selected={calendarRange}
                onSelect={(range) => { setAttemptedRangeError(null); setTempDateRange(normalizeCalendarRange(range)); }}
                defaultMonth={calendarRange.from}
                numberOfMonths={1}
                locale={ptBR}
                className="rounded-md border border-border/40 p-2"
                styles={{ day_button: { fontSize: 12 } }}
                classNames={{ month: "space-y-2" }}
              />

              {/* A única ação de limpar restaura o rascunho e o período aplicado. */}
              <div data-date-actions className="grid grid-cols-2 gap-2 mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  data-date-action="clear-applied"
                  className="h-8 border-0 bg-[var(--app-surface-soft)] text-xs font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]"
                  onClick={handleClearDate}
                >
                  Limpar período
                </Button>
                <Button
                  size="sm"
                  data-date-action="apply"
                  className="h-8 text-xs font-light"
                  disabled={!draftRange || Boolean(draftRangeError)}
                  onClick={handleApplyCustomDate}
                >
                  Aplicar
                </Button>
              </div>
            </div>}
            {!showCalendar && (datePreset !== null || customDateRange) && <div className="w-full p-2"><Button data-date-action="clear-applied" variant="ghost" size="sm" onClick={handleClearDate} className="h-8 w-full text-xs font-light text-[var(--app-text-secondary)]">Limpar período</Button></div>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function normalizeCalendarRange(range?: { from?: Date; to?: Date } | null) {
  return {
    from: range?.from ? startOfDay(range.from) : undefined,
    to: range?.to ? startOfDay(range.to) : undefined,
  };
}

// Simple period filter for pages that only need preset options (no custom date range)
interface SimplePeriodFilterProps {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  triggerClassName?: string;
  align?: "start" | "center" | "end";
}

export function SimplePeriodFilter({
  value,
  onChange,
  options,
  triggerClassName,
  align = "start",
}: SimplePeriodFilterProps) {
  const [open, setOpen] = useState(false);

  const currentLabel = options.find((o) => o.value === value)?.label || "Período";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" title={currentLabel} aria-label={`Período: ${currentLabel}`} className={cn(FILTER_UI.trigger, triggerClassName)}>
          <CalendarIcon className="h-4 w-4" />
          <span>{currentLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-auto p-0", FILTER_UI.panelViewport)} align={align} collisionPadding={FILTER_UI.collisionPadding}>
        <div className="p-4">
          <div className="grid grid-cols-2 gap-2">
            {options.map((option) => (
              <Button
                key={option.value}
                variant={value === option.value ? "default" : "outline"}
                size="sm"
                className={cn(
                  "h-10 text-sm font-medium rounded-full transition-all",
                  value === option.value ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-muted",
                )}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
