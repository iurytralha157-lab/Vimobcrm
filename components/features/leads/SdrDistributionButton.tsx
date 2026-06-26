import { useState } from 'react';
import {
  Users,
  ChevronRight,
  ChevronLeft,
  Search,
  Check,
  Loader2,
  AlertCircle,
  Shuffle,
  UserCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePipelines, useStages } from '@/hooks/use-stages';
import { useAllTeamPipelines } from '@/hooks/use-team-pipelines';
import { useTeams } from '@/hooks/use-teams';
import { useUpdateLead } from '@/hooks/use-leads';
import type { Lead } from '@/hooks/use-leads';
import type { TablesUpdate } from '@/integrations/supabase/types';
import { leadsAPI } from '@/lib/api/leads';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { useAuth } from '@/contexts/AuthContext';

type DistributionLead = Pick<Lead, 'id'> & Partial<Pick<Lead, 'pipeline_id' | 'assigned_user_id'>>;
type LeadDistributionUpdate = Pick<
  TablesUpdate<'leads'>,
  'pipeline_id' | 'stage_id' | 'assigned_user_id'
> & { id: string };

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

interface SdrDistributionButtonProps {
  lead: DistributionLead;
  refetchStages?: () => void;
}

export function SdrDistributionButton({ lead, refetchStages }: SdrDistributionButtonProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'pipeline' | 'mode' | 'manual'>('pipeline');
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();
  const { data: allTeamPipelines = [] } = useAllTeamPipelines();
  const { data: teams = [] } = useTeams();
  const { data: stages = [] } = useStages(selectedPipelineId || undefined);
  const updateLead = useUpdateLead();
  const accessScope = useUserAccessScope();
  const { organization } = useAuth();

  const allowedTeamIds = accessScope.isAdmin ? null : new Set(accessScope.ledTeamIds);
  const allowedPipelineIds = accessScope.isAdmin ? null : new Set(accessScope.ledPipelineIds);

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId);
  const visiblePipelines = accessScope.isAdmin
    ? pipelines
    : pipelines.filter((pipeline) => allowedPipelineIds?.has(pipeline.id));

  // Find teams associated with the selected pipeline
  const pipelineTeams = allTeamPipelines
    .filter(tp => tp.pipeline_id === selectedPipelineId)
    .map(tp => teams.find(t => t.id === tp.team_id))
    .filter((team) => !!team && (accessScope.isAdmin || allowedTeamIds?.has(team.id)));

  // Get all members of those teams
  const teamMembers = pipelineTeams.flatMap(t => t?.members || []);

  // Unique users from those members
  const availableUsers = Array.from(new Map(
    teamMembers.map(m => [m.user?.id, m.user])
  ).values()).filter((u): u is NonNullable<typeof u> => !!u);

  const filteredUsers = availableUsers.filter(u =>
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handlePipelineSelect = (id: string) => {
    if (!accessScope.isAdmin && !allowedPipelineIds?.has(id)) return;
    setSelectedPipelineId(id);
    setStep('mode');
  };

  const handleManualAssign = async (userId: string) => {
    if (!selectedPipelineId || isProcessing) return;
    if (!accessScope.isAdmin && !allowedPipelineIds?.has(selectedPipelineId)) return;
    if (!availableUsers.some((user) => user.id === userId)) {
      toast.error('Você só pode distribuir para membros da sua equipe');
      return;
    }
    setIsProcessing(true);

    try {
      // Find first stage of target pipeline
      const sortedStages = [...stages].sort((a, b) => (a.position || 0) - (b.position || 0));
      const firstStageId = sortedStages[0]?.id;

      if (!firstStageId) {
        throw new Error('Não foi possível encontrar o estágio inicial desta pipeline.');
      }

      const leadUpdate: LeadDistributionUpdate = {
        id: lead.id,
        pipeline_id: selectedPipelineId,
        stage_id: firstStageId,
        assigned_user_id: userId
      };

      await updateLead.mutateAsync(leadUpdate);

      toast.success(`Lead distribuído com sucesso para ${availableUsers.find(u => u?.id === userId)?.name}`);
      setOpen(false);
      if (refetchStages) refetchStages();
    } catch (error: unknown) {
      toast.error('Erro ao distribuir lead: ' + getErrorMessage(error));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAutomaticDistribute = async () => {
    if (!selectedPipelineId || isProcessing) return;
    if (!accessScope.isAdmin && !allowedPipelineIds?.has(selectedPipelineId)) return;
    setIsProcessing(true);

    try {
      // Find first stage of target pipeline
      const sortedStages = [...stages].sort((a, b) => (a.position || 0) - (b.position || 0));
      const firstStageId = sortedStages[0]?.id;

      if (!firstStageId) {
        throw new Error('Não foi possível encontrar o estágio inicial desta pipeline.');
      }

      // 1. Move lead to pipeline
      const leadUpdate: LeadDistributionUpdate = {
        id: lead.id,
        pipeline_id: selectedPipelineId,
        stage_id: firstStageId,
        assigned_user_id: null // Reset to let round robin work
      };

      await updateLead.mutateAsync(leadUpdate);

      const distribution = await leadsAPI.redistributeLeadRoundRobin(lead.id, organization?.id);
      if (distribution.error || !distribution.success) {
        throw new Error(distribution.error || 'Distribuicao automatica nao encontrou uma fila disponivel.');
      }

      toast.success(`Lead movido para ${selectedPipeline?.name} e distribuído automaticamente.`);
      setOpen(false);
      if (refetchStages) refetchStages();
    } catch (error: unknown) {
      toast.error('Erro na distribuição automática: ' + getErrorMessage(error));
    } finally {
      setIsProcessing(false);
    }
  };

  const resetState = () => {
    setStep('pipeline');
    setSelectedPipelineId(null);
    setSearchQuery('');
  };

  return (
    <Popover open={open} onOpenChange={(val) => {
      setOpen(val);
      if (!val) resetState();
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Users className="h-3.5 w-3.5" />
          Distribuir SDR
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] sm:w-[380px] p-0" align="start">
        <div className="p-3 border-b border-white/[0.055] bg-white/[0.035]">
          <div className="flex items-center gap-2">
            {step !== 'pipeline' && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setStep(step === 'manual' ? 'mode' : 'pipeline')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <h4 className="font-semibold text-sm">
              {step === 'pipeline' && 'Selecionar Pipeline'}
              {step === 'mode' && 'Modo de Distribuição'}
              {step === 'manual' && 'Distribuir Manualmente'}
            </h4>
          </div>
        </div>

        <div className="p-2">
          {step === 'pipeline' && (
            <div className="space-y-1">
              {pipelinesLoading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                visiblePipelines.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handlePipelineSelect(p.id)}
                    className={cn(
                      "w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-accent transition-colors text-left",
                      lead.pipeline_id === p.id && "bg-primary/5 border border-primary/20"
                    )}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      {lead.pipeline_id === p.id && <span className="text-[10px] text-primary font-medium">Pipeline Atual</span>}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))
              )}
              {!pipelinesLoading && visiblePipelines.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Nenhuma pipeline liberada para sua equipe.
                </div>
              )}
            </div>
          )}

          {step === 'mode' && (
            <div className="space-y-3 p-1">
              <div className="bg-primary/5 rounded-lg p-3 border border-primary/10 mb-4">
                <p className="text-xs text-muted-foreground mb-1">Pipeline selecionada:</p>
                <p className="text-sm font-semibold text-primary">{selectedPipeline?.name}</p>
              </div>

              {pipelineTeams.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {pipelineTeams.map(t => (
                      <Badge key={t?.id} variant="secondary" className="text-[10px] h-5">
                        Equipe: {t?.name}
                      </Badge>
                    ))}
                  </div>

                  <Button
                    variant="outline"
                    className="w-full justify-start h-12 gap-3"
                    onClick={() => setStep('manual')}
                    disabled={isProcessing}
                  >
                    <div className="h-8 w-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <UserCheck className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">Distribuir Manualmente</p>
                      <p className="text-[10px] text-muted-foreground">Escolher o responsável</p>
                    </div>
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-start h-12 gap-3"
                    onClick={handleAutomaticDistribute}
                    disabled={isProcessing}
                  >
                    <div className="h-8 w-8 rounded-lg bg-orange-100 flex items-center justify-center">
                      <Shuffle className="h-4 w-4 text-orange-600" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">Distribuir Automaticamente</p>
                      <p className="text-[10px] text-muted-foreground">Usar fila Round Robin</p>
                    </div>
                    {isProcessing && <Loader2 className="h-4 w-4 ml-auto animate-spin" />}
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-6 text-center">
                  <AlertCircle className="h-10 w-10 text-amber-500 mb-3 opacity-50" />
                  <p className="text-sm font-medium">Nenhuma equipe vinculada</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Esta pipeline não possui equipes configuradas para distribuição.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full"
                    onClick={() => setStep('manual')}
                    disabled={isProcessing}
                  >
                    Distribuir Manualmente
                  </Button>
                </div>
              )}
            </div>
          )}

          {step === 'manual' && (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar usuário..."
                  className="pl-9 h-9 text-sm"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <ScrollArea className="h-[400px]">
                <div className="space-y-1 py-1">
                  {filteredUsers.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      Nenhum usuário encontrado
                    </div>
                  ) : (
                    filteredUsers.map(user => (
                      <button
                        key={user.id}
                        onClick={() => handleManualAssign(user.id)}
                        disabled={isProcessing}
                        className={cn(
                          "w-full flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors text-left",
                          lead.assigned_user_id === user.id && "bg-primary/5"
                        )}
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={user.avatar_url || undefined} />
                          <AvatarFallback className="text-[10px]">
                            {user.name?.[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{user.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
                        </div>
                        {lead.assigned_user_id === user.id && (
                          <Check className="h-4 w-4 text-primary shrink-0" />
                        )}
                        {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
