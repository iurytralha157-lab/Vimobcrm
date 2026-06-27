import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMemo } from 'react';
import { PropertyPickerDialog } from '@/components/features/properties/PropertyPickerDialog';
import { createClientId } from '@/lib/client-id';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ChevronDown,
  Plus,
  X,
  Trash2,
  Loader2,
  Save,
  Settings2,
  Users,
  Filter,
  AlertCircle,
  UsersRound,
  Globe,
  Webhook,
  MessageSquare,
  GripVertical,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useTeams } from '@/hooks/use-teams';
import { useOrganizationUsers } from '@/hooks/use-users';
import { useTags } from '@/hooks/use-tags';
import { useProperties } from '@/hooks/use-properties';
import { useWebhooks } from '@/hooks/use-webhooks';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useMetaFormConfigs } from '@/hooks/use-meta-forms';
import { useMetaIntegrations } from '@/hooks/use-meta-integration';
import { cn } from '@/lib/utils';

// Drag and Drop imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

interface QueueSettings {
  enable_redistribution?: boolean;
  redistribution_timeout_minutes?: number;
  redistribution_warning_minutes?: number;
  redistribution_max_attempts?: number;
  preserve_position?: boolean;
  require_checkin?: boolean;
  reentry_behavior?: 'redistribute' | 'keep_assignee';
}

interface RuleCondition {
  id: string;
  type: 'source' | 'webhook' | 'whatsapp_session' | 'meta_form' | 'website_category' | 'campaign_contains' | 'tag' | 'city' | 'interest_property';
  values: string[];
}

type RuleConditionType = RuleCondition['type'];

interface QueueMember {
  id?: string;
  type: 'user' | 'team';
  entityId: string;
  weight: number;
  name?: string;
}

interface QueueFormData {
  name: string;
  strategy: 'simple' | 'weighted';
  target_pipeline_id: string;
  target_stage_id: string;
  is_active: boolean;
  settings: QueueSettings;
  conditions: RuleCondition[];
  members: QueueMember[];
}

type QueueStrategy = QueueFormData['strategy'];

interface ExistingQueueRule {
  id: string;
  match_type?: string | null;
  match_value?: string | null;
}

interface ExistingQueueMember {
  id?: string;
  team_id?: string | null;
  user_id?: string | null;
  weight?: number | null;
  user?: {
    name?: string | null;
  } | null;
}

interface ExistingDistributionQueue {
  id?: string;
  name?: string | null;
  strategy?: string | null;
  target_pipeline_id?: string | null;
  target_stage_id?: string | null;
  is_active?: boolean | null;
  settings?: Partial<QueueSettings> | null;
  rules?: ExistingQueueRule[] | null;
  members?: ExistingQueueMember[] | null;
}

interface DistributionQueueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue?: ExistingDistributionQueue | null;
  onSave: (data: QueueFormData) => Promise<void>;
  allowedTeamIds?: string[];
  allowedUserIds?: string[];
  allowedPipelineIds?: string[];
}

const EMPTY_RESTRICTION_IDS: string[] = [];

const SOURCE_OPTIONS = [
  { value: 'meta_ads', label: 'Meta Ads' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webhook', label: 'Webhook' },
  { value: 'website', label: 'Website' },
];

const CONDITION_TYPES = [
  { value: 'source', label: 'Fonte genérica' },
  { value: 'webhook', label: 'Webhook específico' },
  { value: 'whatsapp_session', label: 'Conexão WhatsApp' },
  { value: 'meta_form', label: 'Formulário Meta' },
  { value: 'website_category', label: 'Categoria do site' },
  { value: 'campaign_contains', label: 'Nome da campanha contém' },
  { value: 'tag', label: 'Tag' },
  { value: 'city', label: 'Cidade' },
  { value: 'interest_property', label: 'Interesse em imóvel' },
];

const WEBSITE_CATEGORY_OPTIONS = [
  { value: 'venda', label: 'Venda' },
  { value: 'locacao', label: 'Locação' },
  { value: 'lancamento', label: 'Lançamento' },
];

function isQueueStrategy(value: unknown): value is QueueStrategy {
  return value === 'simple' || value === 'weighted';
}

function isRuleConditionType(value: unknown): value is RuleConditionType {
  return typeof value === 'string' && CONDITION_TYPES.some((condition) => condition.value === value);
}

// Sortable Item Component for Members
function SortableMemberRow({
  member,
  idx,
  strategy,
  totalWeight,
  onUpdateWeight,
  onRemove
}: {
  member: QueueMember;
  idx: number;
  strategy: string;
  totalWeight: number;
  onUpdateWeight: (id: string, weight: number) => void;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: member.entityId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };

  const percentage = totalWeight > 0
    ? Math.round((member.weight / totalWeight) * 100)
    : 0;

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={cn('border-0 hover:bg-[var(--app-surface-hover)]', isDragging && 'bg-[var(--app-surface-hover)]')}
    >
      <TableCell className="w-10">
        <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {member.type === 'team' ? (
            <UsersRound className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Avatar className="h-6 w-6">
              <AvatarFallback className="text-xs bg-primary text-primary-foreground">
                {member.name?.[0] || '?'}
              </AvatarFallback>
            </Avatar>
          )}
          <div>
            <span className="font-medium text-sm">{member.name || 'Desconhecido'}</span>
            {member.type === 'team' && (
              <Badge variant="outline" className="ml-2 text-xs">Equipe</Badge>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        {strategy === 'weighted' ? (
          <div className="flex items-center justify-center gap-2">
            <Input
              type="number"
              value={member.weight}
              onChange={e => onUpdateWeight(member.entityId, parseInt(e.target.value) || 1)}
              className="w-16 text-center h-8"
              min={1}
              max={100}
            />
            <span className="text-xs text-muted-foreground w-10">
              ({percentage}%)
            </span>
          </div>
        ) : (
          <div className="text-center text-muted-foreground text-sm">
            #{idx + 1}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(member.entityId)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function DistributionQueueEditor({
  open,
  onOpenChange,
  queue,
  onSave,
  allowedTeamIds,
  allowedUserIds,
  allowedPipelineIds,
}: DistributionQueueEditorProps) {
  const { data: pipelines = [] } = usePipelines();
  const { data: teams = [] } = useTeams();
  const { data: users = [] } = useOrganizationUsers();
  const { data: tags = [] } = useTags();
  const { data: properties = [] } = useProperties();
  const { data: webhooks = [] } = useWebhooks();
  const { data: whatsappSessions = [] } = useWhatsAppSessions();
  const { data: metaIntegrations = [] } = useMetaIntegrations();
  const activeMetaIntegration = metaIntegrations.find(i => i.is_connected);
  const { data: metaFormConfigs = [] } = useMetaFormConfigs(activeMetaIntegration?.id);
  const hasTeamRestriction = Array.isArray(allowedTeamIds);
  const hasUserRestriction = Array.isArray(allowedUserIds);
  const hasPipelineRestriction = Array.isArray(allowedPipelineIds);
  const effectiveAllowedTeamIds = allowedTeamIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedUserIds = allowedUserIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedPipelineIds = allowedPipelineIds ?? EMPTY_RESTRICTION_IDS;
  const visibleTeams = useMemo(() => (
    hasTeamRestriction
      ? teams.filter((team) => effectiveAllowedTeamIds.includes(team.id))
      : teams
  ), [effectiveAllowedTeamIds, hasTeamRestriction, teams]);
  const visibleUsers = useMemo(() => (
    hasUserRestriction
      ? users.filter((user) => effectiveAllowedUserIds.includes(user.id))
      : users
  ), [effectiveAllowedUserIds, hasUserRestriction, users]);
  const visiblePipelines = useMemo(() => (
    hasPipelineRestriction
      ? pipelines.filter((pipeline) => effectiveAllowedPipelineIds.includes(pipeline.id))
      : pipelines
  ), [effectiveAllowedPipelineIds, hasPipelineRestriction, pipelines]);

  const [saving, setSaving] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);

  const [formData, setFormData] = useState<QueueFormData>({
    name: '',
    strategy: 'simple',
    target_pipeline_id: '',
    target_stage_id: '',
    is_active: true,
    settings: {
      enable_redistribution: false,
      redistribution_timeout_minutes: 20,
      redistribution_warning_minutes: 2,
      redistribution_max_attempts: 10,
      preserve_position: true,
      require_checkin: false,
    },
    conditions: [],
    members: [],
  });

  // Sensors for DnD
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Get stages for selected pipeline
  const { data: stages = [] } = useStages(formData.target_pipeline_id || undefined);

  useEffect(() => {
    if (open) {
      // This is UI draft hydration when the dialog opens or switches queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenSections([]);
    }
  }, [open, queue?.id]);

  // Initialize form when queue changes
  useEffect(() => {
    if (queue) {
      const existingConditions: RuleCondition[] = (queue.rules || []).map((rule) => {
        const matchType = isRuleConditionType(rule.match_type) ? rule.match_type : 'source';
        const matchValueStr = rule.match_value || '';
        let values: string[] = [];
        if (matchValueStr) {
          values = matchValueStr.split(',').map((v: string) => v.trim()).filter(Boolean);
        }
        return { id: rule.id, type: matchType, values };
      });

      const membersMap = new Map<string, QueueMember>();
      for (const m of (queue.members || [])) {
        if (m.team_id) {
          const key = `team_${m.team_id}`;
          if (!membersMap.has(key)) {
            const team = visibleTeams.find(t => t.id === m.team_id) || teams.find(t => t.id === m.team_id);
            membersMap.set(key, {
              id: m.id,
              type: 'team',
              entityId: m.team_id,
              weight: m.weight || 10,
              name: team?.name || 'Equipe',
            });
          }
        } else {
          const userId = m.user_id;
          if (!userId) continue;
          const key = `user_${userId}`;
          if (!membersMap.has(key)) {
            membersMap.set(key, {
              id: m.id,
              type: 'user',
              entityId: userId,
              weight: m.weight || 10,
              name: m.user?.name || 'Usuário',
            });
          }
        }
      }

      const existingMembers = Array.from(membersMap.values());
      const strategy: QueueStrategy = isQueueStrategy(queue.strategy) ? queue.strategy : 'simple';

      // This is form draft hydration from the selected queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        name: queue.name || '',
        strategy,
        target_pipeline_id: queue.target_pipeline_id || '',
        target_stage_id: queue.target_stage_id || '',
        is_active: queue.is_active ?? true,
        settings: {
          enable_redistribution: false,
          redistribution_timeout_minutes: 20,
          redistribution_warning_minutes: 2,
          redistribution_max_attempts: 10,
          preserve_position: true,
          require_checkin: false,
          ...(queue.settings || {}),
        },
        conditions: existingConditions,
        members: existingMembers,
      });
    } else {
      // This is form draft hydration for create mode.
      setFormData({
        name: '',
        strategy: 'simple',
        target_pipeline_id: '',
        target_stage_id: '',
        is_active: true,
        settings: {
          enable_redistribution: false,
          redistribution_timeout_minutes: 20,
          redistribution_warning_minutes: 2,
          redistribution_max_attempts: 10,
          preserve_position: true,
          require_checkin: false,
        },
        conditions: [],
        members: [],
      });
    }
    // Intentionally initialize only when the dialog opens or switches queue.
    // Team/user query refreshes must not reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue?.id]);

  const toggleSection = (section: string) => {
    setOpenSections(prev =>
      prev.includes(section)
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const addCondition = () => {
    setFormData(prev => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        { id: createClientId('condition'), type: 'source', values: [] }
      ],
    }));
  };

  const updateCondition = (id: string, updates: Partial<RuleCondition>) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions.map(c =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }));
  };

  const removeCondition = (id: string) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions.filter(c => c.id !== id),
    }));
  };

  const addMember = (type: 'user' | 'team', entityId: string, name: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.some(m => m.type === type && m.entityId === entityId)
        ? prev.members
        : [...prev.members, { type, entityId, weight: 10, name }],
    }));
  };

  const updateMemberWeight = (entityId: string, weight: number) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.map(m =>
        m.entityId === entityId ? { ...m, weight: Math.max(1, weight) } : m
      ),
    }));
  };

  const removeMember = (entityId: string) => {
    setFormData(prev => ({
      ...prev,
      members: prev.members.filter(m => m.entityId !== entityId),
    }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFormData((prev) => {
        const oldIndex = prev.members.findIndex((m) => m.entityId === active.id);
        const newIndex = prev.members.findIndex((m) => m.entityId === over.id);
        return {
          ...prev,
          members: arrayMove(prev.members, oldIndex, newIndex),
        };
      });
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Nome da fila é obrigatório');
      return;
    }
    if (!formData.target_pipeline_id) {
      toast.error('Pipeline de destino é obrigatório');
      return;
    }
    if (!formData.target_stage_id) {
      toast.error('Estágio inicial é obrigatório');
      return;
    }
    if (hasPipelineRestriction && !effectiveAllowedPipelineIds.includes(formData.target_pipeline_id)) {
      toast.error('Você só pode criar filas para pipelines da sua equipe');
      return;
    }
    if (hasTeamRestriction || hasUserRestriction) {
      const invalidMember = formData.members.some((member) =>
        member.type === 'team'
          ? !effectiveAllowedTeamIds.includes(member.entityId)
          : !effectiveAllowedUserIds.includes(member.entityId)
      );
      if (invalidMember) {
        toast.error('Você só pode distribuir para sua equipe ou membros dela');
        return;
      }
    }
    const hasValidCriteria = formData.conditions.some(condition =>
      condition.values.some(value => value.trim())
    );
    if (!hasValidCriteria) {
      toast.error('Adicione pelo menos um critério de entrada para salvar a fila');
      return;
    }
    if (formData.is_active && formData.members.length === 0) {
      toast.error('Adicione pelo menos um participante antes de ativar a fila');
      return;
    }
    setSaving(true);
    try {
      await onSave(formData);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  const totalWeight = formData.members.reduce((sum, m) => sum + m.weight, 0);
  const renderConditionValueSelector = (condition: RuleCondition) => {
    switch (condition.type) {
      case 'source':
        return (
          <div className="flex flex-wrap gap-1">
            {SOURCE_OPTIONS.map(opt => (
              <Badge
                key={opt.value}
                variant={condition.values.includes(opt.value) ? 'default' : 'outline'}
                className="cursor-pointer"
                onClick={() => {
                  const newValues = condition.values.includes(opt.value)
                    ? condition.values.filter(v => v !== opt.value)
                    : [...condition.values, opt.value];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                {opt.label}
              </Badge>
            ))}
          </div>
        );
      case 'webhook':
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Webhooks:</p>
            <div className="flex flex-wrap gap-1">
              {webhooks.filter(w => w.type === 'incoming').map(wh => (
                <Badge
                  key={wh.id}
                  variant={condition.values.includes(wh.id) ? 'default' : 'outline'}
                  className="cursor-pointer gap-1"
                  onClick={() => {
                    const newValues = condition.values.includes(wh.id)
                      ? condition.values.filter(v => v !== wh.id)
                      : [...condition.values, wh.id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  <Webhook className="h-3 w-3" />
                  {wh.name}
                </Badge>
              ))}
            </div>
          </div>
        );
      case 'whatsapp_session':
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Conexões WhatsApp:</p>
            <div className="flex flex-wrap gap-1">
              {whatsappSessions.filter(s => s.is_active).map(session => (
                <Badge
                  key={session.id}
                  variant={condition.values.includes(session.id) ? 'default' : 'outline'}
                  className="cursor-pointer gap-1"
                  onClick={() => {
                    const newValues = condition.values.includes(session.id)
                      ? condition.values.filter(v => v !== session.id)
                      : [...condition.values, session.id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  <MessageSquare className="h-3 w-3" />
                  {session.display_name || session.phone_number || session.instance_name}
                </Badge>
              ))}
            </div>
          </div>
        );
      case 'meta_form':
        return (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Formulários Meta:</p>
            <div className="flex flex-wrap gap-1">
              {metaFormConfigs.map(form => (
                <Badge
                  key={form.form_id}
                  variant={condition.values.includes(form.form_id) ? 'default' : 'outline'}
                  className="cursor-pointer gap-1"
                  onClick={() => {
                    const newValues = condition.values.includes(form.form_id)
                      ? condition.values.filter(v => v !== form.form_id)
                      : [...condition.values, form.form_id];
                    updateCondition(condition.id, { values: newValues });
                  }}
                >
                  {form.form_name || form.form_id}
                </Badge>
              ))}
            </div>
          </div>
        );
      case 'website_category':
        return (
          <div className="flex flex-wrap gap-1">
            {WEBSITE_CATEGORY_OPTIONS.map(opt => (
              <Badge
                key={opt.value}
                variant={condition.values.includes(opt.value) ? 'default' : 'outline'}
                className="cursor-pointer gap-1"
                onClick={() => {
                  const newValues = condition.values.includes(opt.value)
                    ? condition.values.filter(v => v !== opt.value)
                    : [...condition.values, opt.value];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                <Globe className="h-3 w-3" />
                {opt.label}
              </Badge>
            ))}
          </div>
        );
      case 'campaign_contains':
        return (
          <Input
            placeholder="Digite parte do nome da campanha..."
            value={condition.values[0] || ''}
            onChange={e => updateCondition(condition.id, { values: [e.target.value] })}
          />
        );
      case 'tag':
        return (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <Badge
                key={tag.id}
                variant={condition.values.includes(tag.id) ? 'default' : 'outline'}
                className="cursor-pointer"
                style={condition.values.includes(tag.id) ? { backgroundColor: tag.color } : {}}
                onClick={() => {
                  const newValues = condition.values.includes(tag.id)
                    ? condition.values.filter(v => v !== tag.id)
                    : [...condition.values, tag.id];
                  updateCondition(condition.id, { values: newValues });
                }}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        );
      case 'city':
        return (
          <Input
            placeholder="Ex: São Paulo, Campinas"
            value={condition.values.join(', ')}
            onChange={e => updateCondition(condition.id, {
              values: e.target.value.split(',').map(v => v.trim()).filter(Boolean)
            })}
          />
        );
      case 'interest_property':
        return (
          <PropertyPickerDialog
            properties={properties}
            selectedPropertyId={condition.values[0]}
            onSelect={(prop) => updateCondition(condition.id, { values: [prop.id] })}
          />
        );
      default:
        return null;
    }
  };

  const hasValidCriteria = formData.conditions.some(condition =>
    condition.values.some(value => value.trim())
  );
  const hasRequiredMembers = !formData.is_active || formData.members.length > 0;
  const canSave = !!formData.name.trim() && !!formData.target_pipeline_id && !!formData.target_stage_id && hasValidCriteria && hasRequiredMembers && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[94vw] max-w-6xl overflow-hidden border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-2xl">
        <DialogHeader className="bg-[var(--app-surface-soft)] px-6 py-5">
          <DialogTitle>
            {queue ? 'Editar Fila de Distribuição' : 'Nova Fila de Distribuição'}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[calc(90vh-150px)] overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              <Collapsible open={openSections.includes('basic')} onOpenChange={() => toggleSection('basic')}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-primary" />
                    <span className="font-medium">Informações básicas</span>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.includes('basic') && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Nome da fila *</Label>
                      <Input
                        placeholder="Ex: Leads Facebook"
                        value={formData.name}
                        onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Estratégia</Label>
                      <Select
                        value={formData.strategy}
                        onValueChange={(value) => {
                          if (isQueueStrategy(value)) {
                            setFormData(prev => ({ ...prev, strategy: value }));
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simple">Sequencial</SelectItem>
                          <SelectItem value="weighted">Ponderada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Pipeline de destino *</Label>
                      <Select
                        value={formData.target_pipeline_id || ''}
                        onValueChange={v => setFormData(prev => ({
                          ...prev,
                          target_pipeline_id: v,
                          target_stage_id: '',
                        }))}
                      >
                        <SelectTrigger className={!formData.target_pipeline_id ? 'border-destructive' : ''}>
                          <SelectValue placeholder="Selecione um pipeline..." />
                        </SelectTrigger>
                        <SelectContent>
                          {visiblePipelines.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Estágio inicial *</Label>
                      <Select
                        value={formData.target_stage_id || ''}
                        onValueChange={v => setFormData(prev => ({ ...prev, target_stage_id: v }))}
                        disabled={!formData.target_pipeline_id}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um estágio..." />
                        </SelectTrigger>
                        <SelectContent>
                          {stages.map(s => (
                            <SelectItem key={s.id} value={s.id}>
                              <div className="flex items-center gap-2">
                                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color ?? undefined }} />
                                {s.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={openSections.includes('rules')} onOpenChange={() => toggleSection('rules')}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-primary" />
                    <span className="font-medium">Regras de entrada</span>
                    {formData.conditions.length > 0 && <Badge variant="secondary" className="text-xs">{formData.conditions.length}</Badge>}
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.includes('rules') && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  {formData.conditions.map((condition) => (
                    <div key={condition.id} className="space-y-3 rounded-lg border-0 bg-[var(--app-surface-soft)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Select
                          value={condition.type}
                          onValueChange={(value) => {
                            if (isRuleConditionType(value)) {
                              updateCondition(condition.id, { type: value, values: [] });
                            }
                          }}
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONDITION_TYPES.map(ct => (
                              <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeCondition(condition.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {renderConditionValueSelector(condition)}
                    </div>
                  ))}
                  {!hasValidCriteria && (
                    <p className="text-xs text-destructive">Adicione pelo menos um critério preenchido para salvar a fila.</p>
                  )}
                  <Button variant="outline" onClick={addCondition} className="w-full gap-2">
                    <Plus className="h-4 w-4" /> Nova condição
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className="space-y-4">
              <Collapsible open={openSections.includes('members')} onOpenChange={() => toggleSection('members')}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <span className="font-medium">Ordem de distribuição</span>
                    {formData.members.length > 0 && <Badge variant="secondary" className="text-xs">{formData.members.length}</Badge>}
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.includes('members') && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  {formData.members.length > 0 && (
                    <div className="overflow-hidden rounded-lg border-0 bg-[var(--app-surface)]">
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                        modifiers={[restrictToVerticalAxis]}
                      >
                        <Table>
                          <TableHeader className="[&_tr]:border-0">
                            <TableRow className="border-0 hover:bg-transparent">
                              <TableHead className="w-10" />
                              <TableHead>Participante</TableHead>
                              <TableHead className="w-32 text-center">
                                {formData.strategy === 'weighted' ? 'Peso' : 'Ordem'}
                              </TableHead>
                              <TableHead className="w-12" />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <SortableContext
                              items={formData.members.map(m => m.entityId)}
                              strategy={verticalListSortingStrategy}
                            >
                              {formData.members.map((member, idx) => (
                                <SortableMemberRow
                                  key={member.entityId}
                                  member={member}
                                  idx={idx}
                                  strategy={formData.strategy}
                                  totalWeight={totalWeight}
                                  onUpdateWeight={updateMemberWeight}
                                  onRemove={removeMember}
                                />
                              ))}
                            </SortableContext>
                          </TableBody>
                        </Table>
                      </DndContext>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select onValueChange={v => {
                      const user = users.find(u => u.id === v);
                      if (user) addMember('user', v, user.name);
                    }}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Adicionar corretor..." />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleUsers.filter(u => !formData.members.some(m => m.type === 'user' && m.entityId === u.id)).map(user => (
                          <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select onValueChange={v => {
                      const team = visibleTeams.find(t => t.id === v);
                      if (team) addMember('team', v, team.name);
                    }}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Adicionar equipe..." />
                      </SelectTrigger>
                      <SelectContent>
                        {visibleTeams.filter(t => !formData.members.some(m => m.type === 'team' && m.entityId === t.id)).map(team => (
                          <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {formData.is_active && formData.members.length === 0 && (
                    <p className="text-xs text-destructive">Adicione pelo menos um participante para manter a fila ativa.</p>
                  )}
                </CollapsibleContent>
              </Collapsible>

              <Collapsible open={openSections.includes('redistribution')} onOpenChange={() => toggleSection('redistribution')}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border-0 bg-[var(--app-surface-soft)] p-4 text-left transition-colors hover:bg-[var(--app-surface-hover)]">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    <span className="font-medium">Redistribuição</span>
                    {formData.settings.enable_redistribution && <Badge variant="secondary" className="text-xs">Ativa</Badge>}
                  </div>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', openSections.includes('redistribution') && 'rotate-180')} />
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4 px-1 pt-4">
                  <div className="space-y-4 rounded-lg border-0 bg-[var(--app-surface-soft)] p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label>Ativar redistribuição de lead parado</Label>
                        <p className="text-xs text-muted-foreground">
                          Se o responsável não fizer contato nem movimentar o próprio lead no prazo, o sistema envia para o próximo participante da fila.
                        </p>
                      </div>
                      <Switch
                        checked={!!formData.settings.enable_redistribution}
                        onCheckedChange={(checked) => setFormData(prev => ({
                          ...prev,
                          settings: {
                            ...prev.settings,
                            enable_redistribution: checked,
                            redistribution_timeout_minutes: prev.settings.redistribution_timeout_minutes ?? 20,
                            redistribution_warning_minutes: prev.settings.redistribution_warning_minutes ?? 2,
                            redistribution_max_attempts: prev.settings.redistribution_max_attempts ?? 10,
                          },
                        }))}
                      />
                    </div>

                    {formData.settings.enable_redistribution && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label>Tempo</Label>
                          <Input
                            type="number"
                            min={1}
                            value={formData.settings.redistribution_timeout_minutes ?? 20}
                            onChange={e => setFormData(prev => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                redistribution_timeout_minutes: Math.max(1, Number(e.target.value) || 20),
                              },
                            }))}
                          />
                          <p className="text-[11px] text-muted-foreground">Minutos.</p>
                        </div>

                        <div className="space-y-2">
                          <Label>Aviso</Label>
                          <Input
                            type="number"
                            min={0}
                            value={formData.settings.redistribution_warning_minutes ?? 2}
                            onChange={e => setFormData(prev => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                redistribution_warning_minutes: Math.max(0, Number(e.target.value) || 0),
                              },
                            }))}
                          />
                          <p className="text-[11px] text-muted-foreground">Minutos antes.</p>
                        </div>

                        <div className="space-y-2">
                          <Label>Tentativas</Label>
                          <Input
                            type="number"
                            min={0}
                            value={formData.settings.redistribution_max_attempts ?? 10}
                            onChange={e => setFormData(prev => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                redistribution_max_attempts: Math.max(0, Number(e.target.value) || 0),
                              },
                            }))}
                          />
                          <p className="text-[11px] text-muted-foreground">0 sem limite.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 bg-[var(--app-surface-soft)] px-6 py-4">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="rounded-xl" onClick={handleSave} disabled={!canSave}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Salvar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
