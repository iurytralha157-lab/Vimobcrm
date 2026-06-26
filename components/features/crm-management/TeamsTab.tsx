import { useState } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Crown, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { TeamDialog } from '@/components/features/teams/TeamDialog';
import { MemberAvailabilityDialog } from '@/components/features/teams/MemberAvailabilityDialog';
import { useTeams, useDeleteTeam, useUpdateTeamStatus, Team } from '@/hooks/use-teams';
import { useTeamMembersAvailability, formatAvailabilitySummary } from '@/hooks/use-member-availability';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';

export function TeamsTab() {
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
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
  const visibleTeams = accessScope.isAdmin ? teams : teams.filter((team) => accessScope.ledTeamIds.includes(team.id));

  const allMemberIds = visibleTeams.flatMap((team) => team.members?.map((member) => member.id) || []);
  const { data: allAvailability = [] } = useTeamMembersAvailability(allMemberIds);

  const getMemberAvailability = (memberId: string) => {
    return allAvailability.filter((availability) => availability.team_member_id === memberId);
  };

  const handleEdit = (team: Team) => {
    setSelectedTeam(team);
    setTeamDialogOpen(true);
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
    setSelectedTeam(null);
    setTeamDialogOpen(true);
  };

  const openAvailability = (member: NonNullable<Team['members']>[number]) => {
    setAvailabilityMember({
      id: member.id,
      name: member.user?.name || '',
      avatar: member.user?.avatar_url,
    });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-2 rounded-lg border border-white/[0.055] bg-[var(--app-surface)] p-3">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  const totalMembers = visibleTeams.reduce((acc, team) => acc + (team.members?.length || 0), 0);
  const activeTeams = visibleTeams.filter((team) => team.is_active !== false).length;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Equipes</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {visibleTeams.length} {visibleTeams.length === 1 ? 'equipe' : 'equipes'} · {activeTeams}{' '}
              {activeTeams === 1 ? 'ativa' : 'ativas'} · {totalMembers} {totalMembers === 1 ? 'membro' : 'membros'}
            </p>
          </div>
          {accessScope.isAdmin && (
            <Button onClick={handleNewTeam} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Equipe
            </Button>
          )}
        </div>

        {visibleTeams.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.025] py-16 text-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Users className="h-8 w-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Crie sua primeira equipe</h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              Organize seus corretores em equipes e configure a disponibilidade de cada um.
            </p>
            {accessScope.isAdmin && (
              <Button onClick={handleNewTeam} size="lg" className="gap-2">
                <Plus className="h-4 w-4" />
                Nova Equipe
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-white/[0.055] bg-[var(--app-surface)] [&_td:nth-child(n+3)]:hidden [&_th:nth-child(n+3)]:hidden md:[&_td:nth-child(n+3)]:table-cell md:[&_th:nth-child(n+3)]:table-cell">
            <Table className="table-fixed md:table-auto">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[64px] px-3 md:w-[72px] md:px-4">Status</TableHead>
                  <TableHead className="w-auto">Nome da equipe</TableHead>
                  <TableHead>Membros</TableHead>
                  <TableHead>Criada por</TableHead>
                  <TableHead className="w-[112px] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTeams.map((team) => {
                  const members = team.members || [];
                  const createdAt = format(new Date(team.created_at), 'dd/MM/yyyy HH:mm', { locale: ptBR });
                  const creator = team.created_by_user?.name || team.created_by_user?.email || 'Não informado';

                  return (
                    <TableRow key={team.id} className="cursor-pointer" onClick={() => handleEdit(team)}>
                      <TableCell className="px-3 md:px-4" onClick={(event) => event.stopPropagation()}>
                        {accessScope.isAdmin ? (
                          <Switch
                            checked={team.is_active !== false}
                            onCheckedChange={(checked) => updateTeamStatus.mutate({ id: team.id, is_active: checked })}
                            aria-label={team.is_active !== false ? 'Desativar equipe' : 'Ativar equipe'}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">Ativa</span>
                        )}
                      </TableCell>

                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2.5 md:gap-3">
                          <Avatar className="h-9 w-9 shrink-0 border-2 border-background md:h-10 md:w-10">
                            <AvatarImage src={team.logo_url || undefined} />
                            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                              {getInitials(team.name || 'EQ')}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium">{team.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {members.length} {members.length === 1 ? 'membro' : 'membros'}
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        {members.length > 0 ? (
                          <div className="flex max-w-[560px] items-center gap-0.5 overflow-x-auto overflow-y-hidden py-1 pr-1 [scrollbar-width:thin]">
                            {members.map((member) => {
                              const availabilitySummary = formatAvailabilitySummary(getMemberAvailability(member.id));

                              return (
                                <Tooltip key={member.id}>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="relative shrink-0 rounded-full transition hover:z-10 hover:scale-105"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        openAvailability(member);
                                      }}
                                    >
                                      <Avatar className="h-8 w-8 border border-background shadow-sm">
                                        <AvatarImage src={member.user?.avatar_url || undefined} />
                                        <AvatarFallback className="bg-primary text-[10px] text-primary-foreground">
                                          {getInitials(member.user?.name || '?')}
                                        </AvatarFallback>
                                      </Avatar>
                                      {member.is_leader && (
                                        <span className="absolute -right-0.5 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black text-amber-400 shadow-sm ring-1 ring-amber-400/40">
                                          <Crown className="h-2 w-2 fill-amber-400/25" />
                                        </span>
                                      )}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[260px] p-3">
                                    <div className="flex items-center gap-3">
                                      <Avatar className="h-9 w-9">
                                        <AvatarImage src={member.user?.avatar_url || undefined} />
                                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                          {getInitials(member.user?.name || '?')}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div>
                                        <p className="font-medium">{member.user?.name || 'Usuário'}</p>
                                        <p className="text-xs text-muted-foreground">{availabilitySummary}</p>
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
                            className="h-auto p-0"
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
                        <div className="text-sm">{creator}</div>
                        <div className="text-xs text-muted-foreground">{createdAt}</div>
                      </TableCell>

                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(team)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {accessScope.isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
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

        <TeamDialog
          open={teamDialogOpen}
          onOpenChange={setTeamDialogOpen}
          team={selectedTeam}
          canEditLeadership={accessScope.isAdmin}
        />

        {availabilityMember && (
          <MemberAvailabilityDialog
            open={!!availabilityMember}
            onOpenChange={(open) => !open && setAvailabilityMember(null)}
            teamMemberId={availabilityMember.id}
            memberName={availabilityMember.name}
            memberAvatar={availabilityMember.avatar}
          />
        )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir equipe?</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir a equipe &quot;{teamToDelete?.name}&quot;? Esta ação não pode ser desfeita. Os
                membros serão removidos da equipe, mas suas contas permanecerão ativas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
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
