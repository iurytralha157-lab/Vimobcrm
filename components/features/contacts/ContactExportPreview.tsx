import { FileSpreadsheet } from 'lucide-react';
import { CONTACT_EXPORT_COLUMN_OPTIONS, type ContactExportColumnKey, type ContactExportFilters, type ContactExportFormat } from '@/lib/export-contacts';
import { formatPtBRNumber } from '@/lib/utils/formatting';
import { getContactExportFilterPreview } from '@/lib/contact-export-preview';
import { cn } from '@/lib/utils';

interface ContactExportPreviewProps {
  format: ContactExportFormat;
  columnKeys: ReadonlySet<ContactExportColumnKey>;
  includeDynamicFields: boolean;
  filters: ContactExportFilters;
  totalCount: number;
  filterValues?: Partial<Record<keyof ContactExportFilters, string>>;
  modelName: string;
}

const stateClassName = 'inline-block rounded-[4px] px-1.5 py-0.5 text-[10px] font-light leading-4';

export function ContactExportPreview({ format, columnKeys, includeDynamicFields, filters, totalCount, filterValues, modelName }: ContactExportPreviewProps) {
  const columns = CONTACT_EXPORT_COLUMN_OPTIONS.filter((column) => columnKeys.has(column.key));
  const activeFilters = getContactExportFilterPreview(filters, filterValues);
  return (
    <div className="space-y-3 text-[12px] font-light" aria-label="Resumo das opções de exportação">
      <section className="space-y-2 rounded-[6px] bg-[var(--app-surface-solid)] p-3">
        <p className="flex items-center gap-2 text-[11px] font-normal"><FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />{format === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}</p>
        <p>{formatPtBRNumber(totalCount)} contato(s)</p>
        <p className="text-[10px] text-[var(--app-text-tertiary)]">Nos filtros atuais</p>
      </section>
      <section className="space-y-3 rounded-[6px] bg-[var(--app-surface-solid)] p-3">
        <p className="text-[11px] font-normal">Opções do arquivo</p>
        <dl className="space-y-3 text-[11px] [&>div]:flex [&>div]:items-start [&>div]:justify-between [&>div]:gap-3 [&_dt]:shrink-0 [&_dt]:text-[var(--app-text-secondary)] [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:text-right [&_dd]:[overflow-wrap:anywhere]">
          <div><dt>Modelo</dt><dd>{modelName}</dd></div>
          <div><dt>Campos fixos</dt><dd>{columns.length} selecionados</dd></div>
          <div><dt>Expansão de campos</dt><dd><span className={cn(stateClassName, includeDynamicFields ? 'bg-primary/50 text-white' : 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]')}>{includeDynamicFields ? 'Ativada' : 'Desativada'}</span></dd></div>
          <div><dt>Filtros</dt><dd>{activeFilters.length ? `${activeFilters.length} ativo(s)` : 'Sem adicionais'}</dd></div>
        </dl>
        {columns.length === 0 && <p role="status" className="text-[11px] text-destructive">Selecione ao menos um campo fixo.</p>}
      </section>
      {columns.length > 0 && <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px]">
        <summary className="cursor-pointer font-normal">Ver campos ({columns.length})</summary>
        <ol className="mt-3 space-y-1.5 break-words [overflow-wrap:anywhere]">{columns.map((column) => <li key={column.key}>{column.label}</li>)}</ol>
      </details>}
      {activeFilters.length > 0 && <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px]">
        <summary className="cursor-pointer font-normal">Ver filtros ({activeFilters.length})</summary>
        <dl className="mt-3 space-y-2">{activeFilters.map(({ key, label, value }) => <div key={key}><dt className="text-[var(--app-text-tertiary)]">{label}</dt><dd className="break-words text-[var(--app-text-secondary)] [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      </details>}
      <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px]">
        <summary className="cursor-pointer font-normal">Ver detalhes</summary>
        <div className="mt-3 space-y-2 leading-4 text-[var(--app-text-secondary)]">
          <p>A exportação inclui todas as páginas que correspondem aos filtros e às suas permissões. A ordem é pela criação, dos mais recentes para os mais antigos.</p>
          <p>A expansão acrescenta colunas de campos personalizados e metadados conforme os contatos. Se exceder o limite, a exportação será interrompida; use as colunas JSON ou reduza os filtros. Nenhum campo será cortado.</p>
          <p>O arquivo é um relatório. A importação aceita menos campos e não restaura todos os dados do CRM.</p>
          <p>As colunas JSON respeitam as permissões e ocultam CPF e RG. O Excel aceita até 16.384 colunas e 32.767 caracteres por célula; para JSON longo, use CSV sem expansão.</p>
        </div>
      </details>
      <p className="text-[10px] leading-4 text-[var(--app-text-tertiary)]">Ao concluir a revisão, prepare o arquivo e clique em Baixar arquivo.</p>
    </div>
  );
}
