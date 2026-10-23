import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { CONTACT_PAGE_SIZE_OPTIONS, parseContactPageInput } from "./model";
import { useContactPaginationClearance } from "@/hooks/contacts/use-contact-pagination-clearance";

type ContactsPaginationProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: Dispatch<SetStateAction<number>>;
  onPageSizeChange: Dispatch<SetStateAction<number>>;
};

export function ContactsPagination({
  page,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: ContactsPaginationProps) {
  const [pageInputValue, setPageInputValue] = useState("1");
  const footerRef = useRef<HTMLDivElement>(null);
  useContactPaginationClearance(footerRef, totalPages > 1 || totalCount > 0);

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setPageInputValue(String(page));
    });
    return () => {
      isActive = false;
    };
  }, [page]);

  if (totalPages <= 1 && totalCount <= 0) return null;

  const applyPageInput = () => {
    const nextPage = parseContactPageInput(pageInputValue, totalPages);
    if (nextPage !== null) {
      onPageChange(nextPage);
    } else {
      setPageInputValue(String(page));
    }
  };

  return (
    <div ref={footerRef} className="app-toolbar contacts-pagination flex min-h-10 flex-col items-stretch gap-1.5 rounded-none py-2 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-2 md:py-1"
      style={{ paddingLeft: "max(8px, env(safe-area-inset-left), var(--contacts-pagination-clearance-left, 0px))", paddingRight: "max(8px, env(safe-area-inset-right), var(--contacts-pagination-clearance-right, 0px))" }}>
      <div className="flex min-w-0 items-center justify-between gap-2 md:flex-wrap md:justify-start">
        <p className="min-w-0 break-words text-[10px] font-light text-[var(--app-text-secondary)] md:text-[12px]">
          Página {page} de {totalPages || 1}
        </p>
        <Select
          value={String(pageSize)}
          onValueChange={(value) => {
            onPageSizeChange(Number(value));
            onPageChange(1);
          }}
        >
          <SelectTrigger
            aria-label="Contatos por página"
            className="h-8 w-24 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[10px] font-light shadow-none md:w-[112px] md:text-[11px]"
          >
            <SelectValue>
              <span className="md:hidden">{pageSize} / pág.</span>
              <span className="hidden md:inline">{pageSize} por página</span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CONTACT_PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} por página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid w-full min-w-0 grid-cols-[32px_32px_minmax(32px,1fr)_32px_32px] items-center gap-1 md:flex md:w-auto md:max-w-full md:flex-wrap">
        <Button
          variant="outline"
          size="icon"
          aria-label="Ir para a primeira página"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() => onPageChange(1)}
          disabled={page === 1}
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ir para a página anterior"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() =>
            onPageChange((currentPage) => Math.max(1, currentPage - 1))
          }
          disabled={page === 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <div className="flex min-w-0 items-center justify-center gap-1 md:mx-2">
          <Input
            type="text"
            inputMode="numeric"
            aria-label="Número da página"
            value={pageInputValue}
            onChange={(event) => setPageInputValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyPageInput();
            }}
            onBlur={applyPageInput}
            className="h-8 w-full min-w-0 max-w-12 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-1 text-center text-[11px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30 md:w-12"
          />
          <span className="hidden text-[12px] font-light text-[var(--app-text-secondary)] md:inline">
            / {totalPages}
          </span>
        </div>

        <Button
          variant="outline"
          size="icon"
          aria-label="Ir para a próxima página"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() =>
            onPageChange((currentPage) => Math.min(totalPages, currentPage + 1))
          }
          disabled={page === totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Ir para a última página"
          className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages}
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
