"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clock3,
  Copy,
  CopyCheck,
  Crown,
  Loader2,
  RefreshCw,
  Save,
  ShieldX,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormWizardLayout } from "@/components/shared/forms/FormWizardLayout";
import { FormWizardDiscardDialog } from "@/components/shared/forms/FormWizardDiscardDialog";
import {
  FORM_WIZARD_DIALOG_CLASS_NAME,
  FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME,
  FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME,
} from "@/config/form-wizard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useTeamMembersAvailability } from "@/hooks/use-member-availability";
import { useOrganizationPresenceList } from "@/hooks/presence";
import {
  useCreateTeam,
  useTeam,
  useTeamEditorSnapshot,
  useReloadTeamEditor,
  useUpdateTeam,
} from "@/hooks/use-teams";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useUsers } from "@/hooks/use-users";
import {
  teamsAPI,
  type MemberAvailability,
  type Team,
  type CreateTeamInput,
} from "@/lib/api/teams";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { createUUID } from "@/lib/client-id";
import { getInitials } from "@/lib/user-display";
import { cn } from "@/lib/utils";
import { getVisibleTeamMemberIds, sameTeamMemberIds } from "@/lib/teams/team-editor-snapshot";
import { clearTeamCreateIntent, readTeamCreateIntent, saveTeamCreateIntent, teamCreateIntentKey, teamCreationErrorConfirmsNoResult, type StoredTeamCreateIntent, type TeamCreateIntent } from "@/lib/teams/team-create-intent";

import {
  DAYS_OF_WEEK,
  availabilityTimeOptions,
  availabilityWeekReviewReason,
  availabilityToWeek,
  createDefaultAvailabilityWeek,
  isValidAvailabilityWeek,
  toAvailabilityInput,
  type DaySchedule,
  type AvailabilityWeekReviewReason,
} from "./availability-week";
import { isAvailabilityClock } from "@/lib/teams/availability-clock";
import type { VimobAPIRequestIntent } from "@/lib/api/vimob-client";
import { assertManagementRequestIntent, captureManagementRequestIntent } from "@/lib/api/management-request";
import { TeamChangeHistory } from "./TeamChangeHistory";
import { TeamOperationalOverview } from "./TeamOperationalOverview";
import { TeamCreationPreview } from "@/components/features/teams/TeamCreationPreview";

type TeamEditorScreenProps =
  { mode: "create"; teamId?: never } | { mode: "edit"; teamId: string };

interface MemberSelection {
  userId: string;
  isLeader: boolean;
}

type ScheduleWarning = AvailabilityWeekReviewReason;

const MANAGEMENT_TEAMS_URL = "/crm/management?tab=teams";
const TEAM_EDITOR_PANEL_HEIGHT_CLASS = "h-[min(600px,62dvh)] min-h-[360px]";
const TEAM_EDITOR_LOADING_PANEL_HEIGHT_CLASS = "h-[600px]";
const TEAM_EDITOR_STEPS = [
  { id: "identity", label: "Identificação", icon: Camera },
  { id: "members", label: "Membros e liderança", icon: Users },
  { id: "schedule", label: "Escala de atendimento", icon: Clock3 },
  { id: "review", label: "Revisão", icon: Check },
];
type TeamEditorStep = "identity" | "members" | "schedule" | "review";

function clearConfirmedCreation(attempt: TeamCreateIntent) {
  try { clearTeamCreateIntent(window.sessionStorage, attempt.organizationId, attempt.userId); } catch { /* A confirmed response must not become an error because storage was disabled. */ }
}

function buildEditorFingerprint({
  name,
  logoUrl,
  isActive,
  members,
  weeksByUserId,
}: {
  name: string;
  logoUrl: string | null;
  isActive: boolean;
  members: MemberSelection[];
  weeksByUserId: Record<string, DaySchedule[]>;
}) {
  return JSON.stringify({
    name: name.trim(),
    logoUrl: logoUrl || null,
    isActive,
    members: [...members]
      .sort((left, right) => left.userId.localeCompare(right.userId))
      .map((member) => ({
        ...member,
        availability: [...(weeksByUserId[member.userId] || [])].sort(
          (left, right) => left.day_of_week - right.day_of_week,
        ),
      })),
  });
}

export default function TeamEditorScreen(props: TeamEditorScreenProps) {
  const isEditing = props.mode === "edit";
  const teamId = isEditing ? props.teamId : null;
  const title = isEditing ? "Editar equipe" : "Nova equipe";
  const router = useRouter();
  const wizardId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef<string | null>(null);
  const submitInFlightRef = useRef(false);
  const creationAttemptRef = useRef<TeamCreateIntent | null>(null);

  const { activeOrganization, profile } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const userId = profile?.id || null;
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  const organizationRef = useRef(organizationId);
  useEffect(() => { organizationRef.current = organizationId; }, [organizationId]);
  const currentTeamIdRef = useRef(teamId);
  const mountedRef = useRef(true);
  const submitOperationRef = useRef<AbortController | null>(null);
  const reloadOperationRef = useRef<AbortController | null>(null);
  useEffect(() => { currentTeamIdRef.current = teamId; }, [teamId]);
  useEffect(() => { mountedRef.current = true; return () => {
    mountedRef.current = false;
    submitOperationRef.current?.abort();
    reloadOperationRef.current?.abort();
  }; }, []);
  const access = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManageAllTeams =
    access.isAdmin || (!access.isTeamLeader && hasPermission("team_manage"));
  const canCheckCreationRecovery = !isEditing && Boolean(organizationId && userId) && hasPermission("team_manage");
  const canAccessEditor = isEditing
    ? canManageAllTeams ||
      (hasPermission("team_manage") && access.isTeamLeader && access.ledTeamIds.includes(props.teamId))
    : canManageAllTeams || canCheckCreationRecovery;

  const editorSnapshotQuery = useTeamEditorSnapshot(teamId, {
    enabled: isEditing && canAccessEditor,
  });
  const teamQuery = useTeam(teamId, {
    enabled: isEditing && canAccessEditor && editorSnapshotQuery.isSuccess,
  });
  const usersQuery = useUsers({ enabled: canAccessEditor && (isEditing || canManageAllTeams) });
  const team = teamQuery.data;
  const teamMemberIds = useMemo(
    () => team?.members?.map((member) => member.id) || [],
    [team?.members],
  );
  const availabilityQuery = useTeamMembersAvailability(teamMemberIds);
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();
  const reloadTeamEditor = useReloadTeamEditor();

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [selectedMembers, setSelectedMembers] = useState<MemberSelection[]>([]);
  const [weeksByUserId, setWeeksByUserId] = useState<
    Record<string, DaySchedule[]>
  >({});
  const [warningByUserId, setWarningByUserId] = useState<
    Record<string, ScheduleWarning>
  >({});
  const [confirmedWarnings, setConfirmedWarnings] = useState<Set<string>>(
    new Set(),
  );
  const [activeScheduleUserId, setActiveScheduleUserId] = useState<
    string | null
  >(null);
  const [activeStep, setActiveStep] = useState<TeamEditorStep>("identity");
  const [discardOpen, setDiscardOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [saveConflict, setSaveConflict] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [baseMemberIds, setBaseMemberIds] = useState<string[] | null>(null);
  const [pendingCreation, setPendingCreation] = useState(false);
  const [recoverableCreation, setRecoverableCreation] = useState<StoredTeamCreateIntent | { status: "storage_unavailable" } | null>(null);

  const activeUsers = useMemo(
    () =>
      (usersQuery.data || []).filter(
        (user) => user.is_active !== false && Boolean(user.id),
      ),
    [usersQuery.data],
  );
  const activeUserIds = useMemo(
    () => new Set(activeUsers.map((user) => user.id)),
    [activeUsers],
  );
  const presenceQuery = useOrganizationPresenceList({
    enabled: canAccessEditor && activeUsers.length > 0,
  });
  const presenceByUserId = useMemo(
    () =>
      new Map(
        (presenceQuery.data?.users || []).map((presence) => [
          presence.user_id,
          presence,
        ]),
      ),
    [presenceQuery.data?.users],
  );
  const selectedUserIds = useMemo(
    () => new Set(selectedMembers.map((member) => member.userId)),
    [selectedMembers],
  );

  useEffect(() => {
    if (!logoFile) return;
    const objectUrl = URL.createObjectURL(logoFile);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLogoPreview(objectUrl);
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [logoFile]);

  const hydrateTeamEditor = useCallback((
    currentTeam: Team,
    availability: MemberAvailability[],
  ) => {
    submitInFlightRef.current = false;
    setIsSubmitting(false);
    setIsReloading(false);
    const weeks: Record<string, DaySchedule[]> = {};
    const warnings: Record<string, ScheduleWarning> = {};
    for (const member of currentTeam.members || []) {
      const saved = availability.filter(
        (entry) => entry.team_member_id === member.id,
      );
      weeks[member.user_id] = availabilityToWeek(saved);
      const reviewReason = availabilityWeekReviewReason(saved);
      if (reviewReason) warnings[member.user_id] = reviewReason;
    }
    const members = (currentTeam.members || []).map((member) => ({
      userId: member.user_id,
      isLeader: member.is_leader || false,
    }));

    setName(currentTeam.name);
    setLogoUrl(currentTeam.logo_url || null);
    setLogoFile(null);
    setLogoPreview(null);
    setIsActive(currentTeam.is_active !== false);
    setSelectedMembers(members);
    setWeeksByUserId(weeks);
    setWarningByUserId(warnings);
    setConfirmedWarnings(new Set());
    setActiveScheduleUserId(currentTeam.members?.[0]?.user_id || null);
    setSavedFingerprint(
      buildEditorFingerprint({
        name: currentTeam.name,
        logoUrl: currentTeam.logo_url || null,
        isActive: currentTeam.is_active !== false,
        members,
        weeksByUserId: weeks,
      }),
    );
    setBaseRevision(currentTeam.revision);
    setBaseMemberIds(getVisibleTeamMemberIds(currentTeam));
    setSaveConflict(false);
    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!canAccessEditor) return;
    if (!isEditing) {
      const key = `create:${organizationId || "pending"}:${userId || "pending"}`;
      if (initializedRef.current === key) return;
      initializedRef.current = key;
      creationAttemptRef.current = null;
      setPendingCreation(false);
      try {
        // Synchronize the external session-storage snapshot only when this
        // principal's create scope opens; React state is not its source.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRecoverableCreation(organizationId && userId ? readTeamCreateIntent(window.sessionStorage, organizationId, userId) : null);
      }
      catch { setRecoverableCreation({ status: "storage_unavailable" }); }
      submitInFlightRef.current = false;
      setIsSubmitting(false);
      setIsReloading(false);
      setActiveStep("identity");
      setName("");
      setLogoUrl(null);
      setLogoFile(null);
      setIsActive(true);
      setSelectedMembers([]);
      setWeeksByUserId({});
      setWarningByUserId({});
      setConfirmedWarnings(new Set());
      setActiveScheduleUserId(null);
      setBaseRevision(null);
      setBaseMemberIds(null);
      setSaveConflict(false);
      setSavedFingerprint(
        buildEditorFingerprint({
          name: "",
          logoUrl: null,
          isActive: true,
          members: [],
          weeksByUserId: {},
        }),
      );
      setIsInitialized(true);
      return;
    }

    const snapshot = editorSnapshotQuery.data;
    if (!snapshot || editorSnapshotQuery.isFetching) return;
    const key = `edit:${organizationId}:${snapshot.team.id}`;
    if (initializedRef.current === key) return;
    initializedRef.current = key;
    hydrateTeamEditor(snapshot.team, snapshot.availability);
  }, [
    canAccessEditor,
    editorSnapshotQuery.data,
    editorSnapshotQuery.isFetching,
    hydrateTeamEditor,
    isEditing,
    organizationId,
    userId,
  ]);

  const isLoading =
    permissionsLoading ||
    access.isLoading ||
    (canCheckCreationRecovery && !isInitialized) ||
    (canAccessEditor && usersQuery.isLoading) ||
    (isEditing && editorSnapshotQuery.isLoading) ||
    (isEditing && !isInitialized && editorSnapshotQuery.isFetching) ||
    (isEditing && teamQuery.isLoading) ||
    (isEditing && teamMemberIds.length > 0 && availabilityQuery.isLoading);
  const accessScopeError =
    access.isError && !access.hasTenantTeamScope && !canManageAllTeams
      ? access.error
      : null;
  const queryError =
    (editorSnapshotQuery.data === undefined ? editorSnapshotQuery.error : null) ||
    (teamQuery.data === undefined ? teamQuery.error : null) ||
    (usersQuery.data === undefined ? usersQuery.error : null) ||
    (availabilityQuery.data === undefined ? availabilityQuery.error : null);
  const hasStaleEditorData = Boolean(
    (access.isError && (access.hasTenantTeamScope || canManageAllTeams)) ||
    (editorSnapshotQuery.isError && editorSnapshotQuery.data !== undefined) ||
    (teamQuery.isError && teamQuery.data !== undefined) ||
    (usersQuery.isError && usersQuery.data !== undefined) ||
    (availabilityQuery.isError && availabilityQuery.data !== undefined),
  );

  const savedMemberByUserId = useMemo(
    () =>
      new Map((team?.members || []).map((member) => [member.user_id, member])),
    [team?.members],
  );
  const selectedScheduleUsers = activeUsers.filter((user) =>
    selectedUserIds.has(user.id),
  );
  const activeScheduleUser =
    activeUsers.find((user) => user.id === activeScheduleUserId) ||
    selectedScheduleUsers[0];
  const activeScheduleSelection = activeScheduleUser
    ? selectedMembers.find((member) => member.userId === activeScheduleUser.id)
    : undefined;
  const activeWeek = activeScheduleUser
    ? weeksByUserId[activeScheduleUser.id]
    : undefined;

  const unresolvedWarnings = Object.keys(warningByUserId).filter(
    (userId) => selectedUserIds.has(userId) && !confirmedWarnings.has(userId),
  );
  const allWeeksValid = selectedMembers.every((member) =>
    isValidAvailabilityWeek(weeksByUserId[member.userId] || []),
  );
  const editorFingerprint = buildEditorFingerprint({
    name,
    logoUrl,
    isActive,
    members: selectedMembers,
    weeksByUserId,
  });
  const hasUnsavedChanges =
    Boolean(logoFile) ||
    editorFingerprint !== savedFingerprint ||
    Object.keys(warningByUserId).some(
      (userId) => selectedUserIds.has(userId) && confirmedWarnings.has(userId),
    );
  const hasRevisionConflict =
    saveConflict ||
    Boolean(
      isEditing &&
        team &&
        baseRevision !== null &&
        (team.revision !== baseRevision ||
          (baseMemberIds !== null &&
            !sameTeamMemberIds(getVisibleTeamMemberIds(team), baseMemberIds))),
    );
  const canSubmit = !recoverableCreation && ((pendingCreation && canAccessEditor && !isSubmitting && !isReloading) || (
    isInitialized &&
    (isEditing || canManageAllTeams) &&
    (!isEditing || (baseRevision !== null && baseMemberIds !== null)) &&
    Boolean(name.trim()) &&
    allWeeksValid &&
    unresolvedWarnings.length === 0 &&
    hasUnsavedChanges &&
    !hasRevisionConflict &&
    !hasStaleEditorData &&
    !isSubmitting &&
    !isReloading));

  const closeEditor = () => {
    if (isSubmitting || isReloading) return;
    if (pendingCreation || recoverableCreation) { router.push(MANAGEMENT_TEAMS_URL); return; }
    if (isInitialized && hasUnsavedChanges) {
      setDiscardOpen(true);
      return;
    }
    router.push(MANAGEMENT_TEAMS_URL);
  };
  const restoreCreationAttempt = () => {
    if (recoverableCreation?.status !== "ready") return;
    const attempt = recoverableCreation.intent;
    if (attempt.organizationId !== organizationId || attempt.userId !== userId) return;
    const members = (attempt.input.members || []).map((member) => ({ userId: member.userId, isLeader: member.isLeader || false }));
    setName(attempt.input.name);
    setLogoUrl(attempt.input.logo_url || null);
    setLogoFile(null);
    setLogoPreview(null);
    setIsActive(attempt.input.is_active !== false);
    setSelectedMembers(members);
    setWeeksByUserId(Object.fromEntries((attempt.input.members || []).map((member) => [member.userId, availabilityToWeek(member.availability || [])])));
    setWarningByUserId({});
    setConfirmedWarnings(new Set());
    setActiveScheduleUserId(members[0]?.userId || null);
    creationAttemptRef.current = attempt;
    setPendingCreation(true);
    setRecoverableCreation(null);
    setActiveStep("review");
  };
  const acknowledgeExpiredCreation = () => {
    if (recoverableCreation?.status !== "review_required" || !organizationId || !userId) return;
    try {
      const key = teamCreateIntentKey(organizationId, userId)!;
      window.sessionStorage.removeItem(key);
      if (window.sessionStorage.getItem(key) !== null) throw new Error("Storage did not clear the prior attempt");
      setRecoverableCreation(null);
    } catch { toast.error("O armazenamento da sessão continua indisponível."); }
  };
  const activeStepIndex = TEAM_EDITOR_STEPS.findIndex((step) => step.id === activeStep);
  const advanceStep = () => {
    if (activeStep === "identity" && !name.trim()) {
      toast.error("Preencha o nome da equipe.");
      return;
    }
    if (activeStep === "schedule" && (!allWeeksValid || unresolvedWarnings.length > 0)) {
      toast.error("Revise os sete dias da escala de cada membro e confirme as escalas sinalizadas.");
      return;
    }
    const nextStep = TEAM_EDITOR_STEPS[activeStepIndex + 1];
    if (nextStep) setActiveStep(nextStep.id as TeamEditorStep);
  };

  const toggleMember = (userId: string) => {
    const savedMember = savedMemberByUserId.get(userId);
    if (!canManageAllTeams && savedMember?.is_leader) return;

    setSelectedMembers((current) => {
      const exists = current.some((member) => member.userId === userId);
      if (exists) return current.filter((member) => member.userId !== userId);
      return [...current, { userId, isLeader: false }];
    });
    if (!weeksByUserId[userId]) {
      setWeeksByUserId((current) => ({
        ...current,
        [userId]: createDefaultAvailabilityWeek(),
      }));
    }
    setActiveScheduleUserId(userId);
  };

  const toggleLeader = (userId: string) => {
    if (!canManageAllTeams) return;
    setSelectedMembers((current) =>
      current.map((member) =>
        member.userId === userId
          ? { ...member, isLeader: !member.isLeader }
          : member,
      ),
    );
  };

  const updateSchedule = (
    userId: string,
    dayOfWeek: number,
    update: Partial<DaySchedule>,
  ) => {
    setWeeksByUserId((current) => ({
      ...current,
      [userId]: (current[userId] || createDefaultAvailabilityWeek()).map(
        (entry) =>
          entry.day_of_week === dayOfWeek ? { ...entry, ...update } : entry,
      ),
    }));
  };

  const applyScheduleToAllDays = (userId: string, sourceDayOfWeek: number) => {
    setWeeksByUserId((current) => {
      const week = current[userId] || createDefaultAvailabilityWeek();
      const source = week.find((entry) => entry.day_of_week === sourceDayOfWeek);
      if (!source) return current;
      return {
        ...current,
        [userId]: week.map((entry) =>
          entry.is_active
            ? {
                ...entry,
                is_all_day: source.is_all_day,
                start_time: source.start_time,
                end_time: source.end_time,
              }
            : entry,
        ),
      };
    });
  };

  const applyScheduleToAllMembers = (sourceUserId: string) => {
    setWeeksByUserId((current) => {
      const sourceWeek = current[sourceUserId];
      if (!sourceWeek) return current;
      const next: typeof current = { ...current };
      selectedMembers.forEach((member) => {
        if (member.userId === sourceUserId) return;
        next[member.userId] = sourceWeek.map((entry) => ({ ...entry }));
      });
      return next;
    });
  };

  const confirmScheduleWarning = (userId: string, checked: boolean) => {
    setConfirmedWarnings((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const uploadLogo = async (intent: VimobAPIRequestIntent) => {
    if (!canManageAllTeams || !logoFile) return logoUrl;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(logoFile.type)) {
      throw new Error("Use uma imagem JPG, PNG, WEBP ou GIF.");
    }
    if (logoFile.size > 5 * 1024 * 1024) {
      throw new Error("A logo deve ter no máximo 5 MB.");
    }
    return teamsAPI.uploadLogo(logoFile, organizationId, intent);
  };

  const handleLoadCurrentVersion = async () => {
    if (!isEditing || !team || isReloading) return;
    setIsReloading(true);
    const controller = new AbortController();
    reloadOperationRef.current = controller;
    const intent = captureManagementRequestIntent(controller.signal);
    try {
      const current = await reloadTeamEditor(team.id, intent);
      controller.signal.throwIfAborted();
      assertManagementRequestIntent(intent);
      if (!mountedRef.current || organizationRef.current !== organizationId || currentTeamIdRef.current !== teamId) return;
      if (!current) throw new Error("Não foi possível carregar a versão atual da equipe.");
      initializedRef.current = `edit:${organizationId}:${current.team.id}`;
      hydrateTeamEditor(current.team, current.availability);
      void usersQuery.refetch();
    } catch (error) {
      if (!mountedRef.current || organizationRef.current !== organizationId || currentTeamIdRef.current !== teamId || controller.signal.aborted) return;
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a versão atual da equipe.",
      );
    } finally {
      if (reloadOperationRef.current === controller) reloadOperationRef.current = null;
      if (mountedRef.current && organizationRef.current === organizationId && currentTeamIdRef.current === teamId) setIsReloading(false);
    }
  };

  const handleSubmit = async () => {
    if (!organizationId) return;
    if (!isEditing && !userId) return;
    if (submitInFlightRef.current) return;
    if (!canSubmit) {
      if (hasRevisionConflict) {
        toast.error("Carregue a versão atual da equipe antes de salvar.");
      } else if (unresolvedWarnings.length > 0) {
        toast.error(
          "Confirme a regularização das escalas antigas antes de salvar.",
        );
      } else {
        toast.error("Revise o nome e os sete dias da escala de cada membro.");
      }
      return;
    }

    submitInFlightRef.current = true;
    setIsSubmitting(true);
    const submittedOrganizationId = organizationId;
    const submittedUserId = userId;
    const controller = new AbortController();
    submitOperationRef.current = controller;
    const intent = captureManagementRequestIntent(controller.signal);
    const assertCurrentIntent = () => { controller.signal.throwIfAborted(); assertManagementRequestIntent(intent); };
    const isCreationReplay = !isEditing && Boolean(creationAttemptRef.current);
    const isCurrentSubmission = () => mountedRef.current && organizationRef.current === submittedOrganizationId && userIdRef.current === submittedUserId && currentTeamIdRef.current === teamId;
    try {
      if (!isEditing && creationAttemptRef.current) {
        const attempt = creationAttemptRef.current;
        await createTeam.mutateAsync({ ...attempt, intent });
        assertCurrentIntent();
        clearConfirmedCreation(attempt);
        if (isCurrentSubmission()) {
          creationAttemptRef.current = null;
          setPendingCreation(false);
          router.push(MANAGEMENT_TEAMS_URL);
        }
        return;
      }
      if (isEditing && logoFile && baseRevision !== null && baseMemberIds !== null) {
        const fresh = await teamQuery.refetch();
        assertCurrentIntent();
        if (!isCurrentSubmission()) return;
        if (fresh.isError) throw fresh.error;
        if (
          !fresh.data ||
          fresh.data.revision !== baseRevision ||
          !sameTeamMemberIds(getVisibleTeamMemberIds(fresh.data), baseMemberIds)
        ) {
          setSaveConflict(true);
          toast.error("A equipe mudou em outra sessão. Suas alterações foram preservadas.");
          return;
        }
      }
      assertCurrentIntent();
      const finalLogoUrl = await uploadLogo(intent);
      assertCurrentIntent();
      if (!isCurrentSubmission()) return;
      if (logoFile && finalLogoUrl) {
        // Keep a successful upload for retry after a transient mutation error.
        setLogoUrl(finalLogoUrl);
        setLogoFile(null);
        setLogoPreview(null);
      }
      const validMembers = selectedMembers.filter((member) =>
        activeUserIds.has(member.userId),
      );
      if (validMembers.length !== selectedMembers.length) {
        toast.info("Membros inativos foram removidos antes de salvar.");
      }
      const members = validMembers.map((member) => ({
        ...member,
        availability: toAvailabilityInput(weeksByUserId[member.userId]),
      }));

      if (isEditing) {
        if (!team || baseRevision === null || baseMemberIds === null) {
          throw new Error("Não foi possível confirmar a versão atual da equipe.");
        }
        const updatedTeam = await updateTeam.mutateAsync({
          organizationId,
          intent,
          id: team.id,
          expected_revision: baseRevision,
          expected_member_ids: baseMemberIds,
          members,
          preserveLeadership: !canManageAllTeams,
          ...(canManageAllTeams
            ? {
                name: name.trim(),
                logo_url: finalLogoUrl || null,
                is_active: isActive,
              }
            : {}),
        });
        assertCurrentIntent();
        if (!isCurrentSubmission()) return;
        const savedLogoUrl = updatedTeam.logo_url || finalLogoUrl || null;
        setSavedFingerprint(
          buildEditorFingerprint({
            name,
            logoUrl: savedLogoUrl,
            isActive,
            members: validMembers,
            weeksByUserId,
          }),
        );
        setSelectedMembers(validMembers);
        setBaseRevision(updatedTeam.revision);
        setBaseMemberIds(getVisibleTeamMemberIds(updatedTeam));
        setSaveConflict(false);
        setLogoUrl(savedLogoUrl);
        setLogoFile(null);
        setLogoPreview(null);
        setWarningByUserId({});
        setConfirmedWarnings(new Set());
      } else {
        const input: CreateTeamInput = {
          name: name.trim(),
          logo_url: finalLogoUrl || null,
          is_active: true,
          members,
        };
        const attempt: TeamCreateIntent = { input, idempotencyKey: createUUID(), organizationId, userId: userId! };
        if (!saveTeamCreateIntent(window.sessionStorage, attempt)) throw new Error("Não foi possível preservar a tentativa neste navegador. Libere o armazenamento da sessão antes de criar a equipe.");
        creationAttemptRef.current = attempt;
        setPendingCreation(true);
        await createTeam.mutateAsync({ ...attempt, intent });
        assertCurrentIntent();
        clearConfirmedCreation(attempt);
        if (isCurrentSubmission()) {
          creationAttemptRef.current = null;
          setPendingCreation(false);
          router.push(MANAGEMENT_TEAMS_URL);
        }
      }
    } catch (error) {
      if (!isCurrentSubmission() || controller.signal.aborted) return;
      // Validation/authorization errors confirm no creation. Timeout/network/
      // server errors retain the original payload and key for a safe replay.
      if (!isEditing && error instanceof VimobAPIError && teamCreationErrorConfirmsNoResult(error, isCreationReplay)) {
        if (creationAttemptRef.current) clearConfirmedCreation(creationAttemptRef.current);
        creationAttemptRef.current = null;
        setPendingCreation(false);
      }
      console.error("Error saving team editor:", error);
      if (
        error instanceof VimobAPIError &&
        error.code === "team_revision_conflict"
      ) {
        setSaveConflict(true);
        void teamQuery.refetch();
        toast.error("A equipe mudou em outra sessão. Suas alterações foram preservadas.");
        return;
      }
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a equipe.",
      );
    } finally {
      if (submitOperationRef.current === controller) submitOperationRef.current = null;
      if (isCurrentSubmission()) {
        submitInFlightRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const discardDialog = (<FormWizardDiscardDialog open={discardOpen} onOpenChange={setDiscardOpen} busy={isSubmitting || isReloading} onConfirm={() => router.push(MANAGEMENT_TEAMS_URL)} />);

  if (isLoading) {
    return (
      <TeamEditorDialog title={title} onClose={closeEditor} busy={isSubmitting || isReloading} discardDialog={discardDialog}>
        <TeamEditorLoading isEditing={isEditing} />
      </TeamEditorDialog>
    );
  }

  if (accessScopeError) {
    return (
      <TeamEditorDialog title={title} onClose={closeEditor} busy={isSubmitting || isReloading} discardDialog={discardDialog}>
        <EditorMessage
          icon={AlertTriangle}
          title="Não foi possível validar seu acesso"
          description="Confira sua conexão e tente novamente. Nenhuma alteração foi enviada."
          action={
            <Button
              type="button"
              onClick={() => void access.refetch()}
              className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          }
        />
      </TeamEditorDialog>
    );
  }

  if (!canAccessEditor || (!isEditing && !canManageAllTeams && !recoverableCreation && !pendingCreation)) {
    return (
      <TeamEditorDialog title={title} onClose={closeEditor} busy={isSubmitting || isReloading} discardDialog={discardDialog}>
        <EditorMessage
          icon={ShieldX}
          title="Acesso não disponível"
          description={
            isEditing
              ? "Você só pode editar equipes dentro do seu escopo de liderança."
              : "Somente administradores ou perfis com gestão de equipes podem criar uma equipe."
          }
        />
      </TeamEditorDialog>
    );
  }

  if (queryError || (isEditing && !team)) {
    return (
      <TeamEditorDialog title={title} onClose={closeEditor} busy={isSubmitting || isReloading} discardDialog={discardDialog}>
        <EditorMessage
          icon={AlertTriangle}
          title={
            isEditing
              ? "Não foi possível carregar a equipe"
              : "Não foi possível preparar a nova equipe"
          }
          description="Confira sua conexão e tente novamente. Nenhuma alteração foi enviada."
          action={
            <Button
              type="button"
              onClick={() => {
                if (isEditing) {
                  void editorSnapshotQuery.refetch();
                }
                usersQuery.refetch();
                void access.refetch();
              }}
              className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          }
        />
      </TeamEditorDialog>
    );
  }

  const draftPreview = (
    <TeamCreationPreview
      name={name}
      logoUrl={logoPreview || logoUrl}
      members={selectedMembers.flatMap((member) => {
        const user = activeUsers.find((candidate) => candidate.id === member.userId);
        return user ? [{
          id: user.id,
          name: user.name || "Usuário",
          avatarUrl: user.avatar_url,
          isLeader: member.isLeader,
          week: weeksByUserId[member.userId] || [],
        }] : [];
      })}
    />
  );

  return (
    <TeamEditorDialog title={title} onClose={closeEditor} busy={isSubmitting || isReloading} discardDialog={discardDialog}>
      <FormWizardLayout
        steps={TEAM_EDITOR_STEPS.map((step) => ({
          ...step,
          disabled: isSubmitting || isReloading,
          buttonId: `${wizardId}-${step.id}-tab`,
          panelId: `${wizardId}-${step.id}-panel`,
          tourId: `management-team-step-${step.id}`,
        }))}
        activeStep={activeStep}
        onStepChange={(step) => {
          if (!isSubmitting && !isReloading && TEAM_EDITOR_STEPS.some((entry) => entry.id === step)) {
            setActiveStep(step as TeamEditorStep);
          }
        }}
        aside={isEditing && team ? <TeamChangeHistory teamId={team.id} /> : draftPreview}
        asideTitle={isEditing ? undefined : "Prévia da equipe"}
        asideContentClassName={isEditing ? "flex min-h-[360px] flex-col" : undefined}
        footer={(
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p
            className="px-1 text-[10px] text-[var(--app-text-tertiary)]"
            aria-live="polite"
          >
            {isSubmitting
              ? isEditing
                ? "Salvando alterações..."
                : "Criando equipe..."
              : hasRevisionConflict
                ? "A equipe mudou. Carregue a versão atual antes de salvar."
              : canSubmit
                ? "Tudo pronto para salvar."
                : isEditing && !hasUnsavedChanges
                  ? "Nenhuma alteração para salvar."
                  : unresolvedWarnings.length > 0
                    ? "Revise e confirme as escalas sinalizadas."
                    : "Preencha o nome e mantenha uma escala válida para cada membro."}
          </p>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <Button
              type="button"
              className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}
              onClick={activeStepIndex > 0
                ? () => setActiveStep(TEAM_EDITOR_STEPS[activeStepIndex - 1].id as TeamEditorStep)
                : closeEditor}
              disabled={isSubmitting || isReloading}
            >
              {activeStepIndex > 0 ? <><ArrowLeft className="mr-1.5 h-3.5 w-3.5" /> Voltar</> : "Cancelar"}
            </Button>
            {activeStep !== "review" ? (
              <Button type="button" onClick={advanceStep} disabled={isSubmitting || isReloading} className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME}>
                Avançar <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
            <Button
              type="button"
              data-tour="management-team-save"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-busy={isSubmitting}
              className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : isEditing ? (
                <Save className="mr-2 h-4 w-4" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              {isSubmitting
                ? isEditing
                  ? "Salvando..."
                  : "Criando..."
                : isEditing
                  ? "Salvar alterações"
                  : "Criar equipe"}
            </Button>
            )}
          </div>
        </div>
        )}
      >
        <div
          data-tour="management-team-editor"
          id={`${wizardId}-${activeStep}-panel`}
          role="tabpanel"
          aria-labelledby={`${wizardId}-${activeStep}-tab`}
          tabIndex={0}
          className="space-y-4 text-[12px] font-light focus-visible:outline-none"
        >
          {pendingCreation && !isEditing && !isSubmitting && (
            <p role="status" className="rounded-[8px] bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">
              A resposta da criação não foi confirmada. Os dados foram preservados. Repetir usa a mesma tentativa e recupera a equipe, sem criar uma cópia.
            </p>
          )}
          {recoverableCreation && !isEditing && (
            <div role="status" className="space-y-2 rounded-[8px] bg-amber-500/10 p-3 text-[11px] text-amber-700 dark:text-amber-300">
              <p>{recoverableCreation.status === "ready"
                ? "Uma criação anterior está sem resposta confirmada. Recupere os dados para revisar e repetir a mesma tentativa."
                : recoverableCreation.status === "storage_unavailable"
                  ? "Não foi possível conferir as tentativas salvas neste navegador. Libere o armazenamento da sessão e atualize a página antes de criar outra equipe."
                  : "A tentativa anterior expirou ou não pôde ser recuperada. Confira o resultado na lista de equipes antes de continuar."}</p>
              <div className="flex flex-wrap gap-2">
                {recoverableCreation.status === "ready" && <Button type="button" onClick={restoreCreationAttempt} className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}>Recuperar tentativa</Button>}
                <Button type="button" asChild className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}><Link href={MANAGEMENT_TEAMS_URL}>Ver equipes</Link></Button>
                {recoverableCreation.status === "review_required" && canManageAllTeams && <Button type="button" onClick={acknowledgeExpiredCreation} className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}>Conferi a lista e quero iniciar uma nova criação</Button>}
              </div>
            </div>
          )}
          {isEditing && team && (
            <details className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <summary className="cursor-pointer text-[12px] font-normal">Indicadores da equipe</summary>
              <div className="mt-3">
                <TeamOperationalOverview team={team} availability={availabilityQuery.data || []} activeUserIds={usersQuery.isSuccess ? activeUserIds : undefined} />
              </div>
            </details>
          )}
        {hasStaleEditorData && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            <span>Alguns dados podem estar desatualizados. A verificação preserva suas alterações.</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (isEditing) {
                  void editorSnapshotQuery.refetch();
                }
                usersQuery.refetch();
                void access.refetch();
              }}
              className="h-7 rounded-[5px] px-2 text-[10px] font-light"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Verificar dados atuais
            </Button>
          </div>
        )}

        {isEditing && hasRevisionConflict && (
          <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            <span>
              Esta equipe foi alterada em outra sessão. Suas alterações estão
              preservadas. Recarregue a versão atual antes de salvar.
            </span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => void handleLoadCurrentVersion()}
              disabled={isReloading}
              className="h-7 rounded-[5px] px-2 text-[10px] font-light"
            >
              {isReloading ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 h-3 w-3" />
              )}
              Descartar alterações e carregar versão atual
            </Button>
          </div>
        )}
          <fieldset disabled={isSubmitting || isReloading || pendingCreation || Boolean(recoverableCreation) || (!isEditing && !canManageAllTeams)} className="min-w-0 space-y-4 border-0 p-0">
          {activeStep === "identity" && (
        <section
          data-tour="management-team-identity"
          className="shrink-0 rounded-[8px] bg-[var(--app-surface-solid)] p-2.5 sm:p-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-[6px] bg-primary/50 text-white transition-colors enabled:hover:bg-primary disabled:cursor-default"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canManageAllTeams}
              aria-label="Alterar logo da equipe"
            >
              <Avatar className="h-full w-full rounded-[6px]">
                <AvatarImage src={logoPreview || logoUrl || undefined} />
                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[12px] font-light text-white">
                  {getInitials(name || "Equipe", { fallback: "?" })}
                </AvatarFallback>
              </Avatar>
              {canManageAllTeams && (
                <span className="absolute inset-0 grid place-items-center bg-primary/80 opacity-0 transition-opacity group-hover:opacity-100">
                  <Camera className="h-4 w-4" />
                </span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="team-name" className="sr-only">
                Nome da equipe
              </Label>
              <Input
                id="team-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canManageAllTeams}
                maxLength={120}
                placeholder="Ex.: Equipe Comercial"
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
              />
            </div>
            {isEditing && canManageAllTeams && (
              <div className="flex h-9 min-w-[140px] items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] px-2.5">
                <p className="text-[11px] text-[var(--app-text-primary)]">
                  Equipe ativa
                </p>
                <Switch
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  aria-label="Equipe ativa"
                />
              </div>
            )}
          </div>
        </section>
          )}
          {activeStep === "members" && (
          <section
            data-tour="management-team-members"
            data-team-panel="members"
            className={cn(
              TEAM_EDITOR_PANEL_HEIGHT_CLASS,
              "flex min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3",
            )}
          >
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-white">
                  <Users className="h-4 w-4" />
                </span>
                <h2 className="text-[13px] font-normal">Membros</h2>
              </div>
              <span
                className="shrink-0 rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] text-[var(--app-text-secondary)]"
                aria-label={`${selectedMembers.length} membros selecionados`}
              >
                {selectedMembers.length}
              </span>
            </div>

            <div
              data-team-members-scroll
              className="scrollbar-thin -mr-2 min-h-0 flex-1 space-y-1 overflow-y-auto [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
              role="region"
              aria-label="Lista rolável de membros"
              tabIndex={0}
            >
              {activeUsers.map((user) => {
                const selection = selectedMembers.find(
                  (member) => member.userId === user.id,
                );
                const savedMember = savedMemberByUserId.get(user.id);
                const lockedLeader =
                  !canManageAllTeams && savedMember?.is_leader;
                const isFocused = activeScheduleUser?.id === user.id;
                const presence = presenceByUserId.get(user.id);
                const presenceLabel = !presenceQuery.canViewPresence
                  ? null
                  : presenceQuery.isPending
                    ? "Carregando presença"
                    : presenceQuery.isError
                      ? "Presença indisponível"
                      : presence?.presence_status === "online"
                        ? "Online agora"
                        : presence?.presence_status === "idle"
                          ? "Ausente"
                          : presence
                            ? "Offline"
                            : "Sem dados de presença";
                const scheduleLabel = !selection
                  ? "Fora da equipe"
                  : warningByUserId[user.id] ||
                      !isValidAvailabilityWeek(weeksByUserId[user.id] || [])
                    ? "Revisar escala"
                    : "Escala pronta";
                return (
                  <div
                    key={user.id}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-[6px] p-2 transition-colors",
                      isFocused
                        ? "bg-primary/5 ring-1 ring-inset ring-primary/25"
                        : selection
                          ? "bg-[var(--app-surface-hover)]"
                          : "bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]",
                    )}
                  >
                    <Switch
                      checked={Boolean(selection)}
                      onCheckedChange={() => toggleMember(user.id)}
                      disabled={lockedLeader}
                      aria-label={`${selection ? "Remover" : "Adicionar"} ${user.name || "usuário"}`}
                    />
                    <button
                      type="button"
                      className="group/schedule flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-1.5 py-1 text-left transition-colors hover:bg-[var(--app-surface-solid)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
                      onClick={() => {
                        setActiveScheduleUserId(user.id);
                        setActiveStep("schedule");
                      }}
                      aria-pressed={isFocused}
                      aria-label={`Ver escala de ${user.name || "usuário"}`}
                    >
                      <span className="relative shrink-0">
                        <Avatar className="h-8 w-8 rounded-[6px]">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] font-light text-white">
                            {getInitials(user.name, { fallback: "?" })}
                          </AvatarFallback>
                        </Avatar>
                        {presenceQuery.canViewPresence && presence && (
                          <span
                            className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--app-surface-solid)]",
                              presence.presence_status === "online"
                                ? "bg-success"
                                : presence.presence_status === "idle"
                                  ? "bg-warning"
                                  : "bg-[var(--app-text-tertiary)]",
                            )}
                            aria-hidden="true"
                          />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] text-[var(--app-text-primary)]">
                          {user.name || "Usuário"}
                        </span>
                        <span className="block truncate text-[10px] text-[var(--app-text-tertiary)]">
                          {presenceLabel
                            ? `${presenceLabel} · ${scheduleLabel}`
                            : scheduleLabel}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-[5px] transition-colors",
                          isFocused
                            ? "bg-primary text-white"
                            : "bg-[var(--app-surface-solid)] text-[var(--app-text-tertiary)] group-hover/schedule:bg-primary/10 group-hover/schedule:text-primary",
                        )}
                        aria-hidden="true"
                      >
                        <Clock3 className="h-3.5 w-3.5" />
                      </span>
                    </button>
                    {selection && (
                      <button
                        type="button"
                        aria-label={`${selection.isLeader ? "Remover liderança de" : "Definir como líder"} ${user.name || "usuário"}`}
                        onClick={() => toggleLeader(user.id)}
                        disabled={!canManageAllTeams}
                        className={cn(
                          "grid h-8 w-8 shrink-0 place-items-center rounded-[6px] transition-colors",
                          selection.isLeader
                            ? "bg-primary/50 text-white enabled:hover:bg-primary"
                            : "bg-[var(--app-surface-solid)] text-[var(--app-text-tertiary)] enabled:hover:bg-[var(--app-surface-hover)]",
                        )}
                      >
                        <Crown className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          )}
          {activeStep === "schedule" && (
          <section
            data-tour="management-team-schedule"
            data-team-panel="schedule"
            className={cn(
              TEAM_EDITOR_PANEL_HEIGHT_CLASS,
              "flex min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3",
            )}
          >
            {activeScheduleUser && activeScheduleSelection && activeWeek ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex shrink-0 items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <h2 className="shrink-0 text-[13px] font-normal">
                      Escala de atendimento
                    </h2>
                    <span
                      className="max-w-[140px] truncate rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] text-[var(--app-text-secondary)]"
                      title={activeScheduleUser.name || activeScheduleUser.email}
                    >
                      {activeScheduleUser.name || activeScheduleUser.email}
                    </span>
                  </div>
                  {selectedMembers.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        applyScheduleToAllMembers(activeScheduleUser.id)
                      }
                      className="flex shrink-0 items-center gap-1.5 rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                      title="Aplicar esta escala a todos os membros da equipe"
                    >
                      <CopyCheck className="h-3 w-3" />
                      Aplicar a todos
                    </button>
                  )}
                </div>

                {warningByUserId[activeScheduleUser.id] && (
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[6px] bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <p className="text-[11px] font-normal">
                        {warningByUserId[activeScheduleUser.id] === "invalid" ? "Corrija os horários pendentes e confirme esta escala." : "Revise esta escala antes de salvar."}
                      </p>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 rounded-[5px] bg-amber-500/10 px-2 py-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={confirmedWarnings.has(activeScheduleUser.id)}
                        onChange={(event) =>
                          confirmScheduleWarning(
                            activeScheduleUser.id,
                            event.target.checked,
                          )
                        }
                        className="h-3.5 w-3.5 rounded-[4px] accent-primary"
                      />
                      Escala revisada
                    </label>
                  </div>
                )}

                <div
                  data-team-schedule-scroll
                  className="scrollbar-thin -mr-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
                  role="region"
                  aria-label={`Escala semanal de ${activeScheduleUser.name || activeScheduleUser.email}`}
                  tabIndex={0}
                >
                  {activeWeek.map((day) => (
                    <div
                      key={day.day_of_week}
                      className={cn(
                        "grid min-w-0 items-center gap-2 rounded-[6px] p-2 transition-colors sm:grid-cols-[132px_minmax(0,1fr)_28px] sm:items-center",
                        day.is_active
                          ? "bg-[var(--app-surface-hover)]"
                          : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={day.is_active}
                          onCheckedChange={(checked) =>
                            updateSchedule(
                              activeScheduleUser.id,
                              day.day_of_week,
                              {
                                is_active: checked,
                              },
                            )
                          }
                        />
                        <span className="text-[11px]">
                          {DAYS_OF_WEEK[day.day_of_week]}
                        </span>
                      </div>
                      {day.is_active ? (
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--app-text-tertiary)]">
                            <Switch
                              checked={day.is_all_day}
                              onCheckedChange={(checked) =>
                                updateSchedule(
                                  activeScheduleUser.id,
                                  day.day_of_week,
                                  {
                                    is_all_day: checked,
                                  },
                                )
                              }
                              className="scale-75"
                            />
                            24h
                          </label>
                          {day.is_all_day ? (
                            <span className="flex h-8 flex-1 items-center justify-center rounded-[6px] bg-[var(--app-surface-solid)] text-[10px] text-[var(--app-text-secondary)]">
                              Dia inteiro
                            </span>
                          ) : (
                            <div className="flex min-w-0 flex-1 items-center gap-1.5">
                              <TimeSelect
                                value={day.start_time}
                                label={`Início de ${DAYS_OF_WEEK[day.day_of_week]}`}
                                onChange={(value) =>
                                  updateSchedule(
                                    activeScheduleUser.id,
                                    day.day_of_week,
                                    {
                                      start_time: value,
                                    },
                                  )
                                }
                              />
                              <span className="text-[10px] text-[var(--app-text-tertiary)]">
                                até
                              </span>
                              <TimeSelect
                                value={day.end_time}
                                label={`Fim de ${DAYS_OF_WEEK[day.day_of_week]}`}
                                onChange={(value) =>
                                  updateSchedule(
                                    activeScheduleUser.id,
                                    day.day_of_week,
                                    {
                                      end_time: value,
                                    },
                                  )
                                }
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px]">
                          Não recebe leads neste dia
                        </span>
                      )}
                      {day.is_active ? (
                        <button
                          type="button"
                          onClick={() =>
                            applyScheduleToAllDays(
                              activeScheduleUser.id,
                              day.day_of_week,
                            )
                          }
                          className="grid h-7 w-7 shrink-0 place-items-center justify-self-end rounded-[6px] text-[var(--app-text-tertiary)] transition-colors hover:bg-[var(--app-surface-solid)] hover:text-[var(--app-text-primary)]"
                          title={`Aplicar horário de ${DAYS_OF_WEEK[day.day_of_week]} a todos os dias ativos`}
                          aria-label={`Aplicar horário de ${DAYS_OF_WEEK[day.day_of_week]} a todos os dias ativos`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center">
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
                  <UserPlus className="h-5 w-5" />
                </span>
                <h2 className="text-[13px] font-normal">
                  {activeScheduleUser
                    ? `${activeScheduleUser.name || "Usuário"} está fora da equipe`
                    : "Selecione um membro"}
                </h2>
                <p className="mt-1 max-w-sm text-[11px] leading-4 text-[var(--app-text-tertiary)]">
                  {activeScheduleUser
                    ? "A pessoa continua visível na lista. Ative o vínculo para configurar e salvar a escala."
                    : "Clique em uma pessoa na lista para abrir a escala correspondente."}
                </p>
                {activeScheduleUser && (
                  <Button
                    type="button"
                    onClick={() => toggleMember(activeScheduleUser.id)}
                    className="mt-3 h-8 rounded-[6px] bg-primary/50 px-3 text-[11px] font-light text-white shadow-none hover:bg-primary"
                  >
                    Adicionar à equipe
                  </Button>
                )}
              </div>
            )}
          </section>
          )}
          {activeStep === "review" && (
            <section className="space-y-4">
              <h2 className="text-[14px] font-normal">Revise a equipe</h2>
              {draftPreview}
              {!allWeeksValid && selectedMembers.length > 0 && (
                <p role="alert" className="rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  Há uma escala inválida. Mantenha ao menos um dia ativo, confira os sete dias e use horários inicial e final diferentes.
                </p>
              )}
              {unresolvedWarnings.length > 0 && (
                <p role="alert" className="text-[11px] text-[var(--app-text-secondary)]">Revise e confirme as escalas sinalizadas antes de salvar.</p>
              )}
            </section>
          )}
          </fieldset>
        </div>
      </FormWizardLayout>
    </TeamEditorDialog>
  );
}

function TeamEditorDialog({ title, onClose, busy, children, discardDialog }: {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  discardDialog: ReactNode;
}) {
  return (
    <AppLayout title={title} disableMainScroll>
      <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
        <DialogContent
          data-management-editor
          className={FORM_WIZARD_DIALOG_CLASS_NAME}
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0 border-b border-[var(--app-border)] px-5 py-4 text-left">
            <DialogTitle className="pr-8 text-[15px] font-normal">{title}</DialogTitle>
          </DialogHeader>
          {children}
          {discardDialog}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}

function TimeSelect({
  value,
  label,
  onChange,
}: {
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={isAvailabilityClock(value) ? value : undefined} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-8 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 text-[11px] font-light shadow-none"
      >
        <SelectValue placeholder="Revisar horário" />
      </SelectTrigger>
      <SelectContent className="max-h-[260px] rounded-[8px] border-0 p-1">
        {availabilityTimeOptions(value).map((time) => (
          <SelectItem
            key={time}
            value={time}
            className="rounded-[6px] text-[11px] font-light"
          >
            {time}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TeamEditorLoading({ isEditing }: { isEditing: boolean }) {
  return (
    <div className="w-full space-y-3 pb-8">
      <Skeleton className="h-8 w-40 rounded-[6px]" />
      {isEditing && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[70px] rounded-[8px]" />
          ))}
        </div>
      )}
      <Skeleton className="h-16 w-full rounded-[8px]" />
      <div
        className={cn(
          "grid min-w-0 gap-3 lg:grid-cols-[minmax(300px,0.42fr)_minmax(0,0.58fr)]",
          isEditing &&
            "2xl:grid-cols-[minmax(340px,420px)_minmax(400px,1fr)_minmax(260px,320px)]",
        )}
      >
        {Array.from({ length: isEditing ? 3 : 2 }).map((_, index) => (
          <Skeleton
            key={index}
            className={cn(
              TEAM_EDITOR_LOADING_PANEL_HEIGHT_CLASS,
              "rounded-[8px]",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function EditorMessage({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof AlertTriangle;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[52vh] w-full max-w-[720px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-5 py-10 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        <Icon className="h-5 w-5" />
      </span>
      <h2 className="text-[14px] font-normal">{title}</h2>
      <p className="mt-1 max-w-md text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
      <Button
        asChild
        variant="ghost"
        className="mt-3 h-9 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        <Link href={MANAGEMENT_TEAMS_URL}>Voltar para Gestão</Link>
      </Button>
    </div>
  );
}
