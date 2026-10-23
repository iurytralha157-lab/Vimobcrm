"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  PropertyDevelopmentMaintenanceKind,
  PropertyDevelopmentWorkspace,
} from "@/lib/validation";
import { DEVELOPMENT_MAINTENANCE_FIELDS } from "@/components/features/properties/developments/development-maintenance-fields";

export function DevelopmentMaintenanceFields({
  kind,
  record,
  phases,
  pending,
  scopeValid,
  onDirty,
  onSubmit,
  onCancel,
}: {
  kind: PropertyDevelopmentMaintenanceKind;
  record: Record<string, unknown>;
  phases: PropertyDevelopmentWorkspace["phases"];
  pending: boolean;
  scopeValid: boolean;
  onDirty: (value: boolean) => void;
  onSubmit: (changes: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const fields = DEVELOPMENT_MAINTENANCE_FIELDS[kind].map((field) =>
    field.key === "phase_id"
      ? {
          ...field,
          options: Object.fromEntries(
            phases.map((phase) => [phase.id, phase.name]),
          ),
        }
      : field,
  );
  const initial = Object.fromEntries(
    fields.map((field) => [
      field.key,
      record[field.key] == null
        ? ""
        : field.type === "date"
          ? String(record[field.key]).slice(0, 10)
          : String(record[field.key]),
    ]),
  );
  const [values, setValues] = useState(initial);
  const changed = fields.filter(
    (field) => values[field.key] !== initial[field.key],
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const changes = Object.fromEntries(
      changed.map((field) => [
        field.key,
        field.type === "number"
          ? values[field.key] === ""
            ? null
            : Number(values[field.key])
          : values[field.key].trim() || null,
      ]),
    );
    await onSubmit(changes);
  };
  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <fieldset
        disabled={pending || !scopeValid}
        className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-1 pb-1 sm:grid-cols-2"
      >
        {fields.map((field) => (
          <div
            key={field.key}
            className={
              field.type === "textarea"
                ? "space-y-1 sm:col-span-2"
                : "space-y-1"
            }
          >
            <Label
              className="text-xs font-light"
              htmlFor={`maintenance-${field.key}`}
            >
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {field.options ? (
              <Select
                value={values[field.key]}
                disabled={pending || !scopeValid}
                onValueChange={(value) => {
                  setValues((current) => ({
                    ...current,
                    [field.key]: value,
                  }));
                  onDirty(true);
                }}
              >
                <SelectTrigger
                  id={`maintenance-${field.key}`}
                  className="h-9 text-xs"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(field.options).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "textarea" ? (
              <Textarea
                id={`maintenance-${field.key}`}
                className="min-h-20 text-xs"
                rows={3}
                maxLength={field.maxLength}
                value={values[field.key]}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    [field.key]: event.target.value,
                  }));
                  onDirty(true);
                }}
              />
            ) : (
              <Input
                id={`maintenance-${field.key}`}
                className="h-9 text-xs"
                type={field.type ?? "text"}
                required={field.required}
                min={field.type === "number" ? 0 : undefined}
                step={field.type === "number" ? "any" : undefined}
                maxLength={field.maxLength}
                value={values[field.key]}
                onChange={(event) => {
                  setValues((current) => ({
                    ...current,
                    [field.key]:
                      field.key === "state"
                        ? event.target.value.toUpperCase()
                        : event.target.value,
                  }));
                  onDirty(true);
                }}
              />
            )}
          </div>
        ))}
      </fieldset>
      <DialogFooter className="shrink-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || !scopeValid || changed.length === 0}
        >
          {pending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Salvar alterações
        </Button>
      </DialogFooter>
    </form>
  );
}
