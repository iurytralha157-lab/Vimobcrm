import { InternationalPhoneInput } from '@/components/shared/forms/InternationalPhoneInput';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LeadSourceSelect } from '@/components/features/leads/LeadSourceSelect';
import type { LeadFormData, LeadFormErrors, UpdateLeadFormField } from '@/components/features/leads/lead-form/lead-form-data';

type LeadContactFieldsProps = {
  formData: Pick<LeadFormData, 'person_type' | 'name' | 'phone' | 'source' | 'email' | 'feedback'>;
  errors: Pick<LeadFormErrors, 'name' | 'phone' | 'email' | 'contact'>;
  fieldIdPrefix: string;
  sourceKey: string;
  isSubmitting: boolean;
  updateField: UpdateLeadFormField;
};

export function LeadContactFields({
  formData,
  errors,
  fieldIdPrefix,
  sourceKey,
  isSubmitting,
  updateField,
}: LeadContactFieldsProps) {
  const fieldIds = {
    name: `${fieldIdPrefix}-lead-name`,
    contact: `${fieldIdPrefix}-lead-contact`,
    phone: `${fieldIdPrefix}-lead-phone`,
    email: `${fieldIdPrefix}-lead-email`,
  };
  const describedBy = (...ids: Array<string | false | null | undefined>) => ids.filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-4">
      {/* Real Estate: Basic Info - Clean Layout */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={fieldIds.name} className="text-sm font-medium">
            {formData.person_type === 'company' ? 'Nome do contato / responsável *' : 'Nome completo *'}
          </Label>
          <Input
            id={fieldIds.name}
            value={formData.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder={formData.person_type === 'company' ? 'Pessoa responsável pelo contato' : 'Nome do lead'}
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${fieldIds.name}-error` : undefined}
          />
          {errors.name ? (
            <p id={`${fieldIds.name}-error`} className="text-xs font-medium text-destructive" role="alert">
              {errors.name}
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={fieldIds.phone} className="text-sm font-medium">Telefone</Label>
          <InternationalPhoneInput
            id={fieldIds.phone}
            disabled={isSubmitting}
            value={formData.phone}
            onChange={(value) => updateField('phone', value)}
            placeholder="(00) 00000-0000"
            aria-invalid={Boolean(errors.phone || errors.contact)}
            aria-describedby={describedBy(
              errors.phone && `${fieldIds.phone}-error`,
              errors.contact && `${fieldIds.contact}-error`,
            )}
          />
          {errors.phone ? (
            <p id={`${fieldIds.phone}-error`} className="text-xs font-medium text-destructive" role="alert">
              {errors.phone}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Origem</Label>
          <LeadSourceSelect
            key={sourceKey}
            value={formData.source}
            disabled={isSubmitting}
            onValueChange={(value) => updateField('source', value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={fieldIds.email} className="text-sm font-medium">Email</Label>
          <Input
            id={fieldIds.email}
            type="email"
            value={formData.email}
            onChange={(e) => updateField('email', e.target.value)}
            placeholder="email@exemplo.com"
            pattern="^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"
            aria-invalid={Boolean(errors.email || errors.contact)}
            aria-describedby={describedBy(
              errors.email && `${fieldIds.email}-error`,
              errors.contact && `${fieldIds.contact}-error`,
            )}
            title="Informe um email válido (ex: nome@dominio.com)"
          />
          {errors.email ? (
            <p id={`${fieldIds.email}-error`} className="text-xs font-medium text-destructive" role="alert">
              {errors.email}
            </p>
          ) : null}
        </div>
      </div>
      {errors.contact ? (
        <p id={`${fieldIds.contact}-error`} className="-mt-2 text-xs font-medium text-destructive" role="alert">
          {errors.contact}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-sm font-medium">Observações / feedback inicial</Label>
        <Textarea
          value={formData.feedback}
          onChange={(e) => updateField('feedback', e.target.value)}
          placeholder="Contexto do atendimento, necessidades ou próximos passos..."
          rows={4}
        />
        <p className="text-xs text-[var(--app-text-tertiary)]">Este texto entra no histórico como o primeiro feedback do lead.</p>
      </div>
    </div>
  );
}
