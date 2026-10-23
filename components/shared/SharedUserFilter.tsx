"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_UI } from "@/config/filter-ui";
import { searchTextIncludes } from "@/lib/search-text";
import { getUserFilterLabel } from "@/lib/user-display";
import { cn } from "@/lib/utils";

export interface FilterUser {
  id: string;
  name: string;
  email?: string | null;
  avatar_url?: string | null;
  is_active?: boolean | null;
}

function UserAvatar({ user }: { user: FilterUser }) {
  const name = user.name?.trim() || user.email?.trim() || "U";
  return (
    <Avatar className="h-5 w-5 shrink-0">
      <AvatarImage src={user.avatar_url || undefined} alt="" />
      <AvatarFallback className="text-[9px]">{name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

export function SharedUserFilter({
  users, value, onChange, includeUnassigned = false, disabled = false,
  loading = false, layerScope,
}: {
  users: readonly FilterUser[];
  value: string | null;
  onChange: (value: string | null) => void;
  includeUnassigned?: boolean;
  disabled?: boolean;
  loading?: boolean;
  layerScope?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = users.find((user) => user.id === value);
  const label = selected ? getUserFilterLabel(selected) : value === "unassigned" && includeUnassigned ? "Sem responsável" : value && value !== "all" ? "Corretor indisponível" : "Todos os corretores";
  const matching = useMemo(() => users.filter((user) =>
    searchTextIncludes([user.name, user.email].filter(Boolean).join(" "), search),
  ), [search, users]);
  const visible = matching.slice(0, 80);
  const choose = (nextValue: string | null) => { onChange(nextValue); setOpen(false); setSearch(""); };
  const optionClass = cn(FILTER_UI.option, "gap-2");
  const selectedMark = (active: boolean) => <Check className={cn(FILTER_UI.icon, active ? "opacity-100" : "opacity-0")} aria-hidden="true" />;

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setSearch(""); }} modal={false}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-label={`Filtrar por corretor: ${label}`} aria-expanded={open} title={label} disabled={disabled}
          data-filter-active={Boolean(value && value !== "all")}
          className={cn(FILTER_UI.control, "justify-between gap-2", value && value !== "all" && "text-primary")}>
          <span className="flex min-w-0 flex-1 items-center gap-2">{selected ? <UserAvatar user={selected} /> : <User className={FILTER_UI.icon} aria-hidden="true" />}<span className="truncate">{loading && !users.length ? "Carregando corretores..." : label}</span></span>
          <ChevronsUpDown className={cn(FILTER_UI.icon, "opacity-50")} aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={FILTER_UI.collisionPadding} data-filter-layer={layerScope}
        onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}
        className={cn("app-header-popover z-[140] w-[260px] rounded-[8px] border-0 p-1", FILTER_UI.panelViewport)}>
        <Command shouldFilter={false} label="Buscar corretor por nome ou e-mail" className="bg-transparent">
          <CommandInput ref={searchRef} aria-label="Buscar corretor por nome ou e-mail" placeholder="Buscar corretor..." value={search} onValueChange={setSearch} className="h-9 py-0 text-[12px] font-light" />
          <CommandList className="max-h-[min(260px,50dvh)]">
            <CommandGroup>
              <CommandItem value="user:all" className={optionClass} onSelect={() => choose(null)}>{selectedMark(!value || value === "all")}<User className={FILTER_UI.icon} aria-hidden="true" />Todos os corretores</CommandItem>
              {includeUnassigned && <CommandItem value="user:unassigned" className={optionClass} onSelect={() => choose("unassigned")}>{selectedMark(value === "unassigned")}<User className={FILTER_UI.icon} aria-hidden="true" />Sem responsável</CommandItem>}
              {visible.map((user) => (
                <CommandItem key={user.id} value={`user:${user.id}`} className={optionClass} onSelect={() => choose(user.id)} title={getUserFilterLabel(user)}>{selectedMark(value === user.id)}<UserAvatar user={user} /><span className="min-w-0 truncate">{getUserFilterLabel(user)}</span></CommandItem>
              ))}
            </CommandGroup>
            {!matching.length && <p role="status" className="px-2 py-3 text-center text-[12px] text-muted-foreground">{loading ? "Carregando corretores..." : "Nenhum corretor encontrado."}</p>}
            {matching.length > visible.length && <p className="px-2 py-2 text-[11px] text-muted-foreground">Refine a busca para encontrar mais {matching.length - visible.length} corretor(es).</p>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
