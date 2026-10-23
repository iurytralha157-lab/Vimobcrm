import { Building2, FileText, Home, Mail, Phone, User, Workflow } from 'lucide-react';
import { formatPhoneForDisplay } from '@/lib/phone-utils';

interface LeadDraftPreviewProps {
  name: string;
  phone: string;
  email: string;
  personType: 'individual' | 'company';
  corporateName: string;
  profileSummary: Array<{ label: string; value: string }>;
  tagCount: number;
  source: string;
  feedback: string;
  value: string;
  properties: Array<{ id: string; title?: string | null; code?: string | null; bairro?: string | null; cidade?: string | null }>;
  interestCount: number;
  pipeline: string;
  stage: string;
  team: string;
  assignee: string;
  dealStatus: string;
  lostReason: string;
  attachmentNames: string[];
  isEditMode: boolean;
}

export function LeadDraftPreview(props: LeadDraftPreviewProps) {
  const initials = props.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  return (
    <div className="space-y-5 rounded-[8px] bg-[var(--app-surface-solid)] p-5 text-[12px] font-light">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--app-surface-soft)] text-[14px]">
          {initials || <User className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <p className="break-words text-[14px] font-normal">{props.name.trim() || 'Nome do lead'}</p>
          <p className="mt-1 text-[var(--app-text-tertiary)]">{props.personType === 'company' ? 'Pessoa jurídica' : 'Pessoa física'}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {props.source && <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1">{props.source}</span>}
        <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1">Negócio {props.dealStatus.toLowerCase()}</span>
      </div>
      <section className="space-y-2" aria-label="Contato na prévia">
        <p className="text-[var(--app-text-tertiary)]">Contato</p>
        {props.phone && <p className="flex items-start gap-2 break-all rounded-[6px] bg-[var(--app-surface-soft)] p-3"><Phone className="h-4 w-4 shrink-0" />{formatPhoneForDisplay(props.phone)}</p>}
        {props.email && <p className="flex items-start gap-2 break-all rounded-[6px] bg-[var(--app-surface-soft)] p-3"><Mail className="h-4 w-4 shrink-0" />{props.email}</p>}
        {!props.phone && !props.email && <p className="text-[var(--app-text-tertiary)]">Informe um telefone ou e-mail.</p>}
        {props.personType === 'company' && props.corporateName && <p className="flex items-start gap-2 break-words"><Building2 className="h-4 w-4 shrink-0" />{props.corporateName}</p>}
      </section>
      {props.profileSummary.some((item) => item.value.trim()) && <section className="space-y-2" aria-label="Perfil na prévia">
        <p className="text-[var(--app-text-tertiary)]">Pessoa</p>
        <dl className="space-y-2">{props.profileSummary.filter((item) => item.value.trim()).map((item) => <div key={item.label}>
          <dt className="text-[var(--app-text-tertiary)]">{item.label}</dt>
          <dd className="break-words">{item.value}</dd>
        </div>)}</dl>
      </section>}
      <section className="space-y-2" aria-label="Interesse na prévia">
        <p className="flex items-center gap-2 text-[var(--app-text-tertiary)]"><Home className="h-4 w-4" />Interesse</p>
        {props.value && <p className="text-[16px] font-normal">{props.value}</p>}
        {props.properties.map((property, index) => <div key={property.id} className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">
          <p className="break-words font-normal">{[property.code, property.title].filter(Boolean).join(' · ') || 'Imóvel selecionado'}</p>
          <p className="mt-1 text-[var(--app-text-tertiary)]">{[property.bairro, property.cidade, index === 0 ? 'Principal' : null].filter(Boolean).join(' · ')}</p>
        </div>)}
        {props.interestCount > props.properties.length && <p className="text-[var(--app-text-tertiary)]">{props.interestCount} imóvel(is) selecionado(s). Veja os detalhes na etapa Interesse.</p>}
        {!props.interestCount && !props.value && <p className="text-[var(--app-text-tertiary)]">Ainda não informado.</p>}
      </section>
      <section className="space-y-2" aria-label="Gestão na prévia">
        <p className="flex items-center gap-2 text-[var(--app-text-tertiary)]"><Workflow className="h-4 w-4" />Gestão</p>
        <p className="rounded-[6px] bg-[var(--app-surface-soft)] p-3">{[props.pipeline, props.stage].filter(Boolean).join(' / ') || 'Pipeline e estágio ainda não selecionados'}</p>
        {props.team && <p className="break-words">{props.team}</p>}
        <p className="flex items-center gap-2 break-words"><User className="h-4 w-4 shrink-0" />{props.assignee || (props.isEditMode ? 'Responsável atual' : 'Selecione o responsável')}</p>
        {props.lostReason && <p className="break-words text-[var(--app-text-secondary)]">Motivo da perda: {props.lostReason}</p>}
        {props.tagCount > 0 && <p className="text-[var(--app-text-secondary)]">{props.tagCount} tag(s) selecionada(s)</p>}
      </section>
      {props.feedback && <section className="space-y-2">
        <p className="text-[var(--app-text-tertiary)]">{props.isEditMode ? 'Feedback' : 'Feedback inicial'}</p>
        <p className="whitespace-pre-wrap break-words rounded-[6px] bg-[var(--app-surface-soft)] p-3">{props.feedback}</p>
      </section>}
      {props.attachmentNames.length > 0 && <section className="space-y-2">
        <p className="flex items-center gap-2 text-[var(--app-text-tertiary)]"><FileText className="h-4 w-4" />Documentos a enviar</p>
        {props.attachmentNames.map((name, index) => <p key={`${name}-${index}`} className="break-words">{name}</p>)}
      </section>}
    </div>
  );
}
