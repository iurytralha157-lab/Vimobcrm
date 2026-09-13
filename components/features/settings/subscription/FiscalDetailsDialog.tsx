import type { ReactNode } from "react";
import { Building2, Loader2, User } from "lucide-react";

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
import { cn } from "@/lib/utils";

import type { BillingInfo } from "./types";

type FiscalDetailsDialogProps = {
  billingInfo: BillingInfo;
  open: boolean;
  saving: boolean;
  onAutoFillFromOrganization: () => void;
  onAutoFillFromUser: () => void;
  onBillingInfoChange: (billingInfo: BillingInfo) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
};

export function FiscalDetailsDialog({
  billingInfo,
  open,
  saving,
  onAutoFillFromOrganization,
  onAutoFillFromUser,
  onBillingInfoChange,
  onOpenChange,
  onSave,
}: FiscalDetailsDialogProps) {
  const update = (field: keyof BillingInfo, value: string) => {
    onBillingInfoChange({ ...billingInfo, [field]: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none">
        <DialogHeader>
          <DialogTitle className="text-[14px] font-normal">
            Dados fiscais
          </DialogTitle>
          <DialogDescription>
            Usados no cadastro do pagador e na emissão dos documentos
            financeiros.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onAutoFillFromUser}>
            <User className="h-3.5 w-3.5" /> Usar meu perfil
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onAutoFillFromOrganization}
          >
            <Building2 className="h-3.5 w-3.5" /> Usar dados da empresa
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nome / Razão social">
            <Input
              value={billingInfo.name}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field label="CPF ou CNPJ">
            <Input
              value={billingInfo.taxId}
              onChange={(event) => update("taxId", event.target.value)}
            />
          </Field>
          <Field label="E-mail financeiro">
            <Input
              type="email"
              value={billingInfo.email}
              onChange={(event) => update("email", event.target.value)}
            />
          </Field>
          <Field label="Telefone">
            <Input
              value={billingInfo.telefone}
              onChange={(event) => update("telefone", event.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-6">
          <Field label="CEP" className="md:col-span-2">
            <Input
              value={billingInfo.cep}
              onChange={(event) => update("cep", event.target.value)}
            />
          </Field>
          <Field label="Endereço" className="md:col-span-3">
            <Input
              value={billingInfo.endereco}
              onChange={(event) => update("endereco", event.target.value)}
            />
          </Field>
          <Field label="Número">
            <Input
              value={billingInfo.numero}
              onChange={(event) => update("numero", event.target.value)}
            />
          </Field>
          <Field label="Complemento" className="md:col-span-2">
            <Input
              value={billingInfo.complemento}
              onChange={(event) => update("complemento", event.target.value)}
            />
          </Field>
          <Field label="Bairro" className="md:col-span-2">
            <Input
              value={billingInfo.bairro}
              onChange={(event) => update("bairro", event.target.value)}
            />
          </Field>
          <Field label="UF">
            <Input
              value={billingInfo.uf}
              maxLength={2}
              onChange={(event) => update("uf", event.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Cidade">
            <Input
              value={billingInfo.cidade}
              onChange={(event) => update("cidade", event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar dados fiscais
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
