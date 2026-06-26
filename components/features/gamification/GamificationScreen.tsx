'use client';

import { Activity, Award, Flame, Medal, Sparkles, Target, Trophy, Zap, type LucideIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import {
  useGamificationOverview,
  type GamificationOverview,
  type GamificationRankingEntry,
} from '@/hooks/gamification';
import { cn } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  call_made: 'Ligacao realizada',
  message_sent: 'Mensagem enviada',
  contact_made: 'Contato realizado',
  visit_scheduled: 'Visita agendada',
  sale_closed: 'Venda concluida',
  lead_created: 'Novo lead recebido',
  prospecting_report: 'Relatorio de prospeccao',
  mission_bonus: 'Bonus de missao',
  meeting_held: 'Reuniao realizada',
  meeting_scheduled: 'Reuniao agendada',
  proposal_sent: 'Proposta enviada',
  contract_signed: 'Contrato assinado',
  visit_confirmed: 'Visita realizada',
  lead_created_manual: 'Lead criado manualmente',
  property_created: 'Imovel captado',
  manual_entry: 'Lancamento manual',
};

const EMPTY_GAMIFICATION_OVERVIEW: GamificationOverview = {
  ranking: [],
  recentEvents: [],
  missions: [],
  totalPoints: 0,
  activeUsers: 0,
  totalEvents: 0,
  myPosition: null,
};

function formatNumber(value: number) {
  return value.toLocaleString('pt-BR');
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getEventLabel(type: string) {
  return EVENT_LABELS[type] || type.replaceAll('_', ' ');
}

function formatRelativeDate(value: string | null) {
  if (!value) return 'Sem atividade';
  return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ptBR });
}

function getProgress(entry: GamificationRankingEntry) {
  if (entry.xpNextLevel <= 0) return 0;
  return Math.min(100, Math.round((entry.xpCurrentLevel / entry.xpNextLevel) * 100));
}

export default function GamificationScreen() {
  const { overview, isLoading, error } = useGamificationOverview();
  const data = overview ?? EMPTY_GAMIFICATION_OVERVIEW;
  const ranking = data.ranking;
  const podium = ranking.slice(0, 3);
  const topUser = ranking[0];

  return (
    <AppLayout title="Gamificacao">
      <div className="space-y-5">
        {(isLoading || error) && (
          <div className="app-card-soft flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4 text-primary" />
            <span>
              {isLoading
                ? 'Carregando os dados da arena...'
                : 'Arena disponivel. Quando os eventos forem conectados, os dados aparecem automaticamente.'}
            </span>
          </div>
        )}

        <section id="overview" className="grid scroll-mt-4 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Trophy} label="Pontos do time" value={formatNumber(data.totalPoints)} />
          <MetricCard icon={Medal} label="Participantes" value={formatNumber(data.activeUsers)} />
          <MetricCard icon={Zap} label="Eventos registrados" value={formatNumber(data.totalEvents)} />
          <MetricCard
            icon={Award}
            label="Minha posicao"
            value={data.myPosition ? `${data.myPosition} lugar` : '--'}
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <div id="ranking" className="app-card scroll-mt-4 overflow-hidden">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Arena</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Ranking da equipe</h2>
              </div>
              {topUser && (
                <div className="app-card-soft flex items-center gap-3 px-3 py-2">
                  <Flame className="h-4 w-4 text-primary" />
                  <span className="text-xs text-muted-foreground">Lider atual</span>
                  <span className="text-sm font-semibold">{topUser.name}</span>
                </div>
              )}
            </div>

            {ranking.length === 0 ? (
              <EmptyPanel title="Nenhum participante encontrado" />
            ) : (
              <div className="divide-y divide-white/[0.025]">
                {ranking.slice(0, 10).map((entry) => (
                  <RankingRow key={entry.userId} entry={entry} />
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <section id="podium" className="app-card scroll-mt-4 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Podio</p>
                  <h2 className="mt-1 text-lg font-semibold">Top corretores</h2>
                </div>
                <Sparkles className="h-5 w-5 text-primary" />
              </div>

              {podium.length === 0 ? (
                <EmptyPanel title="Sem pontuacao registrada" compact />
              ) : (
                <div className="space-y-2">
                  {podium.map((entry) => (
                    <div key={entry.userId} className="app-card-soft flex items-center gap-3 p-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-white">
                        {entry.position}
                      </div>
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={entry.avatarUrl || undefined} />
                        <AvatarFallback>{getInitials(entry.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{entry.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(entry.points)} pts</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section id="missions" className="app-card scroll-mt-4 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Missoes</p>
                  <h2 className="mt-1 text-lg font-semibold">Desafios ativos</h2>
                </div>
                <Target className="h-5 w-5 text-primary" />
              </div>

              {data.missions.length === 0 ? (
                <EmptyPanel title="Nenhuma missao ativa" compact />
              ) : (
                <div className="space-y-3">
                  {data.missions.map((mission) => {
                    const progress = mission.targetCount > 0
                      ? Math.min(100, Math.round((mission.currentProgress / mission.targetCount) * 100))
                      : 0;

                    return (
                      <div key={mission.id} className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">{mission.title}</p>
                            {mission.description && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{mission.description}</p>
                            )}
                          </div>
                          <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
                            +{mission.bonusPoints}
                          </span>
                        </div>
                        <Progress value={progress} className="h-2 bg-white/10" />
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(mission.currentProgress)} de {formatNumber(mission.targetCount)}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>

        <section id="activities" className="app-card scroll-mt-4 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Atividades</p>
              <h2 className="mt-1 text-lg font-semibold">Pontuacoes recentes</h2>
            </div>
            <Activity className="h-5 w-5 text-primary" />
          </div>

          {data.recentEvents.length === 0 ? (
            <EmptyPanel title="Nenhum evento registrado ainda" compact />
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {data.recentEvents.map((event) => (
                <div key={event.id} className="app-card-soft p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{getEventLabel(event.eventType)}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{event.userName}</p>
                    </div>
                    <span className="rounded-md bg-primary/15 px-2 py-1 text-xs font-semibold text-primary">
                      +{event.points}
                    </span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{formatRelativeDate(event.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppLayout>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="app-card flex items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-2 truncate text-2xl font-bold tracking-tight">{value}</p>
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Icon className="h-5 w-5" />
      </div>
    </div>
  );
}

function RankingRow({ entry }: { entry: GamificationRankingEntry }) {
  const progress = getProgress(entry);

  return (
    <div className={cn('grid gap-3 p-4 md:grid-cols-[64px_minmax(0,1fr)_180px_120px]', entry.isCurrentUser && 'bg-primary/[0.06]')}>
      <div className="flex items-center gap-3 md:justify-center">
        <span className={cn('flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold', entry.position <= 3 ? 'bg-primary text-white' : 'bg-white/10 text-muted-foreground')}>
          {entry.position}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={entry.avatarUrl || undefined} />
          <AvatarFallback>{getInitials(entry.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{entry.name}</p>
          <p className="text-xs text-muted-foreground">
            Nivel {entry.level} - {entry.rank}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">XP</span>
          <span className="font-semibold">
            {formatNumber(entry.xpCurrentLevel)} / {formatNumber(entry.xpNextLevel)}
          </span>
        </div>
        <Progress value={progress} className="h-2 bg-white/10" />
      </div>

      <div className="flex items-center justify-between gap-3 md:justify-end">
        <div className="text-left md:text-right">
          <p className="text-sm font-bold text-primary">{formatNumber(entry.points)} pts</p>
          <p className="text-xs text-muted-foreground">{entry.streakDays} dias de sequencia</p>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center text-muted-foreground', compact ? 'min-h-[120px]' : 'min-h-[220px]')}>
      <Trophy className="mb-3 h-8 w-8 opacity-35" />
      <p className="text-sm font-medium">{title}</p>
    </div>
  );
}
