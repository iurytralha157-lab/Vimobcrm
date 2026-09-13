'use client';

import { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CONTACT_EXPORT_COLUMN_GROUPS,
  CONTACT_EXPORT_COLUMN_OPTIONS,
  CONTACT_EXPORT_PRESETS,
  DEFAULT_CONTACT_EXPORT_COLUMN_KEYS,
  exportContactsFiltered,
  type ContactExportColumnKey,
  type ContactExportFilters,
  type ContactExportFormat,
  type ContactExportProgress,
  type ContactExportPresetKey,
} from '@/lib/export-contacts';
import { cn } from '@/lib/utils';
import { formatPtBRNumber } from '@/lib/utils/formatting';

type ExportContactsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ContactExportFilters;
  organizationId: string | null;
  totalCount: number;
  onExportingChange?: (isExporting: boolean) => void;
};

function normalizeSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function localDateStamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  );
}

function progressValue(
  progress: ContactExportProgress | null,
  isComplete: boolean,
) {
  if (isComplete) return 100;
  if (!progress) return 0;
  if (progress.phase === 'generating') return 90;
  if (progress.phase === 'downloading') return 97;
  if (!progress.total || progress.total <= 0) return 8;
  return Math.min(85, Math.round((progress.processed / progress.total) * 85));
}

function progressLabel(
  progress: ContactExportProgress | null,
  completedCount: number | null,
) {
  if (completedCount !== null) {
    return `${formatPtBRNumber(completedCount)} contatos exportados.`;
  }
  if (!progress) return 'Preparando exportação...';
  if (progress.phase === 'generating') return 'Gerando o arquivo...';
  if (progress.phase === 'downloading') return 'Finalizando o download...';
  if (progress.total !== null) {
    return `Carregando ${formatPtBRNumber(progress.processed)} de ${formatPtBRNumber(progress.total)} contatos...`;
  }
  return `Carregando ${formatPtBRNumber(progress.processed)} contatos...`;
}

export function ExportContactsDialog({
  open,
  onOpenChange,
  filters,
  organizationId,
  totalCount,
  onExportingChange,
}: ExportContactsDialogProps) {
  const [format, setFormat] = useState<ContactExportFormat>('xlsx');
  const [selectedColumns, setSelectedColumns] = useState<Set<ContactExportColumnKey>>(
    () => new Set(DEFAULT_CONTACT_EXPORT_COLUMN_KEYS),
  );
  const [includeDynamicFields, setIncludeDynamicFields] = useState(false);
  const [columnSearch, setColumnSearch] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ContactExportProgress | null>(null);
  const [completedCount, setCompletedCount] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const normalizedColumnSearch = normalizeSearch(columnSearch);
  const groupedColumns = useMemo(
    () =>
      CONTACT_EXPORT_COLUMN_GROUPS.map((group) => ({
        ...group,
        columns: CONTACT_EXPORT_COLUMN_OPTIONS.filter(
          (column) =>
            column.group === group.key &&
            (!normalizedColumnSearch ||
              normalizeSearch(column.label).includes(normalizedColumnSearch)),
        ),
      })).filter((group) => group.columns.length > 0),
    [normalizedColumnSearch],
  );

  const clearRunFeedback = () => {
    setCompletedCount(null);
    setErrorMessage(null);
    setProgress(null);
  };

  const toggleColumn = (key: ContactExportColumnKey, checked: boolean) => {
    clearRunFeedback();
    setSelectedColumns((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const applyPreset = (presetKey: ContactExportPresetKey) => {
    const preset = CONTACT_EXPORT_PRESETS.find(
      (candidate) => candidate.key === presetKey,
    );
    if (!preset) return;
    clearRunFeedback();
    setSelectedColumns(new Set(preset.columnKeys));
    setIncludeDynamicFields(preset.includeDynamicFields);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isExporting) return;
    onOpenChange(nextOpen);
  };

  const cancelExport = () => {
    abortControllerRef.current?.abort();
  };

  const handleExport = async () => {
    if (isExporting || selectedColumns.size === 0) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setIsExporting(true);
    onExportingChange?.(true);
    setCompletedCount(null);
    setErrorMessage(null);
    setProgress({ phase: 'fetching', processed: 0, total: totalCount || null });

    try {
      const count = await exportContactsFiltered({
        filters,
        organizationId,
        filename: `leads-${localDateStamp()}`,
        exportFormat: format,
        columnKeys: [...selectedColumns],
        includeDynamicFields,
        signal: abortController.signal,
        onProgress: setProgress,
      });
      setCompletedCount(count);
    } catch (error: unknown) {
      setProgress(null);
      setErrorMessage(
        isAbortError(error)
          ? 'Exportação cancelada.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível exportar os contatos.',
      );
    } finally {
      abortControllerRef.current = null;
      setIsExporting(false);
      onExportingChange?.(false);
    }
  };

  const renderedProgress = progressValue(progress, completedCount !== null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[min(88vh,760px)] w-[calc(100vw-1.5rem)] max-w-[640px] gap-3 overflow-hidden p-4 sm:p-5"
        onEscapeKeyDown={(event) => {
          if (isExporting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isExporting) event.preventDefault();
        }}
      >
        <DialogHeader className="space-y-1 pr-7 text-left">
          <DialogTitle className="text-[16px] font-medium">
            Exportar contatos
          </DialogTitle>
          <DialogDescription className="text-[12px] font-light leading-5">
            Escolha o formato e somente as colunas que você precisa. Os filtros
            atuais serão mantidos.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2" aria-label="Formato do arquivo">
            <button
              type="button"
              aria-pressed={format === 'xlsx'}
              disabled={isExporting}
              onClick={() => {
                clearRunFeedback();
                setFormat('xlsx');
              }}
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                format === 'xlsx'
                  ? 'border-primary/40 bg-primary/10 text-[var(--app-text-primary)]'
                  : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]',
              )}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-[12px] font-medium">Excel (.xlsx)</span>
                <span className="block text-[10px] font-light">Recomendado</span>
              </span>
            </button>
            <button
              type="button"
              aria-pressed={format === 'csv'}
              disabled={isExporting}
              onClick={() => {
                clearRunFeedback();
                setFormat('csv');
              }}
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-[6px] border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                format === 'csv'
                  ? 'border-primary/40 bg-primary/10 text-[var(--app-text-primary)]'
                  : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]',
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="block text-[12px] font-medium">CSV (.csv)</span>
                <span className="block text-[10px] font-light">Compatível com Excel</span>
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-light text-[var(--app-text-secondary)]">
              Presets
            </span>
            {CONTACT_EXPORT_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant="ghost"
                disabled={isExporting}
                onClick={() => applyPreset(preset.key)}
                className="h-7 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                {preset.label}
              </Button>
            ))}
            <span className="ml-auto text-[11px] font-light text-[var(--app-text-secondary)]">
              {selectedColumns.size} de {CONTACT_EXPORT_COLUMN_OPTIONS.length}
            </span>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--app-text-tertiary)]"
              aria-hidden="true"
            />
            <Input
              value={columnSearch}
              disabled={isExporting}
              onChange={(event) => setColumnSearch(event.target.value)}
              placeholder="Buscar coluna"
              aria-label="Buscar coluna para exportar"
              className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-[11px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>

          <ScrollArea className="h-[min(36vh,300px)] rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-soft)]">
            <div className="space-y-4 p-3">
              {groupedColumns.map((group) => (
                <section key={group.key} aria-labelledby={`export-group-${group.key}`}>
                  <div className="mb-2">
                    <h3
                      id={`export-group-${group.key}`}
                      className="text-[11px] font-medium text-[var(--app-text-primary)]"
                    >
                      {group.label}
                    </h3>
                    <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                      {group.description}
                    </p>
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {group.columns.map((column) => {
                      const checkboxId = `contact-export-${column.key}`;
                      return (
                        <label
                          key={column.key}
                          htmlFor={checkboxId}
                          className="flex min-h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1 text-[11px] font-light text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]"
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={selectedColumns.has(column.key)}
                            disabled={isExporting}
                            onCheckedChange={(checked) =>
                              toggleColumn(column.key, checked === true)
                            }
                            className="h-3.5 w-3.5 rounded-[3px]"
                          />
                          <span className="min-w-0 truncate" title={column.label}>
                            {column.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              ))}
              {groupedColumns.length === 0 && (
                <p className="py-6 text-center text-[11px] font-light text-[var(--app-text-secondary)]">
                  Nenhuma coluna encontrada.
                </p>
              )}
            </div>
          </ScrollArea>

          <label className="flex cursor-pointer items-start gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2">
            <Checkbox
              checked={includeDynamicFields}
              disabled={isExporting}
              onCheckedChange={(checked) => {
                clearRunFeedback();
                setIncludeDynamicFields(checked === true);
              }}
              className="mt-0.5 h-3.5 w-3.5 rounded-[3px]"
            />
            <span>
              <span className="block text-[11px] font-medium text-[var(--app-text-primary)]">
                Incluir campos personalizados e metadados expandidos
              </span>
              <span className="block text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
                Pode acrescentar muitas colunas. Use para auditorias ou backups completos.
              </span>
            </span>
          </label>

          {(isExporting || completedCount !== null) && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2"
            >
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-light text-[var(--app-text-secondary)]">
                {completedCount !== null ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
                {progressLabel(progress, completedCount)}
              </div>
              <Progress value={renderedProgress} className="h-1.5" />
            </div>
          )}

          {errorMessage && (
            <p
              role="alert"
              className="rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] font-light text-destructive"
            >
              {errorMessage}
            </p>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-[var(--app-border)] pt-3 sm:space-x-0">
          <span className="mr-auto text-[10px] font-light text-[var(--app-text-tertiary)]">
            {formatPtBRNumber(totalCount)} contato(s) nos filtros atuais
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={isExporting ? cancelExport : () => handleOpenChange(false)}
            className="h-8 rounded-[6px] px-2.5 text-[11px] font-light shadow-none"
          >
            {isExporting ? 'Cancelar exportação' : 'Fechar'}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={isExporting || selectedColumns.size === 0 || totalCount === 0}
            onClick={() => void handleExport()}
            className="h-8 rounded-[6px] px-3 text-[11px] font-light shadow-none"
          >
            {isExporting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {completedCount !== null ? 'Exportar novamente' : 'Exportar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
