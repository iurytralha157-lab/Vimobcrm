"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_UI } from "@/config/filter-ui";
import { searchTextIncludes } from "@/lib/search-text";
import { cn } from "@/lib/utils";

export interface SearchableFilterOption {
  value: string;
  label: string;
  keywords?: readonly string[];
  disabledReason?: string;
}

interface SearchableFilterSelectProps {
  value: string | null;
  onChange: (value: string | null) => void;
  options: readonly SearchableFilterOption[];
  allLabel: string;
  ariaLabel: string;
  className?: string;
  popupClassName?: string;
  loading?: boolean;
  disabled?: boolean;
  error?: boolean;
  emptyLabel?: string;
  icon?: ReactNode;
  layerScope?: string;
}

/** A single filter with stable option identities and local, accent-insensitive search. */
export function SearchableFilterSelect({
  value, onChange, options, allLabel, ariaLabel, className, popupClassName,
  loading = false, disabled = false, error = false,
  emptyLabel = "Nenhuma opção disponível", icon, layerScope,
}: SearchableFilterSelectProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const uniqueOptions = useMemo(
    () => Array.from(new Map(options.map((option) => [option.value, option])).values()),
    [options],
  );
  const selected = uniqueOptions.find((option) => option.value === value);
  const label = selected?.label ?? (value ? "Seleção indisponível" : allLabel);
  const matches = useMemo(() => uniqueOptions.filter((option) =>
    searchTextIncludes([option.label, option.value, ...(option.keywords ?? [])].join(" "), search),
  ), [search, uniqueOptions]);
  const select = (nextValue: string | null) => {
    onChange(nextValue);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch(""); }} modal={false}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox"
          aria-label={`${ariaLabel}: ${label}`} aria-expanded={open} aria-haspopup="dialog"
          aria-busy={loading} disabled={disabled} title={label}
          data-filter-active={Boolean(value && value !== "all")}
          className={cn(FILTER_UI.control, "justify-between gap-2", value && "text-primary", className)}>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">{icon}<span className="truncate">{loading && !uniqueOptions.length ? "Carregando..." : label}</span></span>
          <ChevronsUpDown className={cn(FILTER_UI.icon, "opacity-50")} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={FILTER_UI.collisionPadding}
        data-filter-layer={layerScope}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
        className={cn("app-header-popover z-[140] w-[var(--radix-popover-trigger-width)] min-w-64 rounded-[8px] border-0 p-1", FILTER_UI.panelViewport, popupClassName)}>
        <Command shouldFilter={false} label={`Buscar opções: ${ariaLabel}`} className="bg-transparent">
          <CommandInput ref={searchRef} aria-label={`Buscar opções: ${ariaLabel}`} placeholder="Buscar opções..." value={search} onValueChange={setSearch} className="h-9 py-0 text-[12px] font-light" />
          <CommandList className="max-h-[min(260px,50dvh)]">
            <CommandGroup>
              <CommandItem value="filter:all" onSelect={() => select(null)} className={FILTER_UI.option}>
                <Check className={cn(FILTER_UI.icon, "mr-2", value ? "opacity-0" : "opacity-100")} aria-hidden="true" />{allLabel}
              </CommandItem>
              {matches.map((option) => (
                <CommandItem key={option.value} value={`filter:option:${option.value}`} disabled={Boolean(option.disabledReason)} onSelect={() => { if (!option.disabledReason) select(option.value); }} className={FILTER_UI.option} title={option.disabledReason ? `${option.label}. ${option.disabledReason}` : option.label} aria-label={option.disabledReason ? `${option.label}. ${option.disabledReason}` : option.label}>
                  <Check className={cn(FILTER_UI.icon, "mr-2", value === option.value ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                  <span className="min-w-0 truncate">{option.label}</span>
                  {option.disabledReason ? <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">Somente consulta</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {loading && !uniqueOptions.length && <p role="status" className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground"><Loader2 className={cn(FILTER_UI.icon, "animate-spin")} aria-hidden="true" />Carregando opções...</p>}
            {error && <p role="alert" className="flex items-center gap-2 px-2 py-3 text-[12px] text-muted-foreground"><AlertCircle className={FILTER_UI.icon} aria-hidden="true" />Opções indisponíveis. A seleção foi preservada.</p>}
            {!loading && !error && !matches.length && <p role="status" className="px-2 py-3 text-center text-[12px] text-muted-foreground">{search.trim() ? "Nenhuma opção encontrada" : emptyLabel}</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
