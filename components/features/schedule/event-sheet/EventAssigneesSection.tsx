import { Plus, Users, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Team } from "@/hooks/use-teams";
import { commandSearchFilter } from "@/lib/search-text";
import { cn } from "@/lib/utils";
import {
  agendaControlClass,
  agendaPopoverClass,
} from "@/components/features/schedule/event-sheet/config";
import { AgendaRow } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import type {
  AssigneeCandidate,
  DisplayAssignee,
} from "@/components/features/schedule/event-sheet/model";

export function EventAssigneesSection({
  isMasked,
  locked,
  assigneeDraftReady,
  assigneesError,
  assigneesFetching,
  allAssignees,
  availableUsers,
  users,
  assignableTeams,
  showAssigneePicker,
  selectedTeamId,
  primaryUserId,
  onRetry,
  onRemoveAssignee,
  onAssigneePickerChange,
  onAddAssignee,
  onTeamSelect,
  onPrimaryUserChange,
}: {
  isMasked: boolean;
  locked: boolean;
  assigneeDraftReady: boolean;
  assigneesError: boolean;
  assigneesFetching: boolean;
  allAssignees: readonly DisplayAssignee[];
  availableUsers: readonly AssigneeCandidate[];
  users: readonly AssigneeCandidate[];
  assignableTeams: readonly Team[];
  showAssigneePicker: boolean;
  selectedTeamId: string;
  primaryUserId: string;
  onRetry: () => void;
  onRemoveAssignee: (userId: string) => void;
  onAssigneePickerChange: (open: boolean) => void;
  onAddAssignee: (userId: string) => void;
  onTeamSelect: (teamId: string) => void;
  onPrimaryUserChange: (userId: string) => void;
}) {
  return (
    <AgendaRow
      dataTour="agenda-event-assignees"
      icon={<Users size={18} />}
      label="Responsáveis"
      inline
    >
      <div className="flex min-h-10 w-full flex-wrap items-center gap-2">
        {isMasked ? (
          <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
            Informação privada
          </span>
        ) : !assigneeDraftReady ? (
          <div className="flex items-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]">
            <span>
              {assigneesError
                ? "Não foi possível carregar os responsáveis."
                : "Carregando responsáveis..."}
            </span>
            {assigneesError && (
              <button
                type="button"
                onClick={onRetry}
                disabled={assigneesFetching}
                className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-primary transition-colors hover:bg-[var(--app-surface-hover)] disabled:opacity-50"
              >
                Tentar novamente
              </button>
            )}
          </div>
        ) : allAssignees.length > 0 ? (
          allAssignees.map((assignee) => (
            <div key={assignee.id} className="group relative">
              <Avatar className="h-8 w-8" title={assignee.name}>
                <AvatarImage
                  src={assignee.avatar_url || undefined}
                  alt={assignee.name}
                />
                <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                  {assignee.name
                    .split(" ")
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {!locked && !assignee.primary && (
                <button
                  type="button"
                  onClick={() => onRemoveAssignee(assignee.id)}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label="Remover responsável"
                >
                  <X size={8} strokeWidth={3} />
                </button>
              )}
            </div>
          ))
        ) : (
          <span className="text-[12px] font-light text-[var(--app-text-tertiary)]">
            Adicionar convidados
          </span>
        )}
        {!locked && assigneeDraftReady && availableUsers.length > 0 && (
          <Popover
            open={showAssigneePicker}
            onOpenChange={onAssigneePickerChange}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Adicionar responsável"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--app-text-secondary)] hover:text-primary",
                  agendaControlClass,
                )}
              >
                <Plus size={14} />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className={cn("w-[260px] p-0", agendaPopoverClass)}
              align="start"
            >
              <Command
                filter={commandSearchFilter}
                className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
              >
                <CommandInput placeholder="Adicionar responsável..." />
                <CommandList>
                  <CommandEmpty>Sem usuários disponíveis.</CommandEmpty>
                  <CommandGroup>
                    {availableUsers.map((user) => (
                      <CommandItem
                        key={user.id}
                        onSelect={() => onAddAssignee(user.id)}
                      >
                        <Avatar className="mr-2 h-5 w-5">
                          <AvatarImage
                            src={user.avatar_url || undefined}
                            alt={user.name}
                          />
                          <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                            {user.name
                              .split(" ")
                              .slice(0, 2)
                              .map((part) => part[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-[12px] font-light">
                          {user.name}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
        {!locked && assigneeDraftReady && assignableTeams.length > 0 && (
          <Select value={selectedTeamId} onValueChange={onTeamSelect}>
            <SelectTrigger
              aria-label="Adicionar equipe responsável"
              className={cn(
                "h-10 min-w-[132px] flex-1 px-3 text-[12px] font-light sm:h-9 sm:flex-none",
                agendaControlClass,
              )}
            >
              <SelectValue placeholder="Equipe" />
            </SelectTrigger>
            <SelectContent className={agendaPopoverClass}>
              {assignableTeams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {!locked && assigneeDraftReady && !primaryUserId && (
        <Select value={primaryUserId} onValueChange={onPrimaryUserChange}>
          <SelectTrigger
            aria-label="Responsável principal"
            className={cn(
              "mt-2 h-10 text-[12px] font-light sm:h-9",
              agendaControlClass,
            )}
          >
            <SelectValue placeholder="Responsável principal..." />
          </SelectTrigger>
          <SelectContent className={agendaPopoverClass}>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </AgendaRow>
  );
}
