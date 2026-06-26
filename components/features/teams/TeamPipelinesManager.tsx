import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  GitBranch,
  Link as LinkIcon,
  Unlink,
  Crown,
  Check,
  Loader2,
} from 'lucide-react';
import { useTeams } from '@/hooks/use-teams';
import { usePipelines } from '@/hooks/use-stages';
import {
  useAllTeamPipelines,
  useAssignPipelineToTeam,
  useRemovePipelineFromTeam,
} from '@/hooks/use-team-pipelines';
import { cn } from '@/lib/utils';

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

  const getTeamPipelines = (teamId: string) => {
    return teamPipelineRelations
      .filter((tp) => tp.team_id === teamId)
      .map((tp) => tp.pipeline)
      .filter((pipeline): pipeline is NonNullable<TeamPipelineRelation["pipeline"]> => !!pipeline);
  };

  const getPipelineTeams = (pipelineId: string) => {
    return teamPipelineRelations
      .filter((tp) => tp.pipeline_id === pipelineId)
      .map((tp) => tp.team)
      .filter((team): team is NonNullable<TeamPipelineRelation["team"]> => !!team);
  };

  const isPipelineAssigned = (teamId: string, pipelineId: string) => {
    return teamPipelineRelations.some(
      (tp) => tp.team_id === teamId && tp.pipeline_id === pipelineId
    );
  };

  const handleTogglePipeline = async (teamId: string, pipelineId: string, isAssigned: boolean) => {
    if (isAssigned) {
      await removePipeline.mutateAsync({ teamId, pipelineId });
    } else {
      await assignPipeline.mutateAsync({ teamId, pipelineId });
    }
  };

  const selectedTeam = teams.find(t => t.id === selectedTeamId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Teams Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Equipes
            </CardTitle>
            <CardDescription>
              Clique em uma equipe para gerenciar suas pipelines
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 md:px-6">
            {teams.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma equipe criada. Crie equipes na aba &quot;Equipes&quot;.
              </p>
            ) : (
              teams.map((team) => {
                const teamPipelines = getTeamPipelines(team.id);
                const leaders = (team.members || []).filter(m => m.is_leader);
                const isSelected = selectedTeamId === team.id;

                return (
                  <div
                    key={team.id}
                    onClick={() => {
                      setSelectedTeamId(team.id);
                      setDialogOpen(true);
                    }}
                    className={cn(
                      "p-4 rounded-lg border cursor-pointer transition-all hover:border-primary/50 hover:bg-accent/50",
                      isSelected && "border-primary bg-accent"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{team.name}</span>
                          {leaders.length > 0 && (
                            <div className="flex items-center gap-1">
                              <Crown className="h-3 w-3 text-amber-500" />
                              <span className="text-xs text-muted-foreground">
                                {leaders.map(l => l.user?.name?.split(' ')[0]).join(', ')}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-1.5">
                            {(team.members || []).slice(0, 4).map((member) => (
                              <Avatar key={member.id} className="h-6 w-6 border border-background">
                                <AvatarFallback className="bg-primary text-primary-foreground text-[10px]">
                                  {member.user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?'}
                                </AvatarFallback>
                              </Avatar>
                            ))}
                            {(team.members?.length || 0) > 4 && (
                              <div className="h-6 w-6 rounded-full bg-muted border border-background flex items-center justify-center">
                                <span className="text-[10px] text-muted-foreground">+{(team.members?.length || 0) - 4}</span>
                              </div>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {team.members?.length || 0} membros
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {teamPipelines.length > 0 ? (
                          <Badge variant="secondary" className="gap-1">
                            <LinkIcon className="h-3 w-3" />
                            {teamPipelines.length}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            Sem pipelines
                          </Badge>
                        )}
                      </div>
                    </div>

                    {teamPipelines.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
                        {teamPipelines.map((p) => (
                          <Badge key={p?.id} variant="outline" className="text-xs">
                            <GitBranch className="h-3 w-3 mr-1" />
                            {p?.name}
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

        {/* Pipelines Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5" />
              Pipelines
            </CardTitle>
            <CardDescription>
              Visão geral das pipelines e suas equipes vinculadas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 px-4 md:px-6">
            {pipelines.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Nenhuma pipeline criada.
              </p>
            ) : (
              pipelines.map((pipeline) => {
                const pipelineTeams = getPipelineTeams(pipeline.id);
                const hasTeams = pipelineTeams.length > 0;

                return (
                  <div
                    key={pipeline.id}
                    className={cn(
                      "p-4 rounded-lg border",
                      !hasTeams && "border-dashed"
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{pipeline.name}</span>
                          {pipeline.is_default && (
                            <Badge variant="secondary" className="text-xs">Padrão</Badge>
                          )}
                        </div>

                        {hasTeams ? (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {pipelineTeams.map((team) => (
                              <Badge key={team?.id} variant="outline" className="text-xs gap-1">
                                <Users className="h-3 w-3" />
                                {team?.name}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Unlink className="h-3 w-3" />
                            Acessível a todos os usuários
                          </p>
                        )}
                      </div>

                      {hasTeams && (
                        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
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

      {/* Pipeline Assignment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="w-[90%] sm:max-w-md sm:w-full rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {selectedTeam?.name}
            </DialogTitle>
            <DialogDescription>
              Selecione as pipelines que esta equipe terá acesso
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px] -mx-6 px-6">
            <div className="space-y-2">
              {pipelines.map((pipeline) => {
                const isAssigned = selectedTeamId ? isPipelineAssigned(selectedTeamId, pipeline.id) : false;
                const isProcessing = assignPipeline.isPending || removePipeline.isPending;

                return (
                  <label
                    key={pipeline.id}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all hover:bg-accent",
                      isAssigned && "border-primary bg-primary/5"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        checked={isAssigned}
                        disabled={isProcessing}
                        onCheckedChange={() => {
                          if (selectedTeamId) {
                            handleTogglePipeline(selectedTeamId, pipeline.id, isAssigned);
                          }
                        }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <GitBranch className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium">{pipeline.name}</span>
                        </div>
                        {pipeline.is_default && (
                          <span className="text-xs text-muted-foreground">Pipeline padrão</span>
                        )}
                      </div>
                    </div>

                    {isAssigned && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </label>
                );
              })}
            </div>
          </ScrollArea>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="w-full rounded-xl" onClick={() => setDialogOpen(false)}>
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
