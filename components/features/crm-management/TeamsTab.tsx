import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Crown, Pencil, Plus, Trash2, Users } from "lucide-react";
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
import { TeamDialog } from "@/components/features/teams/TeamDialog";
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

export function TeamsTab() {
  const router = useRouter();
  const [tourDialogOpen, setTourDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [availabilityMember, setAvailabilityMember] = useState<{
    id: string;
    name: string;
    avatar?: string | null;
  } | null>(null);

  const { data: teams = [], isLoading } = useTeams({ includeInactive: true });
  const deleteTeam = useDeleteTeam();
  const updateTeamStatus = useUpdateTeamStatus();
  const accessScope = useUserAccessScope();
  const { hasPermission } = useUserPermissions();
  const canManageAllTeams =
    accessScope.isAdmin ||
    (!accessScope.isTeamLeader && hasPermission("team_manage"));
  const visibleTeams = canManageAllTeams
    ? teams
    : teams.filter((team) => accessScope.ledTeamIds.includes(team.id));

  const allMemberIds = visibleTeams.flatMap(
    (team) => team.members?.map((member) => member.id) || [],
  );
  const { data: allAvailability = [] } =
    useTeamMembersAvailability(allMemberIds);

  const getMemberAvailability = (memberId: string) => {
    return allAvailability.filter(
      (availability) => availability.team_member_id === memberId,
    );
  };

  const handleEdit = (team: Team) => {
    router.push(`/crm/management/teams/${team.id}/edit`);
  };

  const handleDelete = (team: Team) => {
    setTeamToDelete(team);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (teamToDelete) {
      await deleteTeam.mutateAsync(teamToDelete.id);
      setDeleteDialogOpen(false);
      setTeamToDelete(null);
    }
  };

  const handleNewTeam = () => {
    if (
      document.documentElement.dataset.setupGuideActiveStep === "teams"
    ) {
      setTourDialogOpen(true);
      return;
    }
    router.push("/crm/management/teams/new");
  };

  useEffect(() => {
    const handleMobileCreate = () => {
      if (!canManageAllTeams) return;
      router.push("/crm/management/teams/new");
    };

    window.addEventListener("vimob:mobile-create-team", handleMobileCreate);
    return () =>
      window.removeEventListener(
        "vimob:mobile-create-team",
        handleMobileCreate,
      );
  }, [canManageAllTeams, router]);

  const openAvailability = (member: NonNullable<Team["members"]>[number]) => {
    setAvailabilityMember({
      id: member.id,
      name: member.user?.name || "",
      avatar: member.user?.avatar_url,
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <>
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
          className="space-y-2 rounded-[8px] bg-[var(--app-surface-solid)] p-2"
        >
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-14 w-full rounded-[6px]" />
          ))}
        </div>
      </>
    );
  }

  return (
    <TooltipProvider>
      <div data-tour="management-teams" className="space-y-3">
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

        {visibleTeams.length === 0 ? (
          <div className="flex min-h-[260px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-10 text-center shadow-none">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[6px] bg-primary/50 text-white">
              <Users className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-[14px] font-normal text-[var(--app-text-primary)]">
              Crie sua primeira equipe
            </h3>
            <p className="mb-4 max-w-sm text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
              Organize seus corretores em equipes e configure a disponibilidade
              de cada um.
            </p>
          </div>
        ) : (
          <div
            data-tour="management-team-list"
            className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none [&_td:nth-child(3)]:hidden [&_td:nth-child(4)]:hidden [&_th:nth-child(3)]:hidden [&_th:nth-child(4)]:hidden md:[&_td:nth-child(3)]:table-cell md:[&_td:nth-child(4)]:table-cell md:[&_th:nth-child(3)]:table-cell md:[&_th:nth-child(4)]:table-cell"
          >
            <Table className="crm-management-table table-fixed">
              <TableHeader>
                <TableRow className="border-b border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
                  <TableHead className="w-[64px] px-3 md:w-[72px] md:px-4">
                    Status
                  </TableHead>
                  <TableHead className="w-auto md:w-[220px]">
                    Nome da equipe
                  </TableHead>
                  <TableHead className="md:w-[42%]">Membros</TableHead>
                  <TableHead className="md:w-[210px]">Criada por</TableHead>
                  <TableHead className="w-[52px] px-2 text-right md:w-[112px] md:px-4">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTeams.map((team) => {
                  const members = team.members || [];
                  const createdAt = format(
                    new Date(team.created_at),
                    "dd/MM/yyyy HH:mm",
                    { locale: ptBR },
                  );
                  const creator =
                    team.created_by_user?.name ||
                    team.created_by_user?.email ||
                    "Não informado";

                  return (
                    <TableRow
                      key={team.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Editar equipe ${team.name}`}
                      className="cursor-pointer border-b border-[var(--app-border)] bg-[var(--app-surface-solid)] outline-none hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30 last:border-b-0"
                      onClick={() => handleEdit(team)}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return;
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleEdit(team);
                        }
                      }}
                    >
                      <TableCell
                        className="px-3 md:px-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {canManageAllTeams ? (
                          <Switch
                            checked={team.is_active !== false}
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
                        ) : (
                          <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                            Ativa
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar className="h-8 w-8 shrink-0 border-0">
                            <AvatarImage src={team.logo_url || undefined} />
                            <AvatarFallback className="bg-primary/50 text-[11px] font-light text-white">
                              {getInitials(team.name || "EQ")}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                              {team.name}
                            </div>
                            <div className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                              {members.length}{" "}
                              {members.length === 1 ? "membro" : "membros"}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        {members.length > 0 ? (
                          <div className="flex max-w-none flex-wrap items-center gap-1 py-1 pr-1">
                            {members.map((member) => {
                              const availabilitySummary =
                                formatAvailabilitySummary(
                                  getMemberAvailability(member.id),
                                );

                              return (
                                <Tooltip key={member.id}>
                                  <TooltipTrigger asChild>
                                    <button
                                      data-tour="management-team-member"
                                      type="button"
                                      aria-label={`Ver disponibilidade de ${member.user?.name || "usuário"}`}
                                      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openAvailability(member);
                                      }}
                                    >
                                      <Avatar className="h-7 w-7 border-0 shadow-none">
                                        <AvatarImage
                                          src={
                                            member.user?.avatar_url || undefined
                                          }
                                        />
                                        <AvatarFallback className="bg-primary/50 text-[10px] font-light text-white">
                                          {getInitials(
                                            member.user?.name || "?",
                                          )}
                                        </AvatarFallback>
                                      </Avatar>
                                      {member.is_leader && (
                                        <span className="absolute -right-0.5 -top-1 flex h-4 w-4 items-center justify-center rounded-[4px] bg-primary/50 text-primary-foreground shadow-none">
                                          <Crown className="h-2.5 w-2.5" aria-hidden="true" />
                                        </span>
                                      )}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[260px] p-3">
                                    <div className="flex items-center gap-3">
                                      <Avatar className="h-9 w-9">
                                        <AvatarImage
                                          src={
                                            member.user?.avatar_url || undefined
                                          }
                                        />
                                        <AvatarFallback className="bg-primary/50 text-[11px] font-light text-white">
                                          {getInitials(
                                            member.user?.name || "?",
                                          )}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <p className="font-medium">
                                          {member.user?.name || "Usuário"}
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
                          </div>
                        ) : (
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
                        )}
                      </TableCell>

                      <TableCell>
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
                            aria-label={`Editar equipe ${team.name}`}
                            onClick={() => handleEdit(team)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canManageAllTeams && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)] shadow-none hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive"
                              aria-label={`Excluir equipe ${team.name}`}
                              onClick={() => handleDelete(team)}
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

        {availabilityMember && (
          <MemberAvailabilityDialog
            open={!!availabilityMember}
            onOpenChange={(open) => !open && setAvailabilityMember(null)}
            teamMemberId={availabilityMember.id}
            memberName={availabilityMember.name}
            memberAvatar={availabilityMember.avatar}
          />
        )}

        <TeamDialog
          open={tourDialogOpen}
          onOpenChange={setTourDialogOpen}
        />

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
                onClick={confirmDelete}
                className="h-9 rounded-[6px] bg-destructive text-[12px] font-light text-destructive-foreground hover:bg-destructive/90"
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}
