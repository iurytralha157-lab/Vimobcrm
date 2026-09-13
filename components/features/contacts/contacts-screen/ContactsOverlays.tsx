import dynamic from 'next/dynamic';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { LeadDetailDialogProps } from '@/components/features/leads/lead-detail';
import type { Lead } from '@/hooks/use-leads';
import { getErrorMessageOrFallback } from '@/lib/api/vimob-error';
import type { ContactExportFilters } from '@/lib/export-contacts';

function DeferredSurfaceLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
    >
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-primary"
        aria-hidden="true"
      />
      Preparando formulário...
    </div>
  );
}

const LeadDetailDialog = dynamic(
  () =>
    import('@/components/features/leads/LeadDetailDialog').then(
      (module) => module.LeadDetailDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

const CreateLeadDialog = dynamic(
  () =>
    import('@/components/features/leads/CreateLeadDialog').then(
      (module) => module.CreateLeadDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

const ImportContactsDialog = dynamic(
  () =>
    import('@/components/features/contacts/ImportContactsDialog').then(
      (module) => module.ImportContactsDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

const ExportContactsDialog = dynamic(
  () =>
    import('@/components/features/contacts/ExportContactsDialog').then(
      (module) => module.ExportContactsDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

type ContactsBulkSelectionBarProps = {
  canDeleteLeads: boolean;
  selectedCount: number;
  onRequestDelete: () => void;
  onClear: () => void;
};

export function ContactsBulkSelectionBar({
  canDeleteLeads,
  selectedCount,
  onRequestDelete,
  onClear,
}: ContactsBulkSelectionBarProps) {
  if (!canDeleteLeads || selectedCount === 0) return null;

  return (
    <div className="app-card-soft fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-[8px] border border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] p-2 shadow-sm">
      <span className="whitespace-nowrap px-1 text-[12px] font-light text-[var(--app-text-primary)]">
        {selectedCount} selecionado(s)
      </span>
      <Button
        variant="destructive"
        size="sm"
        onClick={onRequestDelete}
        className="h-8 gap-1 rounded-[6px] px-2.5 text-[11px] font-light shadow-none"
      >
        <Trash2 className="h-4 w-4 mr-1" />
        Excluir
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="h-8 rounded-[6px] px-2.5 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        Cancelar
      </Button>
    </div>
  );
}

type ContactsOverlaysProps = {
  isOpeningLeadDetails: boolean;
  showLeadDetailError: boolean;
  selectedLeadError: unknown;
  isFetchingSelectedLead: boolean;
  selectedContactId: string | null;
  selectedLead: LeadDetailDialogProps['lead'];
  stages: LeadDetailDialogProps['stages'];
  tags: LeadDetailDialogProps['allTags'];
  users: LeadDetailDialogProps['allUsers'];
  onRetrySelectedLead: () => void;
  onCloseSelectedLead: () => void;
  onEditLead: NonNullable<LeadDetailDialogProps['onEdit']>;
  canCreateLeads: boolean;
  isCreateDialogOpen: boolean;
  onCreateDialogOpenChange: (open: boolean) => void;
  editingLead: Lead | null;
  onEditingDialogOpenChange: (open: boolean) => void;
  onEditedLeadSaved: () => void;
  canDeleteLeads: boolean;
  deleteContactId: string | null;
  isDeletePending: boolean;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
  bulkDeleteDialogOpen: boolean;
  selectedCount: number;
  isBulkDeletePending: boolean;
  onBulkDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmBulkDelete: () => void;
  canImportLeads: boolean;
  importDialogOpen: boolean;
  onImportDialogOpenChange: (open: boolean) => void;
  canExportLeads: boolean;
  exportDialogOpen: boolean;
  exportFilters: ContactExportFilters;
  organizationId: string | null;
  totalCount: number;
  onExportDialogOpenChange: (open: boolean) => void;
  onExportingChange: (isExporting: boolean) => void;
};

export function ContactsOverlays({
  isOpeningLeadDetails,
  showLeadDetailError,
  selectedLeadError,
  isFetchingSelectedLead,
  selectedContactId,
  selectedLead,
  stages,
  tags,
  users,
  onRetrySelectedLead,
  onCloseSelectedLead,
  onEditLead,
  canCreateLeads,
  isCreateDialogOpen,
  onCreateDialogOpenChange,
  editingLead,
  onEditingDialogOpenChange,
  onEditedLeadSaved,
  canDeleteLeads,
  deleteContactId,
  isDeletePending,
  onDeleteDialogOpenChange,
  onConfirmDelete,
  bulkDeleteDialogOpen,
  selectedCount,
  isBulkDeletePending,
  onBulkDeleteDialogOpenChange,
  onConfirmBulkDelete,
  canImportLeads,
  importDialogOpen,
  onImportDialogOpenChange,
  canExportLeads,
  exportDialogOpen,
  exportFilters,
  organizationId,
  totalCount,
  onExportDialogOpenChange,
  onExportingChange,
}: ContactsOverlaysProps) {
  return (
    <>
      {isOpeningLeadDetails && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
        >
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-primary"
            aria-hidden="true"
          />
          Abrindo lead...
        </div>
      )}

      {showLeadDetailError && (
        <div
          role="alert"
          className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
        >
          <AlertTriangle
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          <span>
            {getErrorMessageOrFallback(
              selectedLeadError,
              'Não foi possível abrir este contato.',
            )}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRetrySelectedLead}
            disabled={isFetchingSelectedLead}
            className="h-7 rounded-[4px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            Tentar novamente
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCloseSelectedLead}
            className="h-7 rounded-[4px] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            Fechar
          </Button>
        </div>
      )}

      {selectedContactId && selectedLead && (
        <LeadDetailDialog
          lead={selectedLead}
          stages={stages}
          onClose={onCloseSelectedLead}
          onEdit={onEditLead}
          allTags={tags}
          allUsers={users}
        />
      )}

      {canCreateLeads && isCreateDialogOpen && (
        <CreateLeadDialog
          open={isCreateDialogOpen}
          onOpenChange={onCreateDialogOpenChange}
        />
      )}

      {editingLead && (
        <CreateLeadDialog
          open={!!editingLead}
          onOpenChange={onEditingDialogOpenChange}
          lead={editingLead}
          onSaved={onEditedLeadSaved}
        />
      )}

      <AlertDialog
        open={canDeleteLeads && !!deleteContactId}
        onOpenChange={onDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este contato? Esta ação não pode
              ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletePending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={isDeletePending}
              onClick={(event) => {
                event.preventDefault();
                onConfirmDelete();
              }}
            >
              {isDeletePending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {isDeletePending ? 'Excluindo...' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={canDeleteLeads && bulkDeleteDialogOpen}
        onOpenChange={onBulkDeleteDialogOpenChange}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Excluir {selectedCount} contatos
            </AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir {selectedCount} contatos
              selecionados? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBulkDeletePending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              disabled={isBulkDeletePending}
              onClick={(event) => {
                event.preventDefault();
                onConfirmBulkDelete();
              }}
            >
              {isBulkDeletePending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {isBulkDeletePending
                ? 'Excluindo...'
                : `Excluir ${selectedCount} contatos`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {canImportLeads && importDialogOpen && (
        <ImportContactsDialog
          open={importDialogOpen}
          onOpenChange={onImportDialogOpenChange}
        />
      )}

      {canExportLeads && exportDialogOpen && (
        <ExportContactsDialog
          open={exportDialogOpen}
          onOpenChange={onExportDialogOpenChange}
          filters={exportFilters}
          organizationId={organizationId}
          totalCount={totalCount}
          onExportingChange={onExportingChange}
        />
      )}
    </>
  );
}
