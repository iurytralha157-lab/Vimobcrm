'use client';

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Columns3,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { FormWizardLayout } from '@/components/shared/forms/FormWizardLayout';
import { FORM_WIZARD_DIALOG_CLASS_NAME, FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from '@/config/form-wizard';
import { ContactExportPreview } from '@/components/features/contacts/ContactExportPreview';
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
import styles from '@/components/features/contacts/ContactTransferDialog.module.css';
import { formatPtBRNumber } from '@/lib/utils/formatting';
import { useAuth } from '@/contexts/AuthContext';
import { getGlobalSignOutSessionId } from '@/lib/auth/global-sign-out';
import { getVimobAPIAccessTokenSessionId, getVimobAPIAccessTokenUserId } from '@/lib/api/vimob-client';
import { contactImportScopeKey, createLeadImportScope } from '@/lib/lead-import-scope';
import { captureLeadRequestIntent } from '@/lib/lead-request-intent';

type ExportContactsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ContactExportFilters;
  organizationId: string | null;
  totalCount: number;
  filterValues?: Partial<Record<keyof ContactExportFilters, string>>;
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
  filterValues,
  onExportingChange,
}: ExportContactsDialogProps) {
  const { user, session } = useAuth();
  const sessionId = getGlobalSignOutSessionId(session);
  const scopeKey = contactImportScopeKey(organizationId, user?.id, sessionId);
  const [exportScope] = useState(createLeadImportScope);
  const wizardId = useId();
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
  const [activeStep, setActiveStep] = useState('format');
  const abortControllerRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    const deactivate = exportScope.activate(open ? scopeKey : null);
    return () => {
      deactivate();
      const controller = abortControllerRef.current;
      abortControllerRef.current = null;
      controller?.abort();
      if (controller) {
        setIsExporting(false);
        setProgress(null);
        setCompletedCount(null);
        onExportingChange?.(false);
      }
    };
  }, [exportScope, scopeKey, open, onExportingChange]);

  const normalizedColumnSearch = normalizeSearch(columnSearch);
  const activePreset = CONTACT_EXPORT_PRESETS.find((preset) =>
    preset.includeDynamicFields === includeDynamicFields
    && preset.columnKeys.length === selectedColumns.size
    && preset.columnKeys.every((key) => selectedColumns.has(key)),
  );
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
    if (abortControllerRef.current || selectedColumns.size === 0 || !organizationId || !user?.id) return;
    if (!sessionId || !scopeKey) {
      setErrorMessage('Não foi possível confirmar a sessão. Entre novamente antes de exportar.');
      return;
    }
    const isCurrentScope = exportScope.capture(scopeKey);
    const shouldContinue = () => isCurrentScope()
      && getVimobAPIAccessTokenUserId() === user.id
      && getVimobAPIAccessTokenSessionId() === sessionId;
    if (!shouldContinue()) return;
    const requestIntent = captureLeadRequestIntent(user.id, sessionId);

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
        requestIntent,
        shouldContinue,
        onProgress: (nextProgress) => {
          if (abortControllerRef.current === abortController && shouldContinue()) setProgress(nextProgress);
        },
      });
      abortController.signal.throwIfAborted();
      if (abortControllerRef.current !== abortController || !shouldContinue()) return;
      setCompletedCount(count);
    } catch (error: unknown) {
      if (abortControllerRef.current !== abortController || !shouldContinue()) return;
      setProgress(null);
      setErrorMessage(
        isAbortError(error)
          ? 'Exportação cancelada.'
          : error instanceof Error
            ? error.message
            : 'Não foi possível exportar os contatos.',
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        setIsExporting(false);
        onExportingChange?.(false);
      }
    }
  };

  const renderedProgress = progressValue(progress, completedCount !== null);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(FORM_WIZARD_DIALOG_CLASS_NAME, styles.dialog)}
        onEscapeKeyDown={(event) => {
          if (isExporting) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isExporting) event.preventDefault();
        }}
      >
        <DialogHeader className="shrink-0 space-y-1 px-6 pb-4 pr-12 pt-5 text-left">
          <DialogTitle className="text-[14px] font-normal">
            Exportar contatos
          </DialogTitle>
          <DialogDescription className="sr-only">
            Escolha o formato e somente as colunas que você precisa. Os filtros
            atuais serão mantidos.
          </DialogDescription>
        </DialogHeader>

        <FormWizardLayout
          className={styles.wizard}
          newsButtonClassName={styles.newsButton}
          steps={[
            { id: 'format', label: 'Formato e modelo', icon: FileSpreadsheet, disabled: isExporting, buttonId: `${wizardId}-tab-format`, panelId: `${wizardId}-panel` },
            { id: 'columns', label: 'Campos', icon: Columns3, disabled: isExporting, buttonId: `${wizardId}-tab-columns`, panelId: `${wizardId}-panel` },
            { id: 'review', label: 'Revisão', icon: CheckCircle2, disabled: isExporting, buttonId: `${wizardId}-tab-review`, panelId: `${wizardId}-panel` },
          ]}
          activeStep={activeStep}
          onStepChange={(step) => { if (!isExporting) setActiveStep(step); }}
          asideTitle="Prévia do arquivo"
          aside={<ContactExportPreview format={format} columnKeys={selectedColumns} includeDynamicFields={includeDynamicFields} filters={filters} totalCount={totalCount} filterValues={filterValues} modelName={activePreset?.label || 'Personalizado'} />}
          footer={<>
            <Button type="button" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}
              onClick={() => {
                if (isExporting) cancelExport();
                else if (activeStep === 'format') handleOpenChange(false);
                else setActiveStep(activeStep === 'review' ? 'columns' : 'format');
              }}
            >{isExporting ? 'Cancelar exportação' : activeStep === 'format' ? 'Fechar' : 'Voltar'}</Button>
            <Button type="button" className={cn(FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, styles.primaryButton)}
              disabled={isExporting || (activeStep !== 'format' && selectedColumns.size === 0) || totalCount === 0}
              onClick={() => { if (activeStep === 'review') void handleExport(); else setActiveStep(activeStep === 'format' ? 'columns' : 'review'); }}
            >{isExporting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}{activeStep !== 'review' ? 'Avançar' : completedCount !== null ? 'Exportar novamente' : 'Exportar'}</Button>
          </>}
        >
        <div id={`${wizardId}-panel`} role="tabpanel" aria-labelledby={`${wizardId}-tab-${activeStep}`} className="flex min-h-0 flex-col gap-3">
          <div hidden={activeStep !== 'format'} className={cn('space-y-4', activeStep !== 'format' && 'hidden')}>
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
                  ? 'border-primary/50 bg-primary/50 text-white'
                  : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-primary/50 hover:text-white',
              )}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-current" />
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
                  ? 'border-primary/50 bg-primary/50 text-white'
                  : 'border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-primary/50 hover:text-white',
              )}
            >
              <FileText className="h-4 w-4 shrink-0 text-current" />
              <span>
                <span className="block text-[12px] font-medium">CSV (.csv)</span>
                <span className="block text-[10px] font-light">Compatível com Excel</span>
              </span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-light text-[var(--app-text-secondary)]">
              Modelo
            </span>
            {CONTACT_EXPORT_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                type="button"
                size="sm"
                variant="ghost"
                aria-pressed={activePreset?.key === preset.key}
                disabled={isExporting}
                onClick={() => applyPreset(preset.key)}
                className={cn('h-8 rounded-[6px] px-2.5 text-[11px] font-light shadow-none', activePreset?.key === preset.key ? 'bg-primary/50 text-white hover:bg-primary/50 hover:text-white' : 'bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]')}
              >
                {preset.label}
              </Button>
            ))}
            <span className="ml-auto text-[11px] font-light text-[var(--app-text-secondary)]">
              {selectedColumns.size} campos fixos
            </span>
          </div>

          </div>
          <div hidden={activeStep !== 'columns'} className={cn('space-y-3', activeStep !== 'columns' && 'hidden')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[12px] font-normal">Campos do arquivo</h2>
            <p aria-live="polite" className="rounded-[4px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">{selectedColumns.size} de {CONTACT_EXPORT_COLUMN_OPTIONS.length} selecionados</p>
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
              placeholder="Buscar campo"
              aria-label="Buscar coluna para exportar"
              className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-[11px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>

            <div className="space-y-2">
              {groupedColumns.map((group) => (
                <details key={group.key} open={Boolean(normalizedColumnSearch) || group.key === 'essential'} className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
                  <summary className="cursor-pointer text-[11px] font-normal">
                    {group.label}
                    <span className="ml-2 inline-block text-[10px] font-light text-[var(--app-text-secondary)]">{CONTACT_EXPORT_COLUMN_OPTIONS.filter((column) => column.group === group.key && selectedColumns.has(column.key)).length} de {CONTACT_EXPORT_COLUMN_OPTIONS.filter((column) => column.group === group.key).length} selecionados</span>
                  </summary>
                  <p className="mt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">{normalizedColumnSearch ? `${group.columns.length} campo(s) encontrado(s)` : group.description}</p>
                  <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {group.columns.map((column) => {
                      const checkboxId = `contact-export-${column.key}`;
                      return (
                        <label
                          key={column.key}
                          htmlFor={checkboxId}
                          className={cn('flex min-h-9 min-w-0 cursor-pointer items-start gap-2 rounded-[5px] px-2.5 py-2 text-[11px] font-light transition-colors', selectedColumns.has(column.key) ? 'bg-primary/50 text-white' : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]')}
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={selectedColumns.has(column.key)}
                            disabled={isExporting}
                            onCheckedChange={(checked) =>
                              toggleColumn(column.key, checked === true)
                            }
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] data-[state=checked]:border-white/60 data-[state=checked]:bg-white/20 data-[state=checked]:text-white"
                          />
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]" title={column.label}>
                            {column.label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </details>
              ))}
              {groupedColumns.length === 0 && (
                <p className="py-6 text-center text-[11px] font-light text-[var(--app-text-secondary)]">
                  Nenhum campo encontrado. A seleção foi mantida.
                </p>
              )}
            </div>
          {selectedColumns.size === 0 && <p role="alert" className="text-[11px] font-light text-destructive">Selecione ao menos um campo fixo para continuar.</p>}
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox
              checked={includeDynamicFields}
              aria-label="Incluir campos personalizados e metadados expandidos"
              disabled={isExporting}
              onCheckedChange={(checked) => {
                clearRunFeedback();
                setIncludeDynamicFields(checked === true);
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded-[3px] data-[state=checked]:border-primary/50 data-[state=checked]:bg-primary/50 data-[state=checked]:text-white"
            />
            <span>
              <span className="block text-[11px] font-medium text-[var(--app-text-primary)]">
                Expandir campos personalizados e metadados
              </span>
              <span className="block text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
                {includeDynamicFields ? 'Ativado · Adiciona colunas conforme os contatos.' : 'Desativado'}
              </span>
            </span>
          </label>
          <details className="mt-2 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
            <summary className="cursor-pointer">Sobre a expansão</summary>
            <p className="mt-2">Pode acrescentar muitas colunas ao relatório. Se exceder os limites, use as colunas JSON sem expansão ou reduza os filtros. Nenhum campo será cortado. A importação não restaura todos esses campos.</p>
          </details>
          </div>
          </div>

          {activeStep === 'review' && <section className="space-y-4 text-[12px] font-light" aria-label="Revisar exportação">
            <h2 className="text-[14px] font-normal">Revisar exportação</h2>
            <p>{formatPtBRNumber(totalCount)} contato(s) nos filtros atuais · {format === 'xlsx' ? 'Excel' : 'CSV'} · {selectedColumns.size} coluna(s) selecionada(s).</p>
            <p className="text-[var(--app-text-secondary)]">As colunas escolhidas aparecem na prévia. Os filtros atuais e as permissões de acesso serão mantidos ao carregar os contatos.</p>
            {includeDynamicFields && <p className="text-[var(--app-text-tertiary)]">Campos personalizados e metadados podem acrescentar colunas ao arquivo.</p>}
          </section>}

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
              <Progress value={renderedProgress} className="h-1.5" indicatorClassName="bg-primary/50" />
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

        </FormWizardLayout>
      </DialogContent>
    </Dialog>
  );
}
