"use client";

import { useState, useRef } from "react";
import {
  Check,
  Crown,
  GitBranch,
  Link as LinkIcon,
  Loader2,
  Unlink,
  Users,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useAllTeamPipelines,
  useAssignPipelineToTeam,
  useRemovePipelineFromTeam,
} from "@/hooks/use-team-pipelines";
import { useTeams } from "@/hooks/use-teams";
import { usePipelines } from "@/hooks/use-stages";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { canManageTeamPipeline, getTeamPipelineQueryState } from "@/lib/teams/team-pipeline-management";

type TeamPipelineRelation = {
  team_id: string;
  pipeline_id: string;
  pipeline: {
    id: string;
    name: string;
  } | null;
  team?: {
    id: string;
    name: string;
  } | null;
};

export function TeamPipelinesManager() {
  const { activeOrganization } = useAuth();
  return <TeamPipelinesManagement key={activeOrganization.organizationId || 'none'} />;
}

function TeamPipelinesManagement() {
  const accessScope = useUserAccessScope();
  const { hasPermission } = useUserPermissions();
  const canReadTeams = accessScope.isAdmin || hasPermission('team_view');
  const teamsQuery = useTeams({ enabled: canReadTeams });
  const pipelinesQuery = usePipelines();
  const relationsQuery = useAllTeamPipelines({ enabled: canReadTeams });
  const teams = teamsQuery.data || [];
  const pipelines = pipelinesQuery.data || [];
  const allTeamPipelines = relationsQuery.data || [];
  const assignPipeline = useAssignPipelineToTeam();
  const removePipeline = useRemovePipelineFromTeam();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const queryState = getTeamPipelineQueryState([teamsQuery, pipelinesQuery, relationsQuery]);
  const isRefreshing = teamsQuery.isFetching || pipelinesQuery.isFetching || relationsQuery.isFetching;
  const isProcessing = assignPipeline.isPending || removePipeline.isPending;
  const operation = useRef(false);
  const canManageTeam = (teamId: string) => canManageTeamPipeline({
    ...accessScope, hasPipelinePermission: hasPermission('pipeline_manage'),
  }, teamId);
  const hasPartialScope = accessScope.isTeamLeader && !accessScope.isAdmin && accessScope.memberRole !== 'manager';
  const teamPipelineRelations = allTeamPipelines as TeamPipelineRelation[];

  const getTeamPipelines = (teamId: string) =>
    teamPipelineRelations
      .filter((relation) => relation.team_id === teamId)
      .map((relation) => relation.pipeline)
      .filter(
        (pipeline): pipeline is NonNullable<TeamPipelineRelation["pipeline"]> =>
          !!pipeline,
      );

  const getPipelineTeams = (pipelineId: string) =>
    teamPipelineRelations
      .filter((relation) => relation.pipeline_id === pipelineId)
      .map((relation) => relation.team)
      .filter(
        (team): team is NonNullable<TeamPipelineRelation["team"]> => !!team,
      );

  const isPipelineAssigned = (teamId: string, pipelineId: string) =>
    teamPipelineRelations.some(
      (relation) =>
        relation.team_id === teamId && relation.pipeline_id === pipelineId,
    );

  const handleTogglePipeline = async (
    teamId: string,
    pipelineId: string,
    isAssigned: boolean,
  ) => {
    if (operation.current || isRefreshing || !canManageTeam(teamId)) return;
    operation.current = true;
    try {
      if (isAssigned) await removePipeline.mutateAsync({ teamId, pipelineId });
      else await assignPipeline.mutateAsync({ teamId, pipelineId });
    } catch {
      // Mutations display the error; preserve the authoritative checked value.
    } finally {
      operation.current = false;
    }
  };

  const openTeamPipelines = (teamId: string) => {
    setSelectedTeamId(teamId);
    setDialogOpen(true);
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);

  if (!canReadTeams) {
    return <div role="alert" className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-[12px]">A visualização destes vínculos exige a permissão de visualizar equipes.</div>;
  }

  if (queryState === 'error' || accessScope.isError) {
    return <div role="alert" className="space-y-3 rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-[12px]">
      <p>Não foi possível carregar equipes, pipelines e seus vínculos. Tente novamente antes de alterar.</p>
      <Button variant="secondary" disabled={isRefreshing} onClick={() => void Promise.all([teamsQuery.refetch(), pipelinesQuery.refetch(), relationsQuery.refetch(), accessScope.refetch()])}>Tentar novamente</Button>
    </div>;
  }

  if (queryState === 'loading' || accessScope.isLoading) {
    return (
      <div role="status" aria-label="Carregando equipes e vínculos de pipelines" className="flex h-64 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-tertiary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[var(--app-text-secondary)]">Os vínculos organizam as pipelines das equipes. A visualização de leads segue as permissões de cada usuário.{hasPartialScope && ' Esta lista mostra apenas os vínculos das equipes que você lidera.'}</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="space-y-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
              <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                <Users className="h-4 w-4" />
              </span>
              Equipes
            </CardTitle>
            <CardDescription className="text-[12px] font-light leading-[18px]">
              Clique em uma equipe para gerenciar suas pipelines.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-1 sm:p-4 sm:pt-2">
            {teams.length === 0 ? (
              <p className="py-8 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
                Nenhuma equipe criada. Crie equipes na aba &quot;Equipes&quot;.
              </p>
            ) : (
              teams.map((team) => {
                const teamPipelines = getTeamPipelines(team.id);
                const leaders = (team.members || []).filter(
                  (member) => member.is_leader,
                );
                const isSelected = selectedTeamId === team.id;

                return (
                  <div
                    key={team.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openTeamPipelines(team.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openTeamPipelines(team.id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer rounded-[6px] bg-[var(--app-surface-soft)] p-3 outline-none transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30",
                      isSelected && "bg-primary/10",
                    )}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span title={team.name} className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                            {team.name}
                          </span>
                          {leaders.length > 0 && (
                            <span className="flex min-w-0 items-center gap-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
                              <Crown className="h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate">
                                {leaders
                                  .map(
                                    (leader) =>
                                      leader.user?.name?.split(" ")[0],
                                  )
                                  .filter(Boolean)
                                  .join(", ")}
                              </span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-1">
                            {(team.members || []).slice(0, 5).map((member) => (
                              <Avatar
                                key={member.id}
                                className="h-6 w-6 border-0 shadow-none"
                              >
                                <AvatarFallback className="bg-primary/50 text-[9px] font-light text-white">
                                  {member.user?.name
                                    ?.split(" ")
                                    .map((name) => name[0])
                                    .join("")
                                    .slice(0, 2) || "?"}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                            {(team.members?.length || 0) > 5 && (
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--app-surface-solid)] text-[9px] font-light text-[var(--app-text-tertiary)]">
                                +{(team.members?.length || 0) - 5}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                            {team.members?.length || 0} membros
                          </span>
                        </div>
                      </div>

                      <Badge
                        variant="secondary"
                        className="shrink-0 gap-1 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                      >
                        {teamPipelines.length > 0 && (
                          <LinkIcon className="h-3 w-3" />
                        )}
                        {teamPipelines.length > 0
                          ? teamPipelines.length
                          : "Sem pipelines"}
                      </Badge>
                    </div>

                    {teamPipelines.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--app-border)] pt-3">
                        {teamPipelines.map((pipeline) => (
                          <Badge
                            key={pipeline.id}
                            variant="secondary"
                            className="min-w-0 max-w-full gap-1 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                          >
                            <GitBranch className="h-3 w-3" />
                            <span className="min-w-0 truncate" title={pipeline.name}>{pipeline.name}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
          <CardHeader className="space-y-1 p-4 pb-2">
            <CardTitle className="flex items-center gap-2 text-[14px] font-normal">
              <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                <GitBranch className="h-4 w-4" />
              </span>
              Pipelines
            </CardTitle>
            <CardDescription className="text-[12px] font-light leading-[18px]">
              Visão geral das pipelines e suas equipes vinculadas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 p-3 pt-1 sm:p-4 sm:pt-2">
            {pipelines.length === 0 ? (
              <p className="py-8 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
                Nenhuma pipeline criada.
              </p>
            ) : (
              pipelines.map((pipeline) => {
                const pipelineTeams = getPipelineTeams(pipeline.id);
                const hasTeams = pipelineTeams.length > 0;

                return (
                  <div
                    key={pipeline.id}
                    className="rounded-[6px] bg-[var(--app-surface-soft)] p-3"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                            <GitBranch className="h-3.5 w-3.5" />
                          </span>
                          <span title={pipeline.name} className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
                            {pipeline.name}
                          </span>
                          {pipeline.is_default && (
                            <Badge
                              variant="secondary"
                              className="rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                            >
                              Padrão
                            </Badge>
                          )}
                        </div>

                        {hasTeams ? (
                          <div className="flex flex-wrap gap-1.5 pl-9">
                            {pipelineTeams.map((team) => (
                              <Badge
                                key={team.id}
                                variant="secondary"
                                className="min-w-0 max-w-full gap-1 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                              >
                                <Users className="h-3 w-3" />
                                <span className="min-w-0 truncate" title={team.name}>{team.name}</span>
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="flex items-center gap-1 pl-9 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            <Unlink className="h-3 w-3" />
                             {hasPartialScope ? 'Nenhum vínculo visível neste escopo' : 'Sem equipe vinculada'}
                          </p>
                        )}
                      </div>

                      {hasTeams && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                        >
                           Com vínculos
                        </Badge>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!isProcessing && !operation.current) setDialogOpen(open); }}>
        <DialogContent data-management-editor className="max-h-[90dvh] w-[calc(100vw-24px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px] font-normal">
              <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                <Users className="h-4 w-4" />
              </span>
              {selectedTeam?.name}
            </DialogTitle>
            <DialogDescription className="text-[12px] font-light leading-[18px]">
              {selectedTeamId && canManageTeam(selectedTeamId) ? 'Selecione as pipelines vinculadas a esta equipe.' : 'Visualização dos vínculos desta equipe. Você não tem permissão para alterá-los.'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="-mx-6 max-h-[400px] px-6">
            <div className="space-y-2">
              {pipelines.map((pipeline) => {
                const isAssigned = selectedTeamId
                  ? isPipelineAssigned(selectedTeamId, pipeline.id)
                  : false;

                return (
                  <label
                    key={pipeline.id}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-[6px] bg-[var(--app-surface-soft)] p-3 transition-colors hover:bg-[var(--app-surface-hover)]",
                      isAssigned && "bg-primary/10",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Checkbox
                        checked={isAssigned}
                        disabled={isProcessing || isRefreshing || !selectedTeamId || !canManageTeam(selectedTeamId)}
                        aria-label={`Vincular pipeline ${pipeline.name} à equipe ${selectedTeam?.name || ''}`}
                        onCheckedChange={() => {
                          if (selectedTeamId) {
                            void handleTogglePipeline(
                              selectedTeamId,
                              pipeline.id,
                              isAssigned,
                            );
                          }
                        }}
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <GitBranch className="h-4 w-4 shrink-0 text-[var(--app-text-tertiary)]" />
                          <span className="truncate text-[12px] font-light text-[var(--app-text-primary)]">
                            {pipeline.name}
                          </span>
                        </div>
                        {pipeline.is_default && (
                          <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                            Pipeline padrão
                          </span>
                        )}
                      </div>
                    </div>

                    {isAssigned && (
                      <Check className="h-4 w-4 shrink-0 text-primary" />
                    )}
                  </label>
                );
              })}
            </div>
          </ScrollArea>

          <Button
            variant="secondary"
            disabled={isProcessing}
            className="h-9 w-full rounded-[6px] border-0 text-[12px] font-light shadow-none"
            onClick={() => setDialogOpen(false)}
          >
            Fechar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
