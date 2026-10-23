import type { ComponentProps, ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_UI } from "@/config/filter-ui";
import { cn } from "@/lib/utils";
import { FilterSidebar } from "@/components/shared/filters/FilterSidebar";
import { isFilterPanelLayer, type FilterPanelCloseReason } from "@/components/shared/filters/filter-panel-events";

interface SharedFilterPanelProps {
  presentation: "popover" | "sidebar";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestClose: (reason: FilterPanelCloseReason) => boolean;
  trigger: ReactElement;
  children: ReactNode;
  layerScope: string;
  tourPrefix?: string;
  isMobile: boolean;
  count: number;
  hasActiveFilters: boolean;
  onClear: () => void;
  onOpenAutoFocus: ComponentProps<typeof PopoverContent>["onOpenAutoFocus"];
}

export function SharedFilterPanel(props: SharedFilterPanelProps) {
  if (props.presentation === "sidebar") return <FilterSidebar {...props} />;
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange} modal={false}>
      <PopoverTrigger asChild>{props.trigger}</PopoverTrigger>
      <PopoverContent
        data-tour={props.tourPrefix ? `${props.tourPrefix}-filters-panel` : undefined}
        align="end" data-filter-layer={props.layerScope} collisionPadding={FILTER_UI.collisionPadding}
        onOpenAutoFocus={props.onOpenAutoFocus}
        onInteractOutside={(event) => { if (isFilterPanelLayer(event.target, props.layerScope)) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isFilterPanelLayer(event.target, props.layerScope)) event.preventDefault(); }}
        onFocusOutside={(event) => { if (isFilterPanelLayer(event.target, props.layerScope)) event.preventDefault(); }}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn("app-header-popover z-[100] w-72 rounded-[8px] border-0 p-2.5", FILTER_UI.panelViewport, props.isMobile && "w-[280px]")}
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between pb-1">
            <span className="text-[12px] font-light text-[var(--app-text-secondary)]">Filtros Avançados</span>
            {props.hasActiveFilters && <Button variant="ghost" size="sm" onClick={props.onClear} className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] font-light text-primary shadow-none hover:bg-[var(--app-surface-hover)]">Limpar</Button>}
          </div>
          {props.children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
