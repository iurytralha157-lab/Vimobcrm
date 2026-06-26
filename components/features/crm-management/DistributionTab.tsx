import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shuffle,
  UsersRound,
} from 'lucide-react';
import { useRoundRobins, useUpdateRoundRobin, useDeleteRoundRobin, RoundRobin as RoundRobinType } from '@/hooks/use-round-robins';
import { useTeams } from '@/hooks/use-teams';
import { useTags } from '@/hooks/use-tags';
import { useProperties } from '@/hooks/use-properties';
import { useMetaIntegrations } from '@/hooks/use-meta-integration';
import { useMetaFormConfigs } from '@/hooks/use-meta-forms';
import { useWebhooks } from '@/hooks/use-webhooks';
import { useWhatsAppSessions } from '@/hooks/use-whatsapp-sessions';
import { useCreateQueueAdvanced, useUpdateQueueAdvanced } from '@/hooks/use-create-queue-advanced';
import { DistributionQueueEditor } from '@/components/features/round-robin/DistributionQueueEditor';
import { toast } from 'sonner';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { getPropertySummaries } from '@/lib/api/property-support';
import { useAuth } from '@/contexts/AuthContext';

const matchTypeLabels: Record<string, string> = {
  campaign: 'Campanha',
  campaign_contains: 'Campanha',
  tag: 'Tag',
  property: 'Imóvel',
  source: 'Fonte',
  form: 'Formulário',
  meta_form: 'Formulário',
  webhook: 'Webhook',
  whatsapp_session: 'WhatsApp',
  interest_property: 'Imóvel',
  city: 'Cidade',
};

const avatarColors = [
  'bg-primary text-primary-foreground',
  'bg-orange-500 text-white',
  'bg-emerald-500 text-white',
  'bg-violet-500 text-white',
  'bg-pink-500 text-white',
];

interface RulePropertyLabel {
  id: string;
  code?: string | null;
  vista_codigo?: string | null;
  imoview_codigo?: string | null;
  title?: string | null;
}

const getPropertyLabel = (property: RulePropertyLabel | null | undefined, fallback: string) => {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fallback);
  const cleanFallback = isUuid ? 'Configurado' : fallback;

  if (!property) return cleanFallback;
  return property.code || property.vista_codigo || property.imoview_codigo || property.title || cleanFallback;
};

const EMPTY_ROUND_ROBINS: RoundRobinType[] = [];
const EMPTY_LIST: never[] = [];

export function DistributionTab() {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const { data: roundRobins = EMPTY_ROUND_ROBINS, isLoading } = useRoundRobins();
  const { data: teams = EMPTY_LIST, isLoading: teamsLoading } = useTeams();
  const { data: tags = EMPTY_LIST } = useTags();
  const { data: properties = EMPTY_LIST } = useProperties();
  const { data: webhooks = EMPTY_LIST } = useWebhooks();
  const { data: whatsappSessions = EMPTY_LIST } = useWhatsAppSessions();
  const { data: metaIntegrations = EMPTY_LIST } = useMetaIntegrations();
  const activeMetaIntegration = metaIntegrations.find(i => i.is_connected);
  const { data: metaFormConfigs = EMPTY_LIST } = useMetaFormConfigs(activeMetaIntegration?.id);
  const updateRoundRobin = useUpdateRoundRobin();
  const deleteRoundRobin = useDeleteRoundRobin();
  const createQueue = useCreateQueueAdvanced();
  const updateQueue = useUpdateQueueAdvanced();
  const accessScope = useUserAccessScope();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<RoundRobinType | null>(null);
  const [ruleProperties, setRuleProperties] = useState<RulePropertyLabel[]>([]);
  const visibleRoundRobins = useMemo(() => {
    if (accessScope.isAdmin) return roundRobins;
    const ledTeamIds = new Set(accessScope.ledTeamIds);
    const ledUserIds = new Set(accessScope.ledUserIds);
    return roundRobins.filter((queue) =>
      queue.members.some((member) =>
        (member.team_id && ledTeamIds.has(member.team_id)) ||
        (!member.team_id && member.user_id && ledUserIds.has(member.user_id))
      )
    );
  }, [accessScope.isAdmin, accessScope.ledTeamIds, accessScope.ledUserIds, roundRobins]);

  const effectiveAllowedPipelineIds = useMemo(() => {
    if (accessScope.isAdmin) return undefined;

    return Array.from(new Set([
      ...accessScope.ledPipelineIds,
      ...visibleRoundRobins
        .map((queue) => queue.target_pipeline_id)
        .filter((pipelineId): pipelineId is string => Boolean(pipelineId)),
    ]));
  }, [accessScope.isAdmin, accessScope.ledPipelineIds, visibleRoundRobins]);

  const propertyRuleIds = useMemo(() => {
    const ids = visibleRoundRobins
      .flatMap(queue => queue.rules)
      .filter(rule => rule.match_type === 'interest_property' || rule.match_type === 'property')
      .map(rule => rule.match_value)
      .filter((value): value is string => !!value?.trim());

    return [...new Set(ids)];
  }, [visibleRoundRobins]);

  useEffect(() => {
    let cancelled = false;

    const loadRuleProperties = async () => {
      if (!propertyRuleIds.length) {
        setRuleProperties(current => (current.length ? [] : current));
        return;
      }

      const loadedIds = new Set(properties.map(property => property.id));
      const missingIds = propertyRuleIds.filter(id => !loadedIds.has(id));

      if (!missingIds.length) {
        setRuleProperties(current => (current.length ? [] : current));
        return;
      }

      const data = await getPropertySummaries(missingIds, organizationId);

      if (cancelled) return;

      setRuleProperties(data || []);
    };

    loadRuleProperties();

    return () => {
      cancelled = true;
    };
  }, [organizationId, properties, propertyRuleIds]);

  const hasQueueCriteria = (queue: RoundRobinType) =>
    queue.rules.some(rule => !!rule.match_value?.trim());

  const toggleActive = async (queue: RoundRobinType) => {
    if (!queue.is_active && !hasQueueCriteria(queue)) {
      toast.error('Adicione pelo menos um critério antes de ativar a fila');
      return;
    }
    if (!queue.is_active && queue.members.length === 0) {
      toast.error('Adicione pelo menos um participante antes de ativar a fila');
      return;
    }
    await updateRoundRobin.mutateAsync({ id: queue.id, is_active: !queue.is_active });
  };

  const handleDeleteRR = async (id: string) => {
    if (!confirm('Tem certeza que deseja excluir esta fila?')) return;
    await deleteRoundRobin.mutateAsync(id);
  };

  const handleSaveQueue = async (data: Parameters<typeof createQueue.mutateAsync>[0]) => {
    if (editingQueue) {
      await updateQueue.mutateAsync({ id: editingQueue.id, ...data });
    } else {
      await createQueue.mutateAsync(data);
    }
    setEditingQueue(null);
  };

  const openEditor = (queue?: RoundRobinType) => {
    setEditingQueue(queue || null);
    setEditorOpen(true);
  };

  const formatRule = (rule: RoundRobinType['rules'][number]) => {
    if (rule.match_type === 'tag') {
      const tag = tags.find(t => t.id === rule.match_value);
      return `Tag: ${tag?.name || rule.match_value}`;
    }

    if (rule.match_type === 'interest_property' || rule.match_type === 'property') {
      const property = properties.find(p => p.id === rule.match_value) || ruleProperties.find(p => p.id === rule.match_value);
      return `Imóvel: ${getPropertyLabel(property, rule.match_value || 'Configurado')}`;
    }

    if (rule.match_type === 'meta_form' || rule.match_type === 'form') {
      const metaForm = metaFormConfigs.find(f => f.form_id === rule.match_value || f.id === rule.match_value);
      return `Formulário: ${metaForm?.form_name || rule.match_value}`;
    }

    if (rule.match_type === 'webhook') {
      const webhook = webhooks.find(w => w.id === rule.match_value);
      return `Webhook: ${webhook?.name || rule.match_value}`;
    }

    if (rule.match_type === 'whatsapp_session') {
      const session = whatsappSessions.find(s => s.id === rule.match_value);
      return `WhatsApp: ${session?.display_name || session?.phone_number || session?.instance_name || rule.match_value}`;
    }

    return `${matchTypeLabels[rule.match_type] || rule.match_type}: ${rule.match_value || 'Configurado'}`;
  };

  const formatRules = (queue: RoundRobinType) => {
    if (!queue.rules.length) return 'Qualquer lead';
    return queue.rules.map(formatRule).join(' · ');
  };

  const getMemberName = (member: RoundRobinType['members'][number]) => {
    const team = member.team_id ? teams.find(t => t.id === member.team_id) : null;
    return member.team_id
      ? `${team?.name || 'Equipe'} · ${member.user?.name || 'Usuário'}`
      : member.user?.name || member.user?.email || 'Usuário';
  };

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(part => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

  if (isLoading || teamsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const activeQueues = visibleRoundRobins.filter(rr => rr.is_active).length;
  const totalLeadsDistributed = visibleRoundRobins.reduce((acc, rr) => acc + (rr.leads_distributed || 0), 0);

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Distribuição de Leads</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {visibleRoundRobins.length} {visibleRoundRobins.length === 1 ? 'fila' : 'filas'} · {activeQueues} {activeQueues === 1 ? 'ativa' : 'ativas'} · {totalLeadsDistributed} leads distribuídos
            </p>
          </div>
          <Button data-tour="distribution-new-queue" onClick={() => openEditor()} className="gap-2">
            <Plus className="h-4 w-4" />
            Nova Fila
          </Button>
        </div>

        {visibleRoundRobins.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.025] py-16 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Shuffle className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Configure sua distribuição</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Crie filas para distribuir leads automaticamente entre sua equipe.
            </p>
            <Button onClick={() => openEditor()} size="lg" className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Fila
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/[0.055] bg-[var(--app-surface)] [&_td:nth-child(n+4)]:hidden [&_th:nth-child(n+4)]:hidden md:[&_td:nth-child(n+4)]:table-cell md:[&_th:nth-child(n+4)]:table-cell">
            <Table className="table-fixed md:table-auto">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[62px] px-3 md:w-[72px] md:px-4">Status</TableHead>
                  <TableHead className="w-[34%] md:w-auto">Nome da fila</TableHead>
                  <TableHead>Critério</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Usuários ou equipes</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead>Criada por</TableHead>
                  <TableHead className="w-[112px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRoundRobins.map((queue) => {
                  const creator = queue.created_by_user?.name || queue.created_by_user?.email || 'Não informado';
                  const createdAt = format(new Date(queue.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR });
                  const members = queue.members.slice(0, 5);
                  const teamNames = Array.from(new Set(
                    queue.members
                      .filter(member => member.team_id)
                      .map(member => teams.find(team => team.id === member.team_id)?.name)
                      .filter(Boolean)
                  ));

                  return (
                    <TableRow
                      key={queue.id}
                      className="cursor-pointer"
                      onClick={() => openEditor(queue)}
                    >
                      <TableCell className="px-3 md:px-4" onClick={(event) => event.stopPropagation()}>
                        <Switch
                          checked={queue.is_active || false}
                          onCheckedChange={() => toggleActive(queue)}
                          aria-label={queue.is_active ? 'Desativar fila' : 'Ativar fila'}
                        />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div className="truncate font-medium">{queue.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          <span>{queue.strategy === 'weighted' ? 'Ponderada' : 'Sequencial'}</span>
                          {queue.settings?.enable_redistribution && (
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                              Redistribuição ativa
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 max-w-[150px] md:max-w-[260px]">
                        <p className="truncate text-sm">{formatRules(queue)}</p>
                        {queue.rules.length > 1 && (
                          <p className="text-xs text-muted-foreground">{queue.rules.length} critérios</p>
                        )}
                      </TableCell>
                      <TableCell>
                        {queue.target_pipeline ? (
                          <div>
                            <p className="font-medium">{queue.target_pipeline.name}</p>
                            {queue.target_stage && (
                              <p className="text-xs text-muted-foreground">{queue.target_stage.name}</p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sem pipeline</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {queue.members.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {members.map((member, index) => {
                                const memberName = getMemberName(member);
                                const isTeamMember = !!member.team_id;
                                return (
                                  <Tooltip key={member.id}>
                                    <TooltipTrigger asChild>
                                      <Avatar className="h-8 w-8 border-2 border-background">
                                        {member.user?.avatar_url && (
                                          <AvatarImage src={member.user.avatar_url} alt={memberName} />
                                        )}
                                        <AvatarFallback className={`${avatarColors[index % avatarColors.length]} text-xs font-medium`}>
                                          {isTeamMember ? <UsersRound className="h-4 w-4" /> : getInitials(memberName)}
                                        </AvatarFallback>
                                      </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent>{memberName}</TooltipContent>
                                  </Tooltip>
                                );
                              })}
                              {queue.members.length > members.length && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="h-8 w-8 rounded-full bg-white/[0.06] border-2 border-[var(--app-background)] flex items-center justify-center">
                                      <span className="text-xs text-muted-foreground">+{queue.members.length - members.length}</span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {queue.members.slice(members.length).map(getMemberName).join(', ')}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            {teamNames.length > 0 && (
                              <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                                {teamNames.join(', ')}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sem participantes</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {queue.leads_distributed || 0}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{creator}</div>
                        <div className="text-xs text-muted-foreground">{createdAt}</div>
                      </TableCell>
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditor(queue)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {accessScope.isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDeleteRR(queue.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <DistributionQueueEditor
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) setEditingQueue(null);
          }}
          queue={editingQueue}
          onSave={handleSaveQueue}
          allowedTeamIds={accessScope.isAdmin ? undefined : accessScope.ledTeamIds}
          allowedUserIds={accessScope.isAdmin ? undefined : accessScope.ledUserIds}
          allowedPipelineIds={effectiveAllowedPipelineIds}
        />
      </div>
    </TooltipProvider>
  );
}
