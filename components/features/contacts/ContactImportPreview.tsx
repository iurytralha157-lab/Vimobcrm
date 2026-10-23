import { FileSpreadsheet } from 'lucide-react';
import { formatPtBRNumber } from '@/lib/utils/formatting';
import { buildImportContactSample, type ImportContactPreviewRow } from '@/components/features/contacts/contact-import-preview';
import { cn } from '@/lib/utils';

type ImportAssignmentPreview =
  | { mode: 'protected' }
  | { mode: 'manual'; selected: boolean; name?: string }
  | { mode: 'automatic'; explicitQueue: boolean; queueName?: string; issue: string | null };

interface ContactImportPreviewProps {
  fileName?: string;
  rows: readonly ImportContactPreviewRow[];
  pipelineName: string;
  sourceName: string;
  assignment: ImportAssignmentPreview;
  isParsing?: boolean;
  ignoredColumns?: readonly string[];
}

const stateClassName = 'inline-block rounded-[4px] px-1.5 py-0.5 text-[10px] font-light leading-4';
const neutralStateClassName = 'bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]';

export function ContactImportPreview({ fileName, rows, pipelineName, sourceName, assignment, isParsing = false, ignoredColumns = [] }: ContactImportPreviewProps) {
  const sample = buildImportContactSample(rows);
  const sampleWarnings = sample.filter((row) => row.issues.length > 0).length;
  const fileRead = Boolean(fileName && !isParsing && rows.length > 0);
  const distributionActive = assignment.mode === 'automatic' && !assignment.issue;
  const distributionState = assignment.mode === 'protected'
    ? 'Conforme permissões'
    : assignment.mode === 'manual' ? 'Desativada' : assignment.issue ? 'Pendente' : 'Ativada';
  const responsible = assignment.mode === 'protected'
    ? 'Conforme permissões'
    : assignment.mode === 'automatic' ? 'Pela distribuição'
      : assignment.selected ? assignment.name || 'Não disponível' : 'Sem responsável padrão';
  return (
    <div className="space-y-3 text-[12px] font-light" aria-label="Resumo das opções de importação">
      <div className="space-y-2 rounded-[6px] bg-[var(--app-surface-solid)] p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[11px] text-[var(--app-text-secondary)]"><FileSpreadsheet className="h-3.5 w-3.5 shrink-0" />Arquivo</p>
          <span className={cn(stateClassName, fileRead ? 'bg-primary/50 text-white' : neutralStateClassName)}>{!fileName ? 'Pendente' : isParsing ? 'Lendo...' : fileRead ? 'Lido' : 'Sem linhas'}</span>
        </div>
        <p className="break-words [overflow-wrap:anywhere]" title={fileName}>{fileName || 'Nenhum arquivo selecionado'}</p>
        {fileName && !isParsing && <p className="text-[11px] text-[var(--app-text-secondary)]">{formatPtBRNumber(rows.length)} linhas lidas</p>}
      </div>
      <div className="space-y-3 rounded-[6px] bg-[var(--app-surface-solid)] p-3">
        <p className="text-[11px] font-normal">Opções da importação</p>
        <dl className="space-y-3 text-[11px] [&>div]:flex [&>div]:items-start [&>div]:justify-between [&>div]:gap-3 [&_dt]:shrink-0 [&_dt]:text-[var(--app-text-secondary)] [&_dd]:min-w-0 [&_dd]:break-words [&_dd]:text-right [&_dd]:[overflow-wrap:anywhere]">
          <div><dt>Funil padrão</dt><dd>{pipelineName || <span className={cn(stateClassName, neutralStateClassName)}>Pendente</span>}</dd></div>
          <div><dt>Origem padrão</dt><dd>{sourceName || 'Não informada'}</dd></div>
          <div><dt>Distribuição</dt><dd><span className={cn(stateClassName, distributionActive ? 'bg-primary/50 text-white' : neutralStateClassName)}>{distributionState}</span></dd></div>
          {assignment.mode === 'automatic' && <div><dt>Fila</dt><dd>{assignment.explicitQueue ? assignment.queueName || 'Não disponível' : 'Pelas regras automáticas'}</dd></div>}
          <div><dt>Responsável</dt><dd>{responsible}</dd></div>
        </dl>
        {assignment.mode === 'automatic' && assignment.issue && <p role="status" className="text-[11px] leading-4 text-[var(--app-text-secondary)]">{assignment.issue}</p>}
      </div>
      {ignoredColumns.length > 0 && <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px]"><summary className="cursor-pointer font-normal text-amber-600">{ignoredColumns.length} coluna(s) serão ignoradas</summary><p className="mt-2 break-words [overflow-wrap:anywhere]">{ignoredColumns.join(' · ')}</p></details>}
      {sample.length > 0 && <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3" aria-label="Amostra da importação">
        <summary className="cursor-pointer text-[11px] font-normal">Ver amostra ({sample.length}){sampleWarnings > 0 && <span className="mt-1 block text-amber-600">{sampleWarnings} linha(s) com alerta na amostra</span>}</summary>
        <div className="mt-3 space-y-3">
        {sample.map((row) => <div key={row.rowNumber} className="space-y-2 rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[11px]">
          <p className="break-words font-normal">Linha {row.rowNumber} · {row.nome || 'Sem nome'}</p>
          <p className="break-all text-[var(--app-text-secondary)]">{[row.telefone, row.email].filter(Boolean).join(' · ') || 'Sem telefone ou e-mail informado'}</p>
          {(row.pipeline || row.pipeline_id || row.estagio || row.stage_id) && <p className="break-all">Pipeline: {row.pipeline || row.pipeline_id || 'Padrão selecionado'} · Estágio: {row.estagio || row.stage_id || 'Primeiro estágio ativo'}</p>}
          {(row.responsavel || row.assigned_user_id) && <p className="break-all">Responsável na planilha: {row.responsavel || row.assigned_user_id}</p>}
          {row.tagNames.length > 0 && <p className="break-words">Tags: {row.tagNames.join(' · ')}</p>}
          {row.status && <p className="break-words">Estado do negócio: {row.status}</p>}
          {row.fonte && <p className="break-words">Origem da linha: {row.fonte}</p>}
          {row.motivo_perda && <p className="break-words">Motivo da perda: {row.motivo_perda}</p>}
          {row.mensagem && <p className="break-words">Mensagem: {row.mensagem}</p>}
          {row.issues.length > 0 ? <p className="break-words text-destructive">{row.issues.join(' · ')}</p> : <p className="text-[var(--app-text-tertiary)]">Nome e formato dos contatos verificados localmente.</p>}
        </div>)}
        </div>
      </details>}
      <details className="rounded-[6px] bg-[var(--app-surface-solid)] p-3 text-[11px]">
        <summary className="cursor-pointer font-normal">Ver detalhes</summary>
        <div className="mt-3 space-y-2 leading-4 text-[var(--app-text-secondary)]">
          <p>Para novos contatos, pipeline, estágio e origem da linha prevalecem sobre os padrões. A atribuição segue as opções escolhidas.</p>
          <p>Contatos existentes mantêm funil, estágio, responsável e estado do negócio. E-mail e mensagem vazios não apagam dados cadastrados.</p>
          <p>A importação aplica 11 campos principais e aceita IDs de destino. A exportação contém campos adicionais e não é uma restauração integral.</p>
          <p>Novas tags, reentradas, permissões, destinos e distribuição serão confirmados ao importar. A prévia não cria registros.</p>
        </div>
      </details>
      <p className="text-[10px] leading-4 text-[var(--app-text-tertiary)]">As opções serão confirmadas ao importar.</p>
    </div>
  );
}
