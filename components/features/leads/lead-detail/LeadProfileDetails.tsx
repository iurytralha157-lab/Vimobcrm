import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ptBR } from 'date-fns/locale';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useLeadSensitiveProfile } from '@/hooks/use-leads';
import { maskCPF, maskRG } from '@/lib/masks';
import { formatPhoneForDisplay } from '@/lib/phone-utils';
import { formatPropertyCurrency } from '@/lib/property-display-utils';
import type { LeadDetailLead } from './types';
import { metaText, trackingRecord } from './tracking';
import { formatDateSafely } from './utils';
import { InfoLine } from './InfoLine';
import { cn } from '@/lib/utils';
import { normalizeDisplayName } from '@/lib/display-name';

/** Profile rows plus protected documents. Owns its reveal state, so unmounting hides CPF/RG again. */
export function LeadProfileDetails({
  lead,
  canRevealSensitive,
  scrollClassName,
}: {
  lead: LeadDetailLead;
  canRevealSensitive: boolean;
  /** Extra classes for the scroll container (the hover limits its height; the tab does not). */
  scrollClassName?: string;
}) {
  const [revealState, setRevealState] = useState({ scope: '', value: false });
  const queryClient = useQueryClient();
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || undefined;
  const sensitiveScope = JSON.stringify([organizationId, lead.id, canRevealSensitive]);
  if (revealState.scope !== sensitiveScope) setRevealState({ scope: sensitiveScope, value: false });
  const revealSensitive = canRevealSensitive && revealState.scope === sensitiveScope && revealState.value;
  const setRevealSensitive = (value: boolean) => setRevealState({ scope: sensitiveScope, value });
  useEffect(() => {
    if (canRevealSensitive || !organizationId) return;
    const queryKey = ['lead-sensitive-profile', organizationId, lead.id];
    void queryClient.cancelQueries({ queryKey, exact: true });
    queryClient.setQueryData(queryKey, {});
  }, [canRevealSensitive, lead.id, organizationId, queryClient]);
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
    ['Nome', normalizeDisplayName(lead.name)],
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
    // Hiding this hover must not cancel or erase the editor's shared query.
  };

  const sensitiveValue = (kind: 'cpf' | 'rg') => {
    if (!canRevealSensitive || !revealSensitive) return '••••••••••••';
    if (sensitiveProfile.isError) return 'Indisponível';
    if (sensitiveProfile.isLoading || sensitiveProfile.isFetching) return 'Carregando...';
    const value = sensitiveProfile.data?.[kind];
    if (!value) return 'Não informado';
    return kind === 'cpf' ? maskCPF(value) : maskRG(value);
  };

  return (
        <div className={cn('space-y-3 overflow-y-auto p-3', scrollClassName)}>
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
  );
}
