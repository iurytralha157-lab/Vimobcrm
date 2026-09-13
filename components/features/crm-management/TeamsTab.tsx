import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertTriangle,
  Crown,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MemberAvailabilityDialog } from "@/components/features/teams/MemberAvailabilityDialog";
import {
  useTeams,
  useDeleteTeam,
  useUpdateTeamStatus,
  Team,
} from "@/hooks/use-teams";
import {
  useTeamMembersAvailability,
  formatAvailabilitySummary,
} from "@/hooks/use-member-availability";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { ManagementToolbarPortal } from "@/components/features/crm-management/ManagementToolbar";
import {
  canEditTeam,
  canManageAllTeams as canManageAllTeamsForAccess,
  canViewAllTeams as canViewAllTeamsForAccess,
} from "@/lib/access/management";
import { getInitials } from "@/lib/user-display";

const NEW_TEAM_URL = "/crm/management/teams/new";
const MEMBER_PREVIEW_LIMIT = 4;

function getMemberName(member: NonNullable<Team["members"]>[number]) {
  return member.user?.name || member.user?.email || "Usuário";
}

function getMemberSummary(members: NonNullable<Team["members"]>) {
  const names = members.map(getMemberName);

  if (names.length <= 2) return names.join(" e ");
  return `${names[0]}, ${names[1]} e mais ${names.length - 2}`;
}

export function TeamsTab() {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [availabilityMember, setAvailabilityMember] = useState<{
    id: string;
    name: string;
    avatar?: string | null;
    readOnly: boolean;
  } | null>(null);

  const teamsQuery = useTeams({ includeInactive: true });
  const teams = teamsQuery.data || [];
  const deleteTeam = useDeleteTeam();
  const updateTeamStatus = useUpdateTeamStatus();
  const accessScope = useUserAccessScope();
  const { hasPermission } = useUserPermissions();
  const teamManagementAccess = {
    isAdmin: accessScope.isAdmin,
    isTeamLeader: accessScope.isTeamLeader,
    memberRole: accessScope.memberRole,
    ledTeamIds: accessScope.ledTeamIds,
    hasPermission,
  };
  const canManageAllTeams = canManageAllTeamsForAccess(teamManagementAccess);
  const canViewAllTeams = canViewAllTeamsForAccess(teamManagementAccess);
  const visibleTeams = canViewAllTeams
    ? teams
    : teams.filter((team) => accessScope.ledTeamIds.includes(team.id));

  const allMemberIds = visibleTeams.flatMap(
    (team) => team.members?.map((member) => member.id) || [],
  );
  const availabilityQuery = useTeamMembersAvailability(allMemberIds);
  const allAvailability = availabilityQuery.data || [];

  const getMemberAvailability = (memberId: string) => {
    return allAvailability.filter(
      (availability) => availability.team_member_id === memberId,
    );
  };

  const getMemberAvailabilitySummary = (memberId: string) => {
    if (availabilityQuery.isError && availabilityQuery.data === undefined) {
      return "Escala indisponível";
    }
    if (availabilityQuery.isPending) return "Carregando escala";
    const summary = formatAvailabilitySummary(getMemberAvailability(memberId));
    return availabilityQuery.isError ? `${summary} · desatualizada` : summary;
  };

  const handleEdit = (team: Team) => {
    router.push(`/crm/management/teams/${team.id}/edit`);
  };

  const handleDelete = (team: Team) => {
    setTeamToDelete(team);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!teamToDelete) return;

    try {
      await deleteTeam.mutateAsync(teamToDelete.id);
      setDeleteDialogOpen(false);
      setTeamToDelete(null);
    } catch {
      // A mutação mantém o diálogo aberto e apresenta a mensagem de erro.
    }
  };

  const handleNewTeam = () => {
    router.push(NEW_TEAM_URL);
  };

  useEffect(() => {
    const handleMobileCreate = () => {
      if (!canManageAllTeams) return;
      router.push(NEW_TEAM_URL);
    };

    if (canManageAllTeams) router.prefetch(NEW_TEAM_URL);
    window.addEventListener("vimob:mobile-create-team", handleMobileCreate);
    return () =>
      window.removeEventListener(
        "vimob:mobile-create-team",
        handleMobileCreate,
      );
  }, [canManageAllTeams, router]);

  const openAvailability = (
    member: NonNullable<Team["members"]>[number],
    readOnly: boolean,
  ) => {
    setAvailabilityMember({
      id: member.id,
      name: member.user?.name || "",
      avatar: member.user?.avatar_url,
      readOnly,
    });
  };

  if (teamsQuery.isLoading || accessScope.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {canManageAllTeams && (
          <ManagementToolbarPortal>
            <Button
              data-tour="management-team-new"
              onClick={handleNewTeam}
              className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Nova equipe
            </Button>
          </ManagementToolbarPortal>
        )}
        <div
          data-tour="management-teams"
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain rounded-[8px] bg-[var(--app-surface-solid)] p-2"
        >
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-[6px]" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div
        data-tour="management-teams"
        className="flex h-full min-h-0 flex-col gap-3"
      >
        {canManageAllTeams && (
          <ManagementToolbarPortal>
            <Button
              data-tour="management-team-new"
              onClick={handleNewTeam}
              className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[12px] font-light text-white shadow-none hover:bg-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Nova equipe
            </Button>
          </ManagementToolbarPortal>
        )}

        {teamsQuery.isError && teamsQuery.data === undefined ? (
          <div
            role="alert"
            data-team-list-error
            className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
              Não foi possível carregar as equipes
            </h3>
            <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              Confira sua conexão e tente novamente. Nenhuma equipe foi
              alterada.
            </p>
            <Button
              type="button"
              onClick={() => teamsQuery.refetch()}
              disabled={teamsQuery.isFetching}
              className="h-9 gap-1.5 rounded-[6px] px-3 text-[12px] font-light"
            >
              {teamsQuery.isFetching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Tentar novamente
            </Button>
          </div>
        ) : visibleTeams.length === 0 ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto overscroll-contain rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
              {canManageAllTeams
                ? "Crie sua primeira equipe"
                : "Nenhuma equipe disponível"}
            </h3>
            <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              {canManageAllTeams
                ? "Organize seus corretores em equipes e configure a disponibilidade de cada um."
                : canViewAllTeams
                  ? "Nenhuma equipe ativa foi encontrada nesta organização."
                  : "Você ainda não lidera nenhuma equipe ativa nesta organização."}
            </p>
            {canManageAllTeams && (
              <Button
                onClick={handleNewTeam}
                className="h-9 gap-1.5 rounded-[6px] px-3 text-[12px] font-light"
              >
                <Plus className="h-3.5 w-3.5" />
                Criar equipe
              </Button>
            )}
          </div>
        ) : (
          <>
            {teamsQuery.isError && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
              >
                <span>A lista pode estar desatualizada.</span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => teamsQuery.refetch()}
                  disabled={teamsQuery.isFetching}
                  className="h-7 rounded-[5px] px-2 text-[10px] font-light"
                >
                  <RefreshCw
                    className={`mr-1.5 h-3 w-3 ${teamsQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  Atualizar
                </Button>
              </div>
            )}
            {availabilityQuery.isError && (
              <div
                role="status"
                data-team-availability-error
                className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300"
              >
                <span>
                  {availabilityQuery.data === undefined
                    ? "As escalas dos membros não puderam ser carregadas."
                    : "As escalas exibidas podem estar desatualizadas."}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => availabilityQuery.refetch()}
                  disabled={availabilityQuery.isFetching}
                  className="h-7 rounded-[5px] px-2 text-[10px] font-light"
                >
                  <RefreshCw
                    className={`mr-1.5 h-3 w-3 ${availabilityQuery.isFetching ? "animate-spin" : ""}`}
                  />
                  Tentar novamente
                </Button>
              </div>
            )}
            <div
              data-tour="management-team-list"
              data-management-scroll-region="teams"
              className="min-h-0 flex-1 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none [&>div]:h-full [&>div]:overflow-auto [&>div]:overscroll-contain [&_td:nth-child(3)]:hidden [&_td:nth-child(4)]:hidden [&_th:nth-child(3)]:hidden [&_th:nth-child(4)]:hidden md:[&_td:nth-child(3)]:table-cell md:[&_td:nth-child(4)]:table-cell md:[&_th:nth-child(3)]:table-cell md:[&_th:nth-child(4)]:table-cell"
            >
              <Table className="crm-management-table table-fixed">
                <TableHeader className="crm-management-sticky-header sticky top-0 z-20">
                  <TableRow className="border-b border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
                    <TableHead className="w-[70px] px-2 sm:w-[104px] sm:px-3 md:w-[124px] md:px-4">
                      Status
                    </TableHead>
                    <TableHead className="w-auto md:w-[220px]">
                      Nome da equipe
                    </TableHead>
                    <TableHead className="md:w-[42%]">Membros</TableHead>
                    <TableHead className="md:w-[210px]">Criada por</TableHead>
                    <TableHead className="w-[80px] px-1 text-right sm:w-[88px] sm:px-2 md:w-[104px] md:px-3">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTeams.map((team) => {
                    const members = team.members || [];
                    const previewMembers = [...members]
                      .sort(
                        (left, right) =>
                          Number(Boolean(right.is_leader)) -
                          Number(Boolean(left.is_leader)),
                      )
                      .slice(0, MEMBER_PREVIEW_LIMIT);
                    const remainingMembers =
                      members.length - previewMembers.length;
                    const leadersCount = members.filter(
                      (member) => member.is_leader,
                    ).length;
                    const createdDate = new Date(team.created_at);
                    const createdAt = Number.isNaN(createdDate.getTime())
                      ? "Data não informada"
                      : format(createdDate, "dd/MM/yyyy HH:mm", {
                          locale: ptBR,
                        });
                    const creator =
                      team.created_by_user?.name ||
                      team.created_by_user?.email ||
                      "Não informado";
                    const canEditCurrentTeam = canEditTeam(
                      teamManagementAccess,
                      team.id,
                    );

                    return (
                      <TableRow
                        key={team.id}
                        role={canEditCurrentTeam ? "button" : undefined}
                        tabIndex={canEditCurrentTeam ? 0 : undefined}
                        aria-label={canEditCurrentTeam ? `Editar equipe ${team.name}` : undefined}
                        className={`border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] outline-none hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 last:border-b-0 ${canEditCurrentTeam ? "cursor-pointer" : "cursor-default"}`}
                        onClick={canEditCurrentTeam ? () => handleEdit(team) : undefined}
                        onKeyDown={(event) => {
                          if (!canEditCurrentTeam) return;
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleEdit(team);
                          }
                        }}
                      >
                        <TableCell
                          className="px-2 sm:px-3 md:px-4"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {canManageAllTeams ? (
                            <div className="flex min-w-0 items-center gap-2">
                              <Switch
                                checked={team.is_active !== false}
                                disabled={updateTeamStatus.isPending}
                                onCheckedChange={(checked) =>
                                  updateTeamStatus.mutate({
                                    id: team.id,
                                    is_active: checked,
                                  })
                                }
                                aria-label={
                                  team.is_active !== false
                                    ? "Desativar equipe"
                                    : "Ativar equipe"
                                }
                              />
                              <span className="hidden truncate text-[11px] font-light text-[var(--app-text-secondary)] sm:inline">
                                {team.is_active !== false ? "Ativa" : "Inativa"}
                              </span>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1.5 text-[11px] font-light text-[var(--app-text-secondary)]">
                              <span
                                aria-hidden="true"
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  team.is_active !== false
                                    ? "bg-emerald-500"
                                    : "bg-[var(--app-text-tertiary)]"
                                }`}
                              />
                              <span className="hidden sm:inline">
                                {team.is_active !== false ? "Ativa" : "Inativa"}
                              </span>
                              <span className="sr-only sm:hidden">
                                {team.is_active !== false ? "Ativa" : "Inativa"}
                              </span>
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="min-w-0 px-2 sm:px-3 md:px-4">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar className="hidden h-8 w-8 shrink-0 border-0 sm:flex">
                              <AvatarImage
                                src={team.logo_url || undefined}
                                alt=""
                              />
                              <AvatarFallback className="bg-primary/50 text-[11px] font-light text-white">
                                {getInitials(team.name || "EQ")}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                                {team.name}
                              </div>
                              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] font-light text-[var(--app-text-tertiary)] md:hidden">
                                {previewMembers.length > 0 && (
                                  <span
                                    className="flex shrink-0 items-center -space-x-1.5"
                                    aria-hidden="true"
                                  >
                                    {previewMembers
                                      .slice(0, 3)
                                      .map((member) => (
                                        <Avatar
                                          key={member.id}
                                          className="h-5 w-5 border border-[var(--app-surface-solid)]"
                                        >
                                          <AvatarImage
                                            src={
                                              member.user?.avatar_url ||
                                              undefined
                                            }
                                            alt=""
                                          />
                                          <AvatarFallback className="bg-primary/50 text-[7px] font-light text-white">
                                            {getInitials(getMemberName(member))}
                                          </AvatarFallback>
                                        </Avatar>
                                      ))}
                                  </span>
                                )}
                                <span className="truncate">
                                  {team.is_active !== false
                                    ? "Ativa"
                                    : "Inativa"}
                                  {" · "}
                                  {members.length}{" "}
                                  {members.length === 1 ? "membro" : "membros"}
                                </span>
                              </div>
                              <div className="hidden truncate text-[11px] font-light text-[var(--app-text-tertiary)] md:block">
                                {members.length}{" "}
                                {members.length === 1 ? "membro" : "membros"}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell className="min-w-0">
                          {members.length > 0 ? (
                            <div className="flex min-w-0 items-center gap-3 py-1 pr-1">
                              <div className="flex shrink-0 items-center -space-x-2">
                                {previewMembers.map((member) => {
                                  const memberName = getMemberName(member);
                                  const availabilitySummary =
                                    getMemberAvailabilitySummary(member.id);

                                  return (
                                    <Tooltip key={member.id}>
                                      <TooltipTrigger asChild>
                                        <button
                                          data-tour="management-team-member"
                                          type="button"
                                          aria-label={`Ver disponibilidade de ${memberName}`}
                                          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-primary/30"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openAvailability(member, !canEditCurrentTeam);
                                          }}
                                        >
                                          <Avatar className="h-8 w-8 border-2 border-[var(--app-surface-solid)] shadow-none">
                                            <AvatarImage
                                              src={
                                                member.user?.avatar_url ||
                                                undefined
                                              }
                                              alt=""
                                            />
                                            <AvatarFallback className="bg-primary/50 text-[10px] font-light text-white">
                                              {getInitials(memberName)}
                                            </AvatarFallback>
                                          </Avatar>
                                          {member.is_leader && (
                                            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-[var(--app-surface-solid)] bg-primary text-primary-foreground shadow-none">
                                              <Crown
                                                className="h-2.5 w-2.5"
                                                aria-hidden="true"
                                              />
                                            </span>
                                          )}
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent className="max-w-[260px] p-3">
                                        <div className="flex items-center gap-3">
                                          <Avatar className="h-9 w-9">
                                            <AvatarImage
                                              src={
                                                member.user?.avatar_url ||
                                                undefined
                                              }
                                              alt=""
                                            />
                                            <AvatarFallback className="bg-primary/50 text-[11px] font-light text-white">
                                              {getInitials(memberName)}
                                            </AvatarFallback>
                                          </Avatar>
                                          <div className="min-w-0">
                                            <p className="truncate font-medium">
                                              {memberName}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              {availabilitySummary}
                                            </p>
                                          </div>
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  );
                                })}
                                {remainingMembers > 0 && (
                                  <span
                                    className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-[var(--app-surface-solid)] bg-[var(--app-surface-soft)] text-[10px] font-medium text-[var(--app-text-secondary)]"
                                    aria-label={`Mais ${remainingMembers} ${remainingMembers === 1 ? "membro" : "membros"}`}
                                  >
                                    +{remainingMembers}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p
                                  className="truncate text-[12px] font-light text-[var(--app-text-primary)]"
                                  title={members.map(getMemberName).join(", ")}
                                >
                                  {getMemberSummary(members)}
                                </p>
                                <p className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]">
                                  {members.length}{" "}
                                  {members.length === 1 ? "membro" : "membros"}
                                  {leadersCount > 0 && (
                                    <>
                                      {" · "}
                                      {leadersCount}{" "}
                                      {leadersCount === 1 ? "líder" : "líderes"}
                                    </>
                                  )}
                                </p>
                              </div>
                            </div>
                          ) : canEditCurrentTeam ? (
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto p-0 text-[12px] font-light"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleEdit(team);
                              }}
                            >
                              Adicionar membros
                            </Button>
                          ) : (
                            <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                              Nenhum membro
                            </span>
                          )}
                        </TableCell>

                        <TableCell className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar className="h-7 w-7 shrink-0 border-0">
                              <AvatarImage
                                src={
                                  team.created_by_user?.avatar_url || undefined
                                }
                                alt=""
                              />
                              <AvatarFallback className="bg-[var(--app-surface-soft)] text-[9px] font-light text-[var(--app-text-secondary)]">
                                {getInitials(creator)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="truncate text-[12px] font-light text-[var(--app-text-primary)]">
                                {creator}
                              </div>
                              <div className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]">
                                {createdAt}
                              </div>
                            </div>
                          </div>
                        </TableCell>

                        <TableCell
                          className="w-[80px] px-1 sm:w-[88px] sm:px-2 md:w-auto md:px-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex justify-end gap-0.5 sm:gap-1">
                            {canEditCurrentTeam && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    data-tour="management-team-edit"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                                    aria-label={`Editar equipe ${team.name}`}
                                    onClick={() => handleEdit(team)}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Editar equipe</TooltipContent>
                              </Tooltip>
                            )}
                            {canManageAllTeams && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={deleteTeam.isPending}
                                    className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] shadow-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                                    aria-label={`Excluir equipe ${team.name}`}
                                    onClick={() => handleDelete(team)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Excluir equipe</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        {availabilityMember && (
          <MemberAvailabilityDialog
            open={!!availabilityMember}
            onOpenChange={(open) => !open && setAvailabilityMember(null)}
            teamMemberId={availabilityMember.id}
            memberName={availabilityMember.name}
            memberAvatar={availabilityMember.avatar}
            readOnly={availabilityMember.readOnly}
          />
        )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="w-[calc(100vw-24px)] rounded-[8px] border-0 sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-[14px] font-normal">
                Excluir equipe?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-[12px] font-light leading-[18px]">
                Tem certeza que deseja excluir a equipe &quot;
                {teamToDelete?.name}&quot;? Esta ação não pode ser desfeita. Os
                membros serão removidos da equipe, mas suas contas permanecerão
                ativas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-9 rounded-[6px] text-[12px] font-light">
                Cancelar
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(event) => {
                  event.preventDefault();
                  void confirmDelete();
                }}
                disabled={deleteTeam.isPending}
                className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteTeam.isPending && (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                )}
                {deleteTeam.isPending ? "Excluindo..." : "Excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
