import { Briefcase, Building2, DollarSign } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { maskCNPJ, maskCPF, maskRG } from '@/lib/masks';
import { cn } from '@/lib/utils';
import { formatCurrencyInput, type LeadFormData, type LeadFormErrors, type UpdateLeadFormField } from '@/components/features/leads/lead-form/lead-form-data';

type LeadProfileFieldsProps = {
  formData: Pick<LeadFormData,
    | 'person_type' | 'gender' | 'social_name' | 'birth_date' | 'cpf' | 'rg' | 'profissao' | 'renda_familiar'
    | 'corporate_name' | 'trade_name' | 'cnpj' | 'state_registration' | 'cargo' | 'empresa'
  >;
  errors: Pick<LeadFormErrors, 'birth_date' | 'cpf' | 'cnpj'>;
  isSubmitting: boolean;
  updateField: UpdateLeadFormField;
};

export function LeadProfileFields({
  formData,
  errors,
  isSubmitting,
  updateField,
}: LeadProfileFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label>Tipo de pessoa</Label>
        <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-[var(--app-surface-soft)] p-1">
          {([
            ['individual', 'Pessoa física'],
            ['company', 'Pessoa jurídica'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => updateField('person_type', value)}
              className={cn(
                'h-9 rounded-[6px] text-[12px] font-light transition-colors',
                formData.person_type === value
                  ? 'bg-primary text-primary-foreground shadow-none'
                  : 'text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {formData.person_type === 'individual' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Gênero</Label>
            <Select disabled={isSubmitting} value={formData.gender || '__none__'} onValueChange={(value) => updateField('gender', value === '__none__' ? '' : value as typeof formData.gender)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Não informado</SelectItem>
                <SelectItem value="male">Masculino</SelectItem>
                <SelectItem value="female">Feminino</SelectItem>
                <SelectItem value="other">Outro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nome social</Label>
            <Input value={formData.social_name} onChange={(e) => updateField('social_name', e.target.value)} placeholder="Como prefere ser chamado(a)" />
          </div>
          <div className="space-y-2">
            <Label>Data de nascimento</Label>
            <Input type="date" value={formData.birth_date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => updateField('birth_date', e.target.value)} aria-invalid={Boolean(errors.birth_date)} />
            {errors.birth_date && <p className="text-xs font-medium text-destructive">{errors.birth_date}</p>}
          </div>
          <div className="space-y-2">
            <Label>CPF</Label>
            <Input value={formData.cpf} onChange={(e) => updateField('cpf', maskCPF(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" aria-invalid={Boolean(errors.cpf)} />
            {errors.cpf && <p className="text-xs font-medium text-destructive">{errors.cpf}</p>}
          </div>
          <div className="space-y-2">
            <Label>RG</Label>
            <Input value={formData.rg} onChange={(e) => updateField('rg', maskRG(e.target.value))} placeholder="00.000.000-0" inputMode="numeric" />
          </div>
          <div className="space-y-2">
            <Label>Profissão</Label>
            <Input value={formData.profissao} onChange={(e) => updateField('profissao', e.target.value)} placeholder="Área de atuação" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="flex items-center gap-2"><DollarSign className="h-3.5 w-3.5" />Renda</Label>
            <Input value={formData.renda_familiar} onChange={(e) => updateField('renda_familiar', formatCurrencyInput(e.target.value))} placeholder="R$ 0,00" inputMode="decimal" />
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Razão social</Label>
            <Input value={formData.corporate_name} onChange={(e) => updateField('corporate_name', e.target.value)} placeholder="Razão social da empresa" />
          </div>
          <div className="space-y-2">
            <Label>Nome fantasia</Label>
            <Input value={formData.trade_name} onChange={(e) => updateField('trade_name', e.target.value)} placeholder="Nome comercial" />
          </div>
          <div className="space-y-2">
            <Label>CNPJ</Label>
            <Input value={formData.cnpj} onChange={(e) => updateField('cnpj', maskCNPJ(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" aria-invalid={Boolean(errors.cnpj)} />
            {errors.cnpj && <p className="text-xs font-medium text-destructive">{errors.cnpj}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Inscrição estadual</Label>
            <Input value={formData.state_registration} onChange={(e) => updateField('state_registration', e.target.value)} placeholder="Opcional" />
          </div>
        </div>
      )}

      <div className="grid gap-4 border-t border-[var(--app-border)] pt-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" />Cargo</Label>
          <Input value={formData.cargo} onChange={(e) => updateField('cargo', e.target.value)} placeholder="Ex: Gerente, Diretor..." />
        </div>
        <div className="space-y-2">
          <Label className="flex items-center gap-2"><Building2 className="h-3.5 w-3.5" />Empresa</Label>
          <Input value={formData.empresa} onChange={(e) => updateField('empresa', e.target.value)} placeholder="Nome da empresa" />
        </div>
      </div>
    </>
  );
}
