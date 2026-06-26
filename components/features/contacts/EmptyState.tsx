import { Button } from '@/components/ui/button';
import { Users, Upload, Plus } from 'lucide-react';

interface EmptyStateProps {
  hasActiveFilters: boolean;
  onImport: () => void;
  onCreate: () => void;
  onClearFilters: () => void;
}

export function EmptyState({
  hasActiveFilters,
  onImport,
  onCreate,
  onClearFilters
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-white/[0.045]">
        <Users className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold text-lg">Nenhum contato encontrado</h3>
        <p className="text-muted-foreground text-sm max-w-sm mt-1">
          {hasActiveFilters
            ? 'Tente ajustar os filtros para encontrar mais resultados.'
            : 'Comece importando uma planilha ou criando seu primeiro contato.'}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        {hasActiveFilters ? (
          <Button variant="outline" className="border-white/[0.055] bg-white/[0.035] hover:bg-white/[0.055]" onClick={onClearFilters}>
            Limpar filtros
          </Button>
        ) : (
          <>
            <Button variant="outline" className="border-white/[0.055] bg-white/[0.035] hover:bg-white/[0.055]" onClick={onImport}>
              <Upload className="h-4 w-4 mr-2" />
              Importar Contatos
            </Button>
            <Button onClick={onCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Contato
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
