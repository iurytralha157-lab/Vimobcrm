"use client";

import { useRef } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME,
  FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME,
} from "@/config/form-wizard";

type FormWizardDiscardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  busy?: boolean;
};

export function FormWizardDiscardDialog({ open, onOpenChange, onConfirm, busy = false }: FormWizardDiscardDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const confirmedRef = useRef(false);

  return (
    <AlertDialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <AlertDialogContent
        onOpenAutoFocus={() => {
          confirmedRef.current = false;
          returnFocusRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (confirmedRef.current || !target?.isConnected) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
          <AlertDialogDescription>As alterações que ainda não foram salvas serão descartadas.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME}>Continuar editando</AlertDialogCancel>
          <AlertDialogAction disabled={busy} className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} onClick={() => {
            confirmedRef.current = true;
            onConfirm();
          }}>Descartar alterações</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
