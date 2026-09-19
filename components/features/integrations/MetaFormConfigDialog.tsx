import { useEffect, useMemo, useState } from "react";
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
import { Check, ChevronsUpDown, Globe, FileText, Home, Plus, RefreshCw, Route, Tag } from "lucide-react";
import { useProperties } from "@/hooks/use-properties";
import { MetaForm, MetaFormConfig, useSaveFormConfig } from "@/hooks/use-meta-forms";
import { useRoundRobins } from "@/hooks/use-round-robins";
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { PropertyPickerDialog } from "@/components/features/properties/PropertyPickerDialog";
import { DistributionQueueEditor } from "@/components/features/round-robin/DistributionQueueEditor";
import { useCreateQueueAdvanced } from "@/hooks/use-create-queue-advanced";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useTags } from "@/hooks/use-tags";
import { searchTextIncludes } from "@/lib/search-text";
import { cn } from "@/lib/utils";
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
  const [queuePickerOpen, setQueuePickerOpen] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");

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
  const {
    data: allRoundRobins = [],
    isLoading: roundRobinsLoading,
    isFetching: roundRobinsFetching,
    isError: roundRobinsError,
  } = useRoundRobins({
    enabled: open && canManageDistribution,
  });
  const tagsQuery = useTags({ enabled: open });
  const saveConfig = useSaveFormConfig();
  const createQueue = useCreateQueueAdvanced();
  const roundRobins = useMemo(
    () => open
      ? allRoundRobins
          .filter((queue) => queue.is_active)
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    [allRoundRobins, open],
  );
  const selectedRoundRobin = useMemo(
    () => roundRobins.find((queue) => queue.id === roundRobinId),
    [roundRobinId, roundRobins],
  );
  const matchingRoundRobins = useMemo(
    () => queueSearch.trim()
      ? roundRobins.filter((queue) => searchTextIncludes(queue.name, queueSearch))
      : roundRobins,
    [queueSearch, roundRobins],
  );

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
  const mappedCount = Object.values(fieldMapping).filter(
    (value) => Boolean(value) && value !== "_ignore"
  ).length;

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
      const defaultValues: Record<string, unknown> = {
        purpose,
        auto_tags: selectedTags,
      };
      if (propertyId) {
        defaultValues.property_id = propertyId;
      }

      await saveConfig.mutateAsync({
        integrationId,
        formId: form.id,
        formName: form.name,
        propertyId: propertyId || null,
        roundRobinId: roundRobinId || null,
        purpose,
        source: null,
        sourceDetails: null,
        defaultValues,
        autoTags: selectedTags,
        fieldMapping,
        customFieldsConfig: customFields,
        isActive: true,
      });

      handleOpenChange(false);
    } catch {
      // The mutation owns the error feedback; keep the dialog open for retry.
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!saveConfig.isPending) {
      if (!nextOpen) {
        setQueuePickerOpen(false);
        setQueueSearch("");
      }
      onOpenChange(nextOpen);
    }
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
                      onValueChange={(value) => updateFieldMapping(question.key, value)}
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
                        Fila (opcional)
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
                    <Popover
                      open={queuePickerOpen}
                      onOpenChange={(nextOpen) => {
                        setQueuePickerOpen(nextOpen);
                        if (!nextOpen) setQueueSearch("");
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={queuePickerOpen}
                          aria-busy={roundRobinsLoading || roundRobinsFetching}
                          disabled={roundRobinsLoading}
                          className="h-10 w-full justify-between rounded-[6px] px-3 font-normal"
                        >
                          <span className="truncate">
                            {roundRobinsLoading
                              ? "Carregando filas..."
                              : selectedRoundRobin?.name || (roundRobinId ? "Fila indisponível" : "Sem fila")}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="z-[160] w-[var(--radix-popover-trigger-width)] min-w-64 p-1"
                      >
                        <Command shouldFilter={false}>
                          <CommandInput
                            placeholder="Buscar fila..."
                            value={queueSearch}
                            onValueChange={setQueueSearch}
                          />
                          <CommandList className="max-h-64">
                            {roundRobinsError && (
                              <p className="px-2 py-3 text-center text-sm text-destructive">
                                Não foi possível carregar as filas.
                              </p>
                            )}
                            {!roundRobinsError && matchingRoundRobins.length === 0 && (
                              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                                Nenhuma fila encontrada.
                              </p>
                            )}
                            <CommandGroup>
                              <CommandItem
                                value="sem fila"
                                onSelect={() => {
                                  setRoundRobinId("");
                                  setQueueSearch("");
                                  setQueuePickerOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", roundRobinId ? "opacity-0" : "opacity-100")} />
                                Sem fila
                              </CommandItem>
                              {matchingRoundRobins.map((queue) => (
                                <CommandItem
                                  key={queue.id}
                                  value={`${queue.name} ${queue.id}`}
                                  onSelect={() => {
                                    setRoundRobinId(queue.id);
                                    setQueueSearch("");
                                    setQueuePickerOpen(false);
                                  }}
                                >
                                  <Check className={cn("mr-2 h-4 w-4", roundRobinId === queue.id ? "opacity-100" : "opacity-0")} />
                                  <span className="truncate">{queue.name}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
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
                  <Label>Imóvel (opcional)</Label>
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
                  <SearchableTagPicker
                    tags={tagsQuery.data || []}
                    selectedTagIds={selectedTags}
                    onToggleTag={toggleTag}
                    loading={tagsQuery.isLoading || tagsQuery.isFetching}
                    error={tagsQuery.error}
                    placeholder="Selecionar tags"
                    maxSelected={100}
                  />
                </div>
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row gap-2 border-t border-[var(--app-border)] p-4 sm:justify-end">
          <Button type="button" variant="outline" className="rounded-[6px]" onClick={() => handleOpenChange(false)} disabled={saveConfig.isPending}>
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
