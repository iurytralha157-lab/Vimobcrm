import { ChevronDown, Loader2, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { LeadAssigneeCatalogNotice } from '@/components/features/leads/lead-detail/LeadAssigneeCatalogNotice';
import type { LeadAssigneeCatalogState, LeadDetailAssignee } from '@/components/features/leads/lead-detail/types';
import { commandSearchFilter } from '@/lib/search-text';
import { cn } from '@/lib/utils';

type LeadDetailAssigneePickerProps = {
  mobile: boolean;
  open: boolean;
  disabled: boolean;
  updating: boolean;
  assigneeName: string | null | undefined;
  users: LeadDetailAssignee[];
  catalogState?: LeadAssigneeCatalogState;
  catalogBlocked: boolean;
  portalClassName?: string;
  searchClassName?: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (userId: string | null) => void;
};

export function LeadDetailAssigneePicker({
  mobile, open, disabled, updating, assigneeName, users, catalogState, catalogBlocked,
  portalClassName, searchClassName, onOpenChange, onSelect,
}: LeadDetailAssigneePickerProps) {
  const itemClassName = cn('cursor-pointer rounded-[6px] px-3 py-2', mobile && 'min-h-10');
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label="Alterar responsável pelo lead"
          className={cn('min-w-0 justify-start rounded-[6px] bg-[var(--app-surface-soft)] text-xs font-light text-[var(--app-text-secondary)]', mobile ? 'h-10 px-2.5' : 'h-8 px-3')}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <User className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{assigneeName || 'Sem responsável'}</span>
          {updating ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'overflow-hidden border-0 bg-[var(--app-surface-solid)] p-1',
          mobile ? 'app-header-popover w-[calc(100vw-2rem)] max-w-[380px]' : 'w-[300px] rounded-[8px] shadow-none',
          portalClassName,
        )}
        align="start"
        collisionPadding={12}
        onWheelCapture={(event) => event.stopPropagation()}
        onTouchMoveCapture={(event) => event.stopPropagation()}
      >
        <Command filter={commandSearchFilter} className={cn(
          'border-none bg-transparent [&_[cmdk-input-wrapper]]:border-b-0 [&_[cmdk-input-wrapper]]:px-2',
          mobile ? 'max-h-[min(72vh,430px)]' : 'max-h-[min(72vh,420px)]',
          searchClassName,
        )}>
          <CommandInput aria-label="Buscar responsável" placeholder={mobile ? 'Buscar responsável...' : 'Buscar...'} className={cn('border-none focus:ring-0', mobile ? 'h-10' : 'h-9')} />
          <CommandList
            className={cn(
              'overflow-y-auto overscroll-contain p-1 touch-pan-y scrollbar-thin [-webkit-overflow-scrolling:touch]',
              mobile ? 'max-h-[min(58vh,340px)]' : 'max-h-[min(56vh,320px)]',
            )}
            onWheelCapture={(event) => event.stopPropagation()}
            onTouchMoveCapture={(event) => event.stopPropagation()}
          >
            <LeadAssigneeCatalogNotice state={catalogState} />
            {!catalogBlocked && (
              <>
                <CommandEmpty className="py-4 text-center text-sm text-muted-foreground">Nenhum encontrado.</CommandEmpty>
                <CommandGroup>
                  <CommandItem onSelect={() => onSelect(null)} className={itemClassName}>
                    Sem responsável
                  </CommandItem>
                  {users.map((user) => (
                    <CommandItem key={user.id} onSelect={() => onSelect(user.id)} className={itemClassName}>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="h-7 w-7">
                          <AvatarImage src={user.avatar_url || undefined} alt={user.name || user.email || 'Responsável'} />
                          <AvatarFallback className="text-[10px]">{(user.name || user.email || 'U')[0]}</AvatarFallback>
                        </Avatar>
                        <span className="truncate">{user.name || user.email}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
