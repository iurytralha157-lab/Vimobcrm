import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type SetStateAction } from "react";
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
import { createClientId, createUUID } from "@/lib/client-id";
import { Button } from "@/components/ui/button";
import { FormWizardLayout } from "@/components/shared/forms/FormWizardLayout";
import { FormWizardDiscardDialog } from "@/components/shared/forms/FormWizardDiscardDialog";
import { DistributionQueueCreationPreview } from "@/components/features/round-robin/DistributionQueueCreationPreview";
import {
  FORM_WIZARD_DIALOG_CLASS_NAME,
  FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME,
  FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME,
} from "@/config/form-wizard";
import { ArrowLeft, ArrowRight, Check, Filter, Loader2, MessageSquare, RefreshCw, Save, Settings2, Tags, UsersRound } from "lucide-react";
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
  canEditQueueMember,
  isUnchangedQueueMember,
  moveEditableQueueMember,
  queueMemberKey,
  resolveDirectUserTeamContext,
  type QueueMemberDraft,
} from "@/lib/round-robin/member-context";
import {
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY,
  DEFAULT_WHATSAPP_DISTRIBUTION_AUTO_REPLY_DELAY_SECONDS,
  createEmptyDistributionQueueFormData,
  DISTRIBUTION_QUEUE_CONDITION_TYPES,
  DISTRIBUTION_QUEUE_SOURCE_OPTIONS,
  DISTRIBUTION_QUEUE_WEBSITE_CATEGORY_OPTIONS,
  findConflictingDistributionQueueMetaForm,
  hydrateDistributionQueueFormData,
  isValidWhatsAppDistributionAutoReplyDelay,
  MAX_DISTRIBUTION_QUEUE_AUTO_TAGS,
  MAX_WHATSAPP_DISTRIBUTION_AUTO_REPLY_LENGTH,
  normalizeDistributionQueueAutoTagIds,
  sanitizeDistributionQueueConditions,
  type DistributionQueueCondition,
  type DistributionQueueFormData,
  type ExistingDistributionQueue,
} from "@/lib/round-robin/distribution-queue-form";
import { hasQueueRedistributionCapacity, hasValidQueueCriteria, hasValidQueueDestination, queueRedistributionCapacity, queueSnapshotPreservation } from "@/lib/round-robin/queue-snapshot";
import type { DragEndEvent } from "@dnd-kit/core";
import { useAuth } from "@/contexts/AuthContext";
import { readDistributionDraftRecovery, distributionDraftKey, saveDistributionDraft, saveDistributionNavigationDraft } from "@/lib/round-robin/pending-draft";
import { useDistributionEditorVisit } from "@/hooks/round-robin/use-distribution-editor-visit";
import { getGlobalSignOutSessionId } from "@/lib/auth/global-sign-out";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { DistributionQueueScheduleSection } from "@/components/features/round-robin/distribution-queue-editor/DistributionQueueScheduleSection";
import { queueScheduleError, queueWarningMinutes } from "@/lib/round-robin/operating-schedule";
import { isValidDistributionQueueName } from "@/lib/round-robin/queue-name";
import { distributionQueueAutoReplyError } from "@/lib/round-robin/whatsapp-auto-reply-validation";
import { countDistributionQueueInputCharacters } from "@/lib/round-robin/input-text";

interface DistributionQueueEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue?: ExistingDistributionQueue | null;
  onSave: (data: DistributionQueueFormData) => Promise<ExistingDistributionQueue | void>;
  onReload?: () => Promise<ExistingDistributionQueue>;
  presentation?: "dialog" | "page";
  aside?: ReactNode;
  summary?: ReactNode;
  closeOnSave?: boolean;
  allowedTeamIds?: string[];
  allowedUserIds?: string[];
  allowedPipelineIds?: string[];
}

const EMPTY_RESTRICTION_IDS: string[] = [];
const DEFAULT_PAGE_SECTION_IDS = ["basic", "rules", "members", "schedule", "auto-tags", "redistribution", "whatsapp-auto-reply"];

function withDraftStorage<T>(action: (storage: Storage) => T): T | undefined {
  try { return action(window.sessionStorage); } catch { return undefined; }
}

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
      isActive: member.isActive,
      reenroll: member.reenroll,
    })),
  });
}

export function DistributionQueueEditor({
  open,
  onOpenChange,
  queue,
  onSave,
  onReload,
  presentation = "dialog",
  aside,
  summary,
  closeOnSave = true,
  allowedTeamIds,
  allowedUserIds,
  allowedPipelineIds,
}: DistributionQueueEditorProps) {
  const { activeOrganization, profile, user, session } = useAuth();
  const draftKey = distributionDraftKey(activeOrganization.organizationId, profile?.id, queue?.id);
  const visitKey = draftKey ? JSON.stringify([draftKey, user?.id ?? profile?.id, getGlobalSignOutSessionId(session ?? null)]) : null;
  const { saving, isBusy, beginOperation } = useDistributionEditorVisit(visitKey, open);
  const [recoverableDraft, setRecoverableDraft] = useState<DistributionQueueFormData | null>(null);
  const [createReviewRequired, setCreateReviewRequired] = useState(false);
  const [pendingCreationSnapshot, setPendingCreationSnapshot] = useState<DistributionQueueFormData | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; occurrence: number } | null>(null);
  const saveErrorRef = useRef<HTMLDivElement>(null);
  const [draftStorageError, setDraftStorageError] = useState(false);
  const wizardId = useId();
  useEffect(() => {
    if (open && saveError) saveErrorRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, saveError]);
  const reportSaveError = (message: string) => {
    setSaveError((previous) => ({ message, occurrence: (previous?.occurrence ?? 0) + 1 }));
  };
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

  const [activeStep, setActiveStep] = useState("basic");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>([]);

  const [formData, setFormData] = useState<DistributionQueueFormData>(
    createEmptyDistributionQueueFormData,
  );
  // User edits must not race a replacing operation; hydration and confirmed responses use the internal setter.
  const updateDraft = (update: SetStateAction<DistributionQueueFormData>) => {
    if (!isBusy()) setFormData(update);
  };
  const [editorScopeKey, setEditorScopeKey] = useState(draftKey);
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
  const autoReplyError = distributionQueueAutoReplyError(formData);
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
      queueRedistributionCapacity(
        formData.members,
        queue,
        visibleTeams,
        visibleUsers.map((user) => user.id),
        hasTeamRestriction || hasUserRestriction,
      ),
    [formData.members, queue, visibleTeams, visibleUsers, hasTeamRestriction, hasUserRestriction],
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
      setOpenSections(DEFAULT_PAGE_SECTION_IDS);
      setActiveStep("basic");
      setDiscardOpen(false);
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
    setEditorScopeKey(draftKey);
    setPendingCreationSnapshot(null);
    setDraftStorageError(false);
    // Intentionally initialize only when the dialog opens or switches queue.
    // Team/user query refreshes must not reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, queue?.id, draftKey]);

  const toggleSection = (section: string) => {
    setOpenSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section],
    );
  };

  const addCondition = () => {
    updateDraft((prev) => ({
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
    updateDraft((prev) => {
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
    updateDraft((prev) => {
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

    updateDraft((prev) => ({
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
    updateDraft((prev) => ({
      ...prev,
      members: prev.members.map((m) =>
        queueMemberKey(m) === memberKey && canEditQueueMember(m, allowedUserIds, allowedTeamIds)
          ? { ...m, weight: Math.max(1, Math.min(1000, Math.trunc(weight))) }
          : m,
      ),
    }));
  };

  const removeMember = (memberKey: string) => {
    updateDraft((prev) => ({
      ...prev,
      members: prev.members.filter((m) => queueMemberKey(m) !== memberKey || !canEditQueueMember(m, allowedUserIds, allowedTeamIds)),
    }));
  };

  const toggleAutoTag = (tagId: string) => {
    if (isBusy()) return;
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

    updateDraft((previous) => {
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
      updateDraft((prev) => {
        const members = moveEditableQueueMember(prev.members, String(active.id), String(over.id), (member) => canEditQueueMember(member, allowedUserIds, allowedTeamIds));
        if (members === prev.members) return prev;
        return {
          ...prev,
          members,
        };
      });
    }
  };

  const submitQueueForm = async (payload: DistributionQueueFormData, creationReplay: boolean) => {
    const operation = beginOperation();
    if (!operation) return;
    setFormData(payload);
    const preserved = draftKey ? withDraftStorage((storage) => saveDistributionDraft(storage, draftKey, payload)) : false;
    setDraftStorageError(preserved !== true);
    if (!queue && preserved !== true) {
      operation.finish();
      if (!creationReplay) setFormData({ ...payload, creationAttemptId: undefined });
      reportSaveError("Não foi possível preservar a tentativa neste navegador. Libere o armazenamento da sessão antes de criar a fila.");
      return;
    }
    if (!queue) setPendingCreationSnapshot(payload);
    try {
      const saved = await onSave(payload);
      if (!operation.isCurrent()) return;
      const persisted = saved ? hydrateDistributionQueueFormData(saved, teams) : payload;
      setFormData(persisted);
      setSavedFingerprint(buildEditorFingerprint(persisted));
      setSaveError(null);
      setDraftStorageError(false);
      setRecoverableDraft(null);
      setPendingCreationSnapshot(null);
      if (draftKey) withDraftStorage((storage) => storage.removeItem(draftKey));
      if (presentation === "dialog" && closeOnSave) onOpenChange(false);
    } catch (error) {
      if (!operation.isCurrent()) return;
      if (!queue && !creationReplay && error instanceof VimobAPIError && error.status >= 400 && error.status < 500 && ![408, 409].includes(error.status)) {
        setFormData({ ...payload, creationAttemptId: undefined });
        setPendingCreationSnapshot(null);
        if (draftKey) withDraftStorage((storage) => storage.removeItem(draftKey));
      }
      reportSaveError(error instanceof Error ? error.message : "Não foi possível salvar a fila. Seu rascunho foi mantido.");
    } finally {
      operation.finish();
    }
  };
  const handleSave = async () => {
    if (isBusy()) return;
    if (editorScopeKey !== draftKey) return;
    if (queue?.hasUnsupportedReentryBehavior) { toast.error("A política legada de reentrada não é suportada por este editor. Sua configuração foi preservada."); return; }
    if (hasUnreviewedCreation) {
      toast.error("Revise o pedido de criação anterior antes de iniciar outro.");
      return;
    }
    if (!queue && pendingCreationSnapshot) {
      if (buildEditorFingerprint(formData) !== buildEditorFingerprint(pendingCreationSnapshot)) {
        toast.error("Retome o pedido enviado para confirmar o resultado antes de alterar a nova fila.");
        return;
      }
      await submitQueueForm(pendingCreationSnapshot, true);
      return;
    }
    const scheduleError = queueScheduleError(formData.settings.operating_schedule, !queue);
    if (scheduleError) { toast.error(scheduleError); return; }
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
    if (!isValidDistributionQueueName(formData.name)) {
      toast.error("O nome da fila deve ter entre 2 e 120 caracteres.");
      return;
    }
    if (!hasValidQueueDestination(formData, queue)) {
      toast.error("Selecione o pipeline de destino e o estágio inicial.");
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
        return !canEditQueueMember(member, allowedUserIds, allowedTeamIds) && !isUnchangedQueueMember(member, member.id ? persistedMemberById.get(member.id) : undefined);
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
    const whatsappAutoReplyMessageLength = countDistributionQueueInputCharacters(rawWhatsAppAutoReplyMessage);
    const rawWhatsAppAutoReplyDelay =
      formData.settings.whatsapp_distribution_auto_reply_delay_seconds;
    if (autoReplyError) {
      toast.error(autoReplyError);
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
    const hasValidCriteria = hasValidQueueCriteria(formData, queue);
    if (!hasValidCriteria) {
      toast.error(
        "Adicione pelo menos um criterio de entrada para salvar a fila",
      );
      return;
    }
    if (formData.is_active && !validMembers.some((member) => member.isActive !== false)) {
      toast.error("Adicione pelo menos um participante antes de ativar a fila");
      return;
    }
    if (formData.settings.enable_redistribution) {
      const timeout = formData.settings.redistribution_timeout_minutes ?? 20;
      const warning = queueWarningMinutes(timeout, formData.settings.redistribution_warning_minutes);
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
      const eligibleUserCount = queueRedistributionCapacity(
        validMembers,
        queue,
        visibleTeams,
        visibleUsers.map((user) => user.id),
        hasTeamRestriction || hasUserRestriction,
      );
      if (!hasQueueRedistributionCapacity(formData.settings, eligibleUserCount)) {
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
      ignore_availability: formData.settings.operating_schedule ? false : formData.settings.ignore_availability,
      redistribution_warning_minutes: queueWarningMinutes(formData.settings.redistribution_timeout_minutes ?? 20, formData.settings.redistribution_warning_minutes),
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
      creationAttemptId: queue ? undefined : formData.creationAttemptId || createUUID(),
      settings: sanitizedHasWhatsAppMessageCondition
        ? {
            ...sanitizedSettings,
            // Check-in has no canonical eligibility implementation yet. Keep
            // managed WhatsApp queues explicit instead of persisting a no-op.
            require_checkin: false,
          }
        : {
            ...sanitizedSettings,
            ignore_availability: formData.settings.operating_schedule ? false : queue?.settings?.ignore_availability,
            whatsapp_distribution_auto_reply_enabled: false,
          },
      conditions: sanitizedConditions,
      members: validMembers,
      ...queueSnapshotPreservation({ ...formData, conditions: sanitizedConditions, members: validMembers }, queue),
    };
    await submitQueueForm(payload, Boolean(formData.creationAttemptId));
  };
  const hasValidCriteria = hasValidQueueCriteria(formData, queue);
  const hasValidDestination = hasValidQueueDestination(formData, queue);
  const hasValidSchedule = queueScheduleError(formData.settings.operating_schedule, !queue) === null;
  const hasRequiredMembers = !formData.is_active || formData.members.some((member) => member.isActive !== false);
  const hasRedistributionCapacity = hasQueueRedistributionCapacity(formData.settings, eligibleRedistributionUserCount);
  const hasUnsavedChanges =
    buildEditorFingerprint(formData) !== savedFingerprint;
  const hasUnreviewedCreation = !queue && (createReviewRequired || Boolean(recoverableDraft?.creationAttemptId));
  const reloadQueue = async () => {
    if (!onReload) return;
    const operation = beginOperation();
    if (!operation) return;
    try {
      const current = await onReload();
      if (!operation.isCurrent()) return;
      const data = hydrateDistributionQueueFormData(current, teams);
      setFormData(data);
      setSavedFingerprint(buildEditorFingerprint(data));
      setSaveError(null);
      setDraftStorageError(false);
      setRecoverableDraft(null);
      if (draftKey) withDraftStorage((storage) => storage.removeItem(draftKey));
    } catch (error) {
      if (!operation.isCurrent()) return;
      reportSaveError(error instanceof Error ? error.message : "Não foi possível carregar a versão atual. Seu rascunho foi mantido.");
    } finally {
      operation.finish();
    }
  };
  useEffect(() => {
    if (!open || !draftKey) return;
    const recovered = withDraftStorage((storage) => readDistributionDraftRecovery(storage, draftKey));
    // Synchronize the external session draft when the editor scope opens or changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecoverableDraft(recovered?.status === "ready" ? recovered.form : null);
    setCreateReviewRequired(recovered?.status === "review_required");
  }, [open, draftKey, queue?.revision]);
  useEffect(() => {
    if (!open || !draftKey || !hasUnsavedChanges || editorScopeKey !== draftKey) return;
    if (!hasUnreviewedCreation && !pendingCreationSnapshot) {
      const preserved = withDraftStorage((storage) => saveDistributionDraft(storage, draftKey, formData));
      // Report an external storage failure; saving still validates on the server.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftStorageError(preserved !== true);
    }
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const beforeLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.href === window.location.href) return;
      const preserved = withDraftStorage((storage) => saveDistributionNavigationDraft(storage, draftKey, formData, { hasUnreviewedCreation, pendingCreationSnapshot }));
      setDraftStorageError(preserved !== true);
      if (window.confirm(preserved === true
        ? !queue && (hasUnreviewedCreation || pendingCreationSnapshot)
          ? "Há um pedido de criação sem confirmação. Deseja sair? A tentativa anterior será preservada; alterações posteriores ainda não foram enviadas."
          : "Há alterações não salvas nesta fila. Deseja sair? O rascunho ficará disponível nesta sessão."
        : "Há alterações não salvas nesta fila e o navegador não conseguiu guardar o rascunho. Deseja sair e perder essas alterações?")) return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", beforeLink, true); };
  }, [open, draftKey, formData, hasUnsavedChanges, hasUnreviewedCreation, pendingCreationSnapshot, editorScopeKey, queue]);
  const canReplayCreation = !queue && Boolean(pendingCreationSnapshot) &&
    buildEditorFingerprint(formData) === buildEditorFingerprint(pendingCreationSnapshot || formData) &&
    !hasUnreviewedCreation && !saving && editorScopeKey === draftKey;
  const canSave = canReplayCreation || (
    editorScopeKey === draftKey &&
    !queue?.hasUnsupportedReentryBehavior &&
    (!pendingCreationSnapshot || buildEditorFingerprint(formData) === buildEditorFingerprint(pendingCreationSnapshot)) &&
    isValidDistributionQueueName(formData.name) &&
    hasValidDestination &&
    hasValidSchedule &&
    !autoReplyError &&
    hasValidCriteria &&
    hasRequiredMembers &&
    hasRedistributionCapacity &&
    hasUnsavedChanges &&
    !hasUnreviewedCreation &&
    !blockingReferenceDataError &&
    !blockingReferenceDataLoading &&
    (!queue?.revision || queue.revision === formData.expectedRevision) &&
    !saving);

  const steps = [
    { id: "basic", label: "Nome e destino", icon: Settings2 },
    { id: "rules", label: "Critérios de entrada", icon: Filter },
    { id: "members", label: "Participantes", icon: UsersRound },
    { id: "schedule", label: "Horário da fila", icon: Settings2 },
    { id: "auto-tags", label: "Tags automáticas", icon: Tags },
    { id: "redistribution", label: "Redistribuição", icon: RefreshCw },
    ...(hasWhatsAppMessageCondition ? [{ id: "whatsapp-auto-reply", label: "Resposta no WhatsApp", icon: MessageSquare }] : []),
    { id: "review", label: "Revisão", icon: Check },
  ];
  const displayedStep = steps.some((step) => step.id === activeStep) ? activeStep : "rules";
  const activeStepIndex = steps.findIndex((step) => step.id === displayedStep);
  const closeEditor = () => {
    if (isBusy()) return;
    if (hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    onOpenChange(false);
  };
  const advanceStep = () => {
    if (isBusy()) return;
    if (displayedStep === "basic" && (!isValidDistributionQueueName(formData.name) || !hasValidDestination)) {
      toast.error("Preencha o nome, o pipeline de destino e o estágio inicial.");
      return;
    }
    if (displayedStep === "rules" && !hasValidCriteria) {
      toast.error("Adicione pelo menos um critério de entrada preenchido.");
      return;
    }
    if (displayedStep === "schedule" && !hasValidSchedule) {
      toast.error(queueScheduleError(formData.settings.operating_schedule, !queue));
      return;
    }
    if (displayedStep === "members" && !hasRequiredMembers) {
      toast.error("Adicione pelo menos um participante antes de ativar a fila.");
      return;
    }
    if (displayedStep === "redistribution" && !hasRedistributionCapacity) {
      toast.error("A redistribuição automática precisa de pelo menos dois corretores ativos.");
      return;
    }
    if (displayedStep === "whatsapp-auto-reply" && autoReplyError) {
      toast.error(autoReplyError);
      return;
    }
    const nextStep = steps[activeStepIndex + 1];
    if (nextStep) setActiveStep(nextStep.id);
  };
  const criteriaPreview = formData.conditions.map((condition) => ({
    id: condition.id,
    label: DISTRIBUTION_QUEUE_CONDITION_TYPES.find((option) => option.value === condition.type)?.label || "Critério",
    values: condition.values.map((value) => {
      if (condition.type === "source") return DISTRIBUTION_QUEUE_SOURCE_OPTIONS.find((option) => option.value === value)?.label || value;
      if (condition.type === "website_category") return DISTRIBUTION_QUEUE_WEBSITE_CATEGORY_OPTIONS.find((option) => option.value === value)?.label || value;
      if (condition.type === "meta_form") return metaFormConfigs.find((form) => form.config_id === value || form.form_id === value)?.form_name || "Formulário selecionado";
      if (condition.type === "whatsapp_session") {
        const session = whatsappSessions.find((candidate) => candidate.id === value);
        return session?.display_name || session?.instance_name || "Conexão selecionada";
      }
      if (condition.type === "webhook") return incomingWebhooks.find((webhook) => webhook.id === value)?.name || "Webhook selecionado";
      if (condition.type === "tag") return tags.find((tag) => tag.id === value)?.name || "Tag selecionada";
      if (condition.type === "interest_property") return properties.find((property) => property.id === value)?.title || "Imóvel selecionado";
      return value;
    }),
  }));
  const draftPreview = (
    <DistributionQueueCreationPreview
      formData={formData}
      pipelineName={visiblePipelines.find((pipeline) => pipeline.id === formData.target_pipeline_id)?.name}
      stageName={stages.find((stage) => stage.id === formData.target_stage_id)?.name}
      criteria={criteriaPreview}
      tagNames={selectedAutoTagIds.map((id) => tags.find((tag) => tag.id === id)?.name || "Tag selecionada")}
      teamMembersById={Object.fromEntries(visibleTeams.map((team) => [
        team.id,
        (team.members || []).flatMap((member) => {
          const user = visibleUsers.find((candidate) => candidate.id === member.user_id);
          return user ? [user.name] : [];
        }),
      ]))}
    />
  );
  const editorTitle = queue ? "Editar fila de distribuição" : "Nova fila de distribuição";
  const editorAlerts = (
    <>
      {draftStorageError && <p role="alert" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px]">Não foi possível guardar o rascunho neste navegador. Mantenha esta janela aberta até salvar; sair ou recarregar pode perder as alterações.</p>}
      {queue?.hasUnsupportedReentryBehavior && <p role="alert" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px]">A política legada de reentrada não é suportada por este editor. A fila está disponível para consulta e sua configuração foi preservada.</p>}
      {(saveError || (queue?.revision && queue.revision !== formData.expectedRevision)) && (
        <div ref={saveErrorRef} role="alert" className="rounded-[6px] bg-destructive/10 p-3 text-[12px] font-light text-destructive">
          <p key={saveError?.occurrence ?? "revision-conflict"}>{saveError?.message ?? "A configuração desta fila foi atualizada. Seu rascunho foi mantido."}</p>
          {onReload && <Button type="button" variant="ghost" disabled={saving} className="mt-2 h-8 text-[12px]" onClick={() => void reloadQueue()}>Descartar rascunho e carregar versão atual</Button>}
        </div>
      )}
      {recoverableDraft && (
        <div role="status" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light">
          {!queue && recoverableDraft.creationAttemptId ? "Há um pedido de criação sem confirmação. Restaure para reenviar a mesma tentativa ou confira a lista de filas antes de descartá-lo." : recoverableDraft.expectedRevision !== queue?.revision ? "Há um rascunho de uma versão anterior. Você pode revisá-lo; carregar a versão atual será necessário antes de salvar." : "Há um rascunho não salvo desta fila nesta sessão."}
          <Button type="button" variant="ghost" disabled={saving} className="ml-2 h-8 text-[12px]" onClick={() => { if (isBusy()) return; updateDraft(recoverableDraft); setPendingCreationSnapshot(!queue && recoverableDraft.creationAttemptId ? recoverableDraft : null); setRecoverableDraft(null); }}>Restaurar rascunho</Button>
          <Button type="button" variant="ghost" disabled={saving} className="h-8 text-[12px]" onClick={() => { if (isBusy()) return; setRecoverableDraft(null); if (draftKey) withDraftStorage((storage) => storage.removeItem(draftKey)); }}>{!queue && recoverableDraft.creationAttemptId ? "Conferi a lista e quero descartar o pedido anterior" : "Descartar"}</Button>
        </div>
      )}
      {!queue && pendingCreationSnapshot && buildEditorFingerprint(formData) !== buildEditorFingerprint(pendingCreationSnapshot) && (
        <div role="status" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light">
          Confirme o resultado do pedido já enviado antes de mudar sua configuração.
          <Button type="button" variant="ghost" disabled={saving} className="ml-2 h-8 text-[12px]" onClick={() => updateDraft(pendingCreationSnapshot)}>Retomar pedido enviado</Button>
        </div>
      )}
      {createReviewRequired && (
        <div role="alert" className="rounded-[6px] bg-[var(--app-surface-soft)] p-3 text-[12px] font-light">
          <p>Não foi possível recuperar com segurança a última tentativa de criação. Confira as filas existentes antes de iniciar uma nova criação.</p>
          <a className="mr-2 inline-flex h-8 items-center text-primary underline" href="/crm/management?tab=distribution">Ver filas existentes</a>
          <Button type="button" variant="ghost" disabled={saving} className="h-8 text-[12px]" onClick={() => { if (isBusy()) return; setCreateReviewRequired(false); setPendingCreationSnapshot(null); updateDraft((current) => ({ ...current, creationAttemptId: undefined })); if (draftKey) withDraftStorage((storage) => storage.removeItem(draftKey)); }}>Conferi a lista e quero iniciar uma nova criação</Button>
        </div>
      )}
    </>
  );
  const editorBody = (
    <>
      <FormWizardLayout
        focusContentOnStepChange
        steps={steps.map((step) => ({
          ...step,
          disabled: saving,
          buttonId: `${wizardId}-${step.id}-tab`,
          panelId: `${wizardId}-${step.id}-panel`,
          tourId: `distribution-queue-step-${step.id}`,
        }))}
        activeStep={displayedStep}
        onStepChange={(step) => { if (!isBusy()) setActiveStep(step); }}
        aside={aside ?? draftPreview}
        asideTitle={aside ? undefined : "Prévia da distribuição"}
        asideContentClassName={aside ? "flex min-h-[360px] flex-col" : undefined}
        footer={(
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
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
              : autoReplyError
                ? autoReplyError
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
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}
              onClick={activeStepIndex > 0 ? () => setActiveStep(steps[activeStepIndex - 1].id) : closeEditor}
              disabled={saving}
            >
              {activeStepIndex > 0 ? <><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Voltar</> : "Cancelar"}
            </Button>
            {displayedStep !== "review" ? (
              <Button type="button" onClick={advanceStep} disabled={saving} className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME}>
                Avançar <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
            <Button
              type="button"
              data-tour="distribution-queue-save"
              className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME}
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
            )}
          </div>
        </div>
        )}
      >
        <div
          id={`${wizardId}-${displayedStep}-panel`}
          role="tabpanel"
          aria-labelledby={`${wizardId}-${displayedStep}-tab`}
          tabIndex={0}
          className="space-y-4 focus-visible:outline-none [&_input]:rounded-[6px] [&_label]:text-[12px] [&_label]:font-light"
        >
          <fieldset disabled={saving} aria-label="Configuração da distribuição" className="m-0 min-w-0 space-y-4 border-0 p-0">
          {editorAlerts}
          {summary}
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
          {displayedStep === "basic" && (
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
                updateDraft((previous) => ({ ...previous, name }))
              }
              onStrategyChange={(strategy) =>
                updateDraft((previous) => ({ ...previous, strategy }))
              }
              onPipelineChange={(targetPipelineId) =>
                updateDraft((previous) => ({
                  ...previous,
                  target_pipeline_id: targetPipelineId,
                  target_stage_id: "",
                }))
              }
              onStageChange={(targetStageId) =>
                updateDraft((previous) => ({
                  ...previous,
                  target_stage_id: targetStageId,
                }))
              }
            />
          )}
          {displayedStep === "rules" && (
            <DistributionQueueRulesSection
              open={openSections.includes("rules")}
              conditions={formData.conditions}
              availableConditionTypes={availableConditionTypes}
              hasWhatsAppMessageCondition={hasWhatsAppMessageCondition}
              hasValidCriteria={hasValidCriteria}
              ignoreAvailability={formData.settings.ignore_availability}
              managedSchedule={formData.settings.operating_schedule !== undefined}
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
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    ignore_availability: ignoreAvailability,
                  },
                }))
              }
            />
          )}
          {displayedStep === "members" && (
            <DistributionQueueMembersSection
              open={openSections.includes("members")}
              members={formData.members}
              canEditMember={(member) => canEditQueueMember(member, allowedUserIds, allowedTeamIds)}
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
              onReenroll={(memberKey) => updateDraft((previous) => ({ ...previous, members: previous.members.map((member) => queueMemberKey(member) === memberKey && canEditQueueMember(member, allowedUserIds, allowedTeamIds) ? { ...member, isActive: true, reenroll: true } : member) }))}
            />
          )}
          {displayedStep === "schedule" && (
            <DistributionQueueScheduleSection
              isLegacy={Boolean(queue)}
              schedule={formData.settings.operating_schedule}
              poolNotificationsEnabled={formData.settings.pool_notifications?.enabled === true}
              onPoolNotificationsChange={(enabled) => updateDraft((previous) => ({ ...previous, settings: { ...previous.settings, pool_notifications: { enabled } } }))}
              onChange={(schedule) => updateDraft((previous) => ({ ...previous, settings: { ...previous.settings, operating_schedule: schedule, ignore_availability: false } }))}
            />
          )}
          {displayedStep === "auto-tags" && (
            <DistributionQueueAutoTagsSection
              open={openSections.includes("auto-tags")}
              tags={tags}
              selectedTagIds={selectedAutoTagIds}
              tagsLoading={tagsLoading}
              tagsError={tagsError}
              onToggle={() => toggleSection("auto-tags")}
              onToggleTag={toggleAutoTag}
            />
          )}
          {displayedStep === "redistribution" && (
            <DistributionQueueRedistributionSection
              open={openSections.includes("redistribution")}
              settings={formData.settings}
              eligibleUserCount={eligibleRedistributionUserCount}
              managedSchedule={formData.settings.operating_schedule !== undefined}
              onToggle={() => toggleSection("redistribution")}
              onEnabledChange={(enableRedistribution) =>
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    enable_redistribution: enableRedistribution,
                    redistribution_timeout_minutes:
                      previous.settings.redistribution_timeout_minutes ?? 20,
                    redistribution_warning_minutes:
                      queueWarningMinutes(previous.settings.redistribution_timeout_minutes ?? 20, previous.settings.redistribution_warning_minutes),
                    redistribution_max_attempts:
                      previous.settings.redistribution_max_attempts ?? 10,
                  },
                }))
              }
              onTimeoutChange={(redistributionTimeoutMinutes) =>
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_timeout_minutes:
                      redistributionTimeoutMinutes,
                    redistribution_warning_minutes: queueWarningMinutes(redistributionTimeoutMinutes, previous.settings.redistribution_warning_minutes),
                  },
                }))
              }
              onWarningChange={(redistributionWarningMinutes) =>
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_warning_minutes:
                      queueWarningMinutes(previous.settings.redistribution_timeout_minutes ?? 20, redistributionWarningMinutes),
                  },
                }))
              }
              onMaxAttemptsChange={(redistributionMaxAttempts) =>
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    redistribution_max_attempts: redistributionMaxAttempts,
                  },
                }))
              }
              onReentryBehaviorChange={(reentryBehavior) =>
                updateDraft((previous) => ({
                  ...previous,
                  settings: {
                    ...previous.settings,
                    reentry_behavior: reentryBehavior,
                  },
                }))
              }
            />
          )}
          {displayedStep === "whatsapp-auto-reply" && hasWhatsAppMessageCondition && (
              <DistributionQueueWhatsAppAutoReplySection
                open={openSections.includes("whatsapp-auto-reply")}
                settings={formData.settings}
                onToggle={() => toggleSection("whatsapp-auto-reply")}
                onSettingsChange={(updates) =>
                  updateDraft((previous) => ({
                    ...previous,
                    settings: { ...previous.settings, ...updates },
                  }))
                }
              />
          )}
          {displayedStep === "review" && (
            <section className="space-y-3">
              <h2 className="text-[14px] font-normal">Revise a distribuição</h2>
              {draftPreview}
            </section>
          )}
          </fieldset>
        </div>
      </FormWizardLayout>
      <FormWizardDiscardDialog open={discardOpen} onOpenChange={setDiscardOpen} busy={saving} onConfirm={() => { if (draftKey && (queue || (!pendingCreationSnapshot && !hasUnreviewedCreation))) withDraftStorage((storage) => storage.removeItem(draftKey)); onOpenChange(false); }} />
    </>
  );

  if (presentation === "page") {
    return (
      <section
        data-management-editor="distribution"
        data-tour="distribution-queue-editor"
        className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]"
      >
        {editorBody}
      </section>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) closeEditor(); }}>
      <DialogContent
        data-management-editor="distribution"
        data-tour="distribution-queue-editor"
        className={FORM_WIZARD_DIALOG_CLASS_NAME}
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }}
        onInteractOutside={(event) => event.preventDefault()}
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
