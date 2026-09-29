"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { whatsappContactNameSchema } from "@/lib/validation/whatsapp-calls";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactName: string;
  contactPhone: string;
  leadLinked: boolean;
  busy: boolean;
  onSave: (fullName: string) => Promise<void>;
};

export function SaveWhatsAppContactDialog({
  open,
  onOpenChange,
  contactName,
  contactPhone,
  leadLinked,
  busy,
  onSave,
}: Props) {
  const [name, setName] = useState(contactName);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = whatsappContactNameSchema.safeParse(name);
    if (!parsed.success) {
      setError("Informe um nome de 2 a 120 caracteres.");
      return;
    }
    setError(null);
    await onSave(parsed.data);
  };

  return (
    <Dialog open={open} onOpenChange={busy ? undefined : onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Salvar contato no WhatsApp</DialogTitle>
          <DialogDescription>
            O nome será salvo na conta WhatsApp desta conexão. A agenda nativa do celular pode usar outra sincronização.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="whatsapp-contact-name">Nome</Label>
            <Input
              id="whatsapp-contact-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              disabled={busy || leadLinked}
              autoFocus={!leadLinked}
            />
            {leadLinked && <p className="text-xs text-muted-foreground">Para mudar o nome, edite o lead antes de salvar.</p>}
          </div>
          <p className="text-sm text-muted-foreground">{contactPhone}</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !contactPhone}>
              {busy ? "Salvando..." : "Salvar contato"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
