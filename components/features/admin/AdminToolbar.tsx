import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AdminToolbar({
  search,
  onSearch,
  placeholder,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="app-card p-2">
      <div className="relative w-full md:max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={placeholder}
          className="h-10 border-0 bg-[var(--app-surface-soft)] pl-9 pr-10"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-[6px] text-muted-foreground hover:bg-[var(--app-surface-hover)] hover:text-foreground",
            !search && "pointer-events-none opacity-35",
          )}
          onClick={() => onSearch("")}
          aria-label="Limpar filtros"
          title="Limpar filtros"
        >
          <X className="h-4 w-4" strokeWidth={1.7} />
        </Button>
      </div>
    </div>
  );
}
