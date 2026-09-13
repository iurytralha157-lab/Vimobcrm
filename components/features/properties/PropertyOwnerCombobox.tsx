"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, UserRound, X } from "lucide-react";
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
import {
  PROPERTY_OWNER_PAGE_SIZE,
  usePropertyOwnersPage,
  type PropertyOwner,
} from "@/hooks/use-property-owners";
import { cn } from "@/lib/utils";

type PropertyOwnerComboboxProps = {
  value?: string;
  selectedLabel?: string;
  onSelect: (owner: PropertyOwner | null) => void;
  allowManual?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  id?: string;
  ariaLabel?: string;
  className?: string;
};

export function PropertyOwnerCombobox({
  value,
  selectedLabel,
  onSelect,
  allowManual = false,
  emptyLabel = "Todos",
  disabled = false,
  id,
  ariaLabel = "Proprietário cadastrado",
  className,
}: PropertyOwnerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const ownersQuery = usePropertyOwnersPage(debouncedSearch, {
    enabled: open,
    limit: PROPERTY_OWNER_PAGE_SIZE,
  });

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setDebouncedSearch(search.trim()),
      250,
    );
    return () => window.clearTimeout(timeout);
  }, [search]);

  const owners = useMemo(() => {
    const byId = new Map<string, PropertyOwner>();
    for (const page of ownersQuery.data?.pages ?? []) {
      for (const owner of page.owners) byId.set(owner.id, owner);
    }
    return [...byId.values()];
  }, [ownersQuery.data?.pages]);
  const selectedOwner = owners.find((owner) => owner.id === value);
  const displayLabel = selectedOwner?.name || selectedLabel || emptyLabel;

  const selectOwner = (owner: PropertyOwner | null) => {
    onSelect(owner);
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (!disabled) setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)]",
            !value && !allowManual && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {value
              ? displayLabel
              : allowManual
                ? "Digitar novo proprietário"
                : emptyLabel}
          </span>
          <ChevronsUpDown aria-hidden="true" className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(360px,calc(100vw-2rem))] rounded-[8px] border-0 p-1"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Buscar proprietário por nome, telefone ou e-mail..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                value="__empty__"
                onSelect={() => selectOwner(null)}
                className="cursor-pointer"
              >
                {allowManual ? (
                  <UserRound aria-hidden="true" className="mr-2 h-4 w-4" />
                ) : (
                  <X aria-hidden="true" className="mr-2 h-4 w-4" />
                )}
                {allowManual ? "Digitar novo proprietário" : emptyLabel}
                <Check
                  aria-hidden="true"
                  className={cn(
                    "ml-auto h-4 w-4",
                    value ? "opacity-0" : "opacity-100",
                  )}
                />
              </CommandItem>
              {owners.map((owner) => (
                <CommandItem
                  key={owner.id}
                  value={owner.id}
                  onSelect={() => selectOwner(owner)}
                  className="cursor-pointer"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{owner.name}</span>
                    {(owner.cellphone || owner.email) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {owner.cellphone || owner.email}
                      </span>
                    )}
                  </span>
                  <Check
                    aria-hidden="true"
                    className={cn(
                      "ml-auto h-4 w-4 shrink-0",
                      value === owner.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
            {owners.length === 0 && (
              <div
                role="status"
                className="px-3 py-4 text-center text-xs text-muted-foreground"
              >
                {ownersQuery.isLoading || ownersQuery.isFetching
                  ? "Buscando proprietários..."
                  : ownersQuery.isError
                    ? "Não foi possível buscar proprietários."
                    : "Nenhum proprietário encontrado."}
              </div>
            )}
            {ownersQuery.hasNextPage && (
              <div className="p-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={ownersQuery.isFetchingNextPage}
                  onClick={() => void ownersQuery.fetchNextPage()}
                >
                  {ownersQuery.isFetchingNextPage && (
                    <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Carregar mais proprietários
                </Button>
              </div>
            )}
            {ownersQuery.isError && (
              <div className="p-1">
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => void ownersQuery.refetch()}
                >
                  Tentar novamente
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
