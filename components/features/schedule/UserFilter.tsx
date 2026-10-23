import { Check, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
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
import { useMemo, useRef, useState } from "react";
import { searchTextIncludes } from "@/lib/search-text";
import { FILTER_UI } from "@/config/filter-ui";

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
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedUser = users.find((u) => u.id === selectedUserId);
  const matchingUsers = useMemo(() => users.filter((user) => searchTextIncludes(user.name, search)), [search, users]);
  const selectedLabel = selectedUser?.name ?? (selectedUserId ? "Usuário indisponível" : "Todos os usuários");

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={`Filtrar por usuário: ${selectedLabel}`}
          title={selectedLabel}
          className={cn(FILTER_UI.control, "justify-between")}
        >
          {selectedUser ? (
            <div className="flex min-w-0 items-center gap-2">
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
              <span className="truncate">{selectedLabel}</span>
            </div>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("app-header-popover z-[140] w-[260px] rounded-[8px] border-0 p-1", FILTER_UI.panelViewport)} collisionPadding={FILTER_UI.collisionPadding}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}>
        <Command
          className="bg-transparent [&_[cmdk-input-wrapper]]:border-b-0"
          shouldFilter={false}
          label="Buscar usuário por nome"
        >
          <CommandInput
            placeholder="Buscar usuário..."
            ref={searchRef}
            aria-label="Buscar usuário por nome"
            value={search}
            onValueChange={setSearch}
            className="h-9 py-0 text-[12px] font-light"
          />
          <CommandList>
            {matchingUsers.length === 0 && <p role="status" className="py-3 text-center text-[12px] text-muted-foreground">Nenhum usuário encontrado.</p>}
            <CommandGroup>
              {showAllOption && (
                <CommandItem
                  value="user:all"
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
              {matchingUsers.map((user) => (
                <CommandItem
                  key={user.id}
                  value={`user:${user.id}`}
                  title={user.name}
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
