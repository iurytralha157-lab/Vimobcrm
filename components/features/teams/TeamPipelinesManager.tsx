import { useState } from "react";
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
  const { data: teams = [], isLoading: teamsLoading } = useTeams();
  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const { data: allTeamPipelines = [] } = useAllTeamPipelines();
  const assignPipeline = useAssignPipelineToTeam();
  const removePipeline = useRemovePipelineFromTeam();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const isLoading = teamsLoading || pipelinesLoading;
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
    if (isAssigned) {
      await removePipeline.mutateAsync({ teamId, pipelineId });
    } else {
      await assignPipeline.mutateAsync({ teamId, pipelineId });
    }
  };

  const openTeamPipelines = (teamId: string) => {
    setSelectedTeamId(teamId);
    setDialogOpen(true);
  };

  const selectedTeam = teams.find((team) => team.id === selectedTeamId);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)]">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--app-text-tertiary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
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
                          <span className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
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
                            className="gap-1 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                          >
                            <GitBranch className="h-3 w-3" />
                            {pipeline.name}
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
                          <span className="truncate text-[13px] font-light text-[var(--app-text-primary)]">
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
                                className="gap-1 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                              >
                                <Users className="h-3 w-3" />
                                {team.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="flex items-center gap-1 pl-9 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            <Unlink className="h-3 w-3" />
                            Acessível a todos os usuários
                          </p>
                        )}
                      </div>

                      {hasTeams && (
                        <Badge
                          variant="secondary"
                          className="shrink-0 rounded-[4px] border-0 bg-[var(--app-surface-solid)] text-[10px] font-light text-[var(--app-text-secondary)]"
                        >
                          Restrita
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] w-[calc(100vw-24px)] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[14px] font-normal">
              <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white">
                <Users className="h-4 w-4" />
              </span>
              {selectedTeam?.name}
            </DialogTitle>
            <DialogDescription className="text-[12px] font-light leading-[18px]">
              Selecione as pipelines que esta equipe terá acesso.
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="-mx-6 max-h-[400px] px-6">
            <div className="space-y-2">
              {pipelines.map((pipeline) => {
                const isAssigned = selectedTeamId
                  ? isPipelineAssigned(selectedTeamId, pipeline.id)
                  : false;
                const isProcessing =
                  assignPipeline.isPending || removePipeline.isPending;

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
                        disabled={isProcessing}
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
