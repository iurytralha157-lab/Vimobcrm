import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ptBR } from 'date-fns/locale';
import { Eye, EyeOff, Info } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadSensitiveProfile } from '@/hooks/use-leads';
import { maskCPF, maskRG } from '@/lib/masks';
import { formatPhoneForDisplay } from '@/lib/phone-utils';
import { formatPropertyCurrency } from '@/lib/property-display-utils';
import type { LeadDetailLead } from './types';
import { metaText, trackingRecord } from './tracking';
import { formatDateSafely } from './utils';
import { InfoLine } from './InfoLine';

export function LeadProfileHover({
  lead,
  canRevealSensitive,
}: {
  lead: LeadDetailLead;
  canRevealSensitive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [revealSensitive, setRevealSensitive] = useState(false);
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const sensitiveProfile = useLeadSensitiveProfile(lead.id, {
    enabled: canRevealSensitive && revealSensitive,
  });
  const metadata = trackingRecord(lead.metadata) || {};
  const nestedProfile = trackingRecord(metadata.profile);
  const profileData = nestedProfile && Object.keys(nestedProfile).length > 0 ? nestedProfile : metadata;
  const text = (key: string) => metaText(profileData[key]);
  const personType = text('personType');
  const gender = text('gender');
  const hasCPF = metadata.hasCPF === true || profileData.hasCPF === true;
  const hasRG = metadata.hasRG === true || profileData.hasRG === true;
  const birthDate = text('birthDate');
  const birthDateLabel = birthDate
    ? formatDateSafely(`${birthDate}T00:00:00`, 'dd/MM/yyyy', ptBR, birthDate)
    : null;
  const interestValue =
    typeof lead.valor_interesse === 'number'
      ? formatPropertyCurrency(lead.valor_interesse)
      : null;
  const interestProperty = lead.interest_property || lead.property;
  const propertyLabel =
    [interestProperty?.code, interestProperty?.title].filter(Boolean).join(' - ') || null;
  const rows = [
    ['Nome', lead.name],
    ['Nome social', text('socialName')],
    ['Telefone', formatPhoneForDisplay(lead.phone || '')],
    ['E-mail', lead.email],
    [
      'Tipo',
      personType === 'company'
        ? 'Pessoa jurídica'
        : personType === 'individual'
          ? 'Pessoa física'
          : null,
    ],
    [
      'Gênero',
      gender === 'male'
        ? 'Masculino'
        : gender === 'female'
          ? 'Feminino'
          : gender === 'other'
            ? 'Outro'
            : null,
    ],
    ['Nascimento', birthDateLabel],
    ['Profissão', lead.profissao],
    ['Cargo', lead.cargo],
    ['Empresa', lead.empresa],
    ['Renda', lead.renda_familiar],
    ['Razão social', text('corporateName')],
    ['Nome fantasia', text('tradeName')],
    ['CNPJ', text('cnpj')],
    ['Inscrição estadual', text('stateRegistration')],
    ['Valor de interesse', interestValue],
    ['Imóvel de interesse', propertyLabel],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  const clearSensitiveData = () => {
    setRevealSensitive(false);
    if (organizationId) {
      queryClient.removeQueries({
        queryKey: ['lead-sensitive-profile', organizationId, lead.id],
        exact: true,
      });
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) clearSensitiveData();
  };

  const sensitiveValue = (kind: 'cpf' | 'rg') => {
    if (!revealSensitive) return '••••••••••••';
    if (sensitiveProfile.isLoading || sensitiveProfile.isFetching) return 'Carregando...';
    const value = sensitiveProfile.data?.[kind];
    if (!value) return 'Não informado';
    return kind === 'cpf' ? maskCPF(value) : maskRG(value);
  };

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} openDelay={100} closeDelay={420}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="group inline-flex min-w-0 max-w-full items-center justify-end gap-1 text-right font-normal text-[var(--app-text-primary)] outline-none transition-colors hover:text-primary focus-visible:text-primary"
        >
          <span className="truncate underline decoration-dotted decoration-[var(--app-text-tertiary)] underline-offset-4 group-hover:decoration-primary">
            {lead.name || 'Lead'}
          </span>
          <Info className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)] group-hover:text-primary" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={4}
        collisionPadding={12}
        className="vimob-popover-content z-[110] w-[min(420px,calc(100vw-2rem))] rounded-[8px] border-0 p-0 text-left text-[var(--app-text-primary)] shadow-none"
      >
        <div className="border-b border-[var(--app-border)] px-3 py-2">
          <p className="text-[11px] font-normal text-primary">Ficha do lead</p>
        </div>
        <div className="max-h-[430px] space-y-3 overflow-y-auto p-3">
          <div className="space-y-1.5">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[118px_minmax(0,1fr)] gap-2 text-[11px] leading-snug"
              >
                <span className="text-[var(--app-text-tertiary)]">{label}</span>
                <span className="break-words font-normal text-[var(--app-text-primary)]">
                  {value}
                </span>
              </div>
            ))}
          </div>

          {(hasCPF || hasRG) && (
            <div className="space-y-1.5 border-t border-[var(--app-border)] pt-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-normal text-[var(--app-text-tertiary)]">
                  Documentos protegidos
                </p>
                {canRevealSensitive && (
                  <button
                    type="button"
                    onClick={() =>
                      revealSensitive ? clearSensitiveData() : setRevealSensitive(true)
                    }
                    className="inline-flex items-center gap-1 rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-primary transition-colors hover:bg-[var(--app-surface-hover)]"
                  >
                    {revealSensitive ? (
                      <EyeOff className="h-3 w-3" />
                    ) : (
                      <Eye className="h-3 w-3" />
                    )}
                    {revealSensitive ? 'Ocultar' : 'Revelar'}
                  </button>
                )}
              </div>
              {hasCPF && <InfoLine label="CPF" value={sensitiveValue('cpf')} />}
              {hasRG && <InfoLine label="RG" value={sensitiveValue('rg')} />}
              {sensitiveProfile.isError && (
                <p className="text-[10px] text-destructive">
                  Não foi possível liberar os documentos.
                </p>
              )}
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
