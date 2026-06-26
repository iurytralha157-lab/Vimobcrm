import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Crown, Users, TrendingUp, Loader2 } from 'lucide-react';
import { useLeaderStats } from '@/hooks/use-leader-stats';

export function TeamLeadersStats() {
  const { data: stats = [], isLoading } = useLeaderStats();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Crown className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Nenhum líder de equipe definido ainda.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Clique no avatar de um membro para defini-lo como líder.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Crown className="h-5 w-5 text-amber-500" />
        <h3 className="font-semibold">Estatísticas por Líder</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((leader) => (
          <Card key={`${leader.teamId}-${leader.userId}`} className="overflow-hidden">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 ring-2 ring-amber-500/30">
                  <AvatarFallback className="bg-primary text-primary-foreground">
                    {getInitials(leader.userName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{leader.userName}</p>
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{leader.teamName}</span>
                  </div>
                </div>
                <Crown className="h-4 w-4 text-amber-500" />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2 rounded-lg bg-white/[0.045]">
                  <p className="text-2xl font-bold">{leader.totalLeads}</p>
                  <p className="text-xs text-muted-foreground">Leads totais</p>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/[0.045]">
                  <p className="text-2xl font-bold text-orange-600">{leader.convertedLeads}</p>
                  <p className="text-xs text-muted-foreground">Convertidos</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Taxa de conversão</span>
                  <span className="font-medium">{leader.conversionRate}%</span>
                </div>
                <Progress
                  value={leader.conversionRate}
                  className="h-2"
                />
              </div>

              {leader.conversionRate >= 50 && (
                <Badge className="w-full justify-center bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Alta performance
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
