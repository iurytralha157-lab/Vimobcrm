import { Building2, Search, User, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PropertyPickerDialog,
  type PropertyPickerProperty,
} from "@/components/features/properties/PropertyPickerDialog";
import type { Lead } from "@/hooks/use-leads";
import { cn } from "@/lib/utils";
import {
  agendaControlClass,
  agendaMutedTextClass,
  agendaPopoverClass,
} from "@/components/features/schedule/event-sheet/config";
import { AgendaRow } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";

export function EventRelationsSections({
  locked,
  isExisting,
  isMasked,
  selectedLeadId,
  selectedLeadName,
  showLeadSelector,
  leadSearch,
  searchedLeads,
  canViewProperties,
  selectedPropertyId,
  selectedPropertyLabel,
  allProperties,
  propertiesLoading,
  onRemoveLead,
  onLeadSelectorChange,
  onLeadSearchChange,
  onLeadSelect,
  onPropertyPreview,
  onRemoveProperty,
  onPropertyPickerOpenChange,
  onPropertySearchChange,
  onPropertySelect,
}: {
  locked: boolean;
  isExisting: boolean;
  isMasked: boolean;
  selectedLeadId: string | null;
  selectedLeadName: string | null;
  showLeadSelector: boolean;
  leadSearch: string;
  searchedLeads: readonly Lead[];
  canViewProperties: boolean;
  selectedPropertyId: string | null;
  selectedPropertyLabel: string | null;
  allProperties: PropertyPickerProperty[];
  propertiesLoading: boolean;
  onRemoveLead: () => void;
  onLeadSelectorChange: (open: boolean) => void;
  onLeadSearchChange: (value: string) => void;
  onLeadSelect: (lead: Lead) => void;
  onPropertyPreview: () => void;
  onRemoveProperty: () => void;
  onPropertyPickerOpenChange: (open: boolean) => void;
  onPropertySearchChange: (value: string) => void;
  onPropertySelect: (property: PropertyPickerProperty) => void;
}) {
  return (
    <>
      <AgendaRow icon={<User size={18} />} label="Lead/cliente" inline>
        {selectedLeadId ? (
          <div className="flex items-center justify-between gap-2">
            {isExisting ? (
              <Link
                href={`/crm/pipelines?lead=${selectedLeadId}`}
                className="truncate text-[12px] font-light text-primary hover:text-primary/80"
              >
                {selectedLeadName || "Lead vinculado"}
              </Link>
            ) : (
              <span className="truncate text-[12px] font-light text-[var(--app-text-primary)]">
                {selectedLeadName}
              </span>
            )}
            {!locked && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Remover lead vinculado"
                onClick={onRemoveLead}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        ) : !locked ? (
          <Popover open={showLeadSelector} onOpenChange={onLeadSelectorChange}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] font-light sm:h-9",
                  agendaControlClass,
                  agendaMutedTextClass,
                )}
              >
                <Search className="h-4 w-4" />
                Buscar por nome, tel...
              </button>
            </PopoverTrigger>
            <PopoverContent
              className={cn(
                "w-[min(360px,calc(100vw-32px))] p-0",
                agendaPopoverClass,
              )}
              align="start"
            >
              <Command
                shouldFilter={false}
                className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
              >
                <CommandInput
                  placeholder="Buscar por nome, telefone ou e-mail..."
                  value={leadSearch}
                  onValueChange={onLeadSearchChange}
                />
                <CommandList>
                  <CommandEmpty>Nenhum lead encontrado.</CommandEmpty>
                  <CommandGroup>
                    {searchedLeads.map((lead) => (
                      <CommandItem
                        key={lead.id}
                        value={lead.id}
                        onSelect={() => onLeadSelect(lead)}
                      >
                        <User className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-[12px] font-light">
                            {lead.name}
                          </span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {[lead.phone, lead.email]
                              .filter(Boolean)
                              .join(" · ") || "Sem contato"}
                          </span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
            {isMasked ? "Informação privada" : "Sem lead"}
          </span>
        )}
      </AgendaRow>

      {canViewProperties && (
        <AgendaRow
          dataTour="agenda-event-property"
          icon={<Building2 size={18} />}
          label="Imóvel vinculado"
          inline
        >
          {selectedPropertyId ? (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onPropertyPreview}
                className="truncate text-left text-[12px] font-light text-primary hover:text-primary/80"
              >
                {selectedPropertyLabel || "Imóvel selecionado"}
              </button>
              {!locked && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  aria-label="Remover imóvel vinculado"
                  onClick={onRemoveProperty}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ) : !locked ? (
            <PropertyPickerDialog
              properties={allProperties}
              selectedPropertyId={selectedPropertyId}
              isLoading={propertiesLoading}
              onOpenChange={onPropertyPickerOpenChange}
              onSearchChange={onPropertySearchChange}
              onSelect={onPropertySelect}
              trigger={
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-10 w-full items-center gap-2 px-3 text-left text-[12px] font-light sm:h-9",
                    agendaControlClass,
                    agendaMutedTextClass,
                  )}
                >
                  <Search className="h-4 w-4" />
                  Buscar imóvel
                </button>
              }
            />
          ) : (
            <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
              {isMasked ? "Informação privada" : "Sem imóvel"}
            </span>
          )}
        </AgendaRow>
      )}
    </>
  );
}
