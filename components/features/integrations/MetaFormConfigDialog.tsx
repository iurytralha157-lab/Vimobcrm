import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Globe, FileText, Home, Plus, RefreshCw, Route, Tag } from "lucide-react";
import { useProperties } from "@/hooks/use-properties";
import { MetaForm, MetaFormConfig, useSaveFormConfig } from "@/hooks/use-meta-forms";
import { useRoundRobins } from "@/hooks/use-round-robins";
import { InlineTagSelector } from "@/components/ui/tag-selector";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { DistributionQueueEditor } from "@/components/features/round-robin/DistributionQueueEditor";
import { useCreateQueueAdvanced } from "@/hooks/use-create-queue-advanced";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";

interface MetaFormConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: MetaForm | null;
  config?: MetaFormConfig;
  integrationId: string;
  pageName?: string | null;
}

const LEAD_FIELDS = [
  { key: "name", label: "Nome" },
  { key: "email", label: "E-mail" },
  { key: "phone", label: "Telefone" },
  { key: "message", label: "Mensagem" },
  { key: "cargo", label: "Cargo" },
  { key: "empresa", label: "Empresa" },
  { key: "cidade", label: "Cidade" },
  { key: "bairro", label: "Bairro" },
  { key: "custom", label: "Campo extra" },
];

const FALLBACK_META_FIELDS = [
  { key: "full_name", label: "Full name", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone_number", label: "Phone number", type: "phone" },
  { key: "message", label: "Mensagem", type: "text" },
];

const PURPOSE_OPTIONS = ["Venda", "Aluguel", "Temporada", "Permuta"];

const guessLeadField = (question: { key: string; label: string }) => {
  const text = `${question.key} ${question.label}`.toLowerCase();
  if (text.includes("nome") || text.includes("name")) return "name";
  if (text.includes("email") || text.includes("e-mail")) return "email";
  if (text.includes("phone") || text.includes("fone") || text.includes("telefone") || text.includes("whatsapp")) return "phone";
  if (text.includes("mensagem") || text.includes("message") || text.includes("observ")) return "message";
  if (text.includes("cidade") || text.includes("city")) return "cidade";
  if (text.includes("bairro") || text.includes("neighborhood")) return "bairro";
  return "";
};

export function MetaFormConfigDialog({
  open,
  onOpenChange,
  form,
  config,
  integrationId,
  pageName,
}: MetaFormConfigDialogProps) {
  const [propertyId, setPropertyId] = useState("");
  const [roundRobinId, setRoundRobinId] = useState("");
  const [purpose, setPurpose] = useState("Venda");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<string[]>([]);
  const [queueEditorOpen, setQueueEditorOpen] = useState(false);

  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const hasPropertiesModule = hasModule("properties");
  const canViewProperties =
    hasPropertiesModule &&
    (hasPermission("property_view") || hasPermission("property_manage"));
  const canManageDistribution = hasPermission("distribution_manage");
  const { data: properties } = useProperties(undefined, {}, {
    enabled: open && canViewProperties,
  });
  const { data: allRoundRobins = [] } = useRoundRobins({
    enabled: open && canManageDistribution,
  });
  const saveConfig = useSaveFormConfig();
  const createQueue = useCreateQueueAdvanced();
  const roundRobins = open
    ? allRoundRobins.filter((queue) => queue.is_active).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      if (config) {
        setPropertyId(config.property_id || "");
        setRoundRobinId(config.round_robin_id || "");
        setPurpose(config.purpose || "Venda");
        setSelectedTags(config.auto_tags || []);
        setFieldMapping(config.field_mapping || {});
        setCustomFields(config.custom_fields_config || []);
        return;
      }

      const questions = form?.questions?.length ? form.questions : FALLBACK_META_FIELDS;
      setPropertyId("");
      setRoundRobinId("");
      setPurpose("Venda");
      setSelectedTags([]);
      setFieldMapping(
        Object.fromEntries(
          questions
            .map((question) => [question.key, guessLeadField(question)])
            .filter(([, value]) => value)
        )
      );
      setCustomFields([]);
    });

    return () => {
      cancelled = true;
    };
  }, [config, form, open]);

  if (!open || !form) return null;

  const formQuestions = form.questions?.length ? form.questions : FALLBACK_META_FIELDS;
  const mappedCount = Object.values(fieldMapping).filter(Boolean).length;

  const updateFieldMapping = (metaField: string, crmField: string) => {
    setFieldMapping((prev) => ({
      ...prev,
      [metaField]: crmField,
    }));

    if (crmField === "custom" && !customFields.includes(metaField)) {
      setCustomFields((prev) => [...prev, metaField]);
    } else if (crmField !== "custom" && customFields.includes(metaField)) {
      setCustomFields((prev) => prev.filter((field) => field !== metaField));
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const handleSave = async () => {
    try {
      await saveConfig.mutateAsync({
        integrationId,
        formId: form.id,
        formName: form.name,
        propertyId: propertyId || undefined,
        roundRobinId: roundRobinId || null,
        purpose,
        source: null,
        sourceDetails: null,
        defaultValues: {
          purpose,
          property_id: propertyId || null,
          auto_tags: selectedTags,
        },
        autoTags: selectedTags,
        fieldMapping,
        customFieldsConfig: customFields,
        isActive: true,
      });

      onOpenChange(false);
    } catch {
      // The mutation owns the error feedback; keep the dialog open for retry.
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!saveConfig.isPending) onOpenChange(nextOpen);
  };

  return (
    <>
    <Dialog key={form.id} open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="app-card max-h-[90vh] w-[96vw] overflow-hidden rounded-[8px] p-0 sm:w-full sm:max-w-4xl">
        <DialogHeader className="border-b border-[var(--app-border)] px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-normal">
            <Globe className="h-5 w-5 text-primary" />
            Configurar formulário Meta
          </DialogTitle>
          <DialogDescription>
            {form.name} · {pageName || "Página conectada"}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[66vh]">
          <div className="space-y-5 p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="flex items-center gap-2 text-[14px] font-normal">
                    <FileText className="h-4 w-4 text-primary" />
                    Campos do lead
                  </h4>
                  <p className="text-xs text-muted-foreground">Mapeie só o que precisa entrar no CRM.</p>
                </div>
                <Badge variant="outline">{mappedCount}/{formQuestions.length}</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {formQuestions.map((question) => (
                  <div key={question.key} className="app-card-soft space-y-2 p-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-normal">{question.label || question.key}</p>
                    </div>
                    <Select
                      value={fieldMapping[question.key] || "_ignore"}
                      onValueChange={(value) => updateFieldMapping(question.key, value === "_ignore" ? "" : value)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_ignore">Ignorar</SelectItem>
                        {LEAD_FIELDS.map((field) => (
                          <SelectItem key={field.key} value={field.key}>{field.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <div className="space-y-4">
              <div>
                <h4 className="flex items-center gap-2 text-[14px] font-normal">
                  <Home className="h-4 w-4 text-primary" />
                  Configuração do lead
                </h4>
                <p className="text-xs text-muted-foreground">A origem continua vindo automaticamente da Meta.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Finalidade</Label>
                  <Select value={purpose} onValueChange={setPurpose}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {PURPOSE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {canManageDistribution ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="flex items-center gap-2">
                        <Route className="h-3.5 w-3.5 text-primary" />
                        Fila
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 rounded-[6px] px-2 text-xs"
                        onClick={() => setQueueEditorOpen(true)}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Nova fila
                      </Button>
                    </div>
                    <Select value={roundRobinId || "_none"} onValueChange={(value) => setRoundRobinId(value === "_none" ? "" : value)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione uma fila" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">Sem fila</SelectItem>
                        {roundRobins.map((queue) => (
                          <SelectItem key={queue.id} value={queue.id}>{queue.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-soft)] px-3 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-medium text-[var(--app-text-primary)]">
                      <Route className="h-3.5 w-3.5 text-[var(--app-text-tertiary)]" />
                      Fila de distribuição
                    </p>
                    <p className="mt-1 text-xs text-[var(--app-text-tertiary)]">
                      Seu perfil não pode consultar ou alterar filas. A configuração atual será preservada.
                    </p>
                  </div>
                )}
              </div>

              <div className={canViewProperties
                ? "grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]"
                : "grid grid-cols-1 gap-4"
              }>
                {canViewProperties && <div className="space-y-2">
                  <Label>Imóvel</Label>
                  <div className="flex gap-2">
                    <PropertyPickerDialog
                      properties={properties || []}
                      selectedPropertyId={propertyId || null}
                      onSelect={(property) => setPropertyId(property.id)}
                    />
                    {propertyId && (
                      <Button type="button" variant="outline" className="h-10 rounded-[6px]" onClick={() => setPropertyId("")}>
                        Limpar
                      </Button>
                    )}
                  </div>
                </div>}

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    Tags
                  </Label>
                  <InlineTagSelector
                    selectedTagIds={selectedTags}
                    onToggleTag={toggleTag}
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row gap-2 border-t border-[var(--app-border)] p-4 sm:justify-end">
          <Button type="button" variant="outline" className="rounded-[6px]" onClick={() => onOpenChange(false)} disabled={saveConfig.isPending}>
            Cancelar
          </Button>
          <Button type="button" className="min-w-[140px] rounded-[6px] bg-primary/50 text-primary-foreground shadow-none hover:bg-primary" onClick={handleSave} disabled={saveConfig.isPending}>
            {saveConfig.isPending && <RefreshCw className="h-4 w-4 mr-2 animate-spin" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {canManageDistribution && (
      <DistributionQueueEditor
        open={queueEditorOpen}
        onOpenChange={setQueueEditorOpen}
        onSave={async (data) => {
          const createdQueue = await createQueue.mutateAsync(data);
          setRoundRobinId(createdQueue.id);
        }}
      />
    )}
    </>
  );
}
