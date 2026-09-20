import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DistributionQueueAutoTagsSection,
  DistributionQueueBasicSection,
  DistributionQueueMembersSection,
  DistributionQueueRedistributionSection,
  DistributionQueueRulesSection,
  DistributionQueueWhatsAppAutoReplySection,
} from "@/components/features/round-robin/distribution-queue-editor";
import { createClientId } from "@/lib/client-id";
import { Button } from "@/components/ui/button";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useTeams } from "@/hooks/use-teams";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useTags } from "@/hooks/use-tags";
import { useProperties } from "@/hooks/use-properties";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useWebhooks } from "@/hooks/use-webhooks";
import {
  useRoundRobinMetaForms,
  useRoundRobinWhatsAppSessions,
} from "@/hooks/use-round-robins";
import {
  activeTeamsForUser,
  queueMemberKey,
  resolveDirectUserTeamContext,
  type QueueMemberDraft,
} from "@/lib/round-robin/member-context";
import {
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  createEmptyDistributionQueueFormData,
  DISTRIBUTION_QUEUE_CONDITION_TYPES,
  findConflictingDistributionQueueMetaForm,
  getDistributionQueueEligibleUserIds,
  hasValidDistributionQueueCriteria,
  hydrateDistributionQueueFormData,
  isValidWhatsAppDistributionAutoReplyDelay,
  MAX_DISTRIBUTION_QUEUE_AUTO_TAGS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH,
  normalizeDistributionQueueAutoTagIds,
  sanitizeDistributionQueueConditions,
  type DistributionQueueCondition,
  type DistributionQueueFormData,
  type ExistingDistributionQueue,
} from "@/lib/round-robin/distribution-queue-form";
import type { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";

interface DistributionQueueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue?: ExistingDistributionQueue | null;
  onSave: (data: DistributionQueueFormData) => Promise<void>;
  presentation?: "dialog" | "page";
  allowedTeamIds?: string[];
  allowedUserIds?: string[];
  allowedPipelineIds?: string[];
}

const EMPTY_RESTRICTION_IDS: string[] = [];
const DEFAULT_PAGE_SECTION_IDS = ["basic", "rules", "members"];

function buildEditorFingerprint(formData: DistributionQueueFormData) {
  return JSON.stringify({
    name: formData.name.trim(),
    strategy: formData.strategy,
    targetPipelineId: formData.target_pipeline_id,
    targetStageId: formData.target_stage_id,
    isActive: formData.is_active,
    settings: formData.settings,
    conditions: formData.conditions.map((condition) => ({
      id: condition.id,
      type: condition.type,
      values: condition.values,
      sessionId: condition.sessionId,
    })),
    members: formData.members.map((member) => ({
      id: member.id,
      type: member.type,
      entityId: member.entityId,
      teamId: member.teamId,
      weight: member.weight,
    })),
  });
}

export function DistributionQueueEditor({
  open,
  onOpenChange,
  queue,
  onSave,
  presentation = "dialog",
  allowedTeamIds,
  allowedUserIds,
  allowedPipelineIds,
}: DistributionQueueEditorProps) {
  const { hasModule } = useOrganizationModules();
  const hasPropertiesModule = hasModule("properties");
  const {
    data: pipelines = [],
    isPending: pipelinesLoading,
    isError: pipelinesError,
  } = usePipelines();
  const {
    data: teams = [],
    isPending: teamsLoading,
    isError: teamsError,
  } = useTeams({ includeInactive: true });
  const {
    data: users = [],
    isPending: usersLoading,
    isError: usersError,
  } = useOrganizationUsers();
  const {
    data: tags = [],
    isLoading: tagsLoading,
    isError: tagsError,
  } = useTags();
  const {
    data: properties = [],
    isPending: propertiesLoading,
    isError: propertiesError,
  } = useProperties(
    undefined,
    {},
    {
      enabled: hasPropertiesModule,
    },
  );
  const {
    data: webhooks = [],
    isPending: webhooksLoading,
    isError: webhooksError,
  } = useWebhooks();
  const {
    data: whatsappSessions = [],
    isPending: whatsappSessionsLoading,
    isError: whatsappSessionsError,
  } = useRoundRobinWhatsAppSessions();
  const {
    data: metaFormConfigs = [],
    isLoading: metaFormsLoading,
    isFetching: metaFormsFetching,
    isError: metaFormsError,
  } = useRoundRobinMetaForms();
  const hasTeamRestriction = Array.isArray(allowedTeamIds);
  const hasUserRestriction = Array.isArray(allowedUserIds);
  const hasPipelineRestriction = Array.isArray(allowedPipelineIds);
  const effectiveAllowedTeamIds = allowedTeamIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedUserIds = allowedUserIds ?? EMPTY_RESTRICTION_IDS;
  const effectiveAllowedPipelineIds =
    allowedPipelineIds ?? EMPTY_RESTRICTION_IDS;
  const availableConditionTypes = useMemo(
    () =>
      hasPropertiesModule
        ? DISTRIBUTION_QUEUE_CONDITION_TYPES
        : DISTRIBUTION_QUEUE_CONDITION_TYPES.filter(
            (condition) => condition.value !== "interest_property",
          ),
    [hasPropertiesModule],
  );
  const activeTeams = useMemo(
    () => teams.filter((team) => team.is_active !== false && Boolean(team.id)),
    [teams],
  );
  const activeUsers = useMemo(
    () => users.filter((user) => user.is_active !== false && Boolean(user.id)),
    [users],
  );
  const visibleTeams = useMemo(
    () =>
      hasTeamRestriction
        ? activeTeams.filter((team) =>
            effectiveAllowedTeamIds.includes(team.id),
          )
        : activeTeams,
    [activeTeams, effectiveAllowedTeamIds, hasTeamRestriction],
  );
  const visibleUsers = useMemo(
    () =>
      hasUserRestriction
        ? activeUsers.filter((user) =>
            effectiveAllowedUserIds.includes(user.id),
          )
        : activeUsers,
    [activeUsers, effectiveAllowedUserIds, hasUserRestriction],
  );
  const visiblePipelines = useMemo(
    () =>
      hasPipelineRestriction
        ? pipelines.filter((pipeline) =>
            effectiveAllowedPipelineIds.includes(pipeline.id),
          )
        : pipelines,
    [effectiveAllowedPipelineIds, hasPipelineRestriction, pipelines],
  );
  const incomingWebhooks = useMemo(
    () => webhooks.filter((webhook) => webhook.type === "incoming"),
    [webhooks],
  );
  const activeWhatsAppSessions = useMemo(
    () => whatsappSessions.filter((session) => session.is_active),
    [whatsappSessions],
  );
  const campaignWhatsAppSessions = useMemo(
    () =>
      whatsappSessions.filter(
        (session) =>
          session.is_active &&
          !["disabled", "deleted"].includes(
            session.status.trim().toLowerCase(),
          ) &&
          (!session.provider || session.provider === "evolution_go"),
      ),
    [whatsappSessions],
  );

  const [saving, setSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const [openSections, setOpenSections] = useState<string[]>([]);

  const [formData, setFormData] = useState<DistributionQueueFormData>(
    createEmptyDistributionQueueFormData,
  );
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    buildEditorFingerprint(createEmptyDistributionQueueFormData()),
  );

  const persistedMemberById = useMemo(
    () =>
      new Map(
        (queue?.members || [])
          .filter((member) => Boolean(member.id))
          .map((member) => [member.id as string, member]),
      ),
    [queue?.members],
  );

  const hasWhatsAppMessageCondition = formData.conditions.some(
    (condition) => condition.type === "whatsapp_message_contains",
  );
  const selectedAutoTagIds = normalizeDistributionQueueAutoTagIds(
    formData.settings.auto_tag_ids,
  );

  const selectableUsers = useMemo(
    () =>
      visibleUsers.filter(
        (user) =>
          !formData.members.some(
            (member) => member.type === "user" && member.entityId === user.id,
          ),
      ),
    [formData.members, visibleUsers],
  );
  const selectableTeams = useMemo(
    () =>
      visibleTeams.filter(
        (team) =>
          !formData.members.some(
            (member) => member.type === "team" && member.entityId === team.id,
          ),
      ),
    [formData.members, visibleTeams],
  );
  const eligibleRedistributionUserCount = useMemo(
    () =>
      getDistributionQueueEligibleUserIds(
        formData.members,
        visibleTeams,
        visibleUsers.map((user) => user.id),
      ).length,
    [formData.members, visibleTeams, visibleUsers],
  );
  const teamSelectMessage =
    teams.length === 0
      ? "Nenhuma equipe cadastrada."
      : activeTeams.length === 0
        ? "Nenhuma equipe ativa encontrada."
        : selectableTeams.length === 0
          ? "Todas as equipes ativas ja foram adicionadas."
          : null;

  // Get stages for selected pipeline
  const {
    data: stages = [],
    isPending: stagesLoading,
    isError: stagesError,
  } = useStages(formData.target_pipeline_id || undefined);

  const hasWebhookCondition = formData.conditions.some(
    (condition) => condition.type === "webhook",
  );
  const hasWhatsAppCondition = formData.conditions.some(
    (condition) =>
      condition.type === "whatsapp_session" ||
      condition.type === "whatsapp_message_contains",
  );
  const hasMetaFormCondition = formData.conditions.some(
    (condition) => condition.type === "meta_form",
  );
  const hasTagCondition = formData.conditions.some(
    (condition) => condition.type === "tag",
  );
  const hasPropertyCondition = formData.conditions.some(
    (condition) => condition.type === "interest_property",
  );
  const blockingReferenceDataError =
    pipelinesError ||
    stagesError ||
    teamsError ||
    usersError ||
    ((hasTagCondition || selectedAutoTagIds.length > 0) && tagsError) ||
    (hasWebhookCondition && webhooksError) ||
    (hasWhatsAppCondition && whatsappSessionsError) ||
    (hasMetaFormCondition && metaFormsError) ||
    (hasPropertyCondition && propertiesError);
  const blockingReferenceDataLoading =
    pipelinesLoading ||
    (!!formData.target_pipeline_id && stagesLoading) ||
    teamsLoading ||
    usersLoading ||
    ((hasTagCondition || selectedAutoTagIds.length > 0) && tagsLoading) ||
    (hasWebhookCondition && webhooksLoading) ||
    (hasWhatsAppCondition && whatsappSessionsLoading) ||
    (hasMetaFormCondition && metaFormsLoading) ||
    (hasPropertyCondition && propertiesLoading);

  useEffect(() => {
    if (open) {
      // This is UI draft hydration when the dialog opens or switches queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenSections(presentation === "page" ? DEFAULT_PAGE_SECTION_IDS : []);
    }
  }, [open, presentation, queue?.id]);

  useEffect(() => {
    if (!queue || teamsLoading || teams.length === 0) return;

    const teamNamesById = new Map(
      teams.map((team) => [team.id, team.name || "Equipe"]),
    );
    // Complete team labels after the team query resolves without replacing the
    // rest of the in-progress form draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormData((current) => {
      let changed = false;
      const members = current.members.map((member) => {
        if (member.type !== "team") return member;
        const resolvedName = teamNamesById.get(member.entityId);
        if (!resolvedName || resolvedName === member.name) return member;
        changed = true;
        return { ...member, name: resolvedName };
      });

      return changed ? { ...current, members } : current;
    });
  }, [queue, teams, teamsLoading]);

  // Initialize form when queue changes
  useEffect(() => {
    const hydratedFormData = queue
      ? hydrateDistributionQueueFormData(
          {
            ...queue,
            reentry_behavior:
              queue.reentry_behavior ??
              queue.settings?.reentry_behavior ??
              "redistribute",
          },
          teams,
        )
      : createEmptyDistributionQueueFormData();

    if (queue) {
      // This is form draft hydration from the selected queue.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData(hydratedFormData);
    } else {
      // This is form draft hydration for create mode.
      setFormData(hydratedFormData);
    }
    setSavedFingerprint(buildEditorFingerprint(hydratedFormData));
    // Intentionally initialize only when the dialog opens or switches queue.
    // Team/user query refreshes must not reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue?.id]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  };

  const addCondition = () => {
    setFormData((prev) => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        {
          id: createClientId("condition"),
          type: prev.conditions.some(
            (condition) => condition.type === "whatsapp_message_contains",
          )
            ? "whatsapp_message_contains"
            : "source",
          values: [],
        },
      ],
    }));
  };

  const updateCondition = (
    id: string,
    updates: Partial<DistributionQueueCondition>,
  ) => {
    setFormData((prev) => {
      const current = prev.conditions.find((condition) => condition.id === id);
      const conditions = prev.conditions.map((condition) =>
        condition.id === id ? { ...condition, ...updates } : condition,
      );
      const removedLastWhatsAppCondition =
        current?.type === "whatsapp_message_contains" &&
        updates.type !== undefined &&
        updates.type !== "whatsapp_message_contains" &&
        !conditions.some(
          (condition) => condition.type === "whatsapp_message_contains",
        );

      return {
        ...prev,
        conditions,
        settings: removedLastWhatsAppCondition
          ? {
              ...prev.settings,
              ignore_availability: queue?.settings?.ignore_availability,
              whatsapp_distribution_auto_reply_enabled: false,
            }
          : prev.settings,
      };
    });
  };

  const removeCondition = (id: string) => {
    setFormData((prev) => {
      const removed = prev.conditions.find((condition) => condition.id === id);
      const conditions = prev.conditions.filter(
        (condition) => condition.id !== id,
      );
      const removedLastWhatsAppCondition =
        removed?.type === "whatsapp_message_contains" &&
        !conditions.some(
          (condition) => condition.type === "whatsapp_message_contains",
        );

      return {
        ...prev,
        conditions,
        settings: removedLastWhatsAppCondition
          ? {
              ...prev.settings,
              ignore_availability: queue?.settings?.ignore_availability,
              whatsapp_distribution_auto_reply_enabled: false,
            }
          : prev.settings,
      };
    });
  };

  const addMember = (
    type: "user" | "team",
    entityId: string,
    name: string,
    teamId?: string,
  ) => {
    if (!entityId.trim()) return;

    setFormData((prev) => ({
      ...prev,
      members: prev.members.some(
        (m) => m.type === type && m.entityId === entityId,
      )
        ? prev.members
        : [...prev.members, { type, entityId, teamId, weight: 10, name }],
    }));
  };

  const addDirectUser = (userId: string) => {
    const user = visibleUsers.find((candidate) => candidate.id === userId);
    if (!user) return;

    addMember("user", userId, user.name);
  };

  const updateMemberWeight = (memberKey: string, weight: number) => {
    setFormData((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        queueMemberKey(m) === memberKey
          ? { ...m, weight: Math.max(1, weight) }
          : m,
      ),
    }));
  };

  const removeMember = (memberKey: string) => {
    setFormData((prev) => ({
      ...prev,
      members: prev.members.filter((m) => queueMemberKey(m) !== memberKey),
    }));
  };

  const toggleAutoTag = (tagId: string) => {
    const normalizedTagId = normalizeDistributionQueueAutoTagIds([tagId])[0];
    if (!normalizedTagId) return;

    const currentAutoTagIds = normalizeDistributionQueueAutoTagIds(
      formData.settings.auto_tag_ids,
    );
    if (
      !currentAutoTagIds.includes(normalizedTagId) &&
      currentAutoTagIds.length >= MAX_DISTRIBUTION_QUEUE_AUTO_TAGS
    ) {
      toast.error(
        `Selecione no máximo ${MAX_DISTRIBUTION_QUEUE_AUTO_TAGS} tags automáticas.`,
      );
      return;
    }

    setFormData((previous) => {
      const autoTagIds = normalizeDistributionQueueAutoTagIds(
        previous.settings.auto_tag_ids,
      );
      const alreadySelected = autoTagIds.includes(normalizedTagId);
      return {
        ...previous,
        settings: {
          ...previous.settings,
          auto_tag_ids: alreadySelected
            ? autoTagIds.filter(
                (currentTagId) => currentTagId !== normalizedTagId,
              )
            : [...autoTagIds, normalizedTagId],
        },
      };
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setFormData((prev) => {
        const oldIndex = prev.members.findIndex(
          (m) => queueMemberKey(m) === active.id,
        );
        const newIndex = prev.members.findIndex(
          (m) => queueMemberKey(m) === over.id,
        );
        if (oldIndex < 0 || newIndex < 0) return prev;
        return {
          ...prev,
          members: arrayMove(prev.members, oldIndex, newIndex),
        };
      });
    }
  };

  const handleSave = async () => {
    if (saveInFlightRef.current) return;
    if (blockingReferenceDataError) {
      toast.error(
        "Não foi possível validar todos os dados da fila. Recarregue as referências antes de salvar.",
      );
      return;
    }
    if (blockingReferenceDataLoading) {
      toast.error("Aguarde o carregamento completo dos dados da fila.");
      return;
    }
    if (!formData.name.trim()) {
      toast.error("Nome da fila e obrigatorio");
      return;
    }
    if (!formData.target_pipeline_id) {
      toast.error("Pipeline de destino e obrigatorio");
      return;
    }
    if (!formData.target_stage_id) {
      toast.error("Estagio inicial e obrigatorio");
      return;
    }
    if (
      hasPipelineRestriction &&
      !effectiveAllowedPipelineIds.includes(formData.target_pipeline_id)
    ) {
      toast.error("Você só pode criar filas para pipelines da sua equipe");
      return;
    }
    const participantDataLoading = formData.members.some((member) =>
      member.type === "user" ? teamsLoading || usersLoading : teamsLoading,
    );
    if (participantDataLoading) {
      toast.error("Aguarde o carregamento das equipes e dos corretores.");
      return;
    }
    if (hasTeamRestriction || hasUserRestriction) {
      const invalidMember = formData.members.some((member) => {
        if (member.type === "team") {
          return (
            hasTeamRestriction &&
            !effectiveAllowedTeamIds.includes(member.entityId)
          );
        }
        return (
          (hasUserRestriction &&
            !effectiveAllowedUserIds.includes(member.entityId)) ||
          (hasTeamRestriction &&
            Boolean(member.teamId) &&
            !effectiveAllowedTeamIds.includes(member.teamId || ""))
        );
      });
      if (invalidMember) {
        toast.error("Você só pode distribuir para sua equipe ou membros dela");
        return;
      }
    }
    const validUserIds = new Set(visibleUsers.map((user) => user.id));
    const validTeamIds = new Set(visibleTeams.map((team) => team.id));
    const validMembers: QueueMemberDraft[] = [];
    for (const member of formData.members) {
      if (!member.entityId?.trim()) continue;
      const persistedMember = member.id
        ? persistedMemberById.get(member.id)
        : undefined;
      if (member.type === "team") {
        const isPersistedTeam =
          persistedMember?.team_id === member.entityId &&
          !persistedMember.user_id;
        if (validTeamIds.has(member.entityId) || isPersistedTeam) {
          validMembers.push(member);
        }
        continue;
      }
      const isPersistedUser = persistedMember?.user_id === member.entityId;
      if (!validUserIds.has(member.entityId)) {
        if (isPersistedUser) validMembers.push(member);
        continue;
      }

      const persistedTeamId = persistedMember?.team_id || undefined;
      if (isPersistedUser && persistedTeamId === (member.teamId || undefined)) {
        validMembers.push(member);
        continue;
      }

      const userTeams = activeTeamsForUser(member.entityId, visibleTeams);
      const resolution = resolveDirectUserTeamContext(
        userTeams.map((team) => team.id),
        member.teamId,
      );
      if (resolution.status === "unavailable") {
        toast.error(
          `A equipe escolhida para ${member.name || "o corretor"} não está mais ativa ou vinculada a ele.`,
        );
        return;
      }
      validMembers.push({ ...member, teamId: resolution.teamId });
    }
    if (validMembers.length !== formData.members.length) {
      toast.info(
        "Removi participantes pendentes ou inativos antes de salvar a fila.",
      );
      setFormData((prev) => ({ ...prev, members: validMembers }));
    }
    const configuredWhatsAppMessageConditions = formData.conditions.filter(
      (condition) =>
        condition.type === "whatsapp_message_contains" &&
        condition.values.some((value) => value.trim()),
    );
    if (
      configuredWhatsAppMessageConditions.some(
        (condition) => !condition.sessionId?.trim(),
      )
    ) {
      toast.error(
        "Selecione a conexão do WhatsApp para cada campanha configurada.",
      );
      return;
    }
    const invalidWhatsAppSession = configuredWhatsAppMessageConditions.find(
      (condition) => {
        const selectedSession = whatsappSessions.find(
          (session) => session.id === condition.sessionId,
        );
        return (
          !selectedSession ||
          !selectedSession.is_active ||
          ["disabled", "deleted"].includes(
            selectedSession.status.trim().toLowerCase(),
          ) ||
          (selectedSession.provider !== undefined &&
            selectedSession.provider !== "evolution_go")
        );
      },
    );
    if (invalidWhatsAppSession) {
      toast.error(
        "Selecione uma conexão do WhatsApp ativa para esta campanha.",
      );
      return;
    }
    const hasConfiguredWhatsAppMessageCondition =
      configuredWhatsAppMessageConditions.length > 0;
    const whatsappAutoReplyEnabled =
      hasConfiguredWhatsAppMessageCondition &&
      formData.settings.whatsapp_distribution_auto_reply_enabled === true;
    const rawWhatsAppAutoReplyMessage =
      typeof formData.settings.whatsapp_distribution_auto_reply_message ===
      "string"
        ? formData.settings.whatsapp_distribution_auto_reply_message.trim()
        : "";
    const whatsappAutoReplyMessageLength = Array.from(
      rawWhatsAppAutoReplyMessage,
    ).length;
    const rawWhatsAppAutoReplyDelay =
      formData.settings.whatsapp_distribution_auto_reply_delay_seconds;
    if (
      whatsappAutoReplyEnabled &&
      (whatsappAutoReplyMessageLength < 1 ||
        whatsappAutoReplyMessageLength >
          MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH)
    ) {
      toast.error(
        `A resposta automática deve conter entre 1 e ${MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH} caracteres.`,
      );
      return;
    }
    if (
      whatsappAutoReplyEnabled &&
      !isValidWhatsAppDistributionAutoReplyDelay(rawWhatsAppAutoReplyDelay)
    ) {
      toast.error(
        `O atraso da resposta automática deve ficar entre 1 e ${MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS} segundos.`,
      );
      return;
    }
    const whatsappAutoReplyMessage =
      whatsappAutoReplyMessageLength >= 1 &&
      whatsappAutoReplyMessageLength <=
        MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH
        ? rawWhatsAppAutoReplyMessage
        : DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY;
    const whatsappAutoReplyDelay = isValidWhatsAppDistributionAutoReplyDelay(
      rawWhatsAppAutoReplyDelay,
    )
      ? rawWhatsAppAutoReplyDelay
      : DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS;
    if (
      hasConfiguredWhatsAppMessageCondition &&
      formData.settings.require_checkin
    ) {
      setFormData((previous) => ({
        ...previous,
        settings: { ...previous.settings, require_checkin: false },
      }));
      toast.info(
        "O check-in obrigatório foi desativado nesta fila de WhatsApp. Revise e salve novamente.",
      );
      return;
    }
    const hasValidCriteria = hasValidDistributionQueueCriteria(
      formData.conditions,
    );
    if (!hasValidCriteria) {
      toast.error(
        "Adicione pelo menos um criterio de entrada para salvar a fila",
      );
      return;
    }
    if (formData.is_active && validMembers.length === 0) {
      toast.error("Adicione pelo menos um participante antes de ativar a fila");
      return;
    }
    if (formData.settings.enable_redistribution) {
      const timeout = formData.settings.redistribution_timeout_minutes ?? 20;
      const warning = formData.settings.redistribution_warning_minutes ?? 5;
      if (timeout < 1 || timeout > 10080) {
        toast.error(
          "O prazo de redistribuicao deve ficar entre 1 minuto e 7 dias.",
        );
        return;
      }
      if (warning < 0 || warning >= timeout) {
        toast.error(
          "O aviso precisa acontecer antes do prazo de redistribuicao.",
        );
        return;
      }
      const eligibleUserCount = getDistributionQueueEligibleUserIds(
        validMembers,
        visibleTeams,
        visibleUsers.map((user) => user.id),
      ).length;
      if (eligibleUserCount < 2) {
        toast.error(
          `A redistribuição automática precisa de pelo menos dois corretores ativos. Esta fila possui ${eligibleUserCount}.`,
        );
        return;
      }
    }
    const sanitizedConditions = sanitizeDistributionQueueConditions(
      formData.conditions,
      metaFormConfigs,
    );
    const conflictingMetaForm = findConflictingDistributionQueueMetaForm(
      sanitizedConditions,
      metaFormConfigs,
      queue?.id,
    );
    if (conflictingMetaForm) {
      toast.error(
        `O formulário "${conflictingMetaForm.form_name || conflictingMetaForm.form_id}" já está vinculado a outra fila.`,
      );
      return;
    }
    const sanitizedHasWhatsAppMessageCondition = sanitizedConditions.some(
      (condition) => condition.type === "whatsapp_message_contains",
    );
    const sanitizedSettings = {
      ...formData.settings,
      auto_tag_ids: normalizeDistributionQueueAutoTagIds(
        formData.settings.auto_tag_ids,
      ),
      whatsapp_distribution_auto_reply_enabled:
        sanitizedHasWhatsAppMessageCondition && whatsappAutoReplyEnabled,
      whatsapp_distribution_auto_reply_message: whatsappAutoReplyMessage,
      whatsapp_distribution_auto_reply_delay_seconds: whatsappAutoReplyDelay,
    };
    const payload: DistributionQueueFormData = {
      ...formData,
      settings: sanitizedHasWhatsAppMessageCondition
        ? {
            ...sanitizedSettings,
            // Check-in has no canonical eligibility implementation yet. Keep
            // managed WhatsApp queues explicit instead of persisting a no-op.
            require_checkin: false,
          }
        : {
            ...sanitizedSettings,
            ignore_availability: queue?.settings?.ignore_availability,
            whatsapp_distribution_auto_reply_enabled: false,
          },
      conditions: sanitizedConditions,
      members: validMembers,
    };
    saveInFlightRef.current = true;
    setSaving(true);
    try {
      await onSave(payload);
      setFormData(payload);
      setSavedFingerprint(buildEditorFingerprint(payload));
      if (presentation === "dialog") onOpenChange(false);
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  };
  const hasValidCriteria = hasValidDistributionQueueCriteria(
    formData.conditions,
  );
  const hasRequiredMembers = !formData.is_active || formData.members.length > 0;
  const hasRedistributionCapacity =
    !formData.settings.enable_redistribution ||
    eligibleRedistributionUserCount >= 2;
  const hasUnsavedChanges =
    buildEditorFingerprint(formData) !== savedFingerprint;
  const canSave =
    !!formData.name.trim() &&
    !!formData.target_pipeline_id &&
    !!formData.target_stage_id &&
    hasValidCriteria &&
    hasRequiredMembers &&
    hasRedistributionCapacity &&
    hasUnsavedChanges &&
    !blockingReferenceDataError &&
    !blockingReferenceDataLoading &&
    !saving;

  const editorTitle = queue
    ? "Editar fila de distribuição"
    : "Nova fila de distribuição";
  const editorBody = (
    <>
      {blockingReferenceDataError && (
        <div
          role="alert"
          className="mx-3 mt-3 shrink-0 rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
        >
          Alguns dados necessários não puderam ser validados. O salvamento foi
          bloqueado para preservar regras, participantes e configurações já
          existentes.
        </div>
      )}
      <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-2.5 sm:px-4 sm:py-4 [&_input]:rounded-[6px] [&_label]:text-[12px] [&_label]:font-light">
        <div className="grid grid-cols-1 gap-3 2xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="min-w-0 space-y-3">
            <p className="px-1 text-[10px] font-medium uppercase text-[var(--app-text-tertiary)]">
              Entrada e destino
            </p>
            <DistributionQueueBasicSection
              open={openSections.includes("basic")}
              name={formData.name}
              strategy={formData.strategy}
              targetPipelineId={formData.target_pipeline_id}
              targetStageId={formData.target_stage_id}
              pipelines={visiblePipelines}
              stages={stages}
              onToggle={() => toggleSection("basic")}
              onNameChange={(name) =>
                setFormData((previous) => ({ ...previous, name }))
              }
              onStrategyChange={(strategy) =>
                setFormData((previous) => ({ ...previous, strategy }))
              }
              onPipelineChange={(targetPipelineId) =>
                setFormData((previous) => ({
                  ...previous,
                  target_pipeline_id: targetPipelineId,
                  target_stage_id: "",
                }))
              }
              onStageChange={(targetStageId) =>
                setFormData((previous) => ({
                  ...previous,
                  target_stage_id: targetStageId,
                }))
              }
            />

            <DistributionQueueRulesSection
              open={openSections.includes("rules")}
              conditions={formData.conditions}
              availableConditionTypes={availableConditionTypes}
              hasWhatsAppMessageCondition={hasWhatsAppMessageCondition}
              hasValidCriteria={hasValidCriteria}
              ignoreAvailability={formData.settings.ignore_availability}
              incomingWebhooks={incomingWebhooks}
              whatsappSessions={whatsappSessions}
              activeWhatsAppSessions={activeWhatsAppSessions}
              campaignWhatsAppSessions={campaignWhatsAppSessions}
              metaForms={metaFormConfigs}
              metaFormsLoading={metaFormsLoading}
              metaFormsFetching={metaFormsFetching}
              metaFormsError={metaFormsError}
              queueId={queue?.id}
              tags={tags}
              tagsLoading={tagsLoading}
              tagsError={tagsError}
              properties={properties}
              hasPropertiesModule={hasPropertiesModule}
              onToggle={() => toggleSection("rules")}
              onAddCondition={addCondition}
              onUpdateCondition={updateCondition}
              onRemoveCondition={removeCondition}
              onIgnoreAvailabilityChange={(ignoreAvailability) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    ignore_availability: ignoreAvailability,
                  },
                }))
              }
            />

            <DistributionQueueAutoTagsSection
              open={openSections.includes("auto-tags")}
              tags={tags}
              selectedTagIds={selectedAutoTagIds}
              tagsLoading={tagsLoading}
              tagsError={tagsError}
              onToggle={() => toggleSection("auto-tags")}
              onToggleTag={toggleAutoTag}
            />
          </div>

          <div className="min-w-0 space-y-3">
            <p className="px-1 text-[10px] font-medium uppercase text-[var(--app-text-tertiary)]">
              Participantes e operação
            </p>
            <DistributionQueueMembersSection
              open={openSections.includes("members")}
              members={formData.members}
              strategy={formData.strategy}
              visibleTeams={visibleTeams}
              selectableTeams={selectableTeams}
              selectableUsers={selectableUsers}
              users={visibleUsers}
              teamSelectMessage={teamSelectMessage}
              teamsLoading={teamsLoading}
              usersLoading={usersLoading}
              totalTeams={teams.length}
              activeTeams={activeTeams.length}
              isActive={formData.is_active}
              onToggle={() => toggleSection("members")}
              onDragEnd={handleDragEnd}
              onAddUser={addDirectUser}
              onAddTeam={(teamId) => {
                const team = visibleTeams.find(
                  (candidate) => candidate.id === teamId,
                );
                if (team) {
                  addMember("team", teamId, team.name);
                }
              }}
              onUpdateWeight={updateMemberWeight}
              onRemove={removeMember}
            />

            <DistributionQueueRedistributionSection
              open={openSections.includes("redistribution")}
              settings={formData.settings}
              eligibleUserCount={eligibleRedistributionUserCount}
              onToggle={() => toggleSection("redistribution")}
              onEnabledChange={(enableRedistribution) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    enable_redistribution: enableRedistribution,
                    redistribution_timeout_minutes:
                      previous.settings.redistribution_timeout_minutes ?? 20,
                    redistribution_warning_minutes:
                      previous.settings.redistribution_warning_minutes ?? 5,
                    redistribution_max_attempts:
                      previous.settings.redistribution_max_attempts ?? 10,
                  },
                }))
              }
              onTimeoutChange={(redistributionTimeoutMinutes) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_timeout_minutes:
                      redistributionTimeoutMinutes,
                  },
                }))
              }
              onWarningChange={(redistributionWarningMinutes) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_warning_minutes:
                      redistributionWarningMinutes,
                  },
                }))
              }
              onMaxAttemptsChange={(redistributionMaxAttempts) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_max_attempts: redistributionMaxAttempts,
                  },
                }))
              }
              onReentryBehaviorChange={(reentryBehavior) =>
                setFormData((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    reentry_behavior: reentryBehavior,
                  },
                }))
              }
            />

            {hasWhatsAppMessageCondition && (
              <DistributionQueueWhatsAppAutoReplySection
                open={openSections.includes("whatsapp-auto-reply")}
                settings={formData.settings}
                onToggle={() => toggleSection("whatsapp-auto-reply")}
                onSettingsChange={(updates) =>
                  setFormData((previous) => ({
                    ...previous,
                    settings: { ...previous.settings, ...updates },
                  }))
                }
              />
            )}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "shrink-0 bg-[var(--app-surface-solid)]",
          presentation === "page"
            ? "sticky bottom-0 z-20 mx-auto mb-2 flex w-[calc(100%_-_16px)] max-w-[680px] rounded-[8px] p-2 shadow-[0_-10px_30px_rgba(15,23,42,0.12)]"
            : "border-t border-[var(--app-border)] px-3 py-3 sm:px-4",
        )}
      >
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="px-1 text-[10px] text-[var(--app-text-tertiary)]"
            aria-live="polite"
          >
            {saving
              ? queue
                ? "Salvando alterações..."
                : "Criando fila..."
              : blockingReferenceDataError
                ? "Recarregue os dados necessários antes de salvar."
              : blockingReferenceDataLoading
                ? "Carregando dados da distribuição..."
                : formData.settings.enable_redistribution &&
                    !hasRedistributionCapacity
                  ? `Adicione pelo menos dois corretores ativos ou desative a redistribuição. Atualmente: ${eligibleRedistributionUserCount}.`
                  : canSave
                    ? "Tudo pronto para salvar."
                    : queue && !hasUnsavedChanges
                      ? "Nenhuma alteração para salvar."
                      : "Preencha destino, critérios e participantes obrigatórios."}
          </p>
          <div className="grid w-full grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-2 sm:w-[330px]">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              data-tour="distribution-queue-save"
              className="h-9 rounded-[6px] bg-primary text-[12px] font-light text-white shadow-none hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={handleSave}
              disabled={!canSave}
              aria-busy={saving}
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}{" "}
              {queue ? "Salvar alterações" : "Criar fila"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );

  if (presentation === "page") {
    return (
      <section
        data-tour="distribution-queue-editor"
        className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]"
      >
        {editorBody}
      </section>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="distribution-queue-editor"
        className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-6xl flex-col gap-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-primary)] shadow-none sm:max-h-[88dvh]"
      >
        <DialogHeader className="shrink-0 border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] px-4 py-3 sm:px-5">
          <DialogTitle className="text-[14px] font-normal">
            {editorTitle}
          </DialogTitle>
        </DialogHeader>
        {editorBody}
      </DialogContent>
    </Dialog>
  );
}
