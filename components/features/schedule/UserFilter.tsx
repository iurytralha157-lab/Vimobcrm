import { Check, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useState } from 'react';

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

export function UserFilter({ users, selectedUserId, onUserSelect, showAllOption = true }: UserFilterProps) {
  const [open, setOpen] = useState(false);

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between h-10 rounded-2xl bg-white/[0.035] border-white/[0.055] hover:bg-white/[0.055] hover:text-accent-foreground transition-all px-3"
        >
          {selectedUser ? (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={selectedUser.avatar_url || undefined} />
                <AvatarFallback className="text-[10px]">
                  {selectedUser.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
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
      <PopoverContent className="w-[200px] p-0 bg-[#171717] border border-white/[0.055] shadow-xl z-50">
        <Command>
          <CommandInput placeholder="Buscar usuário..." />
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
                >
                  <Users className="h-4 w-4 mr-2" />
                  Todos os usuários
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      !selectedUserId ? "opacity-100" : "opacity-0"
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
                >
                  <Avatar className="h-5 w-5 mr-2">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="text-[10px]">
                      {user.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{user.name}</span>
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      selectedUserId === user.id ? "opacity-100" : "opacity-0"
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
