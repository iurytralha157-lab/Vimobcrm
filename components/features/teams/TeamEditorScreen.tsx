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
import {
  useTeamMembersAvailability,
} from "@/hooks/use-member-availability";
import { useCreateTeam, useTeam, useUpdateTeam } from "@/hooks/use-teams";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useUsers } from "@/hooks/use-users";
import { teamsAPI } from "@/lib/api/teams";
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

type TeamEditorScreenProps =
  | { mode: "create"; teamId?: never }
  | { mode: "edit"; teamId: string };

interface MemberSelection {
  userId: string;
  isLeader: boolean;
}

type ScheduleWarning = "missing" | "incomplete";

const MANAGEMENT_TEAMS_URL = "/crm/management?tab=teams";

function getInitials(value?: string | null) {
  return (value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TeamEditorScreen(props: TeamEditorScreenProps) {
  const isEditing = props.mode === "edit";
  const teamId = isEditing ? props.teamId : null;
  const title = isEditing ? "Editar equipe" : "Nova equipe";
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef<string | null>(null);

  const { organization, profile } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || null;
  const access = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canManageAllTeams =
    access.isAdmin ||
    (!access.isTeamLeader && hasPermission("team_manage"));
  const canAccessEditor = isEditing
    ? canManageAllTeams ||
      (access.isTeamLeader && access.ledTeamIds.includes(props.teamId))
    : canManageAllTeams;

  const teamQuery = useTeam(teamId, { enabled: isEditing });
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
  const [weeksByUserId, setWeeksByUserId] = useState<Record<string, DaySchedule[]>>({});
  const [warningByUserId, setWarningByUserId] = useState<Record<string, ScheduleWarning>>({});
  const [confirmedWarnings, setConfirmedWarnings] = useState<Set<string>>(new Set());
  const [activeScheduleUserId, setActiveScheduleUserId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

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
      setIsInitialized(true);
      return;
    }

    if (
      !team ||
      (teamMemberIds.length > 0 &&
        (availabilityQuery.isLoading || availabilityQuery.isError))
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

    initializedRef.current = key;
    setName(team.name);
    setLogoUrl(team.logo_url || null);
    setLogoFile(null);
    setIsActive(team.is_active !== false);
    setSelectedMembers(
      (team.members || []).map((member) => ({
        userId: member.user_id,
        isLeader: member.is_leader || false,
      })),
    );
    setWeeksByUserId(weeks);
    setWarningByUserId(warnings);
    setConfirmedWarnings(new Set());
    setActiveScheduleUserId(team.members?.[0]?.user_id || null);
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
  const queryError = teamQuery.error || usersQuery.error || availabilityQuery.error;

  const savedMemberByUserId = useMemo(
    () =>
      new Map((team?.members || []).map((member) => [member.user_id, member])),
    [team?.members],
  );
  const selectedScheduleUsers = activeUsers.filter((user) =>
    selectedUserIds.has(user.id),
  );
  const activeScheduleUser = selectedScheduleUsers.find(
    (user) => user.id === activeScheduleUserId,
  ) || selectedScheduleUsers[0];
  const activeWeek = activeScheduleUser
    ? weeksByUserId[activeScheduleUser.id]
    : undefined;

  const unresolvedWarnings = Object.keys(warningByUserId).filter(
    (userId) =>
      selectedUserIds.has(userId) && !confirmedWarnings.has(userId),
  );
  const allWeeksValid = selectedMembers.every((member) =>
    isValidAvailabilityWeek(weeksByUserId[member.userId] || []),
  );
  const canSubmit =
    isInitialized &&
    Boolean(name.trim()) &&
    allWeeksValid &&
    unresolvedWarnings.length === 0 &&
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
    setActiveScheduleUserId((current) => current || userId);
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
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ];
    if (!allowedTypes.includes(logoFile.type)) {
      throw new Error("Use uma imagem JPG, PNG, WEBP, GIF ou SVG.");
    }
    if (logoFile.size > 5 * 1024 * 1024) {
      throw new Error("A logo deve ter no máximo 5 MB.");
    }
    return teamsAPI.uploadLogo(logoFile, organizationId);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      if (unresolvedWarnings.length > 0) {
        toast.error("Confirme a regularização das escalas antigas antes de salvar.");
      } else {
        toast.error("Revise o nome e os sete dias da escala de cada membro.");
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const finalLogoUrl = await uploadLogo();
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
        await updateTeam.mutateAsync({
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
      } else {
        await createTeam.mutateAsync({
          name: name.trim(),
          logo_url: finalLogoUrl || null,
          is_active: true,
          members,
        });
      }
      router.push(MANAGEMENT_TEAMS_URL);
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
        <TeamEditorLoading />
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
          title="Não foi possível carregar a equipe"
          description="Confira sua conexão e tente novamente. Nenhuma alteração foi enviada."
          action={
            <Button
              type="button"
              onClick={() => {
                teamQuery.refetch();
                usersQuery.refetch();
                availabilityQuery.refetch();
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
    <AppLayout title={title}>
      <div className="mx-auto w-full max-w-[1180px] space-y-3 pb-8 text-[12px] font-light">
        <div className="flex flex-wrap items-center justify-between gap-2">
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
          <span className="text-[11px] text-[var(--app-text-tertiary)]">
            Horário de referência: America/Sao_Paulo
          </span>
        </div>

        <section className="rounded-[8px] bg-[var(--app-surface-solid)] p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-[6px] bg-primary/50 text-white transition-colors enabled:hover:bg-primary disabled:cursor-default"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canManageAllTeams}
              aria-label="Alterar logo da equipe"
            >
              <Avatar className="h-full w-full rounded-[6px]">
                <AvatarImage src={logoPreview || logoUrl || undefined} />
                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[12px] font-light text-white">
                  {getInitials(name || "Equipe")}
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
              accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
              className="hidden"
              onChange={(event) => setLogoFile(event.target.files?.[0] || null)}
            />
            <div className="min-w-0 flex-1">
              <Label htmlFor="team-name" className="mb-1.5 block text-[11px] font-light text-[var(--app-text-tertiary)]">
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
              <div className="flex h-14 min-w-[150px] items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] px-3">
                <div>
                  <p className="text-[12px] text-[var(--app-text-primary)]">Equipe ativa</p>
                  <p className="text-[10px] text-[var(--app-text-tertiary)]">Participa da operação</p>
                </div>
                <Switch checked={isActive} onCheckedChange={setIsActive} />
              </div>
            )}
          </div>
        </section>

        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(300px,0.38fr)_minmax(0,0.62fr)]">
          <section className="min-w-0 rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3">
            <div className="flex items-center justify-between gap-2 px-1 pb-2">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-white">
                  <Users className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="text-[13px] font-normal">Membros</h2>
                  <p className="text-[10px] text-[var(--app-text-tertiary)]">
                    {selectedMembers.length} selecionado(s)
                  </p>
                </div>
              </div>
            </div>

            <div className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
              {activeUsers.map((user) => {
                const selection = selectedMembers.find(
                  (member) => member.userId === user.id,
                );
                const savedMember = savedMemberByUserId.get(user.id);
                const lockedLeader = !canManageAllTeams && savedMember?.is_leader;
                return (
                  <div
                    key={user.id}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-[6px] p-2 transition-colors",
                      selection
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
                    <Avatar className="h-8 w-8 shrink-0 rounded-[6px]">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] font-light text-white">
                        {getInitials(user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        if (!selection) toggleMember(user.id);
                        setActiveScheduleUserId(user.id);
                      }}
                    >
                      <p className="truncate text-[12px] text-[var(--app-text-primary)]">
                        {user.name || "Usuário"}
                      </p>
                      <p className="truncate text-[10px] text-[var(--app-text-tertiary)]">
                        {user.email}
                      </p>
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

          <section className="min-w-0 rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3">
            {activeScheduleUser && activeWeek ? (
              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-[6px] bg-primary/50 text-white">
                      <Clock3 className="h-4 w-4" />
                    </span>
                    <div>
                      <h2 className="text-[13px] font-normal">Escala de atendimento</h2>
                      <p className="text-[10px] text-[var(--app-text-tertiary)]">
                        Sete dias explícitos; dias desligados não recebem leads.
                      </p>
                    </div>
                  </div>
                  <Select
                    value={activeScheduleUser.id}
                    onValueChange={setActiveScheduleUserId}
                  >
                    <SelectTrigger className="h-9 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none sm:w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-[8px] border-0 p-1">
                      {selectedScheduleUsers.map((user) => (
                        <SelectItem
                          key={user.id}
                          value={user.id}
                          className="rounded-[6px] text-[12px] font-light"
                        >
                          {user.name || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {warningByUserId[activeScheduleUser.id] && (
                  <div className="rounded-[6px] bg-amber-500/10 p-3 text-amber-700 dark:text-amber-300">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-[12px] font-normal">
                          {warningByUserId[activeScheduleUser.id] === "missing"
                            ? "Sem escala configurada: recebe leads 24h"
                            : "Escala antiga incompleta: a disponibilidade pode estar incorreta"}
                        </p>
                        <p className="mt-1 text-[10px] leading-4 opacity-80">
                          Ao salvar, os sete dias abaixo serão gravados. O padrão sugerido é segunda a sexta, das 08:00 às 18:00.
                        </p>
                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px]">
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
                          Confirmo que revisei e quero salvar esta escala.
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
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
                            updateSchedule(activeScheduleUser.id, day.day_of_week, {
                              is_active: checked,
                            })
                          }
                        />
                        <span className="text-[11px]">{DAYS_OF_WEEK[day.day_of_week]}</span>
                      </div>
                      {day.is_active ? (
                        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                          <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--app-text-tertiary)]">
                            <Switch
                              checked={day.is_all_day}
                              onCheckedChange={(checked) =>
                                updateSchedule(activeScheduleUser.id, day.day_of_week, {
                                  is_all_day: checked,
                                })
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
                                  updateSchedule(activeScheduleUser.id, day.day_of_week, {
                                    start_time: value,
                                  })
                                }
                              />
                              <span className="text-[10px] text-[var(--app-text-tertiary)]">até</span>
                              <TimeSelect
                                value={day.end_time}
                                label={`Fim de ${DAYS_OF_WEEK[day.day_of_week]}`}
                                onChange={(value) =>
                                  updateSchedule(activeScheduleUser.id, day.day_of_week, {
                                    end_time: value,
                                  })
                                }
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[10px]">Não recebe leads neste dia</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center px-5 text-center">
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]">
                  <UserPlus className="h-5 w-5" />
                </span>
                <h2 className="text-[13px] font-normal">Selecione um membro</h2>
                <p className="mt-1 max-w-sm text-[11px] leading-4 text-[var(--app-text-tertiary)]">
                  Cada membro adicionado recebe uma escala explícita de sete dias. Por padrão, segunda a sexta das 08:00 às 18:00.
                </p>
              </div>
            )}
          </section>
        </div>

        {!allWeeksValid && selectedMembers.length > 0 && (
          <div className="rounded-[6px] bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            Há uma escala inválida. Mantenha ao menos um dia ativo, confira os sete dias e use horários inicial e final diferentes.
          </div>
        )}

        <div className="sticky bottom-2 z-10 ml-auto grid w-full grid-cols-[minmax(0,3fr)_minmax(0,7fr)] gap-2 rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:max-w-[420px]">
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
            className="h-9 rounded-[6px] bg-primary/50 text-[12px] font-light text-white shadow-none hover:bg-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : isEditing ? (
              <Save className="mr-2 h-4 w-4" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            {isEditing ? "Salvar alterações" : "Criar equipe"}
          </Button>
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

function TeamEditorLoading() {
  return (
    <div className="mx-auto w-full max-w-[1180px] space-y-3 pb-8">
      <Skeleton className="h-8 w-40 rounded-[6px]" />
      <Skeleton className="h-24 w-full rounded-[8px]" />
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,0.38fr)_minmax(0,0.62fr)]">
        <Skeleton className="h-[480px] rounded-[8px]" />
        <Skeleton className="h-[480px] rounded-[8px]" />
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
