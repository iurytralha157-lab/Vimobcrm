"use client";

import type { ReactNode } from "react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FORM_WIZARD_DIALOG_CLASS_NAME } from "@/config/form-wizard";
import { cn } from "@/lib/utils";
import styles from "./property-form-fields.module.css";

export function PropertyFormDialog({ title, onClose, busy = false, children }: {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <AppLayout title={title} disableMainScroll>
      <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
        <DialogContent
          aria-describedby={undefined}
          className={cn(FORM_WIZARD_DIALOG_CLASS_NAME, styles.surface, busy && "[&>button]:pointer-events-none [&>button]:opacity-40")}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}
        >
          <DialogHeader className="shrink-0 border-b border-[var(--app-border)] px-6 py-5 pr-12">
            <DialogTitle className="text-[16px] font-normal">{title}</DialogTitle>
          </DialogHeader>
          {children}
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
