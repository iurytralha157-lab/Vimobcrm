import { Button } from "@/components/ui/button";
import { Users, Upload, Plus } from "lucide-react";

interface EmptyStateProps {
  hasActiveFilters: boolean;
  onImport?: () => void;
  onCreate?: () => void;
  onClearFilters: () => void;
}

export function EmptyState({
  hasActiveFilters,
  onImport,
  onCreate,
  onClearFilters,
}: EmptyStateProps) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-5 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
        <Users className="h-4 w-4" aria-hidden="true" />
      </div>

      <h3 className="mt-3 text-[14px] font-medium text-[var(--app-text-primary)]">
        Nenhum contato encontrado
      </h3>
      <p className="mt-1 max-w-sm text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
        {hasActiveFilters
          ? "Tente ajustar os filtros para encontrar mais resultados."
          : onImport || onCreate
            ? "Comece adicionando seu primeiro contato."
            : "Nenhum contato está disponível no seu escopo."}
      </p>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {hasActiveFilters ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={onClearFilters}
          >
            Limpar filtros
          </Button>
        ) : (
          <>
            {onImport && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={onImport}
              >
                <Upload className="h-3.5 w-3.5" />
                Importar contatos
              </Button>
            )}
            {onCreate && (
              <Button
                size="sm"
                className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[11px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                onClick={onCreate}
              >
                <Plus className="h-3.5 w-3.5" />
                Criar contato
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
