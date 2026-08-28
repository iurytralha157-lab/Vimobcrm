import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useState } from "react";
import { commandSearchFilter } from "@/lib/search-text";

interface User {
  id: string;
  name: string;
  avatar_url: string | null;
}

interface UserFilterProps {
  users: User[];
  selectedUserId: string | null;
  onUserSelect: (userId: string | null) => void;
  showAllOption?: boolean;
}

export function UserFilter({
  users,
  selectedUserId,
  onUserSelect,
  showAllOption = true,
}: UserFilterProps) {
  const [open, setOpen] = useState(false);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-8 w-full justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
        >
          {selectedUser ? (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={selectedUser.avatar_url || undefined} />
                <AvatarFallback className="bg-primary/50 text-[10px] font-light text-white">
                  {selectedUser.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span className="truncate">{selectedUser.name}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span>Todos os usuários</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="app-header-popover z-50 w-[220px] rounded-[8px] border-0 p-1">
        <Command
          className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
          filter={commandSearchFilter}
        >
          <CommandInput
            placeholder="Buscar usuário..."
            className="h-8 text-[12px] font-light"
          />
          <CommandList>
            <CommandEmpty>Nenhum usuário encontrado.</CommandEmpty>
            <CommandGroup>
              {showAllOption && (
                <CommandItem
                  value="all"
                  onSelect={() => {
                    onUserSelect(null);
                    setOpen(false);
                  }}
                  className="rounded-[6px] text-[12px] font-light"
                >
                  <Users className="h-4 w-4 mr-2" />
                  Todos os usuários
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      !selectedUserId ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              )}
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.name}
                  onSelect={() => {
                    onUserSelect(user.id);
                    setOpen(false);
                  }}
                  className="rounded-[6px] text-[12px] font-light"
                >
                  <Avatar className="h-5 w-5 mr-2">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="bg-primary/50 text-[10px] font-light text-white">
                      {user.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{user.name}</span>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      selectedUserId === user.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
