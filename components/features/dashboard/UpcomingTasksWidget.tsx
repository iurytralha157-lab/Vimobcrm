import { Calendar, Phone, Mail, MessageSquare, FileText, CheckCircle2, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { format, isToday, isTomorrow, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Task {
  id: string;
  title: string;
  type: 'call' | 'email' | 'meeting' | 'message' | 'task';
  due_date: string;
  lead_name: string;
  lead_id: string;
}

interface UpcomingTasksWidgetProps {
  tasks: Task[];
  isLoading?: boolean;
  onComplete?: (taskId: string) => void;
  onTaskClick?: (leadId: string) => void;
}

const taskIcons = {
  call: { icon: Phone, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  email: { icon: Mail, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  meeting: { icon: Calendar, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  message: { icon: MessageSquare, color: 'text-green-500', bg: 'bg-green-500/10' },
  task: { icon: FileText, color: 'text-gray-500', bg: 'bg-gray-500/10' },
};

function getTimeLabel(dateStr: string): { label: string; urgent: boolean } {
  const date = new Date(dateStr);
  const now = new Date();

  if (date < now) {
    return { label: 'Atrasada', urgent: true };
  }

  if (isToday(date)) {
    return { label: format(date, 'HH:mm'), urgent: false };
  }

  if (isTomorrow(date)) {
    return { label: 'Amanhã', urgent: false };
  }

  return {
    label: formatDistanceToNow(date, { locale: ptBR, addSuffix: true }),
    urgent: false
  };
}

function TaskSkeleton() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Skeleton className="h-8 w-8 rounded-lg" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-6 w-6 rounded" />
    </div>
  );
}

export function UpcomingTasksWidget({
  tasks,
  isLoading,
  onComplete,
  onTaskClick
}: UpcomingTasksWidgetProps) {
  if (isLoading) {
    return (
      <Card className="app-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Próximas Atividades
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <TaskSkeleton key={i} />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (tasks.length === 0) {
    return (
      <Card className="app-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Próximas Atividades
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Nenhuma atividade pendente
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="app-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          Próximas Atividades
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {tasks.slice(0, 5).map((task) => {
          const taskType = taskIcons[task.type] || taskIcons.task;
          const Icon = taskType.icon;
          const timeInfo = getTimeLabel(task.due_date);

          return (
            <div
              key={task.id}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-white/[0.055] group"
              onClick={() => onTaskClick?.(task.lead_id)}
            >
              {/* Icon */}
              <div className={cn(
                "flex items-center justify-center w-8 h-8 rounded-lg",
                taskType.bg
              )}>
                <Icon className={cn("h-4 w-4", taskType.color)} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{task.title}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {task.lead_name}
                </p>
              </div>

              {/* Time / Complete Button */}
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-xs",
                  timeInfo.urgent ? "text-destructive font-medium" : "text-muted-foreground"
                )}>
                  {timeInfo.label}
                </span>
                {onComplete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onComplete(task.id);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground hover:text-primary" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
