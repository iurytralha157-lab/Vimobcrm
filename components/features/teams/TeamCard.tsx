import { Users, Crown, MoreVertical, Pencil, Trash2, Link2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Team } from '@/hooks/use-teams';

interface TeamCardProps {
  team: Team;
  pipelinesCount?: number;
  onEdit: (team: Team) => void;
  onDelete: (team: Team) => void;
  onManagePipelines?: (team: Team) => void;
}

export function TeamCard({ team, pipelinesCount = 0, onEdit, onDelete, onManagePipelines }: TeamCardProps) {
  const leaders = team.members?.filter(m => m.is_leader) || [];
  const regularMembers = team.members?.filter(m => !m.is_leader) || [];
  const totalMembers = team.members?.length || 0;

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Users className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-lg">{team.name}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {totalMembers} {totalMembers === 1 ? 'membro' : 'membros'}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(team)}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </DropdownMenuItem>
              {onManagePipelines && (
                <DropdownMenuItem onClick={() => onManagePipelines(team)}>
                  <Link2 className="h-4 w-4 mr-2" />
                  Gerenciar Pipelines
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => onDelete(team)}
                className="text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Excluir
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Líderes */}
          {leaders.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                <Crown className="h-3 w-3 text-yellow-500" />
                Líderes
              </p>
              <div className="flex flex-wrap gap-2">
                {leaders.map((member) => (
                  <div key={member.id} className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/20 rounded-full pl-1 pr-3 py-1">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={member.user?.avatar_url || undefined} />
                      <AvatarFallback className="text-xs bg-yellow-100 dark:bg-yellow-800">
                        {getInitials(member.user?.name || 'U')}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">{member.user?.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Membros */}
          {regularMembers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Membros</p>
              <div className="flex -space-x-2">
                {regularMembers.slice(0, 5).map((member) => (
                  <Avatar key={member.id} className="h-8 w-8 border-2 border-background">
                    <AvatarImage src={member.user?.avatar_url || undefined} />
                    <AvatarFallback className="text-xs">
                      {getInitials(member.user?.name || 'U')}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {regularMembers.length > 5 && (
                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center border-2 border-background">
                    <span className="text-xs font-medium">+{regularMembers.length - 5}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pipelines */}
          <div className="flex items-center gap-2 pt-2 border-t">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {pipelinesCount} {pipelinesCount === 1 ? 'pipeline vinculada' : 'pipelines vinculadas'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
