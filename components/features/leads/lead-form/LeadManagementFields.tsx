import { Building2, CircleDot, Trophy, User, XCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TagSelector } from '@/components/ui/tag-selector';
import { getPipelineStageColorStyle } from '@/config/pipeline-stage-colors';
import type { LeadFormData, LeadFormErrors, UpdateLeadFormField } from '@/components/features/leads/lead-form/lead-form-data';
import type { Stage } from '@/hooks/use-stages';
import type { Team } from '@/hooks/use-teams';
import type { User as AssignableUser } from '@/hooks/use-users';

export const dealStatusOptions = [
  { value: 'open', label: 'Aberto', icon: CircleDot, color: 'text-blue-500' },
  { value: 'won', label: 'Ganho', icon: Trophy, color: 'text-green-500' },
  { value: 'lost', label: 'Perdido', icon: XCircle, color: 'text-red-500' },
];

type LeadManagementFieldsProps = {
  formData: Pick<LeadFormData, 'team_id' | 'assigned_user_id' | 'deal_status' | 'lost_reason' | 'pipeline_id' | 'stage_id' | 'tag_ids'>;
  errors: Pick<LeadFormErrors, 'lost_reason'>;
  isSubmitting: boolean;
  canSelectTeam: boolean;
  canUploadAttachments: boolean;
  fieldIdPrefix: string;
  teams: Pick<Team, 'id' | 'name' | 'is_active'>[];
  users: Pick<AssignableUser, 'id' | 'name'>[];
  pipelines: { id: string; name: string }[];
  stages: Pick<Stage, 'id' | 'name' | 'color'>[];
  onScopeChange: (value: string) => void;
  updateField: UpdateLeadFormField;
};

export function LeadManagementFields({
  formData,
  errors,
  isSubmitting,
  canSelectTeam,
  canUploadAttachments,
  fieldIdPrefix,
  teams,
  users,
  pipelines,
  stages,
  onScopeChange,
  updateField,
}: LeadManagementFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {canSelectTeam && (
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5" />
            Escopo do lead
          </Label>
          <Select
            disabled={isSubmitting}
            value={formData.team_id || 'personal'}
            onValueChange={onScopeChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione o escopo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="personal">Pessoal</SelectItem>
              {teams.filter((team) => team.is_active !== false).map((team) => (
                <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <User className="h-3.5 w-3.5" />
          Responsável
        </Label>
        <Select
          disabled={isSubmitting}
          value={formData.assigned_user_id}
          onValueChange={(v) => updateField('assigned_user_id', v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o responsável" />
          </SelectTrigger>
          <SelectContent>
            {users.map(user => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Status do Negócio</Label>
        <Select
          disabled={isSubmitting}
          value={formData.deal_status}
          onValueChange={(v) => updateField('deal_status', v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dealStatusOptions.map(opt => (
              <SelectItem key={opt.value} value={opt.value} disabled={opt.value === 'won' && !canUploadAttachments}>
                <div className="flex items-center gap-2">
                  <opt.icon className={`h-3.5 w-3.5 ${opt.color}`} />
                  {opt.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {formData.deal_status === 'lost' && (
          <div className="mt-3 space-y-1.5">
            <Label htmlFor={`${fieldIdPrefix}-lost-reason`}>Motivo da perda *</Label>
            <Input
              id={`${fieldIdPrefix}-lost-reason`}
              value={formData.lost_reason}
              onChange={(event) => updateField('lost_reason', event.target.value)}
              placeholder="Ex.: sem retorno, valor ou desistência"
              maxLength={300}
              aria-invalid={Boolean(errors.lost_reason)}
            />
            {errors.lost_reason && (
              <p className="text-xs font-medium text-destructive" role="alert">{errors.lost_reason}</p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Pipeline</Label>
        <Select
          disabled={isSubmitting}
          value={formData.pipeline_id}
          onValueChange={(v) => {
            updateField('pipeline_id', v);
            updateField('stage_id', '');
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a pipeline" />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map(p => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Estágio</Label>
        <Select
          value={formData.stage_id}
          onValueChange={(v) => updateField('stage_id', v)}
          disabled={isSubmitting || !formData.pipeline_id}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione o estágio" />
          </SelectTrigger>
          <SelectContent>
            {stages.map(s => (
              <SelectItem key={s.id} value={s.id}>
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                     style={getPipelineStageColorStyle(s.color)}
                  />
                  {s.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <TagSelector
          disabled={isSubmitting}
          selectedTagIds={formData.tag_ids}
          onSelectTag={(tagId) => {
            if (!formData.tag_ids.includes(tagId)) {
              updateField('tag_ids', [...formData.tag_ids, tagId]);
            }
          }}
          onRemoveTag={(tagId) => {
            updateField('tag_ids', formData.tag_ids.filter(id => id !== tagId));
          }}
          placeholder="Adicionar tags..."
          triggerClassName="h-10 w-full justify-start rounded-md border-0 bg-[var(--app-surface-soft)] px-3 text-sm font-normal"
        />
      </div>
    </div>
  );
}
