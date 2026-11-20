import { Building2, DollarSign, FileText, Home, Paperclip, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PropertyPickerDialog, type PropertyPickerProperty } from '@/components/features/properties/PropertyPickerDialog';
import { formatCurrencyInput, type UpdateLeadFormField } from '@/components/features/leads/lead-form/lead-form-data';

type LeadInterestFieldsProps = {
  interestValue: string;
  updateField: UpdateLeadFormField;
  isSubmitting: boolean;
  hasPropertiesModule: boolean;
  canViewProperties: boolean;
  propertiesLoading: boolean;
  selectedInterestProperties: PropertyPickerProperty[];
  properties: PropertyPickerProperty[];
  onSelectProperty: (property: PropertyPickerProperty) => void;
  onRemoveProperty: (property: PropertyPickerProperty) => void;
  isEditMode: boolean;
  fieldIdPrefix: string;
  canUploadAttachments: boolean;
  pendingAttachments: File[];
  onSelectAttachments: (files: FileList | null) => void;
  onRemoveAttachment: (file: File) => void;
};

export function LeadInterestFields({
  interestValue,
  updateField,
  isSubmitting,
  hasPropertiesModule,
  canViewProperties,
  propertiesLoading,
  selectedInterestProperties,
  properties,
  onSelectProperty,
  onRemoveProperty,
  isEditMode,
  fieldIdPrefix,
  canUploadAttachments,
  pendingAttachments,
  onSelectAttachments,
  onRemoveAttachment,
}: LeadInterestFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="flex items-center gap-2"><DollarSign className="h-3.5 w-3.5" />Valor de interesse</Label>
        <Input value={interestValue} onChange={(e) => updateField('valor_interesse', formatCurrencyInput(e.target.value))} placeholder="R$ 0,00" inputMode="decimal" />
        <p className="text-xs text-[var(--app-text-tertiary)]">Digite somente os números; a moeda é formatada automaticamente.</p>
      </div>

      {hasPropertiesModule && <div className="space-y-3">
        <Label className="flex items-center gap-2"><Home className="h-3.5 w-3.5" />Imóveis de interesse</Label>
        {selectedInterestProperties.map((property, index) => (
          <div key={property.id} className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2.5">
            <Building2 className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-[var(--app-text-primary)]">{[property.code, property.title].filter(Boolean).join(' - ')}</p>
              <p className="truncate text-xs text-[var(--app-text-tertiary)]">{[property.bairro, property.cidade].filter(Boolean).join(' · ')}{index === 0 ? ' · Principal' : ''}</p>
            </div>
            <button
              type="button"
              aria-label={`Remover ${property.title || property.code || 'imóvel'}`}
              onClick={() => onRemoveProperty(property)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <PropertyPickerDialog
          properties={properties.map((p) => ({
            id: p.id, code: p.code, title: p.title, bairro: p.bairro, cidade: p.cidade,
            preco: p.preco, imagem_principal: p.imagem_principal, tipo_de_imovel: p.tipo_de_imovel,
            tipo_de_negocio: p.tipo_de_negocio, commission_percentage: p.commission_percentage, status: p.status,
          }))}
          selectedPropertyId={null}
          disabled={isSubmitting || !canViewProperties}
          isLoading={propertiesLoading}
          onSelect={onSelectProperty}
          trigger={(
            <button type="button" disabled={isSubmitting || !canViewProperties} className="flex h-10 w-full items-center justify-center gap-2 rounded-[6px] border border-dashed border-primary/40 bg-primary/10 px-3 text-[12px] font-light text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" />{selectedInterestProperties.length > 0 ? 'Adicionar outro imóvel' : 'Adicionar imóvel'}
            </button>
          )}
        />
        {!canViewProperties && <p className="text-xs text-[var(--app-text-tertiary)]">Seu perfil não possui acesso aos imóveis.</p>}
      </div>}

      {!isEditMode && <div className="space-y-3 border-t border-[var(--app-border)] pt-4">
        <div>
          <Label className="flex items-center gap-2"><Paperclip className="h-3.5 w-3.5" />Documentos</Label>
          <p className="mt-1 text-xs text-[var(--app-text-tertiary)]">Até 10 arquivos de 25 MB. O envio acontece depois que o lead é criado.</p>
        </div>
        <Input
          id={`${fieldIdPrefix}-lead-attachments`}
          type="file"
          multiple
          disabled={isSubmitting || !canUploadAttachments}
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
          className="sr-only"
          onChange={(event) => {
            onSelectAttachments(event.target.files);
            event.currentTarget.value = '';
          }}
        />
        {!canUploadAttachments && <p className="text-xs text-[var(--app-text-tertiary)]">Seu perfil pode criar o contato, mas não possui permissão para anexar documentos.</p>}
        {canUploadAttachments && <label htmlFor={`${fieldIdPrefix}-lead-attachments`} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-[6px] border border-dashed border-primary/40 bg-primary/10 text-[12px] font-light text-primary hover:bg-primary/15">
          <Plus className="h-3.5 w-3.5" />Adicionar documentos
        </label>}
        {pendingAttachments.map((file) => (
          <div key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-3 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2">
            <FileText className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[var(--app-text-primary)]">{file.name}</p>
              <p className="text-[11px] text-[var(--app-text-tertiary)]">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
            <button type="button" aria-label={`Remover ${file.name}`} onClick={() => onRemoveAttachment(file)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>}
    </>
  );
}
