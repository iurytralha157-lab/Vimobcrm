import { useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  GripVertical,
  Trash2,
  UserRound,
  UserPlus,
  Users,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  activeTeamsForUser,
  queueMemberKey,
  type QueueMemberDraft,
  type QueueTeamSource,
} from "@/lib/round-robin/member-context";
import type { DistributionQueueStrategy } from "@/lib/round-robin/distribution-queue-form";
import { commandSearchFilter } from "@/lib/search-text";
import { cn } from "@/lib/utils";

interface UserOption {
  id: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
}

interface DistributionQueueMembersSectionProps {
  open: boolean;
  members: QueueMemberDraft[];
  strategy: DistributionQueueStrategy;
  visibleTeams: QueueTeamSource[];
  selectableTeams: QueueTeamSource[];
  selectableUsers: UserOption[];
  users: UserOption[];
  teamSelectMessage: string | null;
  teamsLoading: boolean;
  usersLoading: boolean;
  totalTeams: number;
  activeTeams: number;
  isActive: boolean;
  onToggle: () => void;
  onDragEnd: (event: DragEndEvent) => void;
  onAddUser: (userId: string) => void;
  onAddTeam: (teamId: string) => void;
  onUpdateWeight: (memberKey: string, weight: number) => void;
  onUpdateTeam: (memberKey: string, teamId?: string) => void;
  onRemove: (memberKey: string) => void;
}

interface SortableMemberRowProps {
  member: QueueMemberDraft;
  user?: UserOption;
  index: number;
  strategy: DistributionQueueStrategy;
  totalWeight: number;
  teamOptions: QueueTeamSource[];
  onUpdateWeight: (memberKey: string, weight: number) => void;
  onUpdateTeam: (memberKey: string, teamId?: string) => void;
  onRemove: (memberKey: string) => void;
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SearchableTeamPicker({
  teams,
  value,
  placeholder,
  emptyMessage = "Nenhuma equipe encontrada.",
  clearLabel,
  disabled,
  className,
  onSelect,
}: {
  teams: QueueTeamSource[];
  value?: string;
  placeholder: string;
  emptyMessage?: string;
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  onSelect: (teamId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedTeam = teams.find((team) => team.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={placeholder}
          disabled={disabled}
          className={cn(
            "h-9 min-w-0 justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]",
            className,
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <UsersRound className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate">
              {selectedTeam?.name || placeholder}
            </span>
          </span>
          <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] rounded-[8px] border-[var(--app-border)] p-0 shadow-lg"
      >
        <Command filter={commandSearchFilter}>
          <CommandInput
            placeholder="Buscar equipe por nome..."
            className="h-9 text-[12px]"
          />
          <CommandList className="max-h-[260px]">
            <CommandEmpty className="px-3 py-5 text-[12px]">
              {emptyMessage}
            </CommandEmpty>
            <CommandGroup>
              {clearLabel && (
                <CommandItem
                  value={`${clearLabel} usuario direto sem equipe`}
                  className="cursor-pointer gap-2 rounded-[5px] text-[12px]"
                  onSelect={() => {
                    onSelect("");
                    setOpen(false);
                  }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-primary/10 text-primary">
                    <UserRound className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate">{clearLabel}</span>
                </CommandItem>
              )}
              {teams.map((team) => (
                <CommandItem
                  key={team.id}
                  value={`${team.name || "Equipe"} ${team.id}`}
                  className="cursor-pointer gap-2 rounded-[5px] text-[12px]"
                  onSelect={() => {
                    onSelect(team.id);
                    setOpen(false);
                  }}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-primary/10 text-primary">
                    <UsersRound className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate">{team.name || "Equipe"}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function SortableMemberRow({
  member,
  user,
  index,
  strategy,
  totalWeight,
  teamOptions,
  onUpdateWeight,
  onUpdateTeam,
  onRemove,
}: SortableMemberRowProps) {
  const memberKey = queueMemberKey(member);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: memberKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.5 : undefined,
  };
  const percentage =
    totalWeight > 0 ? Math.round((member.weight / totalWeight) * 100) : 0;
  const displayName = member.name || user?.name || "Desconhecido";
  const initials = getInitials(displayName) || "?";
  const linkedTeam = member.teamId
    ? teamOptions.find((team) => team.id === member.teamId)
    : undefined;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "group grid min-w-0 grid-cols-[36px_38px_minmax(0,1fr)_34px] items-center gap-x-2 gap-y-2 rounded-[7px] bg-[var(--app-surface-soft)] px-2 py-2.5 transition-[background-color,box-shadow] hover:bg-[var(--app-surface-hover)] sm:grid-cols-[36px_38px_minmax(0,1fr)_auto_34px] sm:px-2.5",
        isDragging &&
          "bg-[var(--app-surface-hover)] shadow-[0_10px_28px_rgba(15,23,42,0.14)] ring-1 ring-primary/25",
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Mover ${displayName}, posição ${index + 1}`}
        title="Arraste para mudar a ordem"
        className="flex h-9 w-9 touch-none cursor-grab items-center justify-center gap-0.5 rounded-[6px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:ring-2 focus-visible:ring-primary/40 active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-[10px] text-center text-[11px] font-medium tabular-nums">
          {index + 1}
        </span>
      </button>

      {member.type === "team" ? (
        <span className="grid h-9 w-9 place-items-center rounded-[7px] bg-primary/10 text-primary">
          <UsersRound className="h-4 w-4" aria-hidden="true" />
        </span>
      ) : (
        <Avatar className="h-9 w-9 bg-primary/10 ring-1 ring-black/[0.04]">
          {user?.avatar_url && (
            <AvatarImage
              src={user.avatar_url}
              alt={`Foto de ${displayName}`}
              className="object-cover"
            />
          )}
          <AvatarFallback className="bg-primary/10 text-[11px] font-medium text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
      )}

      <div className="min-w-0 self-center">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="truncate text-[13px] font-medium text-[var(--app-text-primary)]"
            title={displayName}
          >
            {displayName}
          </span>
          {member.type === "team" && (
            <Badge className="h-5 shrink-0 border-0 bg-primary/10 px-1.5 text-[9px] font-medium uppercase tracking-wide text-primary shadow-none hover:bg-primary/10">
              Equipe
            </Badge>
          )}
        </div>

        {member.type === "user" && user?.email && (
          <p
            className="truncate text-[10px] text-[var(--app-text-tertiary)]"
            title={user.email}
          >
            {user.email}
          </p>
        )}

        {member.type === "user" && linkedTeam && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-[var(--app-text-tertiary)]">
            <UsersRound className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {linkedTeam.name || "Equipe vinculada"}
            </span>
          </p>
        )}

        {member.type === "user" && teamOptions.length > 0 && (
          <SearchableTeamPicker
            teams={teamOptions}
            value={member.teamId}
            placeholder="Sem equipe (direto)"
            clearLabel="Sem equipe (direto)"
            className="mt-1.5 h-8 w-full max-w-[250px] bg-[var(--app-surface-solid)] text-[11px]"
            onSelect={(teamId) =>
              onUpdateTeam(memberKey, teamId || undefined)
            }
          />
        )}

        {member.type === "user" && teamOptions.length === 0 && (
          <p
            className="mt-0.5 truncate text-[10px] text-[var(--app-text-tertiary)]"
            title="Direto · sem escala de equipe"
          >
            Direto · sem escala de equipe
          </p>
        )}
      </div>

      {strategy === "weighted" ? (
        <div className="col-start-3 col-end-5 row-start-2 flex min-w-0 items-center gap-1.5 justify-self-start sm:col-start-4 sm:col-end-5 sm:row-start-1 sm:justify-self-end">
          <span className="text-[10px] text-[var(--app-text-tertiary)]">
            Peso
          </span>
          <Input
            type="number"
            value={member.weight}
            onChange={(event) =>
              onUpdateWeight(
                memberKey,
                Number.parseInt(event.target.value) || 1,
              )
            }
            aria-label={`Peso de ${displayName}`}
            className="h-8 w-14 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-1.5 text-center text-[12px] tabular-nums shadow-none"
            min={1}
            max={100}
          />
          <span className="w-8 text-right text-[10px] tabular-nums text-[var(--app-text-tertiary)]">
            {percentage}%
          </span>
        </div>
      ) : (
        <span className="hidden whitespace-nowrap text-[10px] tabular-nums text-[var(--app-text-tertiary)] sm:col-start-4 sm:block sm:justify-self-end">
          Posição {index + 1}
        </span>
      )}

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Remover ${displayName}`}
        title={`Remover ${displayName}`}
        className="col-start-4 row-start-1 h-8 w-8 rounded-[6px] text-[var(--app-text-tertiary)] hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive/30 sm:col-start-5"
        onClick={() => onRemove(memberKey)}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

export function DistributionQueueMembersSection({
  open,
  members,
  strategy,
  visibleTeams,
  selectableTeams,
  selectableUsers,
  users,
  teamSelectMessage,
  teamsLoading,
  usersLoading,
  totalTeams,
  activeTeams,
  isActive,
  onToggle,
  onDragEnd,
  onAddUser,
  onAddTeam,
  onUpdateWeight,
  onUpdateTeam,
  onRemove,
}: DistributionQueueMembersSectionProps) {
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const totalWeight = members.reduce((sum, member) => sum + member.weight, 0);

  return (
    <Collapsible
      data-tour="distribution-queue-members"
      open={open}
      onOpenChange={onToggle}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-[6px] border-0 bg-[var(--app-surface-muted)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--app-surface-hover)] data-[state=open]:bg-primary/10">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="font-medium">Participantes</span>
          {members.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {members.length}
            </Badge>
          )}
        </div>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-0.5 pt-2.5">
        {members.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            modifiers={[restrictToVerticalAxis]}
          >
            <SortableContext
              items={members.map(queueMemberKey)}
              strategy={verticalListSortingStrategy}
            >
              <ol
                data-distribution-members-scroll
                aria-label="Participantes na ordem de distribuição"
                className="scrollbar-thin max-h-[clamp(220px,36dvh,360px)] space-y-1.5 overflow-y-auto overflow-x-hidden overscroll-contain pr-1 [scrollbar-gutter:stable]"
              >
                {members.map((member, index) => (
                  <SortableMemberRow
                    key={queueMemberKey(member)}
                    member={member}
                    user={
                      member.type === "user"
                        ? users.find((user) => user.id === member.entityId)
                        : undefined
                    }
                    index={index}
                    strategy={strategy}
                    totalWeight={totalWeight}
                    teamOptions={
                      member.type === "user"
                        ? activeTeamsForUser(member.entityId, visibleTeams)
                        : []
                    }
                    onUpdateWeight={onUpdateWeight}
                    onUpdateTeam={onUpdateTeam}
                    onRemove={onRemove}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="flex min-h-20 items-center justify-center gap-2 rounded-[7px] bg-[var(--app-surface-soft)] px-4 py-5 text-[11px] text-[var(--app-text-tertiary)]">
            <UsersRound className="h-4 w-4" aria-hidden="true" />
            Nenhum participante adicionado
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={userPickerOpen}
                disabled={teamsLoading || usersLoading}
                aria-label="Buscar e adicionar usuário"
                className="h-9 flex-1 justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <UserPlus className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">Buscar e adicionar usuário</span>
                </span>
                <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] min-w-[280px] rounded-[8px] border-[var(--app-border)] p-0 shadow-lg"
            >
              <Command filter={commandSearchFilter}>
                <CommandInput
                  placeholder="Buscar usuário por nome ou e-mail..."
                  className="h-9 text-[12px]"
                />
                <CommandList className="max-h-[260px]">
                  <CommandEmpty>
                    {selectableUsers.length === 0
                      ? "Nenhum usuário ativo disponível."
                      : "Nenhum usuário encontrado."}
                  </CommandEmpty>
                  <CommandGroup>
                    {selectableUsers.map((user) => {
                      const displayName = user.name || user.email || "Usuário";
                      const initials = getInitials(displayName);

                      return (
                        <CommandItem
                          key={user.id}
                          value={`${user.name || ""} ${user.email || ""} ${user.id}`}
                          className="cursor-pointer"
                          onSelect={() => {
                            onAddUser(user.id);
                            setUserPickerOpen(false);
                          }}
                        >
                          <Avatar className="mr-2 h-8 w-8 shrink-0 bg-primary/10">
                            {user.avatar_url && (
                              <AvatarImage
                                src={user.avatar_url}
                                alt={`Foto de ${displayName}`}
                                className="object-cover"
                              />
                            )}
                            <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
                              {initials || "U"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {displayName}
                            </span>
                            {user.email && (
                              <span className="block truncate text-xs text-muted-foreground">
                                {user.email}
                              </span>
                            )}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <SearchableTeamPicker
            teams={selectableTeams}
            placeholder="Buscar e adicionar equipe"
            emptyMessage={teamSelectMessage || "Nenhuma equipe encontrada."}
            disabled={teamsLoading}
            className="flex-1"
            onSelect={onAddTeam}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Corretores podem participar diretamente. Vincule uma equipe somente
          quando quiser aplicar a escala dela.
        </p>
        {totalTeams > 0 && activeTeams === 0 && (
          <p className="text-xs text-muted-foreground">
            Ative uma equipe em Gestão &gt; Equipes para usá-la em uma fila.
          </p>
        )}
        {isActive && members.length === 0 && (
          <p className="text-xs text-destructive">
            Adicione pelo menos um participante para manter a fila ativa.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
