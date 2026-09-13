"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Clock3,
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
import { useCreateTeam, useTeam, useUpdateTeam } from "@/hooks/use-teams";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useUsers } from "@/hooks/use-users";
import { teamsAPI } from "@/lib/api/teams";
import { getInitials } from "@/lib/user-display";
import { cn } from "@/lib/utils";

import {
  DAYS_OF_WEEK,
  TIME_OPTIONS,
  availabilityToWeek,
  createDefaultAvailabilityWeek,
  hasCompleteAvailabilityWeek,
  isValidAvailabilityWeek,
  toAvailabilityInput,
  type DaySchedule,
} from "./availability-week";
import { TeamChangeHistory } from "./TeamChangeHistory";
import { TeamOperationalOverview } from "./TeamOperationalOverview";

type TeamEditorScreenProps =
  { mode: "create"; teamId?: never } | { mode: "edit"; teamId: string };

interface MemberSelection {
  userId: string;
  isLeader: boolean;
}

type ScheduleWarning = "missing" | "incomplete";

const MANAGEMENT_TEAMS_URL = "/crm/management?tab=teams";
const TEAM_EDITOR_PANEL_HEIGHT_CLASS = "h-[600px] xl:h-full xl:min-h-0";
const TEAM_EDITOR_LOADING_PANEL_HEIGHT_CLASS = "h-[600px]";

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef<string | null>(null);

  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId || null;
  const access = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManageAllTeams =
    access.isAdmin || (!access.isTeamLeader && hasPermission("team_manage"));
  const canAccessEditor = isEditing
    ? canManageAllTeams ||
      (access.isTeamLeader && access.ledTeamIds.includes(props.teamId))
    : canManageAllTeams;

  const teamQuery = useTeam(teamId, {
    enabled: isEditing && canAccessEditor,
  });
  const usersQuery = useUsers({ enabled: canAccessEditor });
  const team = teamQuery.data;
  const teamMemberIds = useMemo(
    () => team?.members?.map((member) => member.id) || [],
    [team?.members],
  );
  const availabilityQuery = useTeamMembersAvailability(teamMemberIds);
  const createTeam = useCreateTeam();
  const updateTeam = useUpdateTeam();

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);

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

  useEffect(() => {
    if (!canAccessEditor) return;
    if (!isEditing) {
      const key = `create:${organizationId || "pending"}`;
      if (initializedRef.current === key) return;
      initializedRef.current = key;
      setName("");
      setLogoUrl(null);
      setLogoFile(null);
      setIsActive(true);
      setSelectedMembers([]);
      setWeeksByUserId({});
      setWarningByUserId({});
      setConfirmedWarnings(new Set());
      setActiveScheduleUserId(null);
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

    if (
      !team ||
      (teamMemberIds.length > 0 &&
        (availabilityQuery.isLoading ||
          (availabilityQuery.isError && availabilityQuery.data === undefined)))
    ) {
      return;
    }
    const key = `edit:${team.id}`;
    if (initializedRef.current === key) return;

    const weeks: Record<string, DaySchedule[]> = {};
    const warnings: Record<string, ScheduleWarning> = {};
    for (const member of team.members || []) {
      const saved = (availabilityQuery.data || []).filter(
        (entry) => entry.team_member_id === member.id,
      );
      weeks[member.user_id] = availabilityToWeek(saved);
      if (saved.length === 0) warnings[member.user_id] = "missing";
      else if (!hasCompleteAvailabilityWeek(saved)) {
        warnings[member.user_id] = "incomplete";
      }
    }

    const members = (team.members || []).map((member) => ({
      userId: member.user_id,
      isLeader: member.is_leader || false,
    }));

    initializedRef.current = key;
    setName(team.name);
    setLogoUrl(team.logo_url || null);
    setLogoFile(null);
    setIsActive(team.is_active !== false);
    setSelectedMembers(members);
    setWeeksByUserId(weeks);
    setWarningByUserId(warnings);
    setConfirmedWarnings(new Set());
    setActiveScheduleUserId(team.members?.[0]?.user_id || null);
    setSavedFingerprint(
      buildEditorFingerprint({
        name: team.name,
        logoUrl: team.logo_url || null,
        isActive: team.is_active !== false,
        members,
        weeksByUserId: weeks,
      }),
    );
    setIsInitialized(true);
  }, [
    availabilityQuery.data,
    availabilityQuery.isError,
    availabilityQuery.isLoading,
    canAccessEditor,
    isEditing,
    organizationId,
    team,
    teamMemberIds.length,
  ]);

  const isLoading =
    permissionsLoading ||
    access.isLoading ||
    (canAccessEditor && usersQuery.isLoading) ||
    (isEditing && teamQuery.isLoading) ||
    (isEditing && teamMemberIds.length > 0 && availabilityQuery.isLoading);
  const accessScopeError =
    access.isError && !access.hasTenantTeamScope && !canManageAllTeams
      ? access.error
      : null;
  const queryError =
    (teamQuery.data === undefined ? teamQuery.error : null) ||
    (usersQuery.data === undefined ? usersQuery.error : null) ||
    (availabilityQuery.data === undefined ? availabilityQuery.error : null);
  const hasStaleEditorData = Boolean(
    (access.isError && (access.hasTenantTeamScope || canManageAllTeams)) ||
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
  const canSubmit =
    isInitialized &&
    Boolean(name.trim()) &&
    allWeeksValid &&
    unresolvedWarnings.length === 0 &&
    hasUnsavedChanges &&
    !isSubmitting;

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

  const confirmScheduleWarning = (userId: string, checked: boolean) => {
    setConfirmedWarnings((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  };

  const uploadLogo = async () => {
    if (!canManageAllTeams || !logoFile) return logoUrl;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(logoFile.type)) {
      throw new Error("Use uma imagem JPG, PNG, WEBP ou GIF.");
    }
    if (logoFile.size > 5 * 1024 * 1024) {
      throw new Error("A logo deve ter no máximo 5 MB.");
    }
    return teamsAPI.uploadLogo(logoFile, organizationId);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (unresolvedWarnings.length > 0) {
        toast.error(
          "Confirme a regularização das escalas antigas antes de salvar.",
        );
      } else {
        toast.error("Revise o nome e os sete dias da escala de cada membro.");
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const finalLogoUrl = await uploadLogo();
      if (logoFile && finalLogoUrl) {
        // Keep a successfully uploaded asset in the form if the team mutation
        // fails, so retrying does not create another orphaned object.
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

      if (isEditing && team) {
        const updatedTeam = await updateTeam.mutateAsync({
          id: team.id,
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
        setLogoUrl(savedLogoUrl);
        setLogoFile(null);
        setLogoPreview(null);
        setWarningByUserId({});
        setConfirmedWarnings(new Set());
      } else {
        const createdTeam = await createTeam.mutateAsync({
          name: name.trim(),
          logo_url: finalLogoUrl || null,
          is_active: true,
          members,
        });
        router.replace(`/crm/management/teams/${createdTeam.id}/edit`);
      }
    } catch (error) {
      console.error("Error saving team editor:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a equipe.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout title={title}>
        <TeamEditorLoading isEditing={isEditing} />
      </AppLayout>
    );
  }

  if (accessScopeError) {
    return (
      <AppLayout title={title}>
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
      </AppLayout>
    );
  }

  if (!canAccessEditor) {
    return (
      <AppLayout title={title}>
        <EditorMessage
          icon={ShieldX}
          title="Acesso não disponível"
          description={
            isEditing
              ? "Você só pode editar equipes dentro do seu escopo de liderança."
              : "Somente administradores ou perfis com gestão de equipes podem criar uma equipe."
          }
        />
      </AppLayout>
    );
  }

  if (queryError || (isEditing && !team)) {
    return (
      <AppLayout title={title}>
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
                teamQuery.refetch();
                usersQuery.refetch();
                availabilityQuery.refetch();
                void access.refetch();
              }}
              className="h-9 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          }
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout title={title} disableMainScroll>
      <div
        data-tour="management-team-editor"
        className="flex h-full min-h-0 w-full flex-col gap-3 overflow-x-hidden overflow-y-auto pb-8 text-[12px] font-light xl:pb-0"
      >
        <div className="flex shrink-0 items-center">
          <Button
            asChild
            variant="ghost"
            className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
          >
            <Link href={MANAGEMENT_TEAMS_URL}>
              <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
              Voltar para Gestão
            </Link>
          </Button>
        </div>

        {isEditing && team && (
          <TeamOperationalOverview
            team={team}
            availability={availabilityQuery.data || []}
            activeUserIds={usersQuery.isSuccess ? activeUserIds : undefined}
          />
        )}

        {hasStaleEditorData && (
          <div
            role="status"
            className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
          >
            <span>Alguns dados podem estar desatualizados.</span>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                teamQuery.refetch();
                usersQuery.refetch();
                availabilityQuery.refetch();
                void access.refetch();
              }}
              className="h-7 rounded-[5px] px-2 text-[10px] font-light"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Atualizar
            </Button>
          </div>
        )}

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

        <div
          className={cn(
            "grid min-w-0 shrink-0 gap-3 lg:grid-cols-[minmax(280px,0.36fr)_minmax(0,0.64fr)] xl:min-h-[360px] xl:max-h-[600px] xl:flex-1",
            isEditing &&
              "xl:grid-cols-[minmax(280px,340px)_minmax(520px,1fr)_minmax(260px,320px)]",
          )}
        >
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
                      onClick={() => setActiveScheduleUserId(user.id)}
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
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-white">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <h2 className="text-[13px] font-normal">
                      Escala de atendimento
                    </h2>
                  </div>
                  <span
                    className="max-w-[45%] truncate rounded-[5px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] text-[var(--app-text-secondary)]"
                    title={activeScheduleUser.name || activeScheduleUser.email}
                  >
                    {activeScheduleUser.name || activeScheduleUser.email}
                  </span>
                </div>

                {warningByUserId[activeScheduleUser.id] && (
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-[6px] bg-amber-500/10 px-2.5 py-2 text-amber-700 dark:text-amber-300">
                    <div className="flex min-w-0 items-center gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <p className="text-[11px] font-normal">
                        Revise esta escala antes de salvar.
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
                        "grid min-w-0 gap-2 rounded-[6px] p-2 transition-colors sm:grid-cols-[132px_minmax(0,1fr)] sm:items-center",
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

          {isEditing && team && (
            <div
              className={cn(
                TEAM_EDITOR_PANEL_HEIGHT_CLASS,
                "min-w-0 w-full lg:col-span-2 xl:col-span-1",
              )}
            >
              <TeamChangeHistory teamId={team.id} />
            </div>
          )}
        </div>

        {!allWeeksValid && selectedMembers.length > 0 && (
          <div className="shrink-0 rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            Há uma escala inválida. Mantenha ao menos um dia ativo, confira os
            sete dias e use horários inicial e final diferentes.
          </div>
        )}

        <div className="sticky bottom-0 z-20 mx-auto flex w-full max-w-[680px] shrink-0 flex-col gap-2 rounded-[8px] bg-[var(--app-surface-solid)] p-2 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] sm:flex-row sm:items-center sm:justify-between">
          <p
            className="px-1 text-[10px] text-[var(--app-text-tertiary)]"
            aria-live="polite"
          >
            {isSubmitting
              ? isEditing
                ? "Salvando alterações..."
                : "Criando equipe..."
              : canSubmit
                ? "Tudo pronto para salvar."
                : isEditing && !hasUnsavedChanges
                  ? "Nenhuma alteração para salvar."
                  : unresolvedWarnings.length > 0
                    ? "Revise e confirme as escalas sinalizadas."
                    : "Preencha o nome e mantenha uma escala válida para cada membro."}
          </p>
          <div className="grid w-full grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-2 sm:w-[330px]">
            <Button
              asChild
              type="button"
              className="h-9 rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              <Link href={MANAGEMENT_TEAMS_URL}>Cancelar</Link>
            </Button>
            <Button
              type="button"
              data-tour="management-team-save"
              onClick={handleSubmit}
              disabled={!canSubmit}
              aria-busy={isSubmitting}
              className="h-9 rounded-[6px] bg-primary text-[12px] font-light text-white shadow-none hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
          </div>
        </div>
      </div>
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
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        className="h-8 min-w-0 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2 text-[11px] font-light shadow-none"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[260px] rounded-[8px] border-0 p-1">
        {TIME_OPTIONS.map((time) => (
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
          "grid min-w-0 gap-3 lg:grid-cols-[minmax(280px,0.36fr)_minmax(0,0.64fr)]",
          isEditing &&
            "xl:grid-cols-[minmax(280px,340px)_minmax(520px,1fr)_minmax(260px,320px)]",
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
