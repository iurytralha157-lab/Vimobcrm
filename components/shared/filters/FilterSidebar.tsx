import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetPortal, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useFilterPanelLayout } from "@/contexts/FilterPanelLayoutContext";
import type { FilterPanelRegistration } from "@/lib/filters/filter-panel-layout";
import { isComposingFilterKey, isFilterPanelLayer, type FilterPanelCloseReason } from "@/components/shared/filters/filter-panel-events";
import { FILTER_SIDEBAR_STYLE } from "@/components/shared/filters/filter-sidebar-style";
import { ResponsiveFilterSidebarContent } from "@/components/shared/filters/ResponsiveFilterSidebarContent";

interface FilterSidebarProps {
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
  onOpenAutoFocus: ComponentProps<typeof SheetContent>["onOpenAutoFocus"];
}

export function FilterSidebar({ open, onOpenChange, onRequestClose, trigger, children, layerScope, tourPrefix, isMobile, onClear, onOpenAutoFocus }: FilterSidebarProps) {
  const { registerPanel } = useFilterPanelLayout();
  const registrationRef = useRef<FilterPanelRegistration | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const composingRef = useRef(false);
  const [panelElement, setPanelElement] = useState<HTMLDivElement | null>(null);
  const [dockElement, setDockElement] = useState<HTMLDivElement | null>(null);
  const setPanelRef = useCallback((element: HTMLDivElement | null) => {
    setPanelElement(element);
  }, []);
  useLayoutEffect(() => { if (!open) composingRef.current = false; }, [open]);
  const tryClose = useCallback((reason: FilterPanelCloseReason) => {
    if (composingRef.current) return false;
    return onRequestClose(reason);
  }, [onRequestClose]);

  useLayoutEffect(() => {
    const registration = registerPanel(layerScope);
    registrationRef.current = registration;
    return () => { registration.unregister(); registrationRef.current = null; };
  }, [layerScope, registerPanel]);
  useLayoutEffect(() => {
    registrationRef.current?.update({
      active: open, present: Boolean(panelElement), mobile: isMobile,
      panelElement, dockElement, tryClose,
    });
  }, [open, panelElement, isMobile, dockElement, tryClose, registerPanel, layerScope]);

  const keepNestedLayer = (target: EventTarget | null) => isFilterPanelLayer(target, layerScope)
    || (target instanceof Element && Boolean(target.closest("[data-filter-panel-launcher]")));

  return (
    <>
    <style>{FILTER_SIDEBAR_STYLE}</style>
    <Sheet open={open} modal={false} onOpenChange={(nextOpen) => { if (nextOpen) onOpenChange(true); else tryClose("outside"); }}>
      <SheetTrigger ref={triggerRef} asChild onClick={(event) => { if (open) { event.preventDefault(); tryClose("explicit"); } }}>{trigger}</SheetTrigger>
      {isMobile && <SheetPortal>
        <div data-state={open ? "open" : "closed"} aria-hidden="true"
          className="vimob-dialog-overlay vimob-filter-sidebar-overlay fixed inset-0 z-[99] bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      </SheetPortal>}
      <ResponsiveFilterSidebarContent open={open} mobile={isMobile} element={panelElement}>
      <SheetContent
        ref={setPanelRef}
        side="right"
        data-filter-sidebar="root"
        data-mobile={isMobile}
        aria-modal={isMobile && open ? true : undefined}
        data-filter-layer={layerScope}
        data-tour={tourPrefix ? `${tourPrefix}-filters-panel` : undefined}
        className="vimob-filter-sidebar"
        overlayClassName="vimob-filter-sidebar-overlay"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          if (!isMobile) return;
          event.preventDefault();
          const active = document.activeElement;
          const activeDialog = active instanceof Element ? active.closest('[role="dialog"], [role="alertdialog"]') : null;
          if (activeDialog && activeDialog !== panelElement) return;
          triggerRef.current?.focus({ preventScroll: true });
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!isComposingFilterKey(event)) tryClose("explicit");
        }}
        onInteractOutside={(event) => { if (keepNestedLayer(event.target)) event.preventDefault(); }}
        onPointerDownOutside={(event) => {
          if (keepNestedLayer(event.target)) { event.preventDefault(); return; }
          if (isMobile) {
            event.preventDefault();
            event.detail.originalEvent.preventDefault();
            tryClose("outside");
          }
        }}
        onFocusOutside={(event) => { if (isMobile || keepNestedLayer(event.target)) event.preventDefault(); }}
        onCompositionStartCapture={() => { composingRef.current = true; }}
        onCompositionEndCapture={() => { composingRef.current = false; }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <header data-filter-sidebar="header" className="vimob-filter-sidebar-header">
          <div className="vimob-filter-sidebar-heading">
            <SheetTitle className="vimob-filter-sidebar-title">Filtros avançados</SheetTitle>
          </div>
          <Button type="button" variant="ghost" size="icon" data-filter-sidebar-close data-filter-sidebar-close-tone="neutral" aria-label="Fechar filtros avançados" title="Fechar filtros avançados" className="vimob-filter-sidebar-close" onClick={() => tryClose("explicit")}>
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
          <SheetDescription className="sr-only">Ajuste os filtros e use Buscar para concluir. Limpar filtros restaura os critérios.</SheetDescription>
        </header>
        <div data-filter-sidebar="body" className="vimob-filter-sidebar-body">{children}</div>
        <footer data-filter-sidebar="footer" className="vimob-filter-sidebar-footer">
          {isMobile && <div ref={setDockElement} data-filter-launcher-slot className="vimob-filter-sidebar-dock" />}
          <div className="vimob-filter-sidebar-actions">
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>Limpar filtros</Button>
            <Button type="button" size="sm" data-filter-sidebar-complete onClick={() => tryClose("explicit")}>Buscar</Button>
          </div>
        </footer>
      </SheetContent>
      </ResponsiveFilterSidebarContent>
    </Sheet>
    </>
  );
}
