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

interface DateFilterPopoverProps {
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset | null) => void;
  customDateRange?: { from: Date; to: Date } | null;
  onCustomDateRangeChange?: (range: { from: Date; to: Date } | null) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  defaultPreset?: DatePreset;
  showCalendar?: boolean;
}

export function DateFilterPopover({
  datePreset,
  onDatePresetChange,
  customDateRange,
  onCustomDateRangeChange,
  triggerClassName,
  align = "start",
  defaultPreset = "last30days",
  showCalendar = true,
}: DateFilterPopoverProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<{ from?: Date; to?: Date }>({});
  const isMobile = useIsMobile();

  // Quando o popover abre, reflete o preset ou range customizado no calendário
  const handleOpenChange = (open: boolean) => {
    if (open) {
      if (datePreset && datePreset !== "custom") {
        const range = getDateRangeFromPreset(datePreset);
        setTempDateRange({ from: range.from, to: range.to });
      } else if (customDateRange) {
        setTempDateRange({ from: customDateRange.from, to: customDateRange.to });
      } else {
        setTempDateRange({});
      }
    }
    setDatePickerOpen(open);
  };

  const filteredPresets = datePresetOptions.filter((option) => {
    if (option.value === "custom") return false;
    if (isMobile) {
      const presetsToRemove = ["thisMonth", "lastMonth", "thisQuarter", "thisYear"];
      return !presetsToRemove.includes(option.value);
    }
    return true;
  });

  const handleDatePresetChange = (preset: DatePreset) => {
    // Toggle off when re-clicking the same preset (allows clearing)
    if (datePreset === preset && !customDateRange) {
      onDatePresetChange(null);
      setTempDateRange({});
    } else {
      onDatePresetChange(preset);
      // Reflete o intervalo do atalho no calendário
      const range = getDateRangeFromPreset(preset);
      setTempDateRange({ from: range.from, to: range.to });
    }
    onCustomDateRangeChange?.(null);
    setDatePickerOpen(false);
  };

  const handleClearDate = () => {
    onDatePresetChange(null);
    onCustomDateRangeChange?.(null);
    setTempDateRange({});
    setDatePickerOpen(false);
  };

  const handleApplyCustomDate = () => {
    if (tempDateRange.from && tempDateRange.to) {
      onDatePresetChange("custom");
      onCustomDateRangeChange?.({
        from: startOfDay(tempDateRange.from),
        to: endOfDay(tempDateRange.to),
      });
      setDatePickerOpen(false);
      setTempDateRange({});
    }
  };

  const getDateLabel = () => {
    if (datePreset === "custom" && customDateRange) {
      return `${format(customDateRange.from, "dd/MM", { locale: ptBR })} - ${format(customDateRange.to, "dd/MM", { locale: ptBR })}`;
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
          className={cn("h-9 gap-2 text-sm", isActive && "border-primary text-primary", triggerClassName)}
        >
          <CalendarIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{getDateLabel()}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto p-0 border-border/40 shadow-xl overflow-hidden", !isMobile && "w-auto")}
        align={align}
      >
        {isMobile ? (
          <div className="p-4 space-y-4">
            {/* Preset buttons in 2-column grid matching the design */}
            <div className="grid grid-cols-2 gap-2">
              {filteredPresets.map((option) => (
                <Button
                  key={option.value}
                  variant={datePreset === option.value && !customDateRange ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "h-10 text-sm font-medium rounded-full transition-all",
                    datePreset === option.value && !customDateRange
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "hover:bg-muted",
                  )}
                  onClick={() => handleDatePresetChange(option.value)}
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
                  mode="range"
                  selected={{ from: tempDateRange.from, to: tempDateRange.to }}
                  onSelect={(range) => {
                    setTempDateRange({ from: range?.from, to: range?.to });
                  }}
                  numberOfMonths={1}
                  locale={ptBR}
                  className="pointer-events-auto rounded-md"
                />

                {/* Apply button */}
                <Button
                  size="sm"
                  className="w-full h-10 rounded-full font-medium"
                  disabled={!tempDateRange.from || !tempDateRange.to}
                  onClick={handleApplyCustomDate}
                >
                  Aplicar
                </Button>

                {(datePreset !== null || customDateRange) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-full border-0 bg-primary/10 text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                    onClick={handleClearDate}
                  >
                    Limpar período
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="flex bg-background">
            {/* Botões Rápidos (Esquerda) */}
            <div className="w-[180px] p-2 bg-muted/30 border-r border-border/40 space-y-1">
              <p className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Atalhos
              </p>
              {datePresetOptions
                .filter((o) => o.value !== "custom")
                .map((option) => (
                  <Button
                    key={option.value}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "w-full justify-start text-xs h-8 font-medium hover:bg-primary/10 hover:text-primary transition-colors",
                      datePreset === option.value && !customDateRange
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                    onClick={() => handleDatePresetChange(option.value as DatePreset)}
                  >
                    {option.label}
                    {datePreset === option.value && !customDateRange && <Check className="ml-auto h-3 w-3" />}
                  </Button>
                ))}
            </div>

            {/* Seletor Personalizado (Direita) */}
            <div className="p-3">
              <p className="px-1 mb-2 text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Personalizado
              </p>
              <Calendar
                mode="range"
                selected={{ from: tempDateRange.from, to: tempDateRange.to }}
                onSelect={(range) => setTempDateRange({ from: range?.from, to: range?.to })}
                numberOfMonths={1}
                locale={ptBR}
                className="rounded-md border border-border/40 p-2"
              />

              {/* Botões Limpar e Aplicar (Abaixo do calendário) */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 border-0 bg-primary/10 text-xs font-bold uppercase tracking-tight text-primary shadow-none hover:bg-primary/15 hover:text-primary"
                  onClick={() => setTempDateRange({})}
                >
                  Limpar
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs font-bold uppercase tracking-tight bg-primary hover:bg-primary/90"
                  disabled={!tempDateRange.from || !tempDateRange.to}
                  onClick={handleApplyCustomDate}
                >
                  Aplicar
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
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
        <Button variant="outline" size="sm" className={cn("h-9 gap-2 text-sm", triggerClassName)}>
          <CalendarIcon className="h-4 w-4" />
          <span>{currentLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align={align}>
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
