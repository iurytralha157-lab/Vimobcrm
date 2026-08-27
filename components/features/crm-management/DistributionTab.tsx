import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Shuffle,
  UsersRound,
} from "lucide-react";
import {
  useDeleteRoundRobin,
  useRoundRobinMetaForms,
  useRoundRobins,
  useRoundRobinWhatsAppSessions,
  useUpdateRoundRobin,
  RoundRobin as RoundRobinType,
} from "@/hooks/use-round-robins";
import { useTeams } from "@/hooks/use-teams";
import { useTags } from "@/hooks/use-tags";
import { useProperties } from "@/hooks/use-properties";
import { useWebhooks } from "@/hooks/use-webhooks";
import {
  useCreateQueueAdvanced,
  useUpdateQueueAdvanced,
} from "@/hooks/use-create-queue-advanced";
import { DistributionQueueEditor } from "@/components/features/round-robin/DistributionQueueEditor";
import { toast } from "sonner";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { getPropertySummaries } from "@/lib/api/property-support";
import { useAuth } from "@/contexts/AuthContext";
import { ManagementToolbarPortal } from "@/components/features/crm-management/ManagementToolbar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const matchTypeLabels: Record<string, string> = {
  campaign: "Campanha",
  campaign_contains: "Campanha",
  whatsapp_message_contains: "Campanha de WhatsApp",
  tag: "Tag",
  property: "Imóvel",
  source: "Fonte",
  form: "Formulário",
  meta_form: "Formulário",
  webhook: "Webhook",
  whatsapp_session: "WhatsApp",
  interest_property: "Imóvel",
  city: "Cidade",
};

interface RulePropertyLabel {
  id: string;
  code?: string | null;
  vista_codigo?: string | null;
  imoview_codigo?: string | null;
  title?: string | null;
}

const getPropertyLabel = (
  property: RulePropertyLabel | null | undefined,
  fallback: string,
) => {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      fallback,
    );
  const cleanFallback = isUuid ? "Configurado" : fallback;

  if (!property) return cleanFallback;
  return (
    property.code ||
    property.vista_codigo ||
    property.imoview_codigo ||
    property.title ||
    cleanFallback
  );
};

const getWhatsAppSessionIdFromMatch = (match: unknown) => {
  if (!match || typeof match !== 'object' || Array.isArray(match)) return '';
  const sessionId = (match as Record<string, unknown>).whatsapp_session_id;
  return typeof sessionId === 'string' ? sessionId.trim() : '';
};

const EMPTY_ROUND_ROBINS: RoundRobinType[] = [];
const EMPTY_LIST: never[] = [];

export function DistributionTab() {
  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id;
  const { data: roundRobins = EMPTY_ROUND_ROBINS, isLoading } =
    useRoundRobins();
  const { data: teams = EMPTY_LIST, isLoading: teamsLoading } = useTeams();
  const { data: tags = EMPTY_LIST } = useTags();
  const { data: properties = EMPTY_LIST } = useProperties();
  const { data: webhooks = EMPTY_LIST } = useWebhooks();
  const { data: whatsappSessions = EMPTY_LIST } = useRoundRobinWhatsAppSessions();
  const { data: metaFormConfigs = EMPTY_LIST } = useRoundRobinMetaForms();
  const updateRoundRobin = useUpdateRoundRobin();
  const deleteRoundRobin = useDeleteRoundRobin();
  const createQueue = useCreateQueueAdvanced();
  const updateQueue = useUpdateQueueAdvanced();
  const accessScope = useUserAccessScope();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQueue, setEditingQueue] = useState<RoundRobinType | null>(null);
  const [queueToDelete, setQueueToDelete] = useState<RoundRobinType | null>(
    null,
  );
  const [ruleProperties, setRuleProperties] = useState<RulePropertyLabel[]>([]);
  const visibleRoundRobins = useMemo(() => {
    if (accessScope.isAdmin) return roundRobins;
    const ledTeamIds = new Set(accessScope.ledTeamIds);
    const ledUserIds = new Set(accessScope.ledUserIds);
    const currentUserId = profile?.id;
    return roundRobins.filter(
      (queue) =>
        (currentUserId && queue.created_by === currentUserId) ||
        queue.members.some(
          (member) =>
            (member.team_id && ledTeamIds.has(member.team_id)) ||
            (!member.team_id &&
              member.user_id &&
              ledUserIds.has(member.user_id)),
        ),
    );
  }, [
    accessScope.isAdmin,
    accessScope.ledTeamIds,
    accessScope.ledUserIds,
    profile?.id,
    roundRobins,
  ]);

  const effectiveAllowedPipelineIds = useMemo(() => {
    if (accessScope.isAdmin) return undefined;

    return Array.from(
      new Set([
        ...accessScope.ledPipelineIds,
        ...visibleRoundRobins
          .map((queue) => queue.target_pipeline_id)
          .filter((pipelineId): pipelineId is string => Boolean(pipelineId)),
      ]),
    );
  }, [accessScope.isAdmin, accessScope.ledPipelineIds, visibleRoundRobins]);

  const propertyRuleIds = useMemo(() => {
    const ids = visibleRoundRobins
      .flatMap((queue) => queue.rules)
      .filter(
        (rule) =>
          rule.match_type === "interest_property" ||
          rule.match_type === "property",
      )
      .map((rule) => rule.match_value)
      .filter((value): value is string => !!value?.trim());

    return [...new Set(ids)];
  }, [visibleRoundRobins]);

  useEffect(() => {
    let cancelled = false;

    const loadRuleProperties = async () => {
      if (!propertyRuleIds.length) {
        setRuleProperties((current) => (current.length ? [] : current));
        return;
      }

      const loadedIds = new Set(properties.map((property) => property.id));
      const missingIds = propertyRuleIds.filter((id) => !loadedIds.has(id));

      if (!missingIds.length) {
        setRuleProperties((current) => (current.length ? [] : current));
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
    queue.rules.some((rule) => !!rule.match_value?.trim());

  const toggleActive = async (queue: RoundRobinType) => {
    if (!queue.is_active && !hasQueueCriteria(queue)) {
      toast.error("Adicione pelo menos um critério antes de ativar a fila");
      return;
    }
    if (!queue.is_active && queue.members.length === 0) {
      toast.error("Adicione pelo menos um participante antes de ativar a fila");
      return;
    }
    await updateRoundRobin.mutateAsync({
      id: queue.id,
      is_active: !queue.is_active,
    });
  };

  const handleDeleteRR = (queue: RoundRobinType) => {
    setQueueToDelete(queue);
  };

  const confirmDeleteRR = async () => {
    if (!queueToDelete) return;
    await deleteRoundRobin.mutateAsync(queueToDelete.id);
    setQueueToDelete(null);
  };

  const handleSaveQueue = async (
    data: Parameters<typeof createQueue.mutateAsync>[0],
  ) => {
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

  const formatRule = (rule: RoundRobinType["rules"][number]) => {
    if (rule.match_type === "tag") {
      const tag = tags.find((t) => t.id === rule.match_value);
      return `Tag: ${tag?.name || rule.match_value}`;
    }

    if (
      rule.match_type === "interest_property" ||
      rule.match_type === "property"
    ) {
      const property =
        properties.find((p) => p.id === rule.match_value) ||
        ruleProperties.find((p) => p.id === rule.match_value);
      return `Imóvel: ${getPropertyLabel(property, rule.match_value || "Configurado")}`;
    }

    if (rule.match_type === "meta_form" || rule.match_type === "form") {
      const metaForm = metaFormConfigs.find(
        (form) =>
          form.form_id === rule.match_value ||
          form.config_id === rule.match_value,
      );
      const pageLabel = metaForm?.page_name || metaForm?.page_id;
      return `Formulário: ${metaForm?.form_name || rule.match_value}${pageLabel ? ` · ${pageLabel}` : ""}`;
    }

    if (rule.match_type === "webhook") {
      const webhook = webhooks.find((w) => w.id === rule.match_value);
      return `Webhook: ${webhook?.name || rule.match_value}`;
    }

    if (rule.match_type === "whatsapp_session") {
      const session = whatsappSessions.find((s) => s.id === rule.match_value);
      return `WhatsApp: ${session?.display_name || session?.phone_number || session?.instance_name || rule.match_value}`;
    }

    if (rule.match_type === "whatsapp_message_contains") {
      const sessionId = getWhatsAppSessionIdFromMatch(rule.match);
      const session = whatsappSessions.find((item) => item.id === sessionId);
      const sessionLabel =
        session?.display_name ||
        session?.phone_number ||
        session?.instance_name ||
        "Conexão indisponível";
      return `Campanha de WhatsApp (${sessionLabel}): mensagem contém "${rule.match_value || "Configurado"}"`;
    }

    return `${matchTypeLabels[rule.match_type] || rule.match_type}: ${rule.match_value || "Configurado"}`;
  };

  const formatRules = (queue: RoundRobinType) => {
    if (!queue.rules.length) return "Qualquer lead";
    return queue.rules.map(formatRule).join(" · ");
  };

  const getMemberName = (member: RoundRobinType["members"][number]) => {
    const team = member.team_id
      ? teams.find((t) => t.id === member.team_id)
      : null;
    return member.team_id
      ? `${team?.name || "Equipe"} · ${member.user?.name || "Usuário"}`
      : member.user?.name || member.user?.email || "Usuário";
  };

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  if (isLoading || teamsLoading) {
    return (
      <>
        <ManagementToolbarPortal>
          <Button
            data-tour="distribution-new-queue"
            onClick={() => openEditor()}
            className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-white shadow-none hover:bg-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova fila
          </Button>
        </ManagementToolbarPortal>
        <div className="flex h-64 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-tertiary)]" />
        </div>
      </>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        <ManagementToolbarPortal>
          <Button
            data-tour="distribution-new-queue"
            onClick={() => openEditor()}
            className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-white shadow-none hover:bg-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            Nova fila
          </Button>
        </ManagementToolbarPortal>

        {visibleRoundRobins.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <Shuffle className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
              Configure sua distribuição
            </h3>
            <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              Crie filas para distribuir leads automaticamente entre sua equipe.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <Table className="crm-management-table table-fixed">
              <TableHeader>
                <TableRow className="border-b border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
                  <TableHead className="w-[62px] px-3 md:w-[72px] md:px-4">
                    Status
                  </TableHead>
                  <TableHead className="w-auto lg:w-[210px]">
                    Nome da fila
                  </TableHead>
                  <TableHead className="hidden lg:table-cell lg:w-[24%]">
                    Critério
                  </TableHead>
                  <TableHead className="hidden lg:table-cell lg:w-[180px]">
                    Pipeline
                  </TableHead>
                  <TableHead className="hidden xl:table-cell xl:w-[28%]">
                    Usuários ou equipes
                  </TableHead>
                  <TableHead className="hidden w-[72px] text-right md:table-cell">
                    Leads
                  </TableHead>
                  <TableHead className="hidden w-[190px] 2xl:table-cell">
                    Criada por
                  </TableHead>
                  <TableHead className="w-[52px] px-2 text-right md:w-[112px] md:px-4">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRoundRobins.map((queue) => {
                  const creator =
                    queue.created_by_user?.name ||
                    queue.created_by_user?.email ||
                    "Não informado";
                  const createdAt = format(
                    new Date(queue.created_at),
                    "dd/MM/yyyy HH:mm",
                    { locale: ptBR },
                  );
                  const members = queue.members.slice(0, 5);
                  const teamNames = Array.from(
                    new Set(
                      queue.members
                        .filter((member) => member.team_id)
                        .map(
                          (member) =>
                            teams.find((team) => team.id === member.team_id)
                              ?.name,
                        )
                        .filter(Boolean),
                    ),
                  );

                  return (
                    <TableRow
                      key={queue.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Editar fila ${queue.name}`}
                      className="cursor-pointer border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] outline-none hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 last:border-b-0"
                      onClick={() => openEditor(queue)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openEditor(queue);
                        }
                      }}
                    >
                      <TableCell
                        className="px-3 md:px-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <Switch
                          checked={queue.is_active || false}
                          onCheckedChange={() => toggleActive(queue)}
                          aria-label={
                            queue.is_active ? "Desativar fila" : "Ativar fila"
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                          {queue.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-light text-[var(--app-text-tertiary)]">
                          <span>
                            {queue.strategy === "weighted"
                              ? "Ponderada"
                              : "Sequencial"}
                          </span>
                          {queue.settings?.enable_redistribution && (
                            <Badge
                              variant="secondary"
                              className="h-5 rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 text-[10px] font-light text-[var(--app-text-secondary)]"
                            >
                              Redistribuição ativa
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden min-w-0 max-w-[260px] lg:table-cell">
                        <p className="truncate text-[12px] font-light">
                          {formatRules(queue)}
                        </p>
                        {queue.rules.length > 1 && (
                          <p className="text-xs text-muted-foreground">
                            {queue.rules.length} critérios
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {queue.target_pipeline ? (
                          <div>
                            <p className="font-medium">
                              {queue.target_pipeline.name}
                            </p>
                            {queue.target_stage && (
                              <p className="text-xs text-muted-foreground">
                                {queue.target_stage.name}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Sem pipeline
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        {queue.members.length > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {members.map((member) => {
                                const memberName = getMemberName(member);
                                const isTeamMember = !!member.team_id;
                                return (
                                  <Tooltip key={member.id}>
                                    <TooltipTrigger asChild>
                                      <Avatar className="h-7 w-7 border-0 shadow-none">
                                        {member.user?.avatar_url && (
                                          <AvatarImage
                                            src={member.user.avatar_url}
                                            alt={memberName}
                                          />
                                        )}
                                        <AvatarFallback className="bg-primary/50 text-[10px] font-light text-white">
                                          {isTeamMember ? (
                                            <UsersRound className="h-4 w-4" />
                                          ) : (
                                            getInitials(memberName)
                                          )}
                                        </AvatarFallback>
                                      </Avatar>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {memberName}
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                              {queue.members.length > members.length && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="flex h-7 w-7 items-center justify-center rounded-full border-0 bg-[var(--app-surface-soft)]">
                                      <span className="text-xs text-muted-foreground">
                                        +{queue.members.length - members.length}
                                      </span>
                                    </div>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {queue.members
                                      .slice(members.length)
                                      .map(getMemberName)
                                      .join(", ")}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            {teamNames.length > 0 && (
                              <span className="max-w-[160px] truncate text-xs text-muted-foreground">
                                {teamNames.join(", ")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            Sem participantes
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right text-[12px] font-light md:table-cell">
                        {queue.leads_distributed || 0}
                      </TableCell>
                      <TableCell className="hidden 2xl:table-cell">
                        <div className="truncate text-[12px] font-light text-[var(--app-text-primary)]">
                          {creator}
                        </div>
                        <div className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {createdAt}
                        </div>
                      </TableCell>
                      <TableCell
                        className="w-[52px] px-2 md:w-auto md:px-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="hidden h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] md:inline-flex"
                            aria-label={`Editar fila ${queue.name}`}
                            onClick={() => openEditor(queue)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {accessScope.isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] shadow-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                              aria-label={`Excluir fila ${queue.name}`}
                              onClick={() => handleDeleteRR(queue)}
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

        <AlertDialog
          open={!!queueToDelete}
          onOpenChange={(open) => !open && setQueueToDelete(null)}
        >
          <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] border-0 sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[14px] font-normal">
                Excluir fila?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
                A fila &quot;{queueToDelete?.name}&quot; será removida. Essa
                ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 rounded-[6px] text-[12px] font-light">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteRR}
                disabled={deleteRoundRobin.isPending}
                className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteRoundRobin.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <DistributionQueueEditor
          open={editorOpen}
          onOpenChange={(open) => {
            setEditorOpen(open);
            if (!open) setEditingQueue(null);
          }}
          queue={editingQueue}
          onSave={handleSaveQueue}
          allowedTeamIds={
            accessScope.isAdmin ? undefined : accessScope.ledTeamIds
          }
          allowedUserIds={
            accessScope.isAdmin ? undefined : accessScope.ledUserIds
          }
          allowedPipelineIds={effectiveAllowedPipelineIds}
        />
      </div>
    </TooltipProvider>
  );
}
